// Entry point: routes Meta webhooks and the admin UI to the single Ledger Durable Object.
import { Ledger } from './ledger.js';

export { Ledger };

const DEFAULT_VERIFY_TOKEN = 'mudaar-verify-2026';

export function verifyToken(env) {
  return env.VERIFY_TOKEN || DEFAULT_VERIFY_TOKEN;
}

function stub(env) {
  return env.LEDGER.get(env.LEDGER.idFromName('main'));
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Meta webhook verification handshake
    if (path === '/webhook' && request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === verifyToken(env) && challenge) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response('forbidden', { status: 403 });
    }

    // Inbound messages: answer 200 immediately, process in the background
    if (path === '/webhook' && request.method === 'POST') {
      const raw = await request.text();
      if (env.APP_SECRET) {
        const header = request.headers.get('x-hub-signature-256') || '';
        const expected = 'sha256=' + (await hmacHex(env.APP_SECRET, raw));
        if (header !== expected) return new Response('bad signature', { status: 401 });
      }
      ctx.waitUntil(
        stub(env).fetch('https://ledger.internal/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: raw,
        })
      );
      return new Response('ok', { status: 200 });
    }

    if (path === '/' || path === '') {
      return Response.redirect(url.origin + '/admin', 302);
    }

    if (path.startsWith('/admin')) {
      // Forward to the Durable Object, preserving method, headers, body and the public origin
      const headers = new Headers(request.headers);
      headers.set('x-public-origin', url.origin);
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
      return stub(env).fetch(new Request(request.url, { method: request.method, headers, body, redirect: 'manual' }));
    }

    if (path === '/health') return new Response('ok');
    return new Response('not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(stub(env).fetch('https://ledger.internal/cron', { method: 'POST' }));
  },
};
