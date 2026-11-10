// WhatsApp Cloud API (Graph API) helpers.

export class WA {
  constructor(env) {
    this.token = env.WHATSAPP_TOKEN;
    this.phoneId = env.PHONE_NUMBER_ID;
    this.wabaId = env.WABA_ID;
    this.version = env.GRAPH_VERSION || 'v23.0';
    this.base = `https://graph.facebook.com/${this.version}`;
  }

  get configured() {
    return Boolean(this.token && this.phoneId && this.wabaId);
  }

  async graph(path, { method = 'GET', body, token } = {}) {
    const res = await fetch(`${this.base}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token || this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const msg = json?.error?.message || text;
      const err = new Error(`Graph ${method} ${path} -> ${res.status}: ${msg}`);
      err.status = res.status;
      err.graph = json?.error;
      throw err;
    }
    return json;
  }

  // ---- sending ----
  send(payload) {
    return this.graph(`${this.phoneId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', ...payload },
    });
  }

  text(to, body) {
    return this.send({ to, type: 'text', text: { body, preview_url: false } });
  }

  // buttons: [{id, title}] max 3, title <= 20 chars
  buttons(to, body, buttons, { header, footer } = {}) {
    const interactive = {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })),
      },
    };
    if (header) interactive.header = { type: 'text', text: header.slice(0, 60) };
    if (footer) interactive.footer = { text: footer.slice(0, 60) };
    return this.send({ to, type: 'interactive', interactive });
  }

  // video by public link (mp4/h264, <= 16 MB)
  video(to, link, caption) {
    return this.send({ to, type: 'video', video: { link, ...(caption ? { caption: String(caption).slice(0, 1024) } : {}) } });
  }

  // contact card (vCard) so the recipient can save the bot under its name with one tap
  contactCard(to, name, phone, { org } = {}) {
    const wa = String(phone).replace(/\D/g, '');
    return this.send({
      to,
      type: 'contacts',
      contacts: [{
        name: { formatted_name: name, first_name: name },
        phones: [{ phone: `+${wa}`, wa_id: wa, type: 'WORK' }],
        ...(org ? { org: { company: org } } : {}),
      }],
    });
  }

  // sections: [{title, rows:[{id,title,description}]}] max 10 rows total
  list(to, body, buttonText, sections, { header, footer } = {}) {
    const interactive = {
      type: 'list',
      body: { text: body },
      action: { button: buttonText.slice(0, 20), sections },
    };
    if (header) interactive.header = { type: 'text', text: header.slice(0, 60) };
    if (footer) interactive.footer = { text: footer.slice(0, 60) };
    return this.send({ to, type: 'interactive', interactive });
  }

  // template with body params (strings) and optional quick-reply payloads (array of strings, by button index)
  template(to, name, bodyParams = [], buttonPayloads = [], lang = 'ar') {
    const components = [];
    if (bodyParams.length) {
      components.push({
        type: 'body',
        parameters: bodyParams.map((t) => ({ type: 'text', text: sanitizeParam(t) })),
      });
    }
    buttonPayloads.forEach((payload, index) => {
      if (payload == null) return;
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload: String(payload).slice(0, 128) }],
      });
    });
    return this.send({ to, type: 'template', template: { name, language: { code: lang }, components } });
  }

  markRead(messageId) {
    return this.graph(`${this.phoneId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
    }).catch(() => {});
  }

  // ---- media ----
  async mediaUrl(mediaId) {
    const j = await this.graph(`${mediaId}`);
    return j.url;
  }

  // ---- account management ----
  phoneInfo() {
    return this.graph(`${this.phoneId}?fields=display_phone_number,verified_name,new_display_name,quality_rating,code_verification_status,name_status,platform_type,status`);
  }

  // request a new display name for the number (Meta reviews it; name_status becomes PENDING_REVIEW)
  setDisplayName(name) {
    return this.graph(`${this.phoneId}`, { method: 'POST', body: { new_display_name: String(name) } });
  }

  register(pin) {
    return this.graph(`${this.phoneId}/register`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', pin: String(pin) },
    });
  }

  subscribedApps() {
    return this.graph(`${this.wabaId}/subscribed_apps`);
  }

  subscribeApp() {
    return this.graph(`${this.wabaId}/subscribed_apps`, { method: 'POST', body: {} });
  }

  listTemplates() {
    return this.graph(`${this.wabaId}/message_templates?fields=name,status,category,language,rejected_reason&limit=100`);
  }

  createTemplate(def) {
    return this.graph(`${this.wabaId}/message_templates`, { method: 'POST', body: def });
  }

  // Configure the app webhook (needs APP_ID + APP_SECRET)
  setAppWebhook(appId, appSecret, callbackUrl, verifyToken) {
    const params = new URLSearchParams({
      object: 'whatsapp_business_account',
      callback_url: callbackUrl,
      verify_token: verifyToken,
      fields: 'messages',
      access_token: `${appId}|${appSecret}`,
    });
    return fetch(`${this.base}/${appId}/subscriptions`, { method: 'POST', body: params }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
      return j;
    });
  }
}

// Template parameters may not contain newlines, tabs, or 4+ consecutive spaces, and may not be empty.
export function sanitizeParam(s) {
  let t = String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  if (!t) t = '·';
  return t.slice(0, 1000);
}

export function normalizePhone(p) {
  let d = String(p || '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('05') && d.length === 10) d = '966' + d.slice(1); // Saudi local format
  if (d.startsWith('5') && d.length === 9) d = '966' + d;
  return d;
}
