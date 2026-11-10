// Admin UI (Arabic, RTL, mobile-first). Served by the Ledger; talks to /admin/api/*.

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alexandria:wght@400..800&family=Outfit:wght@400..700&display=swap">`;

// mudaar brand (Nov 2026): Violet #6B3BF6 · Night #17113A · Cloud #F7F5FC · Sun #FFC53D · Mint #31D6A6 · Coral #FF6A55 · Sky #45A9FF
const WORDMARK = (stroke) => `<path d="M0.5 -0.5V-2.7A1.8 1.8 0 0 1 4.1 -2.7V-0.5M4.1 -2.7A1.8 1.8 0 0 1 7.7 -2.7V-0.5M9.85 -4.5V-2.5A2 2 0 0 0 13.85 -2.5M13.85 -4.5V-0.5M15.8 -2.5A2 2 0 1 1 19.8 -2.5A2 2 0 1 1 15.8 -2.5ZM19.8 -6.7V-0.5M21.75 -2.5A2 2 0 1 1 25.75 -2.5A2 2 0 1 1 21.75 -2.5ZM25.75 -4.5V-0.5M27.7 -2.5A2 2 0 1 1 31.7 -2.5A2 2 0 1 1 27.7 -2.5ZM31.7 -4.5V-0.5M33.85 -0.5V-2.6A1.9 1.9 0 0 1 36.08 -4.47" fill="none" stroke="${stroke}" stroke-width="1" stroke-linecap="round"/><path d="M1.32 0V-2.7A0.98 0.98 0 0 1 3.28 -2.7V0Z" fill="#FFC53D"/><path d="M4.92 0V-2.7A0.98 0.98 0 0 1 6.88 -2.7V0Z" fill="#FF6A55"/>`;
const ARABIC_MARK = (stroke) => `<path d="M2.1 -2.7V-0.5A2.1 2.1 0 0 1 -0.37 1.57M4.25 -0.5V-6.7M7.95 -0.5V-3A1.5 1.5 0 0 0 5.82 -4.36M5.95 -0.5H11.5M9.9 -2.1A1.6 1.6 0 1 1 13.1 -2.1A1.6 1.6 0 1 1 9.9 -2.1Z" fill="none" stroke="${stroke}" stroke-width="1" stroke-linecap="round"/><circle cx="11.5" cy="-2.1" r="0.78" fill="#FFC53D"/><path d="M11.2 -6.05A0.55 0.55 0 1 1 12.3 -6.05A0.55 0.55 0 1 1 11.2 -6.05ZM11.48 -5.57Q11.3 -5 10.75 -4.75" fill="none" stroke="#FF6A55" stroke-width="0.62" stroke-linecap="round"/>`;
export const LOGO_H = (h = 28, stroke = '#17113A') => `<svg height="${h}" viewBox="-0.1 -7.3 54.65 9.5" role="img" aria-label="mudaar مُدار" style="display:block;width:auto">${WORDMARK(stroke)}<g transform="translate(40.85 0)">${ARABIC_MARK(stroke)}</g></svg>`;
export const LOGO_V = (h = 96, stroke = '#17113A') => `<svg height="${h}" viewBox="-0.1 -7.3 36.78 19.5" role="img" aria-label="mudaar مُدار" style="display:block;width:auto">${WORDMARK(stroke)}<g transform="translate(11.93 10)">${ARABIC_MARK(stroke)}</g></svg>`;

const CSS = `
:root{--violet:#6B3BF6;--violet-dk:#5730D1;--night:#17113A;--cloud:#F7F5FC;--sun:#FFC53D;--mint:#31D6A6;--coral:#FF6A55;--sky:#45A9FF;--line:#E3DCFA;--line2:#EEEAF8;--muted:#5C5677;--ink2:#4A4466;--tint:#F1EEF9}
*{box-sizing:border-box}body{margin:0;font-family:'Alexandria','Outfit',-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;background:var(--cloud);color:var(--night);direction:rtl}
header{background:#fff;color:var(--night);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:5;border-bottom:1px solid var(--line)}
header .brand{display:flex;align-items:center;gap:12px}header .brand .sub{font-size:13px;color:var(--muted);border-right:1px solid var(--line);padding-right:12px;line-height:1.2}
header h1{font-size:18px;margin:0}header a{color:var(--violet);text-decoration:none;font-size:13px;font-weight:600}
nav{display:flex;gap:6px;overflow-x:auto;padding:10px 12px;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:57px;z-index:4;-webkit-overflow-scrolling:touch}
nav button{flex:none;border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 14px;font-size:14px;color:var(--night);font-family:inherit}
nav button.on{background:var(--violet);color:#fff;border-color:var(--violet)}
main{padding:14px;max-width:760px;margin:0 auto}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:12px}
.card h2{font-size:16px;margin:0 0 10px;font-weight:700}.muted{color:var(--muted);font-size:13px}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line2)}.row:last-child{border-bottom:none}
.row .t{font-size:15px}.row .s{font-size:12px;color:var(--muted);margin-top:2px}
.pill{display:inline-block;border-radius:999px;padding:3px 10px;font-size:12px;background:var(--tint);color:var(--ink2);white-space:nowrap}
.ok{background:#E2F8F0;color:#0B6B4F}.warn{background:#FFF3D1;color:#7A5200}.bad{background:#FFE7E3;color:#9A2A1C}
button{font-family:inherit}
button.btn{border:none;background:var(--violet);color:#fff;border-radius:12px;padding:10px 14px;font-size:14px;font-weight:600}
button.btn:active{background:var(--violet-dk)}
button.sec{background:#fff;color:var(--violet);border:1.5px solid var(--violet)}button.danger{background:#fff;color:#B23A2A;border:1.5px solid var(--coral)}
button.sm{padding:6px 10px;font-size:13px;border-radius:9px}
input,select,textarea{width:100%;padding:10px;border:1px solid #DDD6F3;border-radius:12px;font-size:15px;background:#fff;font-family:inherit;color:var(--night)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--violet);outline-offset:1px;border-color:var(--violet)}
label{display:block;font-size:13px;color:var(--ink2);margin:10px 0 4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.kpi div{background:var(--cloud);border:1px solid var(--line);border-radius:14px;padding:10px;text-align:center}.kpi b{display:block;font-size:22px;color:var(--violet);font-family:'Outfit','Alexandria',sans-serif}.kpi span{font-size:12px;color:var(--muted)}
pre{background:var(--tint);border-radius:12px;padding:10px;white-space:pre-wrap;font-size:12px;direction:ltr;text-align:left}
.toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--night);color:#fff;padding:10px 16px;border-radius:999px;font-size:14px;z-index:9;max-width:92vw}
.days{display:flex;gap:6px;flex-wrap:wrap}.days label{display:flex;align-items:center;gap:4px;background:var(--tint);border-radius:9px;padding:6px 8px;margin:0;font-size:13px}.days input{width:auto;accent-color:var(--violet)}
.chk{display:flex;align-items:center;gap:8px;margin-top:10px}.chk input{width:auto;accent-color:var(--violet)}
.login{max-width:380px;margin:48px auto;padding:0 16px}.login .card{padding:28px 24px;text-align:center}.login .logo{display:flex;justify-content:center;margin:6px 0 14px}.login form{text-align:right}.login .btn{width:100%}
.login .tag{font-size:15px;font-weight:700;margin:0 0 4px}.login .dots{display:flex;justify-content:center;gap:6px;margin:14px 0 0}.login .dots i{width:8px;height:8px;border-radius:50%;display:block}
`;

export function LOGIN_HTML(message = '') {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mudaar — دخول</title>${FONTS}<style>${CSS}</style></head>
<body><div class="login"><div class="card"><div class="logo">${LOGO_V(104)}</div><p class="tag">مساعد البيت</p><p class="muted" style="margin:0">صفحة الإدارة. ربّ البيت يدخل باسم <b dir="ltr">admin</b> وكلمة المرور المضبوطة في Cloudflare؛ وأهل البيت بالحساب الذي يمنحه لهم.</p>
${message ? `<p class="pill bad" style="display:block;padding:10px">${message}</p>` : ''}
<form method="post" action="/admin/login"><label>اسم المستخدم</label><input type="text" name="username" autocapitalize="none" autocorrect="off" autocomplete="username" placeholder="admin" dir="ltr"><label>كلمة المرور</label><input type="password" name="password" autocomplete="current-password" dir="ltr"><div class="actions"><button class="btn" type="submit">دخول</button></div></form><div class="dots"><i style="background:var(--sun)"></i><i style="background:var(--mint)"></i><i style="background:var(--coral)"></i><i style="background:var(--sky)"></i></div></div></div></body></html>`;
}

export const ADMIN_HTML = (role = 'owner') => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mudaar — الإدارة</title>${FONTS}<style>${CSS}</style></head>
<body>
<header><div class="brand">${LOGO_H(26)}<span class="sub">مساعد البيت<br>${role === 'owner' ? 'ربّ البيت' : 'أهل البيت'}</span></div><a href="/admin/logout">خروج</a></header>
<nav id="nav"></nav>
<main id="main"><div class="card">جارٍ التحميل…</div></main>
<script>
const ME={role:'${role}'};const OWNER=ME.role==='owner';
const ALL_TABS=[['setup','الإعداد'],['today','اليوم'],['recurring','المهام الدورية'],['people','الأشخاص'],['requests','الطلبات'],['shopping','المشتريات'],['ratings','التقييمات'],['settings','الإعدادات'],['log','السجل']];
const FAMILY_TABS=['today','recurring','requests'];
const TABS=OWNER?ALL_TABS:ALL_TABS.filter(([k])=>FAMILY_TABS.includes(k));
const ROLE={owner:'ربّ البيت',family:'أهل البيت',maid:'العاملة',driver:'السائق'};
const LANGS={ar:'العربية',en:'English',id:'Indonesia',tl:'Tagalog',hi:'हिन्दी',ur:'اردو',bn:'বাংলা',ne:'नेपाली',si:'සිංහල',am:'አማርኛ',sw:'Kiswahili',fr:'Français'};
const ST={pending:['⏱ لم تُرسل','warn'],sent:['⏳ بانتظار الرد','warn'],done:['✅ تم','ok'],deferred:['⏳ مؤجَّلة','warn'],problem:['⚠️ مشكلة','bad'],no_reply:['❌ بلا ردّ','bad'],carried:['🔁 رُحّلت','warn'],cancelled:['✖ ملغاة',''],send_failed:['⚠️ فشل الإرسال','bad'],queued:['🌙 مؤجّل','warn'],open:['مطلوب','warn'],bought:['تم ✅','ok'],unavailable:['غير متوفر','bad']};
const DAYS=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtT=iso=>iso?new Date(iso).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}):'—';
const pill=(st)=>{const [t,c]=ST[st]||[st,''];return '<span class="pill '+c+'">'+t+'</span>'};
let toastT;function toast(m){clearTimeout(toastT);let t=$('.toast');if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)}t.textContent=m;t.style.display='block';toastT=setTimeout(()=>t.style.display='none',3500)}
async function api(path,method='GET',body){const r=await fetch('/admin/api/'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(r.status===401){location.reload();return}const j=await r.json().catch(()=>({}));if(!r.ok){throw new Error(j.error||('HTTP '+r.status))}return j}
function nav(){$('#nav').innerHTML=TABS.map(([k,l])=>'<button data-t="'+k+'" class="'+(cur===k?'on':'')+'">'+l+'</button>').join('');$('#nav').onclick=e=>{const b=e.target.closest('button');if(b){location.hash=b.dataset.t}}}
const HOME=OWNER?'setup':'today';const okTab=k=>TABS.some(([t])=>t===k)?k:HOME;
let cur=okTab(location.hash.slice(1));
window.addEventListener('hashchange',()=>{cur=okTab(location.hash.slice(1));render()});
async function render(){nav();$('#main').innerHTML='<div class="card muted">جارٍ التحميل…</div>';try{await VIEWS[cur]()}catch(e){$('#main').innerHTML='<div class="card"><span class="pill bad">خطأ</span> '+esc(e.message)+'</div>'}}
const VIEWS={
 async setup(){
  const o=await api('overview');const s=o.secrets;const miss=Object.entries({WHATSAPP_TOKEN:'المفتاح الدائم',PHONE_NUMBER_ID:'Phone number ID',WABA_ID:'WhatsApp Business Account ID',ADMIN_PASSWORD:'كلمة مرور الإدارة'}).filter(([k])=>!s[k]);
  let h='<div class="card"><h2>1) القيم السرية في Cloudflare</h2>';
  h+=miss.length?'<p class="pill bad" style="display:block;padding:10px">ناقص: '+miss.map(x=>x[1]).join('، ')+'</p><p class="muted">أضفها من لوحة Cloudflare: Worker ← Settings ← Variables and Secrets ← Add، ثم حدّث هذه الصفحة.</p>':'<p class="pill ok" style="display:block;padding:10px">كل القيم الأساسية موجودة ✅</p>';
  h+='<p class="muted">اختياري: APP_ID وAPP_SECRET لضبط Webhook تلقائياً والتحقق من توقيع الرسائل ('+(s.APP_ID&&s.APP_SECRET?'موجودان':'غير موجودين')+'). الترجمة الآلية: '+(s.AI?'مفعّلة':'غير متاحة')+'.</p></div>';
  h+='<div class="card"><h2>2) ربط Webhook في تطبيق Meta</h2><p class="muted">developers.facebook.com ← تطبيقك ← WhatsApp ← Configuration ← Edit، ثم الصق:</p><label>Callback URL</label><input readonly value="'+esc(o.webhook_url)+'" onclick="this.select()"><label>Verify token</label><input readonly value="'+esc(o.verify_token)+'" onclick="this.select()"><p class="muted">ثم (Verify and save) وفي Webhook fields فعّل <b>messages</b>. أو:</p><div class="actions"><button class="btn sec" onclick="setupAct(\\'webhook\\')">ضبط Webhook تلقائياً (يلزم APP_ID/APP_SECRET)</button></div></div>';
  h+='<div class="card"><h2>3) حالة الرقم والحساب</h2><div id="st" class="muted">جارٍ الفحص…</div><div class="actions"><button class="btn sec" onclick="checkStatus()">إعادة الفحص</button></div></div>';
  h+='<div class="card"><h2>4) تفعيل الرقم على واجهة البرمجة</h2><p class="muted">مرة واحدة فقط. اختر رمز تحقق بخطوتين من 6 أرقام واحفظه في ملاحظتك؛ هذا الأمر يثبّته ويفعّل الرقم.</p><label>رمز من 6 أرقام</label><input id="pin" inputmode="numeric" maxlength="6" placeholder="123456"><div class="actions"><button class="btn" onclick="registerNumber()">تفعيل الرقم</button></div></div>';
  h+='<div class="card"><h2>5) اشتراك التطبيق في حساب واتساب</h2><p class="muted">يخبر Meta أن تُرسل رسائل هذا الحساب إلى هذا البوت.</p><div class="actions"><button class="btn" onclick="setupAct(\\'subscribe\\')">اشتراك</button></div></div>';
  h+='<div class="card"><h2>6) القوالب (للرسائل خارج نافذة 24 ساعة)</h2><div id="tpl" class="muted">—</div><div class="actions"><button class="btn" onclick="setupAct(\\'templates\\')">إنشاء القوالب الناقصة</button></div></div>';
  h+='<div class="card"><h2>7) تجربة</h2><p class="muted">يرسل رسالة بأزرار إلى ربّ البيت (أضفه أولاً في «الأشخاص»).</p><div class="actions"><button class="btn" onclick="sendTest()">أرسل رسالة تجريبية</button><button class="btn sec" onclick="runCron()">تشغيل دورة الفحص الآن</button><button class="btn sec" onclick="sendMorning()">إرسال قائمة الصباح الآن</button></div></div>';
  h+='<div class="card"><div class="kpi"><div><b>'+o.counts.people+'</b><span>أشخاص</span></div><div><b>'+o.counts.recurring+'</b><span>مهام دورية</span></div><div><b>'+o.counts.today_done+'/'+o.counts.today_instances+'</b><span>مهام اليوم</span></div></div><p class="muted" style="margin-top:8px">الوقت الآن بتوقيت الرياض: '+o.now+' · التاريخ: '+o.today+'</p></div>';
  $('#main').innerHTML=h;checkStatus();
 },
 async today(){
  const t=await api('today');let h='<div class="card"><h2>ملخص اليوم حتى الآن</h2><pre style="direction:rtl;text-align:right;font-family:inherit;font-size:14px">'+esc(t.summary)+'</pre><div class="actions">'+(OWNER?'<button class="btn sec" onclick="api(\\'send/summary\\',\\'POST\\').then(()=>toast(\\'أُرسل الملخص\\'))">أرسل الملخص الآن</button>':'')+'</div></div>';
  h+='<div class="card"><h2>مهام اليوم ('+t.date+')</h2>'+(t.instances.length?t.instances.map(i=>'<div class="row"><div><div class="t">'+esc(i.title)+'</div><div class="s">'+esc(ROLE[i.role]||'')+' · '+(i.send_time||'الصباح')+(i.carried?' · مرحّلة':'')+(i.defers?' · أُجّلت '+i.defers:'')+(i.problem_text?' · '+esc(i.problem_text):'')+'</div></div><div style="text-align:left">'+pill(i.status)+(OWNER?'<div class="actions" style="margin-top:6px"><button class="btn sm sec" onclick="instAct('+i.id+',\\'done\\')">تم</button><button class="btn sm sec" onclick="instAct('+i.id+',\\'resend\\')">إعادة إرسال</button><button class="btn sm danger" onclick="instAct('+i.id+',\\'cancel\\')">إلغاء</button></div>':'')+'</div></div>').join(''):'<p class="muted">لا مهام اليوم.'+(OWNER?' تُنشأ تلقائياً بعد منتصف الليل من المهام الدورية، أو اضغط «إرسال قائمة الصباح الآن» في الإعداد.':'')+'</p>')+'</div>';
  $('#main').innerHTML=h;
 },
 async recurring(){
  const list=await api('recurring');
  let h=OWNER?'<div class="card"><h2>إضافة مهمة دورية</h2>'+recForm({})+'</div>':'';
  h+='<div class="card"><h2>المهام الدورية ('+list.length+')</h2>'+(list.length?list.map(r=>'<div class="row"><div><div class="t">'+esc(r.title)+(r.title_l2?' <span class="muted">· '+esc(r.title_l2)+'</span>':'')+'</div><div class="s">'+ROLE[r.assignee_role]+' · '+esc(r.human)+' · '+(r.send_time||'الصباح')+' · مهلة '+r.deadline_hours+' س'+(r.paused_until?' · موقوفة حتى '+r.paused_until:'')+'</div></div><div style="text-align:left">'+(r.active?'<span class="pill ok">نشطة</span>':'<span class="pill">متوقفة</span>')+(OWNER?'<div class="actions" style="margin-top:6px"><button class="btn sm sec" onclick="toggleRec('+r.id+','+(r.active?0:1)+')">'+(r.active?'إيقاف':'تفعيل')+'</button><button class="btn sm sec" onclick="editRec('+r.id+')">تعديل</button><button class="btn sm danger" onclick="delRec('+r.id+')">حذف</button></div>':'')+'</div></div>').join(''):'<p class="muted">لا مهام بعد.</p>')+'</div>';
  $('#main').innerHTML=h;window._rec=list;
 },
 async people(){
  const list=await api('people');
  let h='<div class="card"><h2>إضافة شخص</h2><label>الاسم</label><input id="p_name" placeholder="مثال: العاملة سيتي"><div class="grid2"><div><label>الدور</label><select id="p_role"><option value="owner">ربّ البيت</option><option value="family">أهل البيت</option><option value="maid">العاملة</option><option value="driver">السائق</option></select></div><div><label>اللغة</label><select id="p_lang">'+Object.entries(LANGS).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></div></div><label>رقم واتساب (بالصيغة الدولية)</label><input id="p_phone" inputmode="tel" placeholder="9665XXXXXXXX"><div class="chk"><input type="checkbox" id="p_sum"><label style="margin:0">يستلم ملخص المساء</label></div><div class="actions"><button class="btn" onclick="addPerson()">حفظ</button></div></div>';
  h+='<div class="card"><h2>الأشخاص ('+list.length+')</h2>'+(list.length?list.map(p=>'<div class="row"><div><div class="t">'+esc(p.name)+' <span class="pill">'+ROLE[p.role]+'</span>'+(p.gets_summary?' <span class="pill ok">ملخص</span>':'')+'</div><div class="s" style="direction:ltr;text-align:right">+'+esc(p.phone)+' · '+(LANGS[p.lang]||p.lang)+' · آخر رسالة: '+fmtT(p.last_inbound_at)+'</div></div><div class="actions"><button class="btn sm danger" onclick="delPerson('+p.id+')">إزالة</button></div></div>').join(''):'<p class="muted">أضف نفسك أولاً بدور «ربّ البيت»، ثم العاملة والسائق.</p>')+'</div>';
  $('#main').innerHTML=h;
 },
 async requests(){
  const list=await api('requests?days=14');
  let h=OWNER?'<div class="card"><h2>طلب جديد من هنا</h2><label>النص</label><input id="rq_text" placeholder="جهّزي غرفة الضيوف"><label>لمن</label><select id="rq_role"><option value="maid">العاملة</option><option value="driver">السائق</option></select><div class="actions"><button class="btn" onclick="newReq()">إرسال</button></div></div>':'';
  h+='<div class="card"><h2>طلبات آخر 14 يوماً ('+list.length+')</h2>'+(list.length?list.map(r=>'<div class="row"><div><div class="t">'+esc(r.text)+'</div><div class="s">من '+esc(r.requester||'—')+' إلى '+esc(ROLE[r.assignee_role]||r.assignee||'—')+' · '+fmtT(r.created_at)+(r.done_at?' · أُنجز '+fmtT(r.done_at):'')+(r.problem_text?' · ⚠️ '+esc(r.problem_text):'')+'</div></div><div style="text-align:left">'+pill(r.status)+(OWNER?'<div class="actions" style="margin-top:6px"><button class="btn sm sec" onclick="reqAct('+r.id+',\\'done\\')">تم</button><button class="btn sm sec" onclick="reqAct('+r.id+',\\'resend\\')">إعادة</button><button class="btn sm danger" onclick="reqAct('+r.id+',\\'cancel\\')">إلغاء</button></div>':'')+'</div></div>').join(''):'<p class="muted">لا طلبات بعد.</p>')+'</div>';
  $('#main').innerHTML=h;
 },
 async shopping(){
  const list=await api('shopping');const open=list.filter(x=>x.status==='open');
  let h='<div class="card"><h2>إضافة أصناف</h2><input id="sh_items" placeholder="حليب، خبز، ماء"><div class="actions"><button class="btn" onclick="addShop()">إضافة</button><button class="btn sec" onclick="api(\\'shopping/send\\',\\'POST\\').then(()=>{toast(\\'أُرسلت القائمة\\');render()})">إرسال القائمة للسائق الآن ('+open.length+')</button></div></div>';
  h+='<div class="card"><h2>الأصناف</h2>'+(list.length?list.map(s=>'<div class="row"><div><div class="t">'+esc(s.item)+'</div><div class="s">'+fmtT(s.created_at)+(s.added_by_name?' · '+esc(s.added_by_name):'')+(s.note?' · '+esc(s.note):'')+'</div></div><div class="actions">'+pill(s.status)+'<button class="btn sm danger" onclick="api(\\'shopping/'+s.id+'\\',\\'DELETE\\').then(render)">حذف</button></div></div>').join(''):'<p class="muted">القائمة فارغة.</p>')+'</div>';
  $('#main').innerHTML=h;
 },
 async ratings(){
  const list=await api('ratings');const F={3:'😊',2:'😐',1:'😞'};
  $('#main').innerHTML='<div class="card"><h2>التقييمات ('+list.length+')</h2>'+(list.length?list.map(r=>'<div class="row"><div><div class="t">'+F[r.score]+' '+esc(r.subject||'')+'</div><div class="s">'+esc(r.rater||'')+' · '+fmtT(r.created_at)+(r.note?' · 📝 '+esc(r.note)+(r.forwarded?' (أُرسلت كتوجيه)':''):'')+'</div></div></div>').join(''):'<p class="muted">لا تقييمات بعد.</p>')+'</div>';
 },
 async settings(){
  const s=await api('settings');
  const f=(k,l,type='time')=>'<label>'+l+'</label><input id="s_'+k+'" type="'+type+'" value="'+esc(s[k]||'')+'">';
  $('#main').innerHTML='<div class="card"><h2>المواعيد</h2><div class="grid2">'+f('morning_time','قائمة الصباح')+f('shopping_time','إرسال المشتريات')+f('summary_time','ملخص المساء')+'</div><h2 style="margin-top:16px">ساعات الهدوء</h2><div class="chk"><input type="checkbox" id="s_quiet_enabled" '+(s.quiet_enabled==='1'?'checked':'')+'><label style="margin:0">تأجيل الطلبات الفورية خارج ساعات العمل</label></div><div class="grid2">'+f('quiet_start','من')+f('quiet_end','إلى')+'</div><h2 style="margin-top:16px">الافتراضيات</h2><div class="grid2">'+f('default_deadline_hours','مهلة المهمة قبل اعتبارها متأخرة (ساعات)','number')+f('default_remind_hours','التذكير بعد التأجيل (ساعات)','number')+'</div>'+f('bot_name','اسم البوت','text')+'<div class="actions"><button class="btn" onclick="saveSettings()">حفظ</button></div></div><div class="card"><h2>حسابات الدخول</h2><div class="row"><div><div class="t">ربّ البيت (كامل الصلاحيات)</div><div class="s">اسم المستخدم: <b dir="ltr">'+esc(s.owner_user)+'</b> · كلمة المرور من Cloudflare (ADMIN_PASSWORD). لتغيير الاسم أضف ADMIN_USER هناك.</div></div></div><div class="row"><div><div class="t">أهل البيت (اطّلاع فقط: اليوم، المهام الدورية، الطلبات)</div><div class="s">'+(s.family_user?'الحساب الحالي: <b dir="ltr">'+esc(s.family_user)+'</b>':'لم يُنشأ بعد')+'</div></div></div><div class="grid2"><div><label>اسم المستخدم</label><input id="f_user" dir="ltr" autocapitalize="none" value="'+esc(s.family_user||'')+'" placeholder="family"></div><div><label>كلمة مرور جديدة</label><input id="f_pass" dir="ltr" type="password" placeholder="6 أحرف على الأقل"></div></div><div class="actions"><button class="btn" onclick="saveFamily()">'+(s.family_user?'تحديث الحساب':'إنشاء الحساب')+'</button>'+(s.family_user?'<button class="btn danger" onclick="delFamily()">إلغاء الحساب</button>':'')+'</div></div><div class="card"><h2>تصدير إلى Excel (CSV)</h2><div class="actions">'+['people','recurring','instances','requests','shopping','ratings'].map(t=>'<a class="btn sec" style="text-decoration:none;display:inline-block" href="/admin/api/export/'+t+'">'+t+'</a>').join('')+'</div></div>';
 },
 async log(){
  const list=await api('log');$('#main').innerHTML='<div class="card"><h2>آخر الأحداث</h2>'+(list.length?list.map(l=>'<div class="row"><div><div class="t"><span class="pill '+(l.level==='error'?'bad':l.level==='warn'?'warn':'')+'">'+l.level+'</span> '+esc(l.msg)+'</div><div class="s">'+fmtT(l.ts)+(l.data?'<pre>'+esc(l.data)+'</pre>':'')+'</div></div></div>').join(''):'<p class="muted">لا أحداث.</p>')+'</div>';
 }
};
function recForm(r){const days=(r.days?String(r.days).split(',').filter(Boolean).map(Number):[]);return '<input type="hidden" id="r_id" value="'+(r.id||'')+'"><label>المهمة</label><input id="r_title" value="'+esc(r.title||'')+'" placeholder="تنظيف الحوش"><label>النص بلغة العامل (اختياري، يُترجم تلقائياً إن تُرك فارغاً)</label><input id="r_l2" value="'+esc(r.title_l2||'')+'"><div class="grid2"><div><label>المسؤول</label><select id="r_role"><option value="maid" '+(r.assignee_role==='maid'?'selected':'')+'>العاملة</option><option value="driver" '+(r.assignee_role==='driver'?'selected':'')+'>السائق</option></select></div><div><label>التكرار</label><select id="r_freq" onchange="freqUI()"><option value="daily" '+(r.freq==='daily'?'selected':'')+'>يومي</option><option value="weekly" '+(r.freq==='weekly'?'selected':'')+'>أيام محددة</option><option value="every_n" '+(r.freq==='every_n'?'selected':'')+'>كل N أيام</option><option value="monthly" '+(r.freq==='monthly'?'selected':'')+'>شهري</option></select></div></div><div id="f_weekly"><label>الأيام</label><div class="days">'+DAYS.map((d,i)=>'<label><input type="checkbox" class="r_day" value="'+i+'" '+(days.includes(i)?'checked':'')+'>'+d+'</label>').join('')+'</div></div><div id="f_every"><label>كل كم يوم</label><input id="r_interval" type="number" min="2" value="'+(r.interval_n||3)+'"></div><div id="f_monthly"><label>يوم الشهر</label><input id="r_dom" type="number" min="1" max="28" value="'+(r.day_of_month||1)+'"></div><div class="grid2"><div><label>وقت الإرسال (فارغ = مع قائمة الصباح)</label><input id="r_time" type="time" value="'+esc(r.send_time||'')+'"></div><div><label>المهلة قبل التأخر (ساعات)</label><input id="r_dl" type="number" step="0.5" value="'+(r.deadline_hours||4)+'"></div></div><div class="grid2"><div><label>التذكير بعد التأجيل (ساعات)</label><input id="r_rem" type="number" step="0.5" value="'+(r.remind_after_hours||2)+'"></div><div><label>إيقاف مؤقت حتى (اختياري)</label><input id="r_pause" type="date" value="'+esc(r.paused_until||'')+'"></div></div><div class="chk"><input type="checkbox" id="r_esc" '+(r.escalate_now?'checked':'')+'><label style="margin:0">أبلغني فوراً إن لم يُردّ خلال المهلة</label></div><div class="actions"><button class="btn" onclick="saveRec()">'+(r.id?'حفظ التعديل':'إضافة')+'</button>'+(r.id?'<button class="btn sec" onclick="render()">إلغاء</button>':'')+'</div>'}
function freqUI(){const f=$('#r_freq').value;$('#f_weekly').style.display=f==='weekly'?'':'none';$('#f_every').style.display=f==='every_n'?'':'none';$('#f_monthly').style.display=f==='monthly'?'':'none'}
async function saveRec(){const id=$('#r_id').value;const body={title:$('#r_title').value.trim(),title_l2:$('#r_l2').value.trim(),assignee_role:$('#r_role').value,freq:$('#r_freq').value,days:[...document.querySelectorAll('.r_day:checked')].map(x=>+x.value),interval_n:+$('#r_interval').value||3,day_of_month:+$('#r_dom').value||1,send_time:$('#r_time').value||null,deadline_hours:+$('#r_dl').value||4,remind_after_hours:+$('#r_rem').value||2,escalate_now:$('#r_esc').checked,paused_until:$('#r_pause').value||null};if(!body.title)return toast('اكتب اسم المهمة');if(body.freq==='weekly'&&!body.days.length)return toast('اختر يوماً واحداً على الأقل');try{await api('recurring'+(id?'/'+id:''),id?'PUT':'POST',body);toast('تم الحفظ');render()}catch(e){toast(e.message)}}
function editRec(id){const r=window._rec.find(x=>x.id===id);$('#main').innerHTML='<div class="card"><h2>تعديل مهمة</h2>'+recForm(r)+'</div>';freqUI()}
async function toggleRec(id,active){await api('recurring/'+id,'PUT',{active:!!active});render()}
async function delRec(id){if(confirm('حذف المهمة الدورية نهائياً؟')){await api('recurring/'+id,'DELETE');render()}}
async function addPerson(){try{await api('people','POST',{name:$('#p_name').value.trim(),role:$('#p_role').value,lang:$('#p_lang').value,phone:$('#p_phone').value.trim(),gets_summary:$('#p_sum').checked});toast('تمت الإضافة');render()}catch(e){toast(e.message)}}
async function delPerson(id){if(confirm('إزالة هذا الشخص من البوت؟')){await api('people/'+id,'DELETE');render()}}
async function instAct(id,a){await api('instances/'+id+'/action','POST',{action:a});toast('تم');render()}
async function reqAct(id,a){await api('requests/'+id+'/action','POST',{action:a});toast('تم');render()}
async function newReq(){try{await api('requests','POST',{text:$('#rq_text').value.trim(),role:$('#rq_role').value});toast('أُرسل');render()}catch(e){toast(e.message)}}
async function addShop(){await api('shopping','POST',{items:$('#sh_items').value});toast('أُضيفت');render()}
async function saveSettings(){const b={};for(const k of ['morning_time','shopping_time','summary_time','quiet_start','quiet_end','default_deadline_hours','default_remind_hours','bot_name'])b[k]=$('#s_'+k).value;b.quiet_enabled=$('#s_quiet_enabled').checked?'1':'0';await api('settings','PUT',b);toast('تم الحفظ')}
async function saveFamily(){try{await api('account/family','PUT',{username:$('#f_user').value.trim(),password:$('#f_pass').value});toast('تم حفظ حساب أهل البيت');render()}catch(e){toast(e.message)}}
async function delFamily(){if(confirm('إلغاء حساب أهل البيت؟')){await api('account/family','DELETE');toast('أُلغي');render()}}
async function checkStatus(){try{const s=await api('setup/status');let h='';if(s.phone){h+='<div class="row"><div>الرقم</div><div style="direction:ltr">'+esc(s.phone.display_phone_number||'')+'</div></div><div class="row"><div>اسم العرض</div><div>'+esc(s.phone.verified_name||'')+' '+(s.phone.name_status?'<span class="pill">'+esc(s.phone.name_status)+'</span>':'')+'</div></div><div class="row"><div>الجودة</div><div><span class="pill">'+esc(s.phone.quality_rating||'—')+'</span></div></div><div class="row"><div>حالة الاتصال</div><div><span class="pill '+(s.phone.status==='CONNECTED'?'ok':'warn')+'">'+esc(s.phone.status||s.phone.platform_type||'—')+'</span></div></div>'}else if(s.phone_error){h+='<p class="pill bad" style="display:block;padding:10px">'+esc(s.phone_error)+'</p>'}
  h+='<div class="row"><div>اشتراك التطبيق (الخطوة 5)</div><div>'+(s.subscribed&&s.subscribed.length?'<span class="pill ok">مشترك ✅</span>':'<span class="pill warn">غير مشترك</span>')+'</div></div>';$('#st').innerHTML=h;
  if(s.templates){$('#tpl').innerHTML=s.templates.map(t=>'<div class="row"><div>'+t.name+'</div><div><span class="pill '+(t.status==='APPROVED'?'ok':t.status==='MISSING'?'':t.status==='REJECTED'?'bad':'warn')+'">'+t.status+'</span>'+(t.reason?' <span class="muted">'+esc(t.reason)+'</span>':'')+'</div></div>').join('')}else if(s.templates_error){$('#tpl').innerHTML='<span class="pill bad">'+esc(s.templates_error)+'</span>'}}catch(e){$('#st').innerHTML='<span class="pill bad">'+esc(e.message)+'</span>'}}
async function setupAct(a){try{const r=await api('setup/'+a,'POST',{});toast('تم ✅');console.log(r);if(a==='templates'){alert(r.results.map(x=>x.name+': '+(x.skipped?'موجود':x.ok?('أُنشئ ('+x.status+')'):('خطأ: '+x.error))).join('\\n'))}checkStatus()}catch(e){toast(e.message)}}
async function registerNumber(){const pin=$('#pin').value.trim();if(!/^\\d{6}$/.test(pin))return toast('أدخل 6 أرقام');try{await api('setup/register','POST',{pin});toast('تم تفعيل الرقم ✅ احفظ الرمز في ملاحظتك');checkStatus()}catch(e){toast(e.message)}}
async function sendTest(){try{await api('send/test','POST',{});toast('أُرسلت، تحقق من واتساب')}catch(e){toast(e.message)}}
async function runCron(){await api('cron','POST',{});toast('نُفّذت دورة الفحص')}
async function sendMorning(){try{const r=await api('send/morning','POST',{});toast('أُرسلت '+r.sent+' مهمة')}catch(e){toast(e.message)}}
render();
</script></body></html>`;
