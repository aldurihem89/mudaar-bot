// Time helpers. Riyadh is UTC+3 with no daylight saving; offset comes from env.TIMEZONE_OFFSET_MINUTES.

export function nowLocal(offsetMin) {
  return new Date(Date.now() + offsetMin * 60 * 1000);
}

export function dateStr(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (of the shifted "local" date)
}

export function timeStr(d) {
  return d.toISOString().slice(11, 16); // HH:MM
}

export function weekday(d) {
  return d.getUTCDay(); // 0 = Sunday ... 6 = Saturday (on the shifted date)
}

export function dayOfMonth(d) {
  return d.getUTCDate();
}

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map((x) => parseInt(x, 10) || 0);
  return h * 60 + m;
}

export function addDays(dStr, n) {
  const d = new Date(dStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(aStr, bStr) {
  const a = new Date(aStr + 'T00:00:00Z');
  const b = new Date(bStr + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

export const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function arDate(d) {
  return `${AR_WEEKDAYS[weekday(d)]} ${dayOfMonth(d)} ${AR_MONTHS[d.getUTCMonth()]}`;
}

export function arTime(hhmm) {
  const [h, m] = String(hhmm).split(':').map((x) => parseInt(x, 10));
  const suffix = h < 12 ? 'ص' : 'م';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function isInQuietHours(nowMin, startHHMM, endHHMM) {
  const s = toMinutes(startHHMM);
  const e = toMinutes(endHHMM);
  if (s === e) return false;
  if (s < e) return nowMin >= s && nowMin < e;
  return nowMin >= s || nowMin < e; // wraps past midnight
}

export function isoNow() {
  return new Date().toISOString();
}

export function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}
