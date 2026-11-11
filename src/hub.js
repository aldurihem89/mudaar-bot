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
    if (this.q1(`SELECT 1 FROM households WHERE id = ?`, MAIN)) return;
    this.sql.exec(`INSERT INTO households(id, name, owner_name, owner_phone, status, created_at, notes) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      MAIN, 'منزلي', '', '', now(), 'platform');
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
      if (path === '/auth/login' && method === 'POST') return this.login(body);
      if (path.startsWith('/invite/')) return this.invite(path.slice('/invite/'.length), method, body, origin);
      // ----- cron fan-out -----
      if (path === '/cron' && method === 'POST') {
        const hhs = this.q(`SELECT id FROM households WHERE status = 'active'`);
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
  async login(body) {
    const env = this.env;
    const id = String(body.phone || body.username || '').trim().toLowerCase();
    const pw = String(body.password || '');
    if (!env.ADMIN_PASSWORD) return json({ error: 'لم يُضبط ADMIN_PASSWORD بعد' }, 500);
    // platform owner: ADMIN_USER (default "admin") or SUPER_PHONE, with ADMIN_PASSWORD
    const superUser = String(env.ADMIN_USER || 'admin').toLowerCase();
    const superPhone = env.SUPER_PHONE ? normalizePhone(env.SUPER_PHONE) : '';
    const kind = body.kind === 'admin' ? 'admin' : body.kind === 'owner' ? 'owner' : '';
    if (kind !== 'owner' && pw === env.ADMIN_PASSWORD && (id === superUser || (superPhone && normalizePhone(id) === superPhone))) {
      const main = this.q1(`SELECT * FROM households WHERE id = ?`, MAIN);
      return json({ ok: true, session: { h: MAIN, r: 'super', u: id, n: main?.owner_name || 'ربّ البيت', hn: main?.name || 'منزلي' } });
    }
    if (kind === 'admin') return json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }, 401);
    const phone = normalizePhone(id);
    const u = phone ? this.q1(`SELECT * FROM users WHERE phone = ?`, phone) : null;
    if (!u || !u.pass_hash) return json({ error: 'الرقم أو كلمة المرور غير صحيحة' }, 401);
    const hh = this.q1(`SELECT * FROM households WHERE id = ?`, u.household_id);
    if (!hh || hh.status !== 'active') return json({ error: 'هذا المنزل موقوف حالياً' }, 403);
    const h = await sha(`mudaar-user:${u.salt}:${pw}`);
    if (h !== u.pass_hash) return json({ error: 'الرقم أو كلمة المرور غير صحيحة' }, 401);
    this.sql.exec(`UPDATE users SET last_login_at = ? WHERE phone = ?`, now(), phone);
    return json({ ok: true, session: { h: u.household_id, r: u.role, u: phone, n: u.name || '', hn: hh.name } });
  }

  // ---------- invite (owner sets a password) ----------
  async invite(tok, method, body, origin) {
    const u = this.q1(`SELECT * FROM users WHERE invite_token = ?`, tok);
    if (!u) return html(INVITE_HTML({ error: 'رابط الدعوة غير صالح أو انتهت صلاحيته.' }), 404);
    if (u.invite_expires && u.invite_expires < now()) return html(INVITE_HTML({ error: 'انتهت صلاحية رابط الدعوة. اطلب رابطاً جديداً من مُدار.' }), 410);
    const hh = this.q1(`SELECT * FROM households WHERE id = ?`, u.household_id);
    if (method === 'GET') return html(INVITE_HTML({ name: u.name, household: hh?.name || '', phone: u.phone, token: tok }));
    const pw = String(body.password || '');
    if (pw.length < 6) return json({ error: 'كلمة المرور 6 أحرف على الأقل' }, 400);
    const salt = crypto.randomUUID();
    this.sql.exec(`UPDATE users SET pass_hash = ?, salt = ?, invite_token = NULL, invite_expires = NULL, last_login_at = ? WHERE phone = ?`,
      await sha(`mudaar-user:${salt}:${pw}`), salt, now(), u.phone);
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
          phone, ctx.household, String(body.name || '').trim().slice(0, 60), await sha(`mudaar-user:${salt}:${pw}`), salt, now());
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
        const list = this.q(`SELECT * FROM households ORDER BY CASE id WHEN 'main' THEN 0 ELSE 1 END, created_at DESC`);
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
        if (body.name) this.sql.exec(`UPDATE households SET name = ? WHERE id = ?`, String(body.name).trim().slice(0, 80), id);
        if (body.notes != null) this.sql.exec(`UPDATE households SET notes = ? WHERE id = ?`, String(body.notes).slice(0, 500), id);
        return json({ ok: true });
      }
      if (id && method === 'DELETE') {
        if (id === MAIN) return json({ error: 'لا يمكن حذف منزل المنصة' }, 400);
        this.sql.exec(`DELETE FROM users WHERE household_id = ?`, id);
        this.sql.exec(`DELETE FROM phone_index WHERE household_id = ?`, id);
        this.sql.exec(`DELETE FROM households WHERE id = ?`, id);
        await this.ledger(id).fetch('https://ledger.internal/internal/wipe', { method: 'POST', headers: { 'x-household': id } }).catch(() => {});
        return json({ ok: true });
      }
      if (id && method === 'GET') {
        const hh = this.q1(`SELECT * FROM households WHERE id = ?`, id);
        return hh ? json(hh) : json({ error: 'غير موجود' }, 404);
      }
    }
    return json({ error: 'route not found' }, 404);
  }
}
