// Entry point. One Worker, two Durable Object classes:
//   Hub    — platform: households, logins, phone → household index, invites, cron fan-out
//   Ledger — one per household: people, tasks, requests, shopping, ratings, admin pages
// Public site (mudaar-hs.com) is served from static assets; the app (app.mudaar-hs.com) is the admin.
import { Ledger } from './ledger.js';
import { Hub } from './hub.js';
import { LOGIN_HTML } from './admin_ui.js';

export { Ledger, Hub };

const DEFAULT_VERIFY_TOKEN = 'mudaar-verify-2026';
const MAIN = 'main';

export function verifyToken(env) {
  return env.VERIFY_TOKEN || DEFAULT_VERIFY_TOKEN;
}

const ledger = (env, id) => env.LEDGER.get(env.LEDGER.idFromName(id || MAIN));
const hub = (env) => env.HUB.get(env.HUB.idFromName('hub'));

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- sessions: signed cookie, verified here, trusted by the DOs via headers ----------
const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const sessionSecret = (env) => env.SESSION_SECRET || env.ADMIN_PASSWORD || '';

async function makeCookie(env, session) {
  // the platform console (super) lives 12 hours; household sessions 30 days
  const ttl = session.r === 'super' || session.su ? 12 * 3600000 : 30 * 86400000;
  const payload = b64u(JSON.stringify({ ...session, exp: Date.now() + ttl }));
  const sig = await hmacHex(sessionSecret(env), payload);
  return `mb=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(ttl / 1000)}`;
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function rateLimit(env, key, limit, window_ms, lock_ms) {
  try {
    const r = await hub(env).fetch('https://hub.internal/rl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, limit, window_ms, lock_ms }) });
    return await r.json();
  } catch { return { ok: true }; }
}
// security headers on every response that leaves the Worker
const SEC_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
const CSP_APP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const CSP_SITE = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
function withSecurity(res, csp) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SEC_HEADERS)) if (!h.has(k)) h.set(k, v);
  if (csp && (h.get('content-type') || '').includes('text/html') && !h.has('Content-Security-Policy')) h.set('Content-Security-Policy', csp);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
async function readSession(env, request) {
  if (!sessionSecret(env)) return null;
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)mb=([A-Za-z0-9_-]+)\.([a-f0-9]+)/);
  if (!m) return null;
  if ((await hmacHex(sessionSecret(env), m[1])) !== m[2]) return null;
  try {
    const s = JSON.parse(unb64u(m[1]));
    if (!s.exp || s.exp < Date.now() || !s.h || !s.r) return null;
    return s;
  } catch { return null; }
}
const clearCookie = 'mb=; Path=/; Max-Age=0';
const redirect = (to, headers = {}) => new Response(null, { status: 302, headers: { Location: to, ...headers } });
const htmlRes = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function readBody(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('json')) return (await request.json().catch(() => ({}))) || {};
  const fd = await request.formData().catch(() => null);
  return fd ? Object.fromEntries(fd.entries()) : {};
}

const publicHostList = (env) => String(env.PUBLIC_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);

export default {
  async fetch(request, env, ctx) {
    const res = await handle(request, env, ctx);
    const isSite = publicHostList(env).includes(new URL(request.url).hostname);
    return withSecurity(res, isSite ? CSP_SITE : CSP_APP);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(hub(env).fetch('https://hub.internal/cron', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  },
};

async function handle(request, env, ctx) {
  {
    const url = new URL(request.url);
    const path = url.pathname;
    const publicHosts = publicHostList(env);
    const isPublicHost = publicHosts.includes(url.hostname);
    const appOrigin = env.APP_HOST ? `https://${env.APP_HOST}` : url.origin;
    const ip = request.headers.get('cf-connecting-ip') || '';
    const stdHeaders = { 'Content-Type': 'application/json', 'x-public-origin': url.origin, 'x-ip': ip };

    // ----- Meta webhook -----
    if (path === '/webhook' && request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === verifyToken(env) && challenge) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response('forbidden', { status: 403 });
    }
    if (path === '/webhook' && request.method === 'POST') {
      const raw = await request.text();
      if (env.APP_SECRET) {
        const header = request.headers.get('x-hub-signature-256') || '';
        const expected = 'sha256=' + (await hmacHex(env.APP_SECRET, raw));
        if (!safeEqual(header, expected)) return new Response('bad signature', { status: 401 });
      } else if (raw.length > 200000) {
        return new Response('too large', { status: 413 });
      }
      // an unsigned webhook (no APP_SECRET yet) is flagged to the platform ledger so the admin is told to set it
      ctx.waitUntil(dispatchWebhook(env, raw, url.origin, !env.APP_SECRET));
      return new Response('ok', { status: 200 });
    }

    // ----- public interest form → platform household -----
    if (path === '/api/interest' && request.method === 'POST') {
      const raw = await request.text();
      const rl = await rateLimit(env, 'interest:ip:' + (ip || 'unknown'), 6, 3600000, 3600000);
      if (!rl.ok) return jsonRes({ error: 'تم استلام طلبك مسبقاً — سنتواصل معك قريباً' }, 429);
      const r = await ledger(env, MAIN).fetch('https://ledger.internal/interest' + url.search, { method: 'POST', headers: { ...stdHeaders, 'x-ip': ip, 'x-household': MAIN }, body: raw });
      return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    // ----- invite pages (owner sets password) -----
    if (path.startsWith('/invite/')) {
      if (isPublicHost) return redirect(appOrigin + path + url.search);
      if (request.method === 'POST') {
        const body = await readBody(request);
        const r = await hub(env).fetch('https://hub.internal' + path, { method: 'POST', headers: stdHeaders, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return jsonRes(j, r.status);
        return new Response(JSON.stringify({ ok: true, to: '/admin' }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': await makeCookie(env, j.session) } });
      }
      return hub(env).fetch('https://hub.internal' + path, { headers: stdHeaders });
    }

    if (path === '/' || path === '') {
      if (isPublicHost && env.ASSETS) return env.ASSETS.fetch(request);
      return redirect(url.origin + '/admin');
    }

    // ----- admin: login / logout / session -----
    if (path.startsWith('/admin')) {
      if (isPublicHost) return redirect(appOrigin + path);
      if (path === '/admin/login' && request.method === 'POST') {
        const body = await readBody(request);
        const r = await hub(env).fetch('https://hub.internal/auth/login', { method: 'POST', headers: stdHeaders, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.session) return htmlRes(LOGIN_HTML(j.error || 'تعذّر الدخول', body.kind === 'admin' ? 'admin' : 'owner'), r.status === 500 ? 500 : r.status === 429 ? 429 : 401);
        return redirect('/admin', { 'Set-Cookie': await makeCookie(env, j.session) });
      }
      if (path === '/admin/logout') return redirect('/admin', { 'Set-Cookie': clearCookie });

      const session = await readSession(env, request);
      if (!session) {
        if (path.startsWith('/admin/api')) return jsonRes({ error: 'unauthorized' }, 401);
        return htmlRes(LOGIN_HTML(env.ADMIN_PASSWORD ? '' : 'لم يُضبط ADMIN_PASSWORD في إعدادات Worker بعد.'));
      }

      // platform owner switching into another household's board (and back)
      if (path.startsWith('/admin/switch/')) {
        if (session.r !== 'super' && !session.su) return jsonRes({ error: 'forbidden' }, 403);
        const target = path.slice('/admin/switch/'.length) || 'console';
        // back to the platform console (no household open)
        if (target === 'console') return redirect('/admin', { 'Set-Cookie': await makeCookie(env, { h: MAIN, r: 'super', u: session.u, n: session.n, hn: 'لوحة المنصة' }) });
        const r = await hub(env).fetch(`https://hub.internal/api/households/${target}`, { headers: { ...stdHeaders, 'x-role': 'super', 'x-household': MAIN } });
        if (!r.ok) return jsonRes({ error: 'المنزل غير موجود' }, 404);
        const hh = await r.json();
        // open a household's board (the platform owner's own house "main" included) as its owner
        return redirect('/admin', { 'Set-Cookie': await makeCookie(env, { h: target, r: 'owner', su: 1, u: session.u, n: session.n, hn: hh.name }) });
      }

      const fwdHeaders = new Headers(request.headers);
      fwdHeaders.set('x-public-origin', url.origin);
      fwdHeaders.set('x-household', session.h);
      fwdHeaders.set('x-role', session.r);
      fwdHeaders.set('x-user', session.u || '');
      fwdHeaders.set('x-user-name', encodeURIComponent(session.n || ''));
      fwdHeaders.set('x-household-name', encodeURIComponent(session.hn || ''));
      if (session.su) fwdHeaders.set('x-impersonating', '1');
      fwdHeaders.delete('cookie');

      // platform-level API lives in the Hub
      if (/^\/admin\/api\/(households|account\/family|me)(\/|$)/.test(path)) {
        const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
        const r = await hub(env).fetch('https://hub.internal/api/' + path.slice('/admin/api/'.length) + url.search, { method: request.method, headers: fwdHeaders, body });
        return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
      }

      // the platform console (super, no household open) only reaches platform-level routes of the platform ledger;
      // house data is reached by opening a household's board (/admin/switch/:id)
      if (session.r === 'super' && path.startsWith('/admin/api/')) {
        const route = path.slice('/admin/api/'.length);
        const head = route.split('/')[0];
        const allowed = ['setup', 'leads', 'log', 'settings', 'overview', 'cron'].includes(head) || route === 'export/leads' || route === 'send/test';
        if (!allowed) return jsonRes({ error: 'هذه بيانات منزل — افتح لوحة المنزل من «المنازل» أولاً' }, 403);
      }
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
      return ledger(env, session.h).fetch(new Request(request.url, { method: request.method, headers: fwdHeaders, body, redirect: 'manual' }));
    }

    if (path === '/health') return new Response('ok');
    if (env.ASSETS) return env.ASSETS.fetch(request); // static files: site pages, welcome videos
    return new Response('not found', { status: 404 });
  }
}

// Split one Meta webhook payload by household: each message goes to the household its sender belongs to;
// unknown senders go to the platform household (visitor flow); delivery statuses follow the recipient.
async function dispatchWebhook(env, raw, origin, unsigned = false) {
  let body;
  try { body = JSON.parse(raw); } catch { return; }
  const phones = new Set();
  for (const entry of body.entry || []) for (const ch of entry.changes || []) {
    for (const m of ch.value?.messages || []) phones.add(m.from);
    for (const s of ch.value?.statuses || []) if (s.recipient_id) phones.add(s.recipient_id);
  }
  let routes = {};
  if (phones.size) {
    const r = await hub(env).fetch('https://hub.internal/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phones: [...phones] }) });
    routes = r.ok ? await r.json() : {};
  }
  const byHousehold = {};
  for (const entry of body.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    const put = (hid, patch) => {
      byHousehold[hid] ||= { entry: [{ changes: [{ value: { messaging_product: v.messaging_product, metadata: v.metadata, contacts: v.contacts || [], messages: [], statuses: [] } }] }] };
      const slot = byHousehold[hid].entry[0].changes[0].value;
      if (patch.message) slot.messages.push(patch.message);
      if (patch.status) slot.statuses.push(patch.status);
    };
    for (const m of v.messages || []) put(routes[m.from] || MAIN, { message: m });
    for (const s of v.statuses || []) put(routes[s.recipient_id] || MAIN, { status: s });
  }
  await Promise.all(Object.entries(byHousehold).map(([hid, payload]) =>
    ledger(env, hid).fetch('https://ledger.internal/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-public-origin': origin, 'x-household': hid, ...(unsigned ? { 'x-unsigned': '1' } : {}) }, body: JSON.stringify(payload) })
      .catch(() => {})
  ));
}
