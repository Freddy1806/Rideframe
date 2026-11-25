// "What changed" on the Today page (25.11.): two to four short lines made by plain rules from the data the app has, neutral words,
// each leading to its detail page. Pure (tools/today-test.mjs). Numbers from js/bodylib.js (weight trend), js/cardlib.js (fitness,
// records, strength), js/fitness.js (streak); no formulas here.
import { changes, changeWords, fmtKg } from './bodylib.js';
import { streak } from './fitness.js';
import { durOf } from './cardlib.js';

const DAY = 864e5;
const dayTxt = (t, now) => { const n = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / DAY);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 7 ? 'on ' + new Date(t).toLocaleDateString('en-GB', { weekday: 'long' }) : 'on ' + new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const hm = s => s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.round(s % 3600 / 60)).padStart(2, '0')} min` : `${Math.max(1, Math.round(s / 60))} min`;

/** x = { acts (newest first), body ({ list }), fit (cardlib fitnessSummary), recs (cardlib recentRecords), last ({ name, line, key }), now }
 *  -> [{ k, text, href }] at most n, in this order: new records, weight, fitness, consistency, last session */
export function insights(x = {}, n = 4) {
  const now = x.now ?? Date.now(), acts = x.acts || [], out = [];
  const rec = (x.recs?.list || []).filter(r => now - r.t < 8 * DAY)[0];
  if (rec) out.push({ k: 'record', text: `New best ${dayTxt(rec.t, now)}: ${rec.what.toLowerCase()} ${rec.value}.`, href: 'statistik.html' });
  const list = x.body?.list || [];
  if (list.length >= 2) { const c = changes(list, now), d = c.d30 != null ? c.d30 : c.d7, span = c.d30 != null ? '30 days' : '7 days';
    if (d != null) { const w = changeWords(d); out.push({ k: 'weight', text: w.cls === 'flat' ? `Weight steady over ${span}, trend ${fmtKg(c.now)} kg.` : `Weight trend ${w.text} in ${span}, now ${fmtKg(c.now)} kg.`, href: 'body.html' }); } }
  const F = x.fit; if (F && !F.empty && acts.length) { const d = Math.round(F.d28);
    out.push({ k: 'fitness', text: Math.abs(d) < 2 ? `Fitness steady at ${Math.round(F.ctl)} over 4 weeks.` : `Fitness ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} in 4 weeks, now ${Math.round(F.ctl)}.`, href: 'profil.html' }); }
  const s = streak(acts);
  if (s >= 2) out.push({ k: 'streak', text: `${s} weeks in a row with 3 or more active days.`, href: 'statistik.html' });
  else if (acts.length) { const n28 = acts.filter(a => now - a.date < 28 * DAY).length; if (n28) out.push({ k: 'streak', text: `${n28} session${n28 === 1 ? '' : 's'} in the last 4 weeks, about ${Math.round(n28 / 4 * 10) / 10} a week.`, href: 'statistik.html' }); }
  const a = acts[0]; if (a && x.last) out.push({ k: 'last', text: `Last session ${dayTxt(a.date, now)}: ${x.last.name}, ${hm(durOf(a))}.`, href: x.last.href || 'aktivitaeten.html' });
  return out.slice(0, n);
}
