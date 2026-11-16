export function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
export const fmtNum = (v, d = 0) => (v ?? 0).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtKm = m => fmtNum(m / 1000, m < 100000 ? 1 : 0);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** best average of values over a window of n samples (1 sample = 1 s) */
export function bestAvg(values, n) {
  if (values.length < n) return 0;
  let s = 0, best = 0;
  for (let i = 0; i < values.length; i++) { s += values[i]; if (i >= n) s -= values[i - n]; if (i >= n - 1) best = Math.max(best, s / n); }
  return Math.round(best);
}

// ---- current week (Mon–Sun) against the week before (Freddy 16.11.: "immer die aktuelle Woche, von Woche zu Woche besser werden") ----
export const weekStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
/** splits items into this week and the week before; at(item) = its time in ms */
export function twoWeeks(items, at = x => x.date) { const w0 = weekStart(Date.now()), p = new Date(w0); p.setDate(p.getDate() - 7); const w1 = p.getTime();
  return { cur: items.filter(x => at(x) >= w0), prev: items.filter(x => at(x) >= w1 && at(x) < w0) }; }
/** one number of the week card: value, label and a small arrow line against last week; show(v) formats the number */
export function weekStat(cur, prev, label, show = v => fmtNum(v)) {
  const d = cur - prev, cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
  return `<div><b>${show(cur)}</b><small>${label}</small><em class="wd ${cls}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${show(prev)}</em></div>`; }
