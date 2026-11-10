// The Ledger: a single Durable Object (SQLite-backed) that holds all household data and all bot logic.
import { WA, normalizePhone } from './wa.js';
import { TEMPLATES, TEMPLATE_NAMES } from './templates.js';
import { parsePrefix, parseRecurring, describeRecurrence, ROLE_AR, normalizeAr } from './parse.js';
import * as T from './time.js';
import { ADMIN_HTML, LOGIN_HTML } from './admin_ui.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS people (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
     lang TEXT DEFAULT 'en', gets_summary INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
     last_inbound_at TEXT, state TEXT, state_at TEXT, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS recurring (
     id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, title_l2 TEXT, assignee_role TEXT NOT NULL,
     freq TEXT NOT NULL, days TEXT DEFAULT '', interval_n INTEGER DEFAULT 1, day_of_month INTEGER DEFAULT 1,
     send_time TEXT, deadline_hours REAL DEFAULT 4, remind_after_hours REAL DEFAULT 2, escalate_now INTEGER DEFAULT 0,
     active INTEGER DEFAULT 1, paused_until TEXT, start_date TEXT, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS instances (
     id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, recurring_id INTEGER, title TEXT, title_l2 TEXT,
     assignee_id INTEGER, send_time TEXT, sent_at TEXT, status TEXT DEFAULT 'pending', done_at TEXT,
     defers INTEGER DEFAULT 0, deferred_at TEXT, problem_text TEXT, problem_media TEXT, wa_message_id TEXT,
     reminders INTEGER DEFAULT 0, last_reminded_at TEXT, carried INTEGER DEFAULT 0, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS requests (
     id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, requester_id INTEGER, assignee_id INTEGER,
     text TEXT, text_l2 TEXT, media_id TEXT, status TEXT DEFAULT 'pending', sent_at TEXT, done_at TEXT,
     defers INTEGER DEFAULT 0, deferred_at TEXT, problem_text TEXT, problem_media TEXT,
     reminders INTEGER DEFAULT 0, last_reminded_at TEXT, wa_message_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS shopping (
     id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, added_by INTEGER, item TEXT, status TEXT DEFAULT 'open',
     batch_id TEXT, sent_at TEXT, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS ratings (
     id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, kind TEXT, ref_id INTEGER, rater_id INTEGER,
     score INTEGER, note TEXT, forwarded INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, level TEXT, msg TEXT, data TEXT)`,
  `CREATE TABLE IF NOT EXISTS seen (msg_id TEXT PRIMARY KEY, ts TEXT)`,
  `CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, name TEXT, first_text TEXT, last_text TEXT,
     messages INTEGER DEFAULT 0, interest TEXT, first_at TEXT, last_at TEXT, last_reply_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_inst_date ON instances(date)`,
  `CREATE INDEX IF NOT EXISTS idx_req_created ON requests(created_at)`,
];

const DEFAULT_SETTINGS = {
  bot_name: 'مساعد البيت',
  morning_time: '07:00',
  shopping_time: '16:00',
  summary_time: '20:00',
  quiet_enabled: '1',
  quiet_start: '22:00',
  quiet_end: '07:00',
  default_deadline_hours: '4',
  default_remind_hours: '2',
  last_create_date: '',
  last_shopping_date: '',
  last_summary_date: '',
};

const FACES = { 3: '😊', 2: '😐', 1: '😞' };
const LANG_NAMES = {
  en: 'english', id: 'indonesian', tl: 'tagalog', hi: 'hindi', ur: 'urdu', bn: 'bengali', ne: 'nepali',
  si: 'sinhala', am: 'amharic', sw: 'swahili', fr: 'french', ar: 'arabic',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

export class Ledger {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this._settings = null;
    ctx.blockConcurrencyWhile(async () => this.initSchema());
  }

  // ---------- storage helpers ----------
  initSchema() {
    for (const stmt of SCHEMA) this.sql.exec(stmt);
    for (const col of ['welcome_pending INTEGER DEFAULT 0', 'welcomed_at TEXT']) {
      try { this.sql.exec(`ALTER TABLE people ADD COLUMN ${col}`); } catch (e) { /* already there */ }
    }
    for (const col of ["source TEXT DEFAULT 'whatsapp'", 'city TEXT', 'email TEXT', 'staff TEXT', 'note TEXT', 'ip TEXT']) {
      try { this.sql.exec(`ALTER TABLE leads ADD COLUMN ${col}`); } catch (e) { /* already there */ }
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      this.sql.exec(`INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)`, k, v);
    }
  }
  q(sql, ...p) {
    return this.sql.exec(sql, ...p).toArray();
  }
  q1(sql, ...p) {
    return this.q(sql, ...p)[0] || null;
  }
  run(sql, ...p) {
    this.sql.exec(sql, ...p);
    return this.q1(`SELECT last_insert_rowid() AS id`).id;
  }
  settings() {
    if (!this._settings) {
      this._settings = {};
      for (const r of this.q(`SELECT key, value FROM settings`)) this._settings[r.key] = r.value;
    }
    return this._settings;
  }
  setSetting(k, v) {
    this.sql.exec(`INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, String(v));
    this._settings = null;
  }
  log(level, msg, data) {
    try {
      this.sql.exec(`INSERT INTO log(ts, level, msg, data) VALUES (?, ?, ?, ?)`, T.isoNow(), level, String(msg).slice(0, 500), data ? JSON.stringify(data).slice(0, 4000) : null);
      this.sql.exec(`DELETE FROM log WHERE id < (SELECT MAX(id) FROM log) - 2000`);
    } catch {}
  }
  get off() {
    return parseInt(this.env.TIMEZONE_OFFSET_MINUTES || '180', 10);
  }
  now() {
    return T.nowLocal(this.off);
  }
  today() {
    return T.dateStr(this.now());
  }
  get wa() {
    return new WA(this.env);
  }
  // Welcome flow: greeting with a "received" button → language choice → the one-minute video in that language + contact card.
  // Started now when the person is inside the 24h window, otherwise flagged and started on their first message.
  async sendWelcome(p) {
    const first = (p.name || '').split(' ')[0];
    const ar = `مرحباً ${first} 👋\nأنا مُدار - مساعد البيت. سأرسل لك المهام والطلبات هنا على واتساب، وتردّ بضغطة زر.\nهل وصلتك هذه الرسالة؟`;
    const en = `Hi ${first} 👋\nI'm mudaar - Home Assistant. I'll send you tasks and requests here on WhatsApp, and you reply with one tap.\nDid you receive this message?`;
    const body = p.lang === 'ar' ? ar : `${ar}\n\n${en}`;
    await this.wa.buttons(p.phone, body, [{ id: 'welcome:ack', title: p.lang === 'ar' ? 'نعم، وصلت' : 'وصلت · Received' }]);
    this.sql.exec(`UPDATE people SET welcome_pending = 0, welcomed_at = ? WHERE id = ?`, T.isoNow(), p.id);
    this.log('info', 'welcome sent', { to: p.name });
  }
  async askVideoLanguage(p) {
    return this.wa.buttons(p.phone, 'اختر لغة الفيديو التعريفي 🎬\nChoose the language of the intro video', [
      { id: 'lang:ar', title: 'العربية' },
      { id: 'lang:en', title: 'English' },
    ]);
  }
  async sendWelcomeVideo(p, lang) {
    const origin = this.publicOrigin;
    const l = lang === 'en' ? 'en' : 'ar';
    if (origin) {
      await this.wa.video(p.phone, `${origin}/welcome_${l}.mp4`, l === 'en' ? 'mudaar in one minute 🎬' : 'مُدار في دقيقة 🎬');
    } else {
      this.log('warn', 'welcome video: public origin unknown yet');
    }
    await this.sendContactCard(p, l);
  }

  // vCard of the bot's own number, so people see its name instead of a bare number once saved
  async sendContactCard(p, lang) {
    let phone = this.settings().bot_phone;
    if (!phone) {
      try {
        const info = await this.wa.phoneInfo();
        phone = String(info.display_phone_number || '').replace(/\D/g, '');
        if (phone) this.setSetting('bot_phone', phone);
      } catch (e) { this.log('warn', 'contact card: phone lookup failed', { error: e.message }); }
    }
    if (!phone) return;
    const en = 'Save this contact so my messages show my name instead of a number 👆';
    const ar = 'احفظ هذه البطاقة حتى تظهر رسائلي باسمي بدل الرقم 👆';
    const l = lang || p.lang || 'ar';
    await this.wa.contactCard(p.phone, 'مُدار - مساعد البيت | mudaar - Home Assistant', phone, { org: 'mudaar' });
    await this.wa.text(p.phone, l === 'ar' ? ar : `${ar}\n${en}`);
  }

  get publicOrigin() {
    return this.settings().public_origin || '';
  }

  get botName() {
    return this.settings().bot_name || 'مساعد البيت';
  }

  // ---------- people ----------
  personByPhone(phone) {
    return this.q1(`SELECT * FROM people WHERE phone = ? AND active = 1`, normalizePhone(phone));
  }
  person(id) {
    return this.q1(`SELECT * FROM people WHERE id = ?`, id);
  }
  peopleByRole(role) {
    return this.q(`SELECT * FROM people WHERE role = ? AND active = 1 ORDER BY id`, role);
  }
  owners() {
    return this.q(`SELECT * FROM people WHERE role IN ('owner','family') AND active = 1 ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, id`);
  }
  isHousehold(p) {
    return p && (p.role === 'owner' || p.role === 'family');
  }
  isWorker(p) {
    return p && (p.role === 'maid' || p.role === 'driver');
  }
  canFree(p) {
    return T.hoursSince(p.last_inbound_at) < 23.5;
  }
  setState(p, state) {
    this.sql.exec(`UPDATE people SET state = ?, state_at = ? WHERE id = ?`, state ? JSON.stringify(state) : null, state ? T.isoNow() : null, p.id);
  }
  getState(p, maxMinutes = 30) {
    if (!p.state) return null;
    if (T.hoursSince(p.state_at) * 60 > maxMinutes) {
      this.setState(p, null);
      return null;
    }
    try {
      return JSON.parse(p.state);
    } catch {
      return null;
    }
  }

  // ---------- translation (Workers AI, optional) ----------
  async translate(text, lang) {
    if (!text || !lang || lang === 'ar' || !this.env.AI) return '';
    const target = LANG_NAMES[lang] || lang;
    try {
      const r = await this.env.AI.run('@cf/meta/m2m100-1.2b', { text, source_lang: 'arabic', target_lang: target });
      return (r?.translated_text || '').trim();
    } catch (e) {
      this.log('warn', 'translate failed: ' + e.message);
      return '';
    }
  }

  // ---------- request routing ----------
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/webhook' && request.method === 'POST') {
        const body = await request.json();
        await this.handleWebhook(body);
        return json({ ok: true });
      }
      if (path === '/interest' && request.method === 'POST') return this.webInterest(request, url);
      if (path === '/cron') {
        await this.cron();
        return json({ ok: true });
      }
      const po = request.headers.get('x-public-origin');
      if (po && po !== this.settings().public_origin) this.setSetting('public_origin', po);
      if (path.startsWith('/admin')) return await this.admin(request, url);
      return new Response('not found', { status: 404 });
    } catch (e) {
      this.log('error', e.message, { path, stack: String(e.stack || '').slice(0, 800) });
      return json({ error: e.message }, 500);
    }
  }

  // ---------- webhook ----------
  async handleWebhook(body) {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        for (const msg of value.messages || []) {
          if (this.q1(`SELECT 1 FROM seen WHERE msg_id = ?`, msg.id)) continue;
          this.sql.exec(`INSERT INTO seen(msg_id, ts) VALUES (?, ?)`, msg.id, T.isoNow());
          this.sql.exec(`DELETE FROM seen WHERE ts < ?`, new Date(Date.now() - 3 * 86400000).toISOString());
          try {
            const c = (value.contacts || []).find((x) => x.wa_id === msg.from) || (value.contacts || [])[0];
            msg._profileName = c?.profile?.name || null;
            await this.onMessage(msg);
          } catch (e) {
            this.log('error', 'onMessage: ' + e.message, { msg });
          }
        }
        for (const st of value.statuses || []) {
          if (st.status === 'failed') this.log('warn', 'message failed', st);
        }
      }
    }
  }

  // ---------- website interest form ----------
  async webInterest(request, url) {
    let d = await request.json().catch(() => null);
    if (!d || !Object.keys(d).length) { try { d = JSON.parse(url.searchParams.get('_b') || '{}'); } catch (e) { d = {}; } }
    const ip = request.headers.get('x-ip') || '';
    const clean = (v, n = 200) => String(v || '').trim().slice(0, n);
    const name = clean(d.name, 80), city = clean(d.city, 60), email = clean(d.email, 120), note = clean(d.note, 500), interest = clean(d.interest, 60);
    const phone = normalizePhone(d.phone || '');
    if (d.website) return json({ ok: true }); // honeypot: pretend success
    if (!name) return json({ error: 'الاسم مطلوب' }, 400);
    if (!phone && !email) return json({ error: 'اكتب رقم الجوال أو البريد الإلكتروني' }, 400);
    if (d.t && Date.now() - Number(d.t) < 2500) return json({ ok: true }); // filled faster than a human
    const recent = this.q1(`SELECT COUNT(*) AS n FROM leads WHERE ip = ? AND first_at > ?`, ip, new Date(Date.now() - 3600000).toISOString()).n;
    if (ip && recent >= 5) return json({ error: 'حاول لاحقاً' }, 429);
    const staff = `عاملات ${clean(d.maids, 4)} · سائقون ${clean(d.drivers, 4)}`;
    const now = T.isoNow();
    const key = phone || `email:${email.toLowerCase()}`;
    this.run(`INSERT INTO leads(phone, name, first_text, last_text, messages, interest, first_at, last_at, source, city, email, staff, note, ip)
              VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'web', ?, ?, ?, ?, ?)
              ON CONFLICT(phone) DO UPDATE SET name = excluded.name, last_text = excluded.last_text, messages = messages + 1, interest = excluded.interest,
                last_at = excluded.last_at, city = excluded.city, email = excluded.email, staff = excluded.staff, note = excluded.note`,
      key, name, note, note, interest, now, now, city, email, staff, note, ip);
    this.log('info', 'web interest', { name, city, phone: Boolean(phone), email: Boolean(email) });
    const lines = [`📝 اهتمام جديد من الموقع`, `الاسم: ${name}`, city ? `المدينة: ${city}` : '', phone ? `الجوال: +${phone}` : '', email ? `البريد: ${email}` : '', staff, interest ? `الأهم له: ${interest}` : '', note ? `ملاحظة: ${note}` : ''].filter(Boolean);
    await this.notifyHousehold(lines.join('\n'), 'نموذج الاهتمام').catch(() => {});
    return json({ ok: true });
  }

  // ---------- visitors (numbers not registered in this household, e.g. from the website button) ----------
  async onVisitor(from, msg) {
    const text = msg.text?.body?.trim() || (msg.interactive?.button_reply?.title) || msg.button?.text || '';
    const action = msg.interactive?.button_reply?.id || msg.button?.payload || null;
    const name = msg._profileName || null;
    const now = T.isoNow();
    const lead = this.q1(`SELECT * FROM leads WHERE phone = ?`, from);
    if (!lead) {
      this.run(`INSERT INTO leads(phone, name, first_text, last_text, messages, first_at, last_at) VALUES (?, ?, ?, ?, 1, ?, ?)`, from, name, text, text, now, now);
    } else {
      this.sql.exec(`UPDATE leads SET last_text = ?, messages = messages + 1, last_at = ?, name = COALESCE(?, name) WHERE phone = ?`, text, now, name, from);
    }
    this.wa.markRead(msg.id);
    const fresh = this.q1(`SELECT * FROM leads WHERE phone = ?`, from);
    if (action === 'lead:trial' || action === 'lead:info') {
      const interest = action === 'lead:trial' ? 'تجربة' : 'استفسار';
      this.sql.exec(`UPDATE leads SET interest = ? WHERE phone = ?`, interest, from);
      await this.wa.text(from, action === 'lead:trial'
        ? 'رائع 🙌 سجّلنا اهتمامك بتجربة مُدار لبيتك. سيتواصل معك فريق مُدار على هذا الرقم خلال أيام.\nGreat — we noted your interest in trying mudaar; we will reach out on this number within days.'
        : 'تمام 👍 اكتب استفسارك هنا وسيصل إلى فريق مُدار ويُردّ عليك على هذا الرقم.\nSure — type your question here and the mudaar team will reply on this number.');
      await this.notifyHousehold(`👤 مهتم بمُدار (${interest}): +${from}${fresh.name ? ' · ' + fresh.name : ''}`, 'زائر الموقع');
      return;
    }
    // first contact (or after a quiet day): brand welcome with two buttons; later messages are relayed to the owner
    const replyAgain = !fresh.last_reply_at || T.hoursSince(fresh.last_reply_at) > 24;
    if (replyAgain) {
      await this.wa.buttons(from,
        'أهلًا بك في مُدار 👋\nمُدار مساعد بيت على واتساب: يرسل المهام للعاملة والسائق، يستقبل طلباتك، ويرسل لك تقرير المساء.\nالخدمة الآن في مرحلة تجريبية محدودة. كيف نساعدك؟\n\nWelcome to mudaar — a WhatsApp home assistant for your household staff. We are in a limited pilot. How can we help?',
        [{ id: 'lead:trial', title: 'أرغب بالتجربة' }, { id: 'lead:info', title: 'لديّ استفسار' }]);
      this.sql.exec(`UPDATE leads SET last_reply_at = ? WHERE phone = ?`, now, from);
      this.log('info', 'visitor welcomed', { from, name });
    }
    if (text && fresh.messages > 1) {
      await this.notifyHousehold(`💬 زائر الموقع +${from}${fresh.name ? ' (' + fresh.name + ')' : ''}: ${text}`, 'زائر الموقع');
    } else if (!text && !action) {
      this.log('info', 'visitor non-text message', { from, type: msg.type });
    }
  }

  async onMessage(msg) {
    const from = normalizePhone(msg.from);
    const p = this.personByPhone(from);
    if (!p) return this.onVisitor(from, msg);
    this.sql.exec(`UPDATE people SET last_inbound_at = ? WHERE id = ?`, T.isoNow(), p.id);
    p.last_inbound_at = T.isoNow();
    this.wa.markRead(msg.id);
    if (p.welcome_pending) this.sendWelcome(p).catch((e) => this.log('warn', 'welcome failed', { error: e.message }));

    let actionId = null;
    let text = null;
    let media = null;
    if (msg.type === 'interactive') {
      actionId = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || null;
    } else if (msg.type === 'button') {
      actionId = msg.button?.payload || null;
    } else if (msg.type === 'text') {
      text = (msg.text?.body || '').trim();
    } else if (['image', 'video', 'document', 'audio'].includes(msg.type)) {
      media = { type: msg.type, id: msg[msg.type]?.id, caption: msg[msg.type]?.caption || '' };
    }

    if (actionId) return this.handleAction(p, actionId);
    if (text) return this.handleText(p, text, media);
    if (media) return this.handleMedia(p, media);
  }

  // ---------- actions (button ids / template payloads) ----------
  async handleAction(p, id) {
    const parts = id.split(':');
    const [a, b, c, d] = parts;
    const wa = this.wa;
    switch (a) {
      case 'tgt':
        return this.onTargetChosen(p, b);
      case 'done':
      case 'later':
      case 'prob':
        return this.onWorkerAction(p, a, b, parseInt(c, 10));
      case 'cancel':
        return this.cancelRequest(p, parseInt(c, 10));
      case 'urgent':
        return this.sendQueuedRequest(parseInt(c, 10), p);
      case 'shop':
        return this.onShoppingAction(p, b, c);
      case 'rate':
        return this.onRate(p, b, parseInt(c, 10), parseInt(d, 10));
      case 'note': {
        const st = this.getState(p);
        this.setState(p, null);
        await wa.text(p.phone, 'تمام، سُجّل التقييم بلا ملاحظة.');
        if (st?.queue?.length) return this.sendNextEveningRating(p, st.queue);
        return;
      }
      case 'fwd':
        return this.forwardRatingNote(p, parseInt(c, 10));
      case 'nofwd':
        return wa.text(p.phone, 'حسناً، الملاحظة محفوظة لك فقط.');
      case 'welcome':
        return this.askVideoLanguage(p);
      case 'lang':
        return this.sendWelcomeVideo(p, b);
      case 'sum':
        return b === 'details' ? this.sendSummaryDetails(p) : this.startEveningRating(p);
      case 'rec':
        return this.onRecurringConfirm(p, b);
      case 'skip':
        this.setState(p, null);
        return wa.text(p.phone, 'تم إيقاف التقييم. يمكنك تقييم الباقي من ملخص الغد.');
      default:
        this.log('warn', 'unknown action', { id, person: p.id });
        return wa.text(p.phone, 'لم أفهم هذا الزر. جرّب مرة أخرى.');
    }
  }

  // ---------- free text ----------
  async handleText(p, text, media) {
    const wa = this.wa;
    const state = this.getState(p);
    const norm = normalizeAr(text);

    // Stateful replies first
    if (state?.kind === 'await_note') {
      this.setState(p, null);
      if (/^(تخطي|تجاهل|لا|skip)$/i.test(norm)) return wa.text(p.phone, 'تمام، سُجّل التقييم بلا ملاحظة.');
      this.sql.exec(`UPDATE ratings SET note = ? WHERE id = ?`, text, state.rating_id);
      const r = this.q1(`SELECT * FROM ratings WHERE id = ?`, state.rating_id);
      const next = state.queue && state.queue.length ? ' وننتقل للمهمة التالية.' : '';
      await wa.buttons(p.phone, `📝 سُجّلت الملاحظة مع التقييم.${next}\nهل أرسلها للعامل كتوجيه (بدون الوجه أو الدرجة)؟`, [
        { id: `fwd:rating:${r.id}`, title: 'نعم، كتوجيه' },
        { id: 'nofwd', title: 'لا' },
      ]);
      if (state.queue && state.queue.length) await this.sendNextEveningRating(p, state.queue);
      return;
    }
    if (state?.kind === 'await_problem') {
      this.setState(p, null);
      return this.recordProblem(p, state.ref, text, media?.id || null);
    }
    if (state?.kind === 'await_unavailable') {
      this.setState(p, null);
      const typed = splitItems(text).map((x) => normalizeAr(x));
      const items = this.q(`SELECT id, item FROM shopping WHERE batch_id = ? AND status = 'sent'`, state.batch);
      for (const it of items) {
        const n = normalizeAr(it.item);
        const na = typed.some((tk) => n.includes(tk) || tk.includes(n));
        this.sql.exec(`UPDATE shopping SET status = ?, note = ? WHERE id = ?`, na ? 'unavailable' : 'bought', na ? text : null, it.id);
      }
      await wa.text(p.phone, `تم التسجيل ✅ ${p.lang !== 'ar' ? 'Recorded, thank you.' : ''}`.trim());
      return this.notifyHousehold(`🛒 السائق أبلغ أن الأصناف التالية غير متوفرة: ${text}`, 'قائمة المشتريات');
    }
    if (state?.kind === 'rating_queue' && /^(تخطي|تجاهل|skip)$/i.test(norm)) {
      this.setState(p, null);
      return wa.text(p.phone, 'تم إيقاف التقييم.');
    }

    if (this.isWorker(p)) {
      // Workers normally use buttons; free text is relayed to the household
      await wa.text(p.phone, 'شكراً، وصلت رسالتك لأهل البيت ✅\nThank you, your message was forwarded.');
      return this.notifyHousehold(`💬 رسالة من ${this.roleName(p)} (${p.name}): ${text}`, 'رسالة من العامل');
    }

    if (!this.isHousehold(p)) return;

    // Household commands
    const pre = parsePrefix(text);
    if (pre?.kind === 'recurring') return this.proposeRecurring(p, pre.body);
    if (pre?.kind === 'shopping') return this.addShopping(p, pre.body);
    if (pre?.kind === 'maid' || pre?.kind === 'driver') return this.createRequest(p, pre.kind, pre.body, media?.id || null);

    if (/^(ارسل|أرسل) المشتريات$/.test(norm) || /^مشتريات الان$/.test(norm)) return this.dispatchShopping(true, p);
    if (/^(ملخص|الملخص|ملخص اليوم)$/.test(norm)) return this.sendSummaryTo(p, this.today(), true);
    if (/^(مساعده|مساعدة|help|\?|؟)$/.test(norm)) return this.sendHelp(p);
    if (state?.kind === 'rec_confirm') {
      // user typed corrections instead of pressing buttons: re-parse
      return this.proposeRecurring(p, text);
    }

    // Default: a request. Ask who it is for.
    this.setState(p, { kind: 'await_target', text, media: media?.id || null });
    return wa.buttons(p.phone, `«${text.slice(0, 200)}»\nلمن هذا الطلب؟`, [
      { id: 'tgt:maid', title: 'العاملة' },
      { id: 'tgt:driver', title: 'السائق' },
      { id: 'tgt:shopping', title: 'مشتريات' },
    ]);
  }

  async handleMedia(p, media) {
    const state = this.getState(p);
    if (state?.kind === 'await_problem') {
      this.setState(p, null);
      return this.recordProblem(p, state.ref, media.caption || 'صورة مرفقة', media.id);
    }
    if (this.isWorker(p)) {
      await this.wa.text(p.phone, 'وصلت الصورة لأهل البيت ✅');
      return this.notifyHousehold(`📷 ${this.roleName(p)} أرسل ${media.type === 'image' ? 'صورة' : 'ملفاً'}${media.caption ? ': ' + media.caption : ''}`, 'مرفق من العامل', media.id);
    }
    if (this.isHousehold(p)) {
      this.setState(p, { kind: 'await_target', text: media.caption || 'انظر المرفق', media: media.id });
      return this.wa.buttons(p.phone, 'لمن هذا الطلب (مع المرفق)؟', [
        { id: 'tgt:maid', title: 'العاملة' },
        { id: 'tgt:driver', title: 'السائق' },
        { id: 'tgt:shopping', title: 'مشتريات' },
      ]);
    }
  }

  sendHelp(p) {
    return this.wa.text(
      p.phone,
      `أنا ${this.botName} 🏠\n• اكتب أي طلب وسأسألك لمن هو\n• اختصارات: «ع: …» للعاملة، «س: …» للسائق، «م: حليب، خبز» للمشتريات\n• «دوري: تنظيف الحوش كل خميس 9 ص للعاملة» لإضافة مهمة دورية\n• «أرسل المشتريات» لإرسال القائمة الآن\n• «ملخص» لملخص اليوم حتى الآن`
    );
  }

  roleName(p) {
    return ROLE_AR[p.role] || p.role;
  }

  // ---------- requests ----------
  async onTargetChosen(p, target) {
    const state = this.getState(p);
    this.setState(p, null);
    if (!state || state.kind !== 'await_target') return this.wa.text(p.phone, 'انتهت مهلة هذا الطلب؛ أعد إرساله من فضلك.');
    if (target === 'shopping') return this.addShopping(p, state.text);
    return this.createRequest(p, target, state.text, state.media);
  }

  async createRequest(requester, role, text, mediaId) {
    const wa = this.wa;
    const assignee = this.peopleByRole(role)[0];
    if (!assignee) return wa.text(requester.phone, `لا يوجد ${ROLE_AR[role]} مسجّل بعد. أضفه من صفحة الإدارة.`);
    const l2 = await this.translate(text, assignee.lang);
    const id = this.run(
      `INSERT INTO requests(created_at, requester_id, assignee_id, text, text_l2, media_id, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      T.isoNow(), requester.id, assignee.id, text, l2, mediaId
    );
    const s = this.settings();
    const nowMin = T.toMinutes(T.timeStr(this.now()));
    if (s.quiet_enabled === '1' && T.isInQuietHours(nowMin, s.quiet_start, s.quiet_end)) {
      this.sql.exec(`UPDATE requests SET status = 'queued' WHERE id = ?`, id);
      return wa.buttons(requester.phone, `🌙 الوقت خارج ساعات العمل. سيصل الطلب لـ${ROLE_AR[role]} الساعة ${T.arTime(s.quiet_end)}.`, [
        { id: `urgent:req:${id}`, title: 'عاجل، أرسل الآن' },
        { id: `cancel:req:${id}`, title: 'إلغاء الطلب' },
      ]);
    }
    await this.deliverRequest(id);
    return wa.buttons(requester.phone, `✅ أُرسل لـ${ROLE_AR[role]}.`, [{ id: `cancel:req:${id}`, title: 'إلغاء الطلب' }]);
  }

  async deliverRequest(id) {
    const r = this.q1(`SELECT * FROM requests WHERE id = ?`, id);
    if (!r || ['done', 'cancelled'].includes(r.status)) return;
    const assignee = this.person(r.assignee_id);
    const requester = this.person(r.requester_id);
    const from = requester ? requester.name : 'أهل البيت';
    const time = T.arTime(T.timeStr(this.now()));
    const l2 = r.text_l2 || '·';
    const btns = [
      { id: `done:req:${id}`, title: 'تم ✅' },
      { id: `later:req:${id}`, title: 'لاحقاً ⏳' },
      { id: `prob:req:${id}`, title: 'مشكلة ⚠️' },
    ];
    try {
      let res;
      if (this.canFree(assignee)) {
        if (r.media_id) await this.wa.send({ to: assignee.phone, type: 'image', image: { id: r.media_id } }).catch(() => {});
        res = await this.wa.buttons(assignee.phone, `📋 طلب جديد من ${from} (${time})\n${r.text}${r.text_l2 ? '\n' + r.text_l2 : ''}`, btns);
      } else {
        res = await this.wa.template(assignee.phone, 'new_request', [from, time, r.text, l2], btns.map((b) => b.id));
      }
      this.sql.exec(`UPDATE requests SET status = 'sent', sent_at = ?, wa_message_id = ? WHERE id = ?`, T.isoNow(), res?.messages?.[0]?.id || null, id);
    } catch (e) {
      this.log('error', 'deliverRequest failed: ' + e.message, { id });
      this.sql.exec(`UPDATE requests SET status = 'send_failed' WHERE id = ?`, id);
      if (requester) await this.wa.text(requester.phone, `⚠️ تعذّر إرسال الطلب لـ${this.roleName(assignee)} (${e.graph?.message || e.message}). راجع صفحة الإعداد.`).catch(() => {});
    }
  }

  async sendQueuedRequest(id, p) {
    const r = this.q1(`SELECT * FROM requests WHERE id = ?`, id);
    if (!r || r.status !== 'queued') return this.wa.text(p.phone, 'هذا الطلب أُرسل أو أُلغي مسبقاً.');
    await this.deliverRequest(id);
    return this.wa.text(p.phone, '✅ أُرسل الآن.');
  }

  async cancelRequest(p, id) {
    const r = this.q1(`SELECT * FROM requests WHERE id = ?`, id);
    if (!r) return;
    if (r.status === 'done') return this.wa.text(p.phone, 'الطلب أُنجز بالفعل فلا يمكن إلغاؤه.');
    if (r.status === 'cancelled') return this.wa.text(p.phone, 'الطلب ملغى مسبقاً.');
    const wasSent = r.status === 'sent' || r.status === 'deferred';
    this.sql.exec(`UPDATE requests SET status = 'cancelled' WHERE id = ?`, id);
    await this.wa.text(p.phone, '❌ أُلغي الطلب.');
    if (wasSent) {
      const a = this.person(r.assignee_id);
      if (a) await this.safeNotify(a, `❌ أُلغي الطلب: ${r.text}`, 'الطلب');
    }
  }

  // ---------- worker actions ----------
  async onWorkerAction(p, action, kind, id) {
    const table = kind === 'inst' ? 'instances' : kind === 'req' ? 'requests' : null;
    if (!table) return;
    const row = this.q1(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!row) return this.wa.text(p.phone, 'لم أجد هذه المهمة.');
    const title = kind === 'inst' ? row.title : row.text;
    if (action === 'done') {
      if (row.status === 'done') return this.wa.text(p.phone, 'مسجّلة كمنجزة مسبقاً ✅');
      this.sql.exec(`UPDATE ${table} SET status = 'done', done_at = ? WHERE id = ?`, T.isoNow(), id);
      await this.wa.text(p.phone, `✓ تم تسجيلها — ${T.arTime(T.timeStr(this.now()))}\n${p.lang !== 'ar' ? 'Recorded, thank you ✅' : ''}`.trim());
      if (kind === 'req') await this.notifyRequestDone(row, p);
      return;
    }
    if (action === 'later') {
      this.sql.exec(`UPDATE ${table} SET status = 'deferred', defers = defers + 1, deferred_at = ?, reminders = 0 WHERE id = ?`, T.isoNow(), id);
      const h = kind === 'inst' ? this.remindHoursFor(row) : parseFloat(this.settings().default_remind_hours) || 2;
      return this.wa.text(p.phone, `⏳ حسناً، سأذكّرك بعد ${h} ساعة.\n${p.lang !== 'ar' ? `OK, I will remind you in ${h} hours.` : ''}`.trim());
    }
    if (action === 'prob') {
      this.setState(p, { kind: 'await_problem', ref: { kind, id } });
      return this.wa.text(p.phone, `اكتب وصف المشكلة أو أرسل صورة لها.\n${p.lang !== 'ar' ? 'Describe the problem or send a photo.' : ''}`.trim());
    }
  }

  remindHoursFor(inst) {
    const rec = inst.recurring_id ? this.q1(`SELECT remind_after_hours FROM recurring WHERE id = ?`, inst.recurring_id) : null;
    return rec?.remind_after_hours || parseFloat(this.settings().default_remind_hours) || 2;
  }

  async recordProblem(p, ref, text, mediaId) {
    const table = ref.kind === 'inst' ? 'instances' : 'requests';
    const row = this.q1(`SELECT * FROM ${table} WHERE id = ?`, ref.id);
    if (!row) return;
    this.sql.exec(`UPDATE ${table} SET status = 'problem', problem_text = ?, problem_media = ? WHERE id = ?`, text, mediaId, ref.id);
    await this.wa.text(p.phone, `تم إبلاغ أهل البيت ✅\n${p.lang !== 'ar' ? 'The household has been informed.' : ''}`.trim());
    const title = ref.kind === 'inst' ? row.title : row.text;
    const targets = ref.kind === 'req' && row.requester_id ? [this.person(row.requester_id), ...this.owners()] : this.owners();
    const seen = new Set();
    for (const t of targets) {
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      await this.safeNotify(t, `⚠️ ${this.roleName(p)} أبلغ عن مشكلة في «${title}»:\n${text}`, `مهمة ${title}`, mediaId);
    }
  }

  async notifyRequestDone(r, worker) {
    const requester = this.person(r.requester_id);
    if (!requester) return;
    const time = T.arTime(T.timeStr(this.now()));
    const who = this.roleName(worker);
    const btns = [
      { id: `rate:req:${r.id}:3`, title: '😊 راضٍ' },
      { id: `rate:req:${r.id}:2`, title: '😐 مقبول' },
      { id: `rate:req:${r.id}:1`, title: '😞 غير راضٍ' },
    ];
    try {
      if (this.canFree(requester)) {
        await this.wa.buttons(requester.phone, `✅ ${who} أنجزت: ${r.text}\n${time}\nكيف كان الأداء؟`, btns);
      } else {
        await this.wa.template(requester.phone, 'rating_request', [who, r.text, time], btns.map((b) => b.id));
      }
    } catch (e) {
      this.log('error', 'notifyRequestDone: ' + e.message);
    }
  }

  // Send a notice to a household member, falling back to the house_notice template outside the 24h window
  async safeNotify(p, text, subject, mediaId) {
    try {
      if (this.canFree(p)) {
        if (mediaId) await this.wa.send({ to: p.phone, type: 'image', image: { id: mediaId } }).catch(() => {});
        await this.wa.text(p.phone, text);
      } else {
        // outside the 24h window: utility template keyed by a running notice number
        const n = parseInt(this.settings().notice_seq || '1000', 10) + 1;
        this.setSetting('notice_seq', String(n));
        const body = subject && !text.includes(subject) ? `${subject}: ${text}` : text;
        await this.wa.template(p.phone, 'request_update', [String(n), body]);
      }
    } catch (e) {
      this.log('error', `notify ${p.name}: ${e.message}`);
    }
  }
  async notifyHousehold(text, subject, mediaId) {
    for (const o of this.owners()) await this.safeNotify(o, text, subject, mediaId);
  }

  // ---------- shopping ----------
  async addShopping(p, text) {
    const items = splitItems(text);
    if (!items.length) return this.wa.text(p.phone, 'لم أجد أصنافاً. اكتبها مفصولة بفواصل: حليب، خبز، ماء');
    for (const it of items) this.run(`INSERT INTO shopping(created_at, added_by, item, status) VALUES (?, ?, ?, 'open')`, T.isoNow(), p.id, it);
    const open = this.q1(`SELECT COUNT(*) AS n FROM shopping WHERE status = 'open'`).n;
    return this.wa.text(p.phone, `🛒 أُضيفت للقائمة (${open} ${open === 1 ? 'صنف' : 'أصناف'} بانتظار الإرسال). تُرسل للسائق الساعة ${T.arTime(this.settings().shopping_time)}، أو اكتب «أرسل المشتريات».`);
  }

  async dispatchShopping(force, requester) {
    const items = this.q(`SELECT * FROM shopping WHERE status = 'open' ORDER BY id`);
    if (!items.length) {
      if (requester) await this.wa.text(requester.phone, 'القائمة فارغة.');
      return;
    }
    const driver = this.peopleByRole('driver')[0];
    if (!driver) {
      if (requester) await this.wa.text(requester.phone, 'لا يوجد سائق مسجّل. أضفه من صفحة الإدارة.');
      return;
    }
    const batch = `${this.today()}-${Date.now().toString(36)}`;
    const list = items.map((i) => i.item).join('، ');
    const l2 = await this.translate(list, driver.lang);
    const btns = [
      { id: `shop:done:${batch}`, title: 'تم ✅' },
      { id: `shop:na:${batch}`, title: 'غير متوفر' },
    ];
    try {
      if (this.canFree(driver)) {
        await this.wa.buttons(driver.phone, `🛒 مشتريات اليوم (${items.length}):\n${items.map((i) => '• ' + i.item).join('\n')}${l2 ? '\n' + l2 : ''}`, btns);
      } else {
        await this.wa.template(driver.phone, 'shopping_list', [`${items.length} أصناف`, list], btns.map((b) => b.id));
      }
      this.sql.exec(`UPDATE shopping SET status = 'sent', batch_id = ?, sent_at = ? WHERE status = 'open'`, batch, T.isoNow());
      if (requester) await this.wa.text(requester.phone, `✅ أُرسلت القائمة للسائق (${items.length}).`);
    } catch (e) {
      this.log('error', 'dispatchShopping: ' + e.message);
      if (requester) await this.wa.text(requester.phone, `⚠️ تعذّر الإرسال: ${e.graph?.message || e.message}`);
    }
  }

  async onShoppingAction(p, action, batch) {
    if (action === 'done') {
      this.sql.exec(`UPDATE shopping SET status = 'bought' WHERE batch_id = ? AND status = 'sent'`, batch);
      await this.wa.text(p.phone, `شكراً ✅ ${p.lang !== 'ar' ? 'Thank you!' : ''}`.trim());
      return this.notifyHousehold('🛒 السائق أنهى المشتريات ✅', 'المشتريات');
    }
    if (action === 'na') {
      this.setState(p, { kind: 'await_unavailable', batch });
      return this.wa.text(p.phone, `اكتب الأصناف غير المتوفرة مفصولة بفواصل.\n${p.lang !== 'ar' ? 'Type the unavailable items, separated by commas.' : ''}`.trim());
    }
  }

  // ---------- ratings ----------
  async onRate(p, kind, refId, score) {
    if (![1, 2, 3].includes(score)) return;
    const existing = this.q1(`SELECT id FROM ratings WHERE kind = ? AND ref_id = ? AND rater_id = ?`, kind, refId, p.id);
    let ratingId;
    if (existing) {
      this.sql.exec(`UPDATE ratings SET score = ?, created_at = ? WHERE id = ?`, score, T.isoNow(), existing.id);
      ratingId = existing.id;
    } else {
      ratingId = this.run(`INSERT INTO ratings(created_at, kind, ref_id, rater_id, score) VALUES (?, ?, ?, ?, ?)`, T.isoNow(), kind, refId, p.id, score);
    }
    const prev = this.getState(p);
    const queue = prev?.kind === 'rating_queue' ? prev.queue : null;
    this.setState(p, { kind: 'await_note', rating_id: ratingId, queue });
    return this.wa.buttons(p.phone, `${FACES[score]} شكراً. تريد إضافة ملاحظة؟ اكتبها الآن.`, [{ id: 'note:skip', title: 'بدون ملاحظة' }]);
  }

  async forwardRatingNote(p, ratingId) {
    const r = this.q1(`SELECT * FROM ratings WHERE id = ?`, ratingId);
    if (!r || !r.note) return this.wa.text(p.phone, 'لا توجد ملاحظة لإرسالها.');
    const table = r.kind === 'inst' ? 'instances' : r.kind === 'req' ? 'requests' : null;
    const row = table ? this.q1(`SELECT * FROM ${table} WHERE id = ?`, r.ref_id) : null;
    const worker = row ? this.person(row.assignee_id) : this.peopleByRole('driver')[0];
    if (!worker) return this.wa.text(p.phone, 'لم أجد العامل المعني.');
    const title = row ? (r.kind === 'inst' ? row.title : row.text) : 'المشتريات';
    const l2 = await this.translate(r.note, worker.lang);
    await this.safeNotify(worker, `📝 توجيه بخصوص «${title}»:\n${r.note}${l2 ? '\n' + l2 : ''}`, title);
    this.sql.exec(`UPDATE ratings SET forwarded = 1 WHERE id = ?`, ratingId);
    return this.wa.text(p.phone, `✅ أُرسل التوجيه لـ${this.roleName(worker)}.`);
  }

  async startEveningRating(p) {
    const date = this.today();
    const ids = this.q(
      `SELECT i.id FROM instances i WHERE i.date = ? AND i.status = 'done'
         AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.kind = 'inst' AND r.ref_id = i.id AND r.rater_id = ?) ORDER BY i.id`,
      date, p.id
    ).map((r) => r.id);
    if (!ids.length) return this.wa.text(p.phone, 'لا توجد مهام منجزة اليوم بلا تقييم.');
    return this.sendNextEveningRating(p, ids);
  }

  async sendNextEveningRating(p, queue) {
    const [id, ...rest] = queue;
    if (!id) {
      this.setState(p, null);
      return this.wa.text(p.phone, '✅ اكتمل تقييم مهام اليوم. شكراً.');
    }
    const inst = this.q1(`SELECT * FROM instances WHERE id = ?`, id);
    this.setState(p, { kind: 'rating_queue', queue: rest });
    const worker = this.person(inst.assignee_id);
    return this.wa.buttons(p.phone, `تقييم (${queue.length} متبقية)\n${this.roleName(worker)}: ${inst.title}\nاكتب «تخطي» للإيقاف.`, [
      { id: `rate:inst:${id}:3`, title: '😊 راضٍ' },
      { id: `rate:inst:${id}:2`, title: '😐 مقبول' },
      { id: `rate:inst:${id}:1`, title: '😞 غير راضٍ' },
    ]);
  }

  // ---------- recurring tasks via chat ----------
  async proposeRecurring(p, body) {
    const parsed = parseRecurring(body, { todayWeekday: T.weekday(this.now()) });
    if (!parsed.ok) {
      this.setState(p, { kind: 'rec_confirm', parsed: null });
      return this.wa.text(p.phone, `لم أفهم ${parsed.notes.join(' و')}.\nمثال: «دوري: تنظيف الحوش كل خميس 9 ص للعاملة»`);
    }
    if (!parsed.assignee_role) parsed.assignee_role = 'maid';
    this.setState(p, { kind: 'rec_confirm', parsed });
    const s = this.settings();
    const time = parsed.send_time ? T.arTime(parsed.send_time) : `مع قائمة الصباح (${T.arTime(s.morning_time)})`;
    const notes = parsed.notes.length ? `\nملاحظة: ${parsed.notes.join('، ')}` : '';
    return this.wa.buttons(
      p.phone,
      `🔁 مهمة دورية جديدة\n${parsed.title}\nالمسؤول: ${ROLE_AR[parsed.assignee_role]} · ${describeRecurrence(parsed)} · ${time}\nتذكير إن تأخرت: بعد ${s.default_remind_hours} ساعة${notes}`,
      [
        { id: 'rec:confirm', title: 'تأكيد ✅' },
        { id: 'rec:edit', title: 'تعديل' },
        { id: 'rec:cancel', title: 'إلغاء' },
      ]
    );
  }

  async onRecurringConfirm(p, action) {
    const state = this.getState(p);
    if (action === 'cancel') {
      this.setState(p, null);
      return this.wa.text(p.phone, 'أُلغيت.');
    }
    if (action === 'edit') {
      return this.wa.text(p.phone, 'أعد كتابة المهمة كاملة بالصيغة الصحيحة، مثل: «تنظيف الحوش كل خميس 9 ص للعاملة»');
    }
    if (!state?.parsed) return this.wa.text(p.phone, 'انتهت المهلة؛ أعد إرسال المهمة من جديد.');
    const r = state.parsed;
    this.setState(p, null);
    const worker = this.peopleByRole(r.assignee_role)[0];
    const l2 = worker ? await this.translate(r.title, worker.lang) : '';
    const s = this.settings();
    const id = this.run(
      `INSERT INTO recurring(title, title_l2, assignee_role, freq, days, interval_n, day_of_month, send_time, deadline_hours, remind_after_hours, active, start_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      r.title, l2, r.assignee_role, r.freq, (r.days || []).join(','), r.interval || 1, r.day_of_month || 1, r.send_time || null,
      parseFloat(s.default_deadline_hours) || 4, parseFloat(s.default_remind_hours) || 2, this.today(), T.isoNow()
    );
    const next = this.nextDueDate(this.q1(`SELECT * FROM recurring WHERE id = ?`, id));
    return this.wa.text(p.phone, `✓ أُضيفت للدفتر${next ? `، وأول موعد لها ${next}` : ''}.`);
  }

  // ---------- scheduling ----------
  isDue(rec, dateStr) {
    if (!rec.active) return false;
    if (rec.paused_until && rec.paused_until >= dateStr) return false;
    if (rec.start_date && rec.start_date > dateStr) return false;
    const d = new Date(dateStr + 'T00:00:00Z');
    switch (rec.freq) {
      case 'daily':
        return true;
      case 'weekly':
        return String(rec.days || '').split(',').filter(Boolean).map(Number).includes(d.getUTCDay());
      case 'every_n': {
        const anchor = rec.start_date || dateStr;
        const diff = T.daysBetween(anchor, dateStr);
        return diff >= 0 && diff % Math.max(1, rec.interval_n) === 0;
      }
      case 'monthly':
        return d.getUTCDate() === (rec.day_of_month || 1);
      default:
        return false;
    }
  }
  nextDueDate(rec) {
    let d = this.today();
    for (let i = 0; i < 62; i++) {
      if (this.isDue(rec, d)) return T.arDate(new Date(d + 'T00:00:00Z'));
      d = T.addDays(d, 1);
    }
    return null;
  }

  async cron() {
    const s = this.settings();
    const now = this.now();
    const today = T.dateStr(now);
    const nowMin = T.toMinutes(T.timeStr(now));

    // 1. Create today's instances once per day (after 00:05), carrying over yesterday's unfinished ones
    if (s.last_create_date !== today && nowMin >= 5) {
      this.createInstancesFor(today);
      this.setSetting('last_create_date', today);
    }

    // 2. Send pending instances whose time has come (default = morning time)
    const morning = T.toMinutes(s.morning_time);
    const pending = this.q(`SELECT * FROM instances WHERE date = ? AND status = 'pending' ORDER BY assignee_id, id`, today);
    const dueNow = pending.filter((i) => T.toMinutes(i.send_time || s.morning_time) <= nowMin);
    if (dueNow.length) await this.sendInstances(dueNow, nowMin >= morning && nowMin < morning + 30);

    // 3. Shopping list
    if (s.last_shopping_date !== today && nowMin >= T.toMinutes(s.shopping_time)) {
      this.setSetting('last_shopping_date', today);
      await this.dispatchShopping(false, null);
    }

    // 4. Evening summary
    if (s.last_summary_date !== today && nowMin >= T.toMinutes(s.summary_time)) {
      this.setSetting('last_summary_date', today);
      await this.sendSummaries(today);
    }

    // 5. Reminders for deferred / unanswered items
    await this.sendReminders();

    // 6. Queued (quiet hours) requests
    if (s.quiet_enabled === '1' && !T.isInQuietHours(nowMin, s.quiet_start, s.quiet_end)) {
      for (const r of this.q(`SELECT id FROM requests WHERE status = 'queued'`)) await this.deliverRequest(r.id);
    }

    // 7. Template approval watch: every 30 min until all approved; tells the owner when done (or if one is rejected)
    if (s.templates_watch !== 'done' && T.hoursSince(s.templates_checked_at || null) * 60 >= 29) {
      await this.watchTemplates().catch((e) => this.log('warn', 'template watch failed', { error: e.message }));
    }
  }

  async watchTemplates() {
    this.setSetting('templates_checked_at', T.isoNow());
    const all = (await this.wa.listTemplates()).data || [];
    const mine = TEMPLATE_NAMES.map((n) => ({ name: n, t: all.find((x) => x.name === n && x.language === 'ar') }));
    const missing = mine.filter((m) => !m.t);
    if (missing.length) return; // not created yet; nothing to watch
    const rejected = mine.filter((m) => m.t.status === 'REJECTED');
    const approved = mine.filter((m) => m.t.status === 'APPROVED');
    const lastRejected = this.settings().templates_rejected_notified || '';
    if (rejected.length && rejected.map((r) => r.name).join(',') !== lastRejected) {
      this.setSetting('templates_rejected_notified', rejected.map((r) => r.name).join(','));
      const lines = rejected.map((r) => `• ${r.name}: ${r.t.rejected_reason || 'بدون سبب'}`).join('\n');
      for (const o of this.owners()) await this.safeNotify(o, `⚠️ رفضت Meta ${rejected.length} من القوالب:\n${lines}\nسيعاد ضبط صياغتها وإرسالها.`, 'القوالب');
      this.log('warn', 'templates rejected', { names: rejected.map((r) => r.name) });
    }
    if (approved.length === mine.length) {
      this.setSetting('templates_watch', 'done');
      for (const o of this.owners()) await this.safeNotify(o, `✅ اعتُمدت القوالب السبعة. يمكن الآن مراسلة أي شخص تضيفه حتى لو لم يراسل البوت من قبل — أضف العاملة والسائق متى شئت.`, 'القوالب');
      this.log('info', 'templates all approved');
    }
  }

  createInstancesFor(date) {
    const yesterday = T.addDays(date, -1);
    // carry over unfinished work from yesterday
    const unfinished = this.q(`SELECT * FROM instances WHERE date = ? AND status IN ('pending','sent','deferred','no_reply','send_failed')`, yesterday);
    for (const u of unfinished) {
      this.sql.exec(`UPDATE instances SET status = 'carried' WHERE id = ?`, u.id);
      this.run(
        `INSERT INTO instances(date, recurring_id, title, title_l2, assignee_id, send_time, status, carried, created_at) VALUES (?, ?, ?, ?, ?, NULL, 'pending', 1, ?)`,
        date, u.recurring_id, u.title, u.title_l2, u.assignee_id, T.isoNow()
      );
    }
    for (const rec of this.q(`SELECT * FROM recurring WHERE active = 1`)) {
      if (!this.isDue(rec, date)) continue;
      if (this.q1(`SELECT 1 FROM instances WHERE recurring_id = ? AND date = ? AND carried = 0`, rec.id, date)) continue;
      const worker = this.peopleByRole(rec.assignee_role)[0];
      if (!worker) continue;
      this.run(
        `INSERT INTO instances(date, recurring_id, title, title_l2, assignee_id, send_time, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        date, rec.id, rec.title, rec.title_l2, worker.id, rec.send_time || null, T.isoNow()
      );
    }
  }

  async sendInstances(list, withGreeting) {
    const byWorker = new Map();
    for (const i of list) {
      if (!byWorker.has(i.assignee_id)) byWorker.set(i.assignee_id, []);
      byWorker.get(i.assignee_id).push(i);
    }
    for (const [workerId, items] of byWorker) {
      const w = this.person(workerId);
      if (!w) continue;
      const free = this.canFree(w);
      const total = this.q1(`SELECT COUNT(*) AS n FROM instances WHERE date = ? AND assignee_id = ?`, items[0].date, workerId).n;
      if (withGreeting && free) {
        await this.wa.text(w.phone, `صباح الخير 🌤️ هذه مهام اليوم:${w.lang !== 'ar' ? '\nGood morning! Today’s tasks:' : ''}`).catch(() => {});
      }
      let n = this.q1(`SELECT COUNT(*) AS n FROM instances WHERE date = ? AND assignee_id = ? AND status <> 'pending'`, items[0].date, workerId).n;
      for (const inst of items) {
        n += 1;
        const l2 = inst.title_l2 || (w.lang !== 'ar' ? await this.translate(inst.title, w.lang) : '');
        if (l2 && !inst.title_l2) this.sql.exec(`UPDATE instances SET title_l2 = ? WHERE id = ?`, l2, inst.id);
        const prefix = inst.carried ? '🔁 متأخرة من أمس: ' : '';
        const btns = [
          { id: `done:inst:${inst.id}`, title: 'تم ✅' },
          { id: `later:inst:${inst.id}`, title: 'لاحقاً ⏳' },
          { id: `prob:inst:${inst.id}`, title: 'مشكلة ⚠️' },
        ];
        try {
          let res;
          if (free) res = await this.wa.buttons(w.phone, `${n}. ${prefix}${inst.title}${l2 ? '\n' + l2 : ''}`, btns);
          else res = await this.wa.template(w.phone, 'task_assigned', [`${n}/${total}`, prefix + inst.title, l2 || '·'], btns.map((b) => b.id));
          this.sql.exec(`UPDATE instances SET status = 'sent', sent_at = ?, wa_message_id = ? WHERE id = ?`, T.isoNow(), res?.messages?.[0]?.id || null, inst.id);
        } catch (e) {
          this.log('error', `send instance ${inst.id}: ${e.message}`);
          this.sql.exec(`UPDATE instances SET status = 'send_failed' WHERE id = ?`, inst.id);
        }
      }
    }
  }

  async sendReminders() {
    const s = this.settings();
    const today = this.today();
    // deferred instances
    for (const i of this.q(`SELECT * FROM instances WHERE date = ? AND status = 'deferred' AND reminders = 0`, today)) {
      if (T.hoursSince(i.deferred_at) >= this.remindHoursFor(i)) await this.remindInstance(i);
    }
    // sent but unanswered instances past deadline
    for (const i of this.q(`SELECT * FROM instances WHERE date = ? AND status = 'sent' AND reminders = 0`, today)) {
      const rec = i.recurring_id ? this.q1(`SELECT deadline_hours, escalate_now FROM recurring WHERE id = ?`, i.recurring_id) : null;
      const dl = rec?.deadline_hours || parseFloat(s.default_deadline_hours) || 4;
      if (T.hoursSince(i.sent_at) >= dl) {
        await this.remindInstance(i);
        if (rec?.escalate_now) await this.notifyHousehold(`⏰ لم يُردّ على مهمة «${i.title}» بعد ${dl} ساعة.`, i.title);
      }
    }
    // requests: deferred or unanswered
    const remindH = parseFloat(s.default_remind_hours) || 2;
    for (const r of this.q(`SELECT * FROM requests WHERE status IN ('deferred','sent') AND reminders = 0 AND created_at > ?`, T.addDays(today, -2))) {
      const since = r.status === 'deferred' ? T.hoursSince(r.deferred_at) : T.hoursSince(r.sent_at);
      if (since >= remindH) await this.remindRequest(r);
    }
  }

  async remindInstance(i) {
    const w = this.person(i.assignee_id);
    if (!w) return;
    const btns = [
      { id: `done:inst:${i.id}`, title: 'تم ✅' },
      { id: `later:inst:${i.id}`, title: 'لاحقاً ⏳' },
      { id: `prob:inst:${i.id}`, title: 'مشكلة ⚠️' },
    ];
    try {
      if (this.canFree(w)) await this.wa.buttons(w.phone, `⏰ تذكير: ${i.title}${i.title_l2 ? '\n' + i.title_l2 : ''}`, btns);
      else await this.wa.template(w.phone, 'task_followup', [i.title, i.title_l2 || '·'], btns.map((b) => b.id));
      this.sql.exec(`UPDATE instances SET reminders = reminders + 1, last_reminded_at = ? WHERE id = ?`, T.isoNow(), i.id);
    } catch (e) {
      this.log('error', 'remindInstance: ' + e.message);
      this.sql.exec(`UPDATE instances SET reminders = reminders + 1 WHERE id = ?`, i.id);
    }
  }

  async remindRequest(r) {
    const w = this.person(r.assignee_id);
    if (!w) return;
    const btns = [
      { id: `done:req:${r.id}`, title: 'تم ✅' },
      { id: `later:req:${r.id}`, title: 'لاحقاً ⏳' },
      { id: `prob:req:${r.id}`, title: 'مشكلة ⚠️' },
    ];
    try {
      if (this.canFree(w)) await this.wa.buttons(w.phone, `⏰ تذكير بطلب: ${r.text}${r.text_l2 ? '\n' + r.text_l2 : ''}`, btns);
      else await this.wa.template(w.phone, 'task_followup', [r.text, r.text_l2 || '·'], btns.map((b) => b.id));
    } catch (e) {
      this.log('error', 'remindRequest: ' + e.message);
    }
    this.sql.exec(`UPDATE requests SET reminders = reminders + 1, last_reminded_at = ? WHERE id = ?`, T.isoNow(), r.id);
  }

  // ---------- summaries ----------
  summaryData(date) {
    const inst = this.q(`SELECT i.*, p.role AS role, p.name AS worker FROM instances i LEFT JOIN people p ON p.id = i.assignee_id WHERE i.date = ? AND i.status <> 'cancelled'`, date);
    const reqs = this.q(`SELECT r.*, p.role AS role FROM requests r LEFT JOIN people p ON p.id = r.assignee_id WHERE substr(r.created_at,1,10) = ? OR substr(r.done_at,1,10) = ?`, date, date);
    const ratings = this.q(`SELECT score FROM ratings WHERE substr(created_at,1,10) = ?`, date);
    const notes = this.q(`SELECT r.note, r.kind, r.ref_id FROM ratings r WHERE substr(r.created_at,1,10) = ? AND r.note IS NOT NULL AND r.note <> ''`, date);
    const shopNA = this.q(`SELECT item FROM shopping WHERE status = 'unavailable' AND substr(sent_at,1,10) = ?`, date);
    const byRole = (role) => {
      const mine = inst.filter((i) => i.role === role);
      const myReqs = reqs.filter((r) => r.role === role);
      const total = mine.length + myReqs.length;
      const done = mine.filter((i) => i.status === 'done').length + myReqs.filter((r) => r.status === 'done').length;
      return { total, done, mine, myReqs };
    };
    const maid = byRole('maid');
    const driver = byRole('driver');
    const delayed = inst.filter((i) => ['deferred', 'no_reply', 'sent', 'carried'].includes(i.status) || (i.status === 'done' && i.defers >= 2));
    const problems = [...inst.filter((i) => i.status === 'problem'), ...reqs.filter((r) => r.status === 'problem')];
    const counts = { 3: 0, 2: 0, 1: 0 };
    for (const r of ratings) counts[r.score] = (counts[r.score] || 0) + 1;
    const carry = inst.filter((i) => ['pending', 'sent', 'deferred', 'no_reply'].includes(i.status)).length;
    return { inst, reqs, maid, driver, delayed, problems, counts, carry, notes, shopNA };
  }

  summaryText(date) {
    const d = this.summaryData(date);
    const fmt = (x) => (x.total ? `${x.done} من ${x.total}` : 'لا مهام');
    const delayedTxt = d.delayed.length
      ? d.delayed.map((i) => `${i.title}${i.defers ? ` (أُجّلت ${i.defers === 1 ? 'مرة' : i.defers + ' مرات'})` : ''}`).join('؛ ')
      : 'لا شيء';
    const problemsTxt = d.problems.length ? d.problems.map((x) => `${x.title || x.text}: ${x.problem_text || ''}`.trim()).join('؛ ') : 'لا شيء';
    const ratingTxt = d.counts[3] + d.counts[2] + d.counts[1] ? `😊 ${d.counts[3]} · 😐 ${d.counts[2]} · 😞 ${d.counts[1]}` : 'لم يُقيَّم بعد';
    const carryTxt = d.carry ? (d.carry === 1 ? 'مهمة واحدة' : d.carry === 2 ? 'مهمتان' : `${d.carry} مهام`) : 'لا شيء';
    const dateTxt = T.arDate(new Date(date + 'T00:00:00Z'));
    const extra = [];
    if (d.shopNA.length) extra.push(`🛒 غير متوفر: ${d.shopNA.map((x) => x.item).join('، ')}`);
    for (const n of d.notes.slice(0, 3)) extra.push(`📝 ملاحظة: ${n.note}`);
    const text = `📊 ملخص ${dateTxt}\nالعاملة: ${fmt(d.maid)} ✅\nالسائق: ${fmt(d.driver)} ✅\n⏳ تأخر: ${delayedTxt}\n⚠️ مشاكل: ${problemsTxt}\n⭐ تقييم اليوم: ${ratingTxt}${extra.length ? '\n' + extra.join('\n') : ''}\n📌 يُرحَّل للغد: ${carryTxt}`;
    const params = [dateTxt, fmt(d.maid), fmt(d.driver), delayedTxt, problemsTxt, ratingTxt, carryTxt];
    return { text, params, data: d };
  }

  async sendSummaries(date) {
    for (const o of this.q(`SELECT * FROM people WHERE gets_summary = 1 AND active = 1`)) await this.sendSummaryTo(o, date, false);
  }

  async sendSummaryTo(p, date, onDemand) {
    const { text, params } = this.summaryText(date);
    const btns = [
      { id: 'sum:details', title: 'عرض التفاصيل' },
      { id: 'sum:rate', title: 'تقييم بقية المهام' },
    ];
    try {
      if (this.canFree(p) || onDemand) await this.wa.buttons(p.phone, text.slice(0, 1024), btns);
      else await this.wa.template(p.phone, 'daily_summary', params, btns.map((b) => b.id));
    } catch (e) {
      this.log('error', 'sendSummary: ' + e.message);
      if (onDemand) await this.wa.text(p.phone, `⚠️ ${e.graph?.message || e.message}`).catch(() => {});
    }
  }

  async sendSummaryDetails(p) {
    const d = this.summaryData(this.today());
    const st = { pending: '⏱ لم تُرسل', sent: '⏳ بانتظار الرد', done: '✅ تم', deferred: '⏳ مؤجَّلة', problem: '⚠️ مشكلة', no_reply: '❌ بلا ردّ', carried: '🔁 رُحّلت', cancelled: '✖ ملغاة', send_failed: '⚠️ فشل الإرسال', queued: '🌙 مؤجّل لساعات العمل' };
    const lines = [];
    for (const i of d.inst) lines.push(`• ${i.title} — ${st[i.status] || i.status}${i.done_at ? ' ' + T.arTime(T.timeStr(new Date(new Date(i.done_at).getTime() + this.off * 60000))) : ''}`);
    for (const r of d.reqs) lines.push(`• طلب: ${r.text} — ${st[r.status] || r.status}`);
    if (!lines.length) lines.push('لا مهام مسجّلة اليوم.');
    return this.wa.text(p.phone, `📋 تفاصيل اليوم\n${lines.join('\n')}`.slice(0, 4000));
  }

  // ---------- admin ----------
  // Two accounts: the owner (ADMIN_USER, default "admin", + ADMIN_PASSWORD from Cloudflare) with full access,
  // and an optional family account (set by the owner in Settings) that can only view today's board, tasks and requests.
  async admin(request, url) {
    const path = url.pathname;
    const origin = request.headers.get('x-public-origin') || url.origin;
    if (origin && origin !== this.settings().public_origin) this.setSetting('public_origin', origin);
    const role = await this.sessionRole(request);

    if (path === '/admin/login' && request.method === 'POST') {
      const ct = request.headers.get('content-type') || '';
      let user = '', pw = '';
      if (ct.includes('json')) {
        const j = await request.json().catch(() => ({}));
        user = j.username || ''; pw = j.password || '';
      } else {
        const fd = await request.formData().catch(() => null);
        user = fd?.get('username') || ''; pw = fd?.get('password') || '';
      }
      user = String(user).trim().toLowerCase();
      if (!this.env.ADMIN_PASSWORD) return html(LOGIN_HTML('لم يُضبط ADMIN_PASSWORD في إعدادات Worker بعد.'), 500);
      const r = await this.checkLogin(user, String(pw));
      if (!r) {
        this.log('warn', 'admin login failed', { user });
        return html(LOGIN_HTML('اسم المستخدم أو كلمة المرور غير صحيحة.'), 401);
      }
      const cookie = await this.sessionCookie(r);
      return new Response(null, { status: 302, headers: { Location: '/admin', 'Set-Cookie': `mb=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` } });
    }
    if (path === '/admin/logout') {
      return new Response(null, { status: 302, headers: { Location: '/admin', 'Set-Cookie': 'mb=; Path=/; Max-Age=0' } });
    }
    if (!role) {
      if (path.startsWith('/admin/api')) return json({ error: 'unauthorized' }, 401);
      return html(LOGIN_HTML(this.env.ADMIN_PASSWORD ? '' : 'لم يُضبط ADMIN_PASSWORD في إعدادات Worker بعد.'));
    }
    if (path === '/admin' || path === '/admin/') return html(ADMIN_HTML(role));
    if (path.startsWith('/admin/api/')) {
      const route = path.slice('/admin/api/'.length);
      if (role !== 'owner' && !this.familyAllowed(request.method, route)) return json({ error: 'هذه الصلاحية لربّ البيت فقط' }, 403);
      return this.adminApi(request, url, route, origin, role);
    }
    return new Response('not found', { status: 404 });
  }

  ownerUser() {
    return String(this.env.ADMIN_USER || 'admin').trim().toLowerCase();
  }
  familyAllowed(method, route) {
    if (method !== 'GET') return false;
    const res = route.split('/')[0].split('?')[0];
    return ['overview', 'today', 'recurring', 'requests', 'me'].includes(res);
  }
  async sha(text) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // returns 'owner' | 'family' | null
  async checkLogin(user, pw) {
    if (user === this.ownerUser() && pw === this.env.ADMIN_PASSWORD) return 'owner';
    const s = this.settings();
    if (s.family_user && s.family_pass && user === String(s.family_user).toLowerCase()) {
      const h = await this.sha(`mudaar-family:${s.family_salt || ''}:${pw}`);
      if (h === s.family_pass) return 'family';
    }
    return null;
  }
  roleCredential(role) {
    return role === 'owner' ? this.env.ADMIN_PASSWORD : (this.settings().family_pass || '');
  }
  async sessionCookie(role) {
    const cred = this.roleCredential(role);
    if (!cred) return '';
    return `${role}.${await this.sha(`mudaar-session:${role}:${cred}`)}`;
  }
  async sessionRole(request) {
    if (!this.env.ADMIN_PASSWORD) return null;
    const cookie = request.headers.get('cookie') || '';
    const m = cookie.match(/(?:^|;\s*)mb=(owner|family)\.([a-f0-9]+)/);
    if (!m) return null;
    const expected = await this.sessionCookie(m[1]);
    return expected && `${m[1]}.${m[2]}` === expected ? m[1] : null;
  }

  async adminApi(request, url, route, origin, role = 'owner') {
    const method = request.method;
    let body = {};
    if (method !== 'GET') {
      body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object' || !Object.keys(body).length) {
        // Safari on iOS occasionally sends an empty body; the admin page also puts the payload in ?_b=
        const qb = url.searchParams.get('_b');
        if (qb) { try { body = JSON.parse(qb); } catch (e) { body = {}; } } else body = {};
      }
    }
    const [res, id, sub] = route.split('/');

    switch (res) {
      case 'me':
        return json({ role, user: role === 'owner' ? this.ownerUser() : this.settings().family_user || '' });

      case 'account': {
        // owner only (enforced by familyAllowed): manage the family (view-only) account
        if (id === 'family' && method === 'PUT') {
          const user = String(body.username || '').trim().toLowerCase();
          const pw = String(body.password || '');
          if (!/^[a-z0-9._-]{3,32}$/.test(user)) return json({ error: 'اسم المستخدم: 3–32 حرفاً لاتينياً أو أرقاماً' }, 400);
          if (user === this.ownerUser()) return json({ error: 'هذا اسم المستخدم الرئيسي' }, 400);
          if (pw.length < 6) return json({ error: 'كلمة المرور 6 أحرف على الأقل' }, 400);
          const salt = crypto.randomUUID();
          this.setSetting('family_user', user);
          this.setSetting('family_salt', salt);
          this.setSetting('family_pass', await this.sha(`mudaar-family:${salt}:${pw}`));
          this.log('info', 'family account set', { user });
          return json({ ok: true, user });
        }
        if (id === 'family' && method === 'DELETE') {
          for (const k of ['family_user', 'family_salt', 'family_pass']) this.setSetting(k, '');
          return json({ ok: true });
        }
        break;
      }

      case 'overview': {
        const s = this.settings();
        const today = this.today();
        if (role !== 'owner') {
          return json({
            today,
            now: T.timeStr(this.now()),
            settings: { bot_name: s.bot_name, morning_time: s.morning_time, summary_time: s.summary_time },
            counts: {
              people: this.q1(`SELECT COUNT(*) AS n FROM people WHERE active = 1`).n,
              recurring: this.q1(`SELECT COUNT(*) AS n FROM recurring WHERE active = 1`).n,
              today_instances: this.q1(`SELECT COUNT(*) AS n FROM instances WHERE date = ?`, today).n,
              today_done: this.q1(`SELECT COUNT(*) AS n FROM instances WHERE date = ? AND status = 'done'`, today).n,
            },
          });
        }
        return json({
          today,
          now: T.timeStr(this.now()),
          settings: s,
          secrets: this.secretStatus(),
          counts: {
            people: this.q1(`SELECT COUNT(*) AS n FROM people WHERE active = 1`).n,
            recurring: this.q1(`SELECT COUNT(*) AS n FROM recurring WHERE active = 1`).n,
            today_instances: this.q1(`SELECT COUNT(*) AS n FROM instances WHERE date = ?`, today).n,
            today_done: this.q1(`SELECT COUNT(*) AS n FROM instances WHERE date = ? AND status = 'done'`, today).n,
            open_requests: this.q1(`SELECT COUNT(*) AS n FROM requests WHERE status IN ('sent','deferred','queued','problem')`).n,
            open_shopping: this.q1(`SELECT COUNT(*) AS n FROM shopping WHERE status = 'open'`).n,
          },
          webhook_url: `${origin}/webhook`,
          verify_token: this.env.VERIFY_TOKEN || 'mudaar-verify-2026',
        });
      }
      case 'people':
        if (method === 'GET') return json(this.q(`SELECT id, name, role, phone, lang, gets_summary, active, last_inbound_at, welcome_pending, welcomed_at FROM people WHERE active = 1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'family' THEN 1 WHEN 'maid' THEN 2 ELSE 3 END, id`));
        if (method === 'POST' && !id) {
          const phone = normalizePhone(body.phone);
          if (!body.name || !phone || phone.length < 9 || !['owner', 'family', 'maid', 'driver'].includes(body.role)) {
            this.log('warn', 'people add rejected', { got: Object.keys(body), name: body.name || '', phone_len: phone.length, role: body.role || '' });
            if (!body.name) return json({ error: 'الاسم مطلوب' }, 400);
            if (!phone || phone.length < 9) return json({ error: 'رقم واتساب غير صالح' }, 400);
            return json({ error: 'الدور غير صالح' }, 400);
          }
          const existing = this.q1(`SELECT id, name, active FROM people WHERE phone = ?`, phone);
          const newId = this.run(
            `INSERT INTO people(name, role, phone, lang, gets_summary, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)
             ON CONFLICT(phone) DO UPDATE SET name = excluded.name, role = excluded.role, lang = excluded.lang, gets_summary = excluded.gets_summary, active = 1`,
            body.name, body.role, phone, body.lang || (body.role === 'maid' || body.role === 'driver' ? 'en' : 'ar'), body.gets_summary ? 1 : 0, T.isoNow()
          );
          if (existing && existing.active) return json({ ok: true, id: existing.id, updated: true, previous: existing.name });
          return json({ ok: true, id: newId });
        }
        if (method === 'POST' && id && sub === 'welcome') {
          const p = this.q1(`SELECT * FROM people WHERE id = ? AND active = 1`, id);
          if (!p) return json({ error: 'الشخص غير موجود' }, 404);
          if (this.canFree(p)) {
            await this.sendWelcome(p);
            return json({ ok: true, sent: true });
          }
          this.sql.exec(`UPDATE people SET welcome_pending = 1 WHERE id = ?`, id);
          return json({ ok: true, sent: false, pending: true });
        }
        if (method === 'DELETE' && id && sub === 'welcome') {
          this.sql.exec(`UPDATE people SET welcome_pending = 0 WHERE id = ?`, id);
          return json({ ok: true });
        }
        if (method === 'PUT' && id) {
          this.sql.exec(
            `UPDATE people SET name = ?, role = ?, phone = ?, lang = ?, gets_summary = ?, active = ? WHERE id = ?`,
            body.name, body.role, normalizePhone(body.phone), body.lang || 'en', body.gets_summary ? 1 : 0, body.active === false ? 0 : 1, id
          );
          return json({ ok: true });
        }
        if (method === 'DELETE' && id) {
          this.sql.exec(`UPDATE people SET active = 0 WHERE id = ?`, id);
          return json({ ok: true });
        }
        break;

      case 'recurring':
        if (method === 'GET') return json(this.q(`SELECT * FROM recurring ORDER BY active DESC, id`).map((r) => ({ ...r, human: describeRecurrence({ ...r, days: String(r.days || '').split(',').filter(Boolean).map(Number), interval: r.interval_n }) })));
        if (method === 'POST') {
          if (!body.title || !body.freq || !body.assignee_role) return json({ error: 'بيانات ناقصة' }, 400);
          const worker = this.peopleByRole(body.assignee_role)[0];
          const l2 = body.title_l2 || (worker ? await this.translate(body.title, worker.lang) : '');
          const newId = this.run(
            `INSERT INTO recurring(title, title_l2, assignee_role, freq, days, interval_n, day_of_month, send_time, deadline_hours, remind_after_hours, escalate_now, active, start_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            body.title, l2, body.assignee_role, body.freq, (body.days || []).join(','), parseInt(body.interval_n || 1, 10), parseInt(body.day_of_month || 1, 10),
            body.send_time || null, parseFloat(body.deadline_hours || 4), parseFloat(body.remind_after_hours || 2), body.escalate_now ? 1 : 0, body.start_date || this.today(), T.isoNow()
          );
          return json({ ok: true, id: newId });
        }
        if (method === 'PUT' && id) {
          const cur = this.q1(`SELECT * FROM recurring WHERE id = ?`, id);
          if (!cur) return json({ error: 'غير موجود' }, 404);
          const merged = { ...cur, ...body };
          this.sql.exec(
            `UPDATE recurring SET title = ?, title_l2 = ?, assignee_role = ?, freq = ?, days = ?, interval_n = ?, day_of_month = ?, send_time = ?, deadline_hours = ?, remind_after_hours = ?, escalate_now = ?, active = ?, paused_until = ? WHERE id = ?`,
            merged.title, merged.title_l2 || null, merged.assignee_role, merged.freq, Array.isArray(merged.days) ? merged.days.join(',') : merged.days || '', parseInt(merged.interval_n || 1, 10),
            parseInt(merged.day_of_month || 1, 10), merged.send_time || null, parseFloat(merged.deadline_hours || 4), parseFloat(merged.remind_after_hours || 2), merged.escalate_now ? 1 : 0,
            merged.active === false || merged.active === 0 ? 0 : 1, merged.paused_until || null, id
          );
          return json({ ok: true });
        }
        if (method === 'DELETE' && id) {
          this.sql.exec(`DELETE FROM recurring WHERE id = ?`, id);
          return json({ ok: true });
        }
        break;

      case 'today': {
        const date = url.searchParams.get('date') || this.today();
        return json({
          date,
          instances: this.q(`SELECT i.*, p.name AS worker, p.role AS role FROM instances i LEFT JOIN people p ON p.id = i.assignee_id WHERE i.date = ? ORDER BY i.id`, date),
          summary: this.summaryText(date).text,
        });
      }
      case 'instances':
        if (method === 'POST' && id && sub === 'action') {
          const inst = this.q1(`SELECT * FROM instances WHERE id = ?`, id);
          if (!inst) return json({ error: 'غير موجود' }, 404);
          if (body.action === 'done') this.sql.exec(`UPDATE instances SET status = 'done', done_at = ? WHERE id = ?`, T.isoNow(), id);
          else if (body.action === 'cancel') this.sql.exec(`UPDATE instances SET status = 'cancelled' WHERE id = ?`, id);
          else if (body.action === 'resend') {
            this.sql.exec(`UPDATE instances SET status = 'pending', reminders = 0 WHERE id = ?`, id);
            await this.sendInstances([this.q1(`SELECT * FROM instances WHERE id = ?`, id)], false);
          }
          return json({ ok: true });
        }
        break;

      case 'requests':
        if (method === 'GET') {
          const days = parseInt(url.searchParams.get('days') || '7', 10);
          return json(this.q(
            `SELECT r.*, a.name AS assignee, a.role AS assignee_role, q.name AS requester FROM requests r LEFT JOIN people a ON a.id = r.assignee_id LEFT JOIN people q ON q.id = r.requester_id WHERE r.created_at > ? ORDER BY r.id DESC`,
            new Date(Date.now() - days * 86400000).toISOString()
          ));
        }
        if (method === 'POST' && id && sub === 'action') {
          if (body.action === 'done') this.sql.exec(`UPDATE requests SET status = 'done', done_at = ? WHERE id = ?`, T.isoNow(), id);
          else if (body.action === 'cancel') this.sql.exec(`UPDATE requests SET status = 'cancelled' WHERE id = ?`, id);
          else if (body.action === 'resend') await this.deliverRequest(parseInt(id, 10));
          return json({ ok: true });
        }
        if (method === 'POST' && !id) {
          const requester = this.owners()[0];
          if (!requester) return json({ error: 'أضف ربّ البيت أولاً' }, 400);
          await this.createRequest(requester, body.role, body.text, null);
          return json({ ok: true });
        }
        break;

      case 'shopping':
        if (method === 'GET') return json(this.q(`SELECT s.*, p.name AS added_by_name FROM shopping s LEFT JOIN people p ON p.id = s.added_by ORDER BY s.id DESC LIMIT 200`));
        if (method === 'POST' && id === 'send') {
          await this.dispatchShopping(true, null);
          return json({ ok: true });
        }
        if (method === 'POST') {
          const owner = this.owners()[0];
          for (const it of splitItems(body.items || body.item || '')) this.run(`INSERT INTO shopping(created_at, added_by, item, status) VALUES (?, ?, ?, 'open')`, T.isoNow(), owner?.id || null, it);
          return json({ ok: true });
        }
        if (method === 'PUT' && id) {
          this.sql.exec(`UPDATE shopping SET status = ?, note = ? WHERE id = ?`, body.status || 'open', body.note || null, id);
          return json({ ok: true });
        }
        if (method === 'DELETE' && id) {
          this.sql.exec(`DELETE FROM shopping WHERE id = ?`, id);
          return json({ ok: true });
        }
        break;

      case 'ratings':
        return json(this.q(
          `SELECT r.*, p.name AS rater,
             CASE r.kind WHEN 'inst' THEN (SELECT title FROM instances WHERE id = r.ref_id) WHEN 'req' THEN (SELECT text FROM requests WHERE id = r.ref_id) ELSE 'مشتريات' END AS subject
           FROM ratings r LEFT JOIN people p ON p.id = r.rater_id ORDER BY r.id DESC LIMIT 300`
        ));

      case 'settings':
        if (method === 'GET') {
          const { family_pass, family_salt, ...rest } = this.settings();
          return json({ ...rest, family_user: rest.family_user || '', owner_user: this.ownerUser() });
        }
        if (method === 'PUT') {
          for (const [k, v] of Object.entries(body)) if (k in DEFAULT_SETTINGS && !k.startsWith('last_')) this.setSetting(k, v);
          return json({ ok: true, settings: this.settings() });
        }
        break;

      case 'log':
        return json(this.q(`SELECT * FROM log ORDER BY id DESC LIMIT 200`));

      case 'leads':
        if (method === 'GET') return json(this.q(`SELECT * FROM leads ORDER BY last_at DESC LIMIT 200`));
        if (method === 'DELETE' && id) { this.sql.exec(`DELETE FROM leads WHERE id = ?`, id); return json({ ok: true }); }
        break;

      case 'export': {
        const table = id;
        const allowed = { people: 'SELECT id,name,role,phone,lang,gets_summary,active,last_inbound_at FROM people', recurring: 'SELECT * FROM recurring', instances: 'SELECT * FROM instances ORDER BY date DESC', requests: 'SELECT * FROM requests ORDER BY id DESC', shopping: 'SELECT * FROM shopping ORDER BY id DESC', ratings: 'SELECT * FROM ratings ORDER BY id DESC', leads: 'SELECT * FROM leads ORDER BY id DESC' };
        if (!allowed[table]) return json({ error: 'جدول غير معروف' }, 400);
        const rows = this.q(allowed[table]);
        const cols = rows.length ? Object.keys(rows[0]) : [];
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
        return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${table}-${this.today()}.csv"` } });
      }

      case 'setup':
        return this.setupApi(method, id, body, origin);

      case 'cron':
        if (method === 'POST') {
          await this.cron();
          return json({ ok: true });
        }
        break;

      case 'send':
        if (method === 'POST' && id === 'morning') {
          const today = this.today();
          if (this.settings().last_create_date !== today) {
            this.createInstancesFor(today);
            this.setSetting('last_create_date', today);
          }
          const pending = this.q(`SELECT * FROM instances WHERE date = ? AND status = 'pending'`, today);
          await this.sendInstances(pending, true);
          return json({ ok: true, sent: pending.length });
        }
        if (method === 'POST' && id === 'summary') {
          await this.sendSummaries(this.today());
          return json({ ok: true });
        }
        if (method === 'POST' && id === 'test') {
          const target = body.phone ? { phone: normalizePhone(body.phone) } : this.owners()[0];
          if (!target) return json({ error: 'لا يوجد رقم' }, 400);
          try {
            const r = await this.wa.buttons(target.phone, `👋 مرحباً! أنا ${this.botName}. هل تصلك هذه الرسالة؟`, [{ id: 'welcome:ack', title: 'نعم، وصلت' }]);
            return json({ ok: true, result: r });
          } catch (e) {
            return json({ error: e.message, graph: e.graph }, 500);
          }
        }
        break;
    }
    return json({ error: 'route not found' }, 404);
  }

  secretStatus() {
    const e = this.env;
    return {
      WHATSAPP_TOKEN: Boolean(e.WHATSAPP_TOKEN),
      PHONE_NUMBER_ID: Boolean(e.PHONE_NUMBER_ID),
      WABA_ID: Boolean(e.WABA_ID),
      ADMIN_PASSWORD: Boolean(e.ADMIN_PASSWORD),
      APP_ID: Boolean(e.APP_ID),
      APP_SECRET: Boolean(e.APP_SECRET),
      AI: Boolean(e.AI),
    };
  }

  async setupApi(method, action, body, origin) {
    const wa = this.wa;
    if (!wa.configured) return json({ error: 'أضف WHATSAPP_TOKEN و PHONE_NUMBER_ID و WABA_ID في إعدادات Worker أولاً' }, 400);
    try {
      switch (action) {
        case 'status': {
          const out = { webhook_url: `${origin}/webhook`, verify_token: this.env.VERIFY_TOKEN || 'mudaar-verify-2026' };
          try { out.phone = await wa.phoneInfo(); } catch (e) { out.phone_error = e.graph?.message || e.message; }
          try { out.subscribed = (await wa.subscribedApps()).data || []; } catch (e) { out.subscribed_error = e.graph?.message || e.message; }
          try {
            const t = (await wa.listTemplates()).data || [];
            out.templates = TEMPLATE_NAMES.map((n) => {
              const found = t.filter((x) => x.name === n);
              const ar = found.find((x) => x.language === 'ar') || found[0];
              return { name: n, status: ar ? ar.status : 'MISSING', category: ar?.category || null, reason: ar?.rejected_reason || null };
            });
          } catch (e) { out.templates_error = e.graph?.message || e.message; }
          return json(out);
        }
        case 'register': {
          if (!/^\d{6}$/.test(String(body.pin || ''))) return json({ error: 'الرمز يجب أن يكون 6 أرقام' }, 400);
          const r = await wa.register(body.pin);
          return json({ ok: true, result: r });
        }
        case 'subscribe': {
          const r = await wa.subscribeApp();
          return json({ ok: true, result: r });
        }
        case 'display_name': {
          const name = String(body.name || '').trim();
          if (name.length < 3) return json({ error: 'اكتب الاسم' }, 400);
          try {
            const r = await wa.setDisplayName(name);
            this.log('info', 'display name requested', { name, result: r });
            return json({ ok: true, result: r });
          } catch (e) {
            const g = e.graph || {};
            const detail = g.error_user_msg || g.error_user_title || g.message || e.message;
            this.log('warn', 'display name request failed', { name, error: detail, code: g.code, sub: g.error_subcode });
            return json({ error: detail }, 400);
          }
        }
        case 'templates': {
          const existing = ((await wa.listTemplates()).data || []).map((x) => x.name);
          const results = [];
          for (const def of TEMPLATES) {
            if (existing.includes(def.name)) { results.push({ name: def.name, skipped: true }); continue; }
            try {
              const r = await wa.createTemplate(def);
              results.push({ name: def.name, ok: true, status: r.status, id: r.id });
            } catch (e) {
              results.push({ name: def.name, error: e.graph?.error_user_msg || e.graph?.message || e.message });
            }
          }
          return json({ ok: true, results });
        }
        case 'webhook': {
          if (!this.env.APP_ID || !this.env.APP_SECRET) return json({ error: 'يلزم APP_ID و APP_SECRET للضبط التلقائي؛ وإلا اضبط Webhook يدوياً من لوحة التطبيق' }, 400);
          const r = await wa.setAppWebhook(this.env.APP_ID, this.env.APP_SECRET, `${origin}/webhook`, this.env.VERIFY_TOKEN || 'mudaar-verify-2026');
          return json({ ok: true, result: r });
        }
        default:
          return json({ error: 'unknown setup action' }, 404);
      }
    } catch (e) {
      return json({ error: e.graph?.error_user_msg || e.graph?.message || e.message, graph: e.graph || null }, 500);
    }
  }
}

function splitItems(text) {
  return String(text || '')
    .split(/[،,\n;؛]+| و(?= )/)
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 80);
}
