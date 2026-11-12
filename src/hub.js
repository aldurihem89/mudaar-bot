// Hub: the platform-level Durable Object. One per deployment.
// Knows every household, every login (owner/family by phone + password), the phone → household index
// used to route WhatsApp messages, and the invite tokens. Household data itself lives in each Ledger.
import { normalizePhone } from './wa.js';
import { INVITE_HTML } from './admin_ui.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_name TEXT, owner_phone TEXT,
     status TEXT DEFAULT 'active', created_at TEXT, notes TEXT)`,
  `CREATE TABLE IF NOT EXISTS users (phone TEXT PRIMARY KEY, household_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT,
     pass_hash TEXT, salt TEXT, invite_token TEXT, invite_expires TEXT, created_at TEXT, last_login_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS phone_index (phone TEXT PRIMARY KEY, household_id TEXT NOT NULL, added_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS throttle (key TEXT PRIMARY KEY, count INTEGER DEFAULT 0, window_start INTEGER, locked_until INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_users_household ON users(household_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_invite ON users(invite_token)`,
  `CREATE INDEX IF NOT EXISTS idx_phone_household ON phone_index(household_id)`,
];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

const MAIN = 'main';

async function sha(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const PBKDF2_ITER = 100000; // Workers cap PBKDF2 at 100k iterations
async function pbkdf2(pw, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITER }, key, 256);
  return 'pbkdf2$' + PBKDF2_ITER + '$' + [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashPassword(pw, salt) { return pbkdf2(pw, salt); }
// verifies either the current PBKDF2 format or the legacy salted SHA-256; returns {ok, legacy}
async function verifyPassword(pw, salt, stored) {
  if (!stored) return { ok: false, legacy: false };
  if (stored.startsWith('pbkdf2$')) return { ok: safeEqual(await pbkdf2(pw, salt), stored), legacy: false };
  return { ok: safeEqual(await sha(`mudaar-user:${salt}:${pw}`), stored), legacy: true };
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const now = () => new Date().toISOString();
const slug = () => 'h_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const token = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);

export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => { for (const s of SCHEMA) this.sql.exec(s); });
  }

  q(sql, ...p) { return this.sql.exec(sql, ...p).toArray(); }
  q1(sql, ...p) { return this.q(sql, ...p)[0] || null; }

  ledger(id) { return this.env.LEDGER.get(this.env.LEDGER.idFromName(id)); }

  // The deployment's first household is the platform owner's own house, which already exists under the id "main".
  async ensureMain(origin) {
    if (this.q1(`SELECT 1 FROM households WHERE id = ?`, MAIN)) return this.ensureMainOwner();
    this.sql.exec(`INSERT INTO households(id, name, owner_name, owner_phone, status, created_at, notes) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      MAIN, 'منزلي', '', '', now(), 'platform');
    await this.importMainPeople();
    this.ensureMainOwner();
  }

  // the platform owner's own house behaves like any other household: its owner has a login row (phone + password via invite)
  ensureMainOwner() {
    const hh = this.q1(`SELECT * FROM households WHERE id = ?`, MAIN);
    if (!hh || !hh.owner_phone || hh.status === 'deleted') return;
    if (this.q1(`SELECT 1 FROM users WHERE household_id = ? AND role = 'owner'`, MAIN)) return;
    if (this.q1(`SELECT 1 FROM users WHERE phone = ?`, hh.owner_phone)) return;
    this.sql.exec(`INSERT INTO users(phone, household_id, role, name, created_at) VALUES (?, ?, 'owner', ?, ?)`, hh.owner_phone, MAIN, hh.owner_name || '', now());
  }

  async importMainPeople() {
    try {
      const r = await this.ledger(MAIN).fetch('https://ledger.internal/internal/people', { headers: { 'x-household': MAIN } });
      const people = r.ok ? await r.json() : [];
      for (const p of people) {
        this.sql.exec(`INSERT OR IGNORE INTO phone_index(phone, household_id, added_at) VALUES (?, ?, ?)`, p.phone, MAIN, now());
        if (p.role === 'owner' && !this.q1(`SELECT 1 FROM households WHERE id = ? AND owner_phone != ''`, MAIN)) {
          this.sql.exec(`UPDATE households SET owner_name = ?, owner_phone = ? WHERE id = ?`, p.name, p.phone, MAIN);
        }
      }
    } catch (e) { /* main ledger not reachable yet; index fills as people are added */ }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('x-public-origin') || '';
    await this.ensureMain(origin);
    const body = method === 'GET' ? {} : await request.json().catch(() => ({}));
    try {
      // ----- routing for the webhook: phone → household -----
      if (path === '/route' && method === 'POST') {
        const out = {};
        for (const ph of body.phones || []) {
          const r = this.q1(`SELECT household_id FROM phone_index WHERE phone = ?`, ph);
          out[ph] = r ? r.household_id : null;
        }
        return json(out);
      }
      // ----- phone index maintenance (called by Ledgers) -----
      if (path === '/phone/claim' && method === 'POST') {
        const phone = normalizePhone(body.phone), hh = body.household;
        const cur = this.q1(`SELECT household_id FROM phone_index WHERE phone = ?`, phone);
        if (cur && cur.household_id !== hh) {
          const other = this.q1(`SELECT name FROM households WHERE id = ?`, cur.household_id);
          return json({ error: `هذا الرقم مسجّل في منزل آخر (${other?.name || cur.household_id})` }, 409);
        }
        this.sql.exec(`INSERT OR REPLACE INTO phone_index(phone, household_id, added_at) VALUES (?, ?, ?)`, phone, hh, now());
        return json({ ok: true });
      }
      if (path === '/phone/release' && method === 'POST') {
        this.sql.exec(`DELETE FROM phone_index WHERE phone = ? AND household_id = ?`, normalizePhone(body.phone), body.household);
        return json({ ok: true });
      }
      // ----- auth -----
      const ip = request.headers.get('x-ip') || '';
      if (path === '/auth/login' && method === 'POST') return this.login(body, ip);
      if (path.startsWith('/invite/')) return this.invite(path.slice('/invite/'.length), method, body, origin, ip);
      // generic limiter used by the Worker for public endpoints: {key, limit, window_ms, lock_ms}
      if (path === '/rl' && method === 'POST') return json(this.hit(String(body.key || 'x'), body.limit || 10, body.window_ms || 60000, body.lock_ms || body.window_ms || 60000));
      // ----- cron fan-out -----
      if (path === '/cron' && method === 'POST') {
        const hhs = this.q(`SELECT id FROM households WHERE status = 'active' OR id = 'main'`);
        const results = [];
        for (const h of hhs) {
          try {
            const r = await this.ledger(h.id).fetch('https://ledger.internal/cron', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-household': h.id }, body: JSON.stringify({ platform: h.id === MAIN }) });
            results.push({ id: h.id, status: r.status });
          } catch (e) { results.push({ id: h.id, error: e.message }); }
        }
        return json({ ok: true, results });
      }
      // ----- admin API (role enforced by the Worker via headers) -----
      const role = request.headers.get('x-role') || '';
      const household = request.headers.get('x-household') || '';
      if (path.startsWith('/api/')) return this.api(path.slice(5), method, body, { role, household, origin, user: request.headers.get('x-user') || '' });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  // ---------- login ----------
  // ---------- throttling (single Hub instance = global counters) ----------
  // hit(key, limit, windowMs, lockMs): counts an event; returns {ok:false, retry_after} once the limit is exceeded.
  hit(key, limit, windowMs, lockMs = windowMs) {
    const t = Date.now();
    if (Math.random() < 0.02) this.sql.exec(`DELETE FROM throttle WHERE (locked_until IS NULL OR locked_until < ?) AND window_start < ?`, t, t - 86400000);
    const r = this.q1(`SELECT * FROM throttle WHERE key = ?`, key);
    if (r && r.locked_until && r.locked_until > t) return { ok: false, retry_after: Math.ceil((r.locked_until - t) / 1000) };
    if (!r || !r.window_start || t - r.window_start > windowMs) {
      this.sql.exec(`INSERT INTO throttle(key, count, window_start, locked_until) VALUES (?, 1, ?, NULL) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start, locked_until = NULL`, key, t);
      return { ok: true, count: 1 };
    }
    const count = r.count + 1;
    if (count > limit) {
      this.sql.exec(`UPDATE throttle SET count = ?, locked_until = ? WHERE key = ?`, count, t + lockMs, key);
      return { ok: false, retry_after: Math.ceil(lockMs / 1000) };
    }
    this.sql.exec(`UPDATE throttle SET count = ? WHERE key = ?`, count, key);
    return { ok: true, count };
  }
  peek(key) {
    const r = this.q1(`SELECT locked_until FROM throttle WHERE key = ?`, key);
    return r && r.locked_until && r.locked_until > Date.now() ? Math.ceil((r.locked_until - Date.now()) / 1000) : 0;
  }
  clear(key) { this.sql.exec(`DELETE FROM throttle WHERE key = ?`, key); }

  async login(body, ip = '') {
    const env = this.env;
    const id = String(body.phone || body.username || '').trim().toLowerCase();
    const pw = String(body.password || '');
    if (!env.ADMIN_PASSWORD) return json({ error: 'لم يُضبط ADMIN_PASSWORD بعد' }, 500);
    // brute-force protection: per identifier (5 failures / 10 min → 15 min lock) and per IP (30 failures / 10 min → 30 min)
    const idKey = 'login:id:' + (normalizePhone(id) || id);
    const ipKey = 'login:ip:' + (ip || 'unknown');
    const lockedFor = Math.max(this.peek(idKey), this.peek(ipKey));
    if (lockedFor) return json({ error: `محاولات كثيرة. حاول بعد ${Math.ceil(lockedFor / 60)} دقيقة.` }, 429);
    const fail = (msg, status = 401) => {
      this.hit(idKey, 5, 10 * 60000, 15 * 60000);
      this.hit(ipKey, 30, 10 * 60000, 30 * 60000);
      return json({ error: msg }, status);
    };
    // platform owner: ADMIN_USER (default "admin") or SUPER_PHONE, with ADMIN_PASSWORD
    const superUser = String(env.ADMIN_USER || 'admin').toLowerCase();
    const superPhone = env.SUPER_PHONE ? normalizePhone(env.SUPER_PHONE) : '';
    const kind = body.kind === 'admin' ? 'admin' : body.kind === 'owner' ? 'owner' : '';
    if (kind !== 'owner' && safeEqual(pw, env.ADMIN_PASSWORD) && (id === superUser || (superPhone && normalizePhone(id) === superPhone))) {
      this.clear(idKey);
      const main = this.q1(`SELECT * FROM households WHERE id = ?`, MAIN);
      return json({ ok: true, session: { h: MAIN, r: 'super', u: id, n: main?.owner_name || 'مدير مُدار', hn: 'لوحة المنصة' } });
    }
    if (kind === 'admin') return fail('اسم المستخدم أو كلمة المرور غير صحيحة');
    const phone = normalizePhone(id);
    const u = phone ? this.q1(`SELECT * FROM users WHERE phone = ?`, phone) : null;
    // same message and similar timing whether or not the number exists
    if (!u || !u.pass_hash) { await pbkdf2(pw, 'no-such-user'); return fail('الرقم أو كلمة المرور غير صحيحة'); }
    const v = await verifyPassword(pw, u.salt, u.pass_hash);
    if (!v.ok) return fail('الرقم أو كلمة المرور غير صحيحة');
    const hh = this.q1(`SELECT * FROM households WHERE id = ?`, u.household_id);
    if (!hh || hh.status !== 'active') return json({ error: 'هذا المنزل موقوف حالياً' }, 403);
    if (v.legacy) { // transparent upgrade of the stored hash
      const salt = crypto.randomUUID();
      this.sql.exec(`UPDATE users SET pass_hash = ?, salt = ? WHERE phone = ?`, await hashPassword(pw, salt), salt, phone);
    }
    this.clear(idKey);
    this.sql.exec(`UPDATE users SET last_login_at = ? WHERE phone = ?`, now(), phone);
    return json({ ok: true, session: { h: u.household_id, r: u.role, u: phone, n: u.name || '', hn: hh.name } });
  }

  // ---------- invite (owner sets a password) ----------
  async invite(tok, method, body, origin, ip = '') {
    if (!/^[a-f0-9]{20,64}$/.test(tok)) return html(INVITE_HTML({ error: 'رابط الدعوة غير صالح أو انتهت صلاحيته.' }), 404);
    const u = this.q1(`SELECT * FROM users WHERE invite_token = ?`, tok);
    if (!u) {
      const r = this.hit('invite:ip:' + (ip || 'unknown'), 20, 10 * 60000, 30 * 60000);
      return html(INVITE_HTML({ error: r.ok ? 'رابط الدعوة غير صالح أو انتهت صلاحيته.' : 'محاولات كثيرة، حاول لاحقاً.' }), r.ok ? 404 : 429);
    }
    if (u.invite_expires && u.invite_expires < now()) return html(INVITE_HTML({ error: 'انتهت صلاحية رابط الدعوة. اطلب رابطاً جديداً من مُدار.' }), 410);
    const hh = this.q1(`SELECT * FROM households WHERE id = ?`, u.household_id);
    if (method === 'GET') return html(INVITE_HTML({ name: u.name, household: hh?.name || '', phone: u.phone, token: tok }));
    const pw = String(body.password || '');
    if (pw.length < 6) return json({ error: 'كلمة المرور 6 أحرف على الأقل' }, 400);
    const salt = crypto.randomUUID();
    this.sql.exec(`UPDATE users SET pass_hash = ?, salt = ?, invite_token = NULL, invite_expires = NULL, last_login_at = ? WHERE phone = ?`,
      await hashPassword(pw, salt), salt, now(), u.phone);
    return json({ ok: true, session: { h: u.household_id, r: u.role, u: u.phone, n: u.name || '', hn: hh?.name || '' } });
  }

  // ---------- admin API ----------
  async api(route, method, body, ctx) {
    const [res, id, sub] = route.split('/');
    const isSuper = ctx.role === 'super';
    const isOwner = isSuper || ctx.role === 'owner';

    if (res === 'me') {
      const hh = this.q1(`SELECT * FROM households WHERE id = ?`, ctx.household);
      return json({ role: ctx.role, user: ctx.user, household: ctx.household, household_name: hh?.name || '' });
    }

    // -- family accounts of the caller's household (owner) --
    if (res === 'account' && id === 'family') {
      if (!isOwner) return json({ error: 'لربّ البيت فقط' }, 403);
      if (method === 'GET') return json(this.q(`SELECT phone, name, created_at, last_login_at FROM users WHERE household_id = ? AND role = 'family' ORDER BY created_at`, ctx.household));
      if (method === 'PUT') {
        const phone = normalizePhone(body.phone);
        const pw = String(body.password || '');
        if (!phone || phone.length < 9) return json({ error: 'رقم الجوال غير صالح' }, 400);
        if (pw.length < 6) return json({ error: 'كلمة المرور 6 أحرف على الأقل' }, 400);
        const other = this.q1(`SELECT household_id, role FROM users WHERE phone = ?`, phone);
        if (other && (other.household_id !== ctx.household || other.role !== 'family')) return json({ error: 'هذا الرقم مستخدم لحساب آخر' }, 409);
        const salt = crypto.randomUUID();
        this.sql.exec(`INSERT INTO users(phone, household_id, role, name, pass_hash, salt, created_at) VALUES (?, ?, 'family', ?, ?, ?, ?)
                       ON CONFLICT(phone) DO UPDATE SET name = excluded.name, pass_hash = excluded.pass_hash, salt = excluded.salt`,
          phone, ctx.household, String(body.name || '').trim().slice(0, 60), await hashPassword(pw, salt), salt, now());
        return json({ ok: true });
      }
      if (method === 'DELETE' && sub) {
        this.sql.exec(`DELETE FROM users WHERE phone = ? AND household_id = ? AND role = 'family'`, normalizePhone(sub), ctx.household);
        return json({ ok: true });
      }
    }

    // -- households console (super) --
    if (res === 'households') {
      if (!isSuper) return json({ error: 'لمدير المنصة فقط' }, 403);
      if (method === 'GET' && !id) {
        if (!this.q1(`SELECT 1 FROM households WHERE id = ? AND (owner_phone != '' OR status = 'deleted')`, MAIN)) { await this.importMainPeople(); this.ensureMainOwner(); }
        const list = this.q(`SELECT * FROM households WHERE status != 'deleted' ORDER BY CASE id WHEN 'main' THEN 0 ELSE 1 END, created_at DESC`);
        return json(list.map((h) => {
          const owner = this.q1(`SELECT phone, name, pass_hash, invite_token, invite_expires, last_login_at FROM users WHERE household_id = ? AND role = 'owner'`, h.id);
          const phones = this.q1(`SELECT COUNT(*) AS n FROM phone_index WHERE household_id = ?`, h.id).n;
          return { ...h, owner_set_password: Boolean(owner?.pass_hash), invite_url: owner?.invite_token ? `${ctx.origin}/invite/${owner.invite_token}` : null,
                   invite_expires: owner?.invite_expires || null, last_login_at: owner?.last_login_at || null, phones };
        }));
      }
      if (method === 'POST' && !id) {
        const name = String(body.name || '').trim().slice(0, 80);
        const ownerName = String(body.owner_name || '').trim().slice(0, 60);
        const phone = normalizePhone(body.owner_phone);
        if (!name) return json({ error: 'اسم المنزل مطلوب' }, 400);
        if (!ownerName) return json({ error: 'اسم ربّ الأسرة مطلوب' }, 400);
        if (!phone || phone.length < 9) return json({ error: 'رقم جوال ربّ الأسرة غير صالح' }, 400);
        if (this.q1(`SELECT 1 FROM phone_index WHERE phone = ?`, phone)) return json({ error: 'هذا الرقم مسجّل في منزل آخر' }, 409);
        if (this.q1(`SELECT 1 FROM users WHERE phone = ?`, phone)) return json({ error: 'هذا الرقم له حساب دخول بالفعل' }, 409);
        const hid = slug();
        const tok = token();
        const exp = new Date(Date.now() + 7 * 86400000).toISOString();
        this.sql.exec(`INSERT INTO households(id, name, owner_name, owner_phone, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`, hid, name, ownerName, phone, now());
        this.sql.exec(`INSERT INTO users(phone, household_id, role, name, invite_token, invite_expires, created_at) VALUES (?, ?, 'owner', ?, ?, ?, ?)`, phone, hid, ownerName, tok, exp, now());
        this.sql.exec(`INSERT OR REPLACE INTO phone_index(phone, household_id, added_at) VALUES (?, ?, ?)`, phone, hid, now());
        // prepare the household's own ledger: name, origin, owner as first person
        await this.ledger(hid).fetch('https://ledger.internal/internal/bootstrap', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-household': hid, 'x-public-origin': ctx.origin },
          body: JSON.stringify({ household_id: hid, household_name: name, owner_name: ownerName, owner_phone: phone }),
        }).catch(() => {});
        return json({ ok: true, id: hid, invite_url: `${ctx.origin}/invite/${tok}` });
      }
      if (id && sub === 'invite' && method === 'POST') {
        const tok = token();
        const exp = new Date(Date.now() + 7 * 86400000).toISOString();
        this.sql.exec(`UPDATE users SET invite_token = ?, invite_expires = ? WHERE household_id = ? AND role = 'owner'`, tok, exp, id);
        return json({ ok: true, invite_url: `${ctx.origin}/invite/${tok}` });
      }
      if (id && sub === 'status' && method === 'POST') {
        const st = body.status === 'suspended' ? 'suspended' : 'active';
        if (id === MAIN) return json({ error: 'لا يمكن إيقاف منزل المنصة' }, 400);
        this.sql.exec(`UPDATE households SET status = ? WHERE id = ?`, st, id);
        return json({ ok: true });
      }
      if (id && method === 'PUT') {
        if (id === MAIN && body.owner_phone) {
          this.sql.exec(`UPDATE households SET status = 'active' WHERE id = ? AND status = 'deleted'`, MAIN);
          const ph = normalizePhone(body.owner_phone);
          if (!ph || ph.length < 9) return json({ error: 'رقم الجوال غير صالح' }, 400);
          const taken = this.q1(`SELECT household_id FROM users WHERE phone = ?`, ph);
          if (taken && taken.household_id !== MAIN) return json({ error: 'هذا الرقم له حساب في منزل آخر' }, 409);
          this.sql.exec(`UPDATE households SET owner_name = ?, owner_phone = ? WHERE id = ?`, String(body.owner_name || '').trim().slice(0, 60), ph, MAIN);
          this.sql.exec(`DELETE FROM users WHERE household_id = ? AND role = 'owner' AND phone != ?`, MAIN, ph);
          this.sql.exec(`INSERT OR IGNORE INTO phone_index(phone, household_id, added_at) VALUES (?, ?, ?)`, ph, MAIN, now());
          this.ensureMainOwner();
        }
        if (body.name) this.sql.exec(`UPDATE households SET name = ? WHERE id = ?`, String(body.name).trim().slice(0, 80), id);
        if (body.notes != null) this.sql.exec(`UPDATE households SET notes = ? WHERE id = ?`, String(body.notes).slice(0, 500), id);
        return json({ ok: true });
      }
      if (id && method === 'DELETE') {
        this.sql.exec(`DELETE FROM users WHERE household_id = ?`, id);
        this.sql.exec(`DELETE FROM phone_index WHERE household_id = ?`, id);
        if (id === MAIN) {
          // the platform owner's own house: wipe its house data, hide it; the platform itself (templates, leads, admin phone) stays
          this.sql.exec(`UPDATE households SET status = 'deleted', owner_name = '', owner_phone = '', name = 'منزلي' WHERE id = ?`, MAIN);
        } else {
          this.sql.exec(`DELETE FROM households WHERE id = ?`, id);
        }
        await this.ledger(id).fetch('https://ledger.internal/internal/wipe', { method: 'POST', headers: { 'x-household': id } }).catch(() => {});
        return json({ ok: true });
      }
      if (id && method === 'GET') {
        const hh = this.q1(`SELECT * FROM households WHERE id = ? AND status != 'deleted'`, id);
        return hh ? json(hh) : json({ error: 'غير موجود' }, 404);
      }
    }
    return json({ error: 'route not found' }, 404);
  }
}
