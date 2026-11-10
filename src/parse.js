// Parsing of short Arabic commands typed by household members.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function normalizeDigits(s) {
  return String(s || '').replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

export function normalizeAr(s) {
  return normalizeDigits(s)
    .replace(/[ً-ْٰ]/g, '') // tashkeel
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

// Shortcut prefixes: "ع: نص" (maid), "س: نص" (driver), "م: نص" (shopping), "دوري: نص" (recurring)
export function parsePrefix(text) {
  const t = normalizeAr(text);
  const m = t.match(/^(ع|عامله|عاملة|العاملة|العامله|س|سائق|السائق|م|مشتريات|المشتريات|دوري|دورية|دوريه)\s*[:：\-]\s*(.+)$/s);
  if (!m) return null;
  const key = m[1];
  const body = m[2].trim();
  if (/^(ع|عامل)/.test(key) || key.startsWith('العامل')) return { kind: 'maid', body };
  if (/^(س|سائق|السائق)/.test(key)) return { kind: 'driver', body };
  if (/^(م|مشتريات|المشتريات)/.test(key)) return { kind: 'shopping', body };
  return { kind: 'recurring', body };
}

const WEEKDAYS = [
  { n: 0, re: /(الاحد|احد)/ },
  { n: 1, re: /(الاثنين|اثنين|الإثنين)/ },
  { n: 2, re: /(الثلاثاء|ثلاثاء)/ },
  { n: 3, re: /(الاربعاء|اربعاء)/ },
  { n: 4, re: /(الخميس|خميس)/ },
  { n: 5, re: /(الجمعه|الجمعة|جمعه|جمعة)/ },
  { n: 6, re: /(السبت|سبت)/ },
];

// Parse a recurring-task sentence like: "تنظيف الحوش كل خميس 9 ص للعاملة"
export function parseRecurring(body, { todayWeekday = 0 } = {}) {
  let t = normalizeAr(body);
  const out = { title: '', assignee_role: null, freq: null, days: [], interval: 1, day_of_month: 1, send_time: null, notes: [] };

  // assignee
  if (/(للعامله|للعاملة|عامله|عاملة|الخادمه|الخادمة|الشغاله|الشغالة)/.test(t)) {
    out.assignee_role = 'maid';
    t = t.replace(/(للعامله|للعاملة|للخادمه|للخادمة|للشغاله|للشغالة)/g, ' ');
  } else if (/(للسائق|سائق|الدرايفر|للدرايفر)/.test(t)) {
    out.assignee_role = 'driver';
    t = t.replace(/(للسائق|للدرايفر)/g, ' ');
  }

  // time: "9 ص" | "9:30 ص" | "الساعه 9" | "9 صباحا" | "4 م" | "4 مساء" | "4 عصرا" | "12 ظهرا"
  const tm = t.match(/(?:الساعه|الساعة)?\s*(\d{1,2})(?::(\d{2}))?\s*(ص|صباحا|صباحاً|م|مساء|مساءً|عصرا|عصراً|ظهرا|ظهراً|ليلا|ليلاً)?(?!\d)/);
  if (tm && (tm[3] || /الساع/.test(t))) {
    let h = parseInt(tm[1], 10);
    const mm = tm[2] ? parseInt(tm[2], 10) : 0;
    const suf = tm[3] || '';
    if (/^ص|صباح/.test(suf)) {
      if (h === 12) h = 0;
    } else if (/^م|مساء|عصر|ليل/.test(suf)) {
      if (h < 12) h += 12;
    } else if (/ظهر/.test(suf)) {
      if (h < 12 && h !== 12) h += 12;
    } else if (h <= 6) {
      h += 12; // "الساعة 4" alone -> afternoon
    }
    if (h >= 0 && h <= 23 && mm >= 0 && mm <= 59) {
      out.send_time = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      t = t.replace(tm[0], ' ');
    }
  }

  // frequency
  const everyN = t.match(/كل\s+(\d{1,2})\s*(ايام|يوم|أيام)/);
  if (/(كل يوم|يومي|يوميا|يومياً|كل الايام)/.test(t)) {
    out.freq = 'daily';
    t = t.replace(/(كل يوم|يوميا|يومياً|يومي|كل الايام)/g, ' ');
  } else if (everyN) {
    out.freq = 'every_n';
    out.interval = Math.max(2, parseInt(everyN[1], 10));
    t = t.replace(everyN[0], ' ');
  } else if (/كل اسبوعين/.test(t)) {
    out.freq = 'every_n';
    out.interval = 14;
    t = t.replace(/كل اسبوعين/g, ' ');
  } else if (/(شهري|شهريا|شهرياً|كل شهر|اول كل شهر|اول الشهر)/.test(t)) {
    out.freq = 'monthly';
    const dm = t.match(/يوم\s+(\d{1,2})\s+(من\s+)?(كل\s+)?شهر/);
    out.day_of_month = dm ? Math.min(28, Math.max(1, parseInt(dm[1], 10))) : 1;
    t = t.replace(/(يوم\s+\d{1,2}\s+(من\s+)?(كل\s+)?شهر|اول كل شهر|اول الشهر|كل شهر|شهريا|شهرياً|شهري)/g, ' ');
  }

  // weekdays (may accompany "كل" or "ايام")
  const days = [];
  for (const w of WEEKDAYS) {
    if (w.re.test(t)) {
      days.push(w.n);
      t = t.replace(new RegExp(w.re.source, 'g'), ' ');
    }
  }
  if (days.length) {
    out.freq = out.freq || 'weekly';
    out.days = days.sort();
    t = t.replace(/(^|\s)(كل|ايام|أيام|يوم|و)(?=\s|$)/g, ' ');
  } else if (/(كل اسبوع|اسبوعي|اسبوعيا|اسبوعياً)/.test(t)) {
    out.freq = 'weekly';
    out.days = [todayWeekday];
    out.notes.push('لم يُذكر يوم الأسبوع، فاعتُمد يوم اليوم');
    t = t.replace(/(كل اسبوع|اسبوعيا|اسبوعياً|اسبوعي)/g, ' ');
  }

  out.title = t
    .replace(/(^|\s)(كل|ايام|أيام|يوم|الساعه|الساعة|في|عند)(?=\s|$)/g, ' ')
    .replace(/[،,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!out.freq) out.notes.push('لم يُفهم التكرار');
  if (!out.title) out.notes.push('لم يُفهم اسم المهمة');
  out.ok = Boolean(out.freq && out.title);
  return out;
}

export function describeRecurrence(r) {
  const AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  switch (r.freq) {
    case 'daily':
      return 'كل يوم';
    case 'weekly':
      return 'كل ' + (r.days || []).map((d) => AR[d]).join(' و');
    case 'every_n':
      return r.interval === 14 ? 'كل أسبوعين' : `كل ${r.interval} أيام`;
    case 'monthly':
      return r.day_of_month === 1 ? 'أول كل شهر' : `يوم ${r.day_of_month} من كل شهر`;
    default:
      return '—';
  }
}

export const ROLE_AR = { owner: 'ربّ البيت', family: 'أهل البيت', maid: 'العاملة', driver: 'السائق' };
