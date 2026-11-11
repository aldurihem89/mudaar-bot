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
  const payload = b64u(JSON.stringify({ ...session, exp: Date.now() + 30 * 86400000 }));
  const sig = await hmacHex(sessionSecret(env), payload);
  return `mb=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const publicHosts = String(env.PUBLIC_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
    const isPublicHost = publicHosts.includes(url.hostname);
    const appOrigin = env.APP_HOST ? `https://${env.APP_HOST}` : url.origin;
    const stdHeaders = { 'Content-Type': 'application/json', 'x-public-origin': url.origin };

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
        if (header !== expected) return new Response('bad signature', { status: 401 });
      }
      ctx.waitUntil(dispatchWebhook(env, raw, url.origin));
      return new Response('ok', { status: 200 });
    }

    // ----- public interest form → platform household -----
    if (path === '/api/interest' && request.method === 'POST') {
      const raw = await request.text();
      const ip = request.headers.get('cf-connecting-ip') || '';
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
        if (!r.ok || !j.session) return htmlRes(LOGIN_HTML(j.error || 'تعذّر الدخول', body.kind === 'admin' ? 'admin' : 'owner'), r.status === 500 ? 500 : 401);
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

      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
      return ledger(env, session.h).fetch(new Request(request.url, { method: request.method, headers: fwdHeaders, body, redirect: 'manual' }));
    }

    if (path === '/health') return new Response('ok');
    if (env.ASSETS) return env.ASSETS.fetch(request); // static files: site pages, welcome videos
    return new Response('not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(hub(env).fetch('https://hub.internal/cron', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  },
};

// Split one Meta webhook payload by household: each message goes to the household its sender belongs to;
// unknown senders go to the platform household (visitor flow); delivery statuses follow the recipient.
async function dispatchWebhook(env, raw, origin) {
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
    ledger(env, hid).fetch('https://ledger.internal/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-public-origin': origin, 'x-household': hid }, body: JSON.stringify(payload) })
      .catch(() => {})
  ));
}
