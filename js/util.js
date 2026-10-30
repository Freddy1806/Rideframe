export function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
export const fmtNum = (v, d = 0) => (v ?? 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtKm = m => fmtNum(m / 1000, m < 100000 ? 1 : 0);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** best average of values over a window of n samples (1 sample = 1 s) */
export function bestAvg(values, n) {
  if (values.length < n) return 0;
  let s = 0, best = 0;
  for (let i = 0; i < values.length; i++) { s += values[i]; if (i >= n) s -= values[i - n]; if (i >= n - 1) best = Math.max(best, s / n); }
  return Math.round(best);
}
