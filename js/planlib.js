// The training plan (25.11., owner: "was heute für ein Training ansteht"): one entry per planned session or rest day, kept per account
// in users/<id>/plan.json (tools/plan-api.mjs) and planned in the app (the week planner js/weekplan.js on the Today page, js/today.js) or by the coach
// through the Claude connector (tools/mcp-api.mjs list_plan, plan_session, update_plan, delete_plan). Pure, shared by both sides.
//   entry = { id, day: 'YYYY-MM-DD' (local), kind: ride | run | strength | rest | other, title, ref?, minutes?, note?, done?: activity id, at, by? }
// ref: what Start launches: a ride workout id (the builder's personal workouts or a built-in one, pure.html?workout=), a watch
// strength workout id (kraft.html?watch=). done: the activity that fulfilled it, set by hand or matched automatically (same day, same kind).
export const KINDS = ['ride', 'run', 'strength', 'rest', 'other'];
export const KIND_NAME = { ride: 'Ride', run: 'Run', strength: 'Strength', rest: 'Rest day', other: 'Other' };
export const MAX_ENTRIES = 600, KEEP_DAYS = 400, MAX_RANGE = 92;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = n => String(n).padStart(2, '0');
export const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** "YYYY-MM-DD" -> local midnight (ms) or NaN */
export const dayMs = s => { const m = DAY_RE.exec(String(s ?? '')); if (!m) return NaN; const d = new Date(+m[1], +m[2] - 1, +m[3]); return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d.getTime() : NaN; };
export const addDays = (s, n) => { const t = dayMs(s); if (!Number.isFinite(t)) return s; const d = new Date(t); d.setDate(d.getDate() + n); return dayKey(d.getTime()); };
/** Monday of the week of day s */
export const monday = s => { const t = dayMs(s), d = new Date(t); return addDays(s, -((d.getDay() + 6) % 7)); };
const text = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, n);

/** checks a new entry (partial = an edit: only the given keys); { error } or { v: the clean fields } */
export function validateEntry(b, { partial = false, now = Date.now() } = {}) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'An object { day, kind, title, ref?, minutes?, note? }.' };
  const ok = new Set(['day', 'kind', 'title', 'ref', 'minutes', 'note']);
  for (const k of Object.keys(b)) if (!ok.has(k)) return { error: `Unknown field "${text(k, 30)}". Allowed: day, kind, title, ref, minutes, note.` };
  const v = {};
  if (b.day !== undefined || !partial) { const t = dayMs(b.day); if (!Number.isFinite(t)) return { error: 'day: a date as YYYY-MM-DD.' };
    if (t < now - KEEP_DAYS * 864e5 || t > now + 366 * 864e5) return { error: 'day: within the last 400 days and the next year.' }; v.day = b.day; }
  if (b.kind !== undefined || !partial) { if (!KINDS.includes(b.kind)) return { error: `kind: one of ${KINDS.join(', ')}.` }; v.kind = b.kind; }
  if (b.title !== undefined) { if (typeof b.title !== 'string') return { error: 'title: text.' }; v.title = text(b.title, 60); }
  if (!partial && !v.title) v.title = KIND_NAME[v.kind];
  if (b.title !== undefined && !v.title) return { error: 'title: 1 to 60 characters.' };
  if (b.ref !== undefined) { if (b.ref !== null && (typeof b.ref !== 'string' || !/^[\w.:-]{1,80}$/.test(b.ref))) return { error: 'ref: a workout id (letters, digits, - _ . :), or null to remove it.' }; v.ref = b.ref || null; }
  if (b.minutes !== undefined) { if (b.minutes !== null && (!Number.isInteger(b.minutes) || b.minutes < 1 || b.minutes > 600)) return { error: 'minutes: a whole number, 1 to 600, or null.' }; v.minutes = b.minutes || null; }
  if (b.note !== undefined) { if (b.note !== null && typeof b.note !== 'string') return { error: 'note: text.' }; v.note = b.note ? text(b.note, 300) : null; }
  return { v };
}
/** an entry with the null fields left out */
export const tidy = e => Object.fromEntries(Object.entries(e).filter(([, x]) => x != null && x !== ''));

/** the kind of a finished activity as the plan names it (light copies from tools/coachdata.mjs or the phone's list) */
export function kindOfAct(a, { sportOf, famOf }) {
  if (a.kraft) return 'strength';
  const g = sportOf(a); return famOf(g) === 'bike' ? 'ride' : g === 'run' ? 'run' : 'other';
}
/** open entries of past days and today that a finished activity of the same day and kind fulfils: [[entry id, activity id]];
 *  every activity counts once, rest days never; acts: [{ id, date (ms), kind }] */
export function autoMatch(entries, acts, today = dayKey(Date.now())) {
  const used = new Set(entries.filter(e => e.done).map(e => String(e.done))), out = [];
  for (const e of entries.slice().sort((a, b) => a.day.localeCompare(b.day))) {
    if (e.done || e.undone || e.kind === 'rest' || e.day > today) continue; // undone by hand: never matched again
    const a = acts.filter(x => !used.has(String(x.id)) && dayKey(x.date) === e.day && (x.kind === e.kind || e.kind === 'other')).sort((x, y) => x.date - y.date)[0];
    if (a) { used.add(String(a.id)); out.push([e.id, String(a.id)]); }
  }
  return out;
}
/** Monday to Sunday of the week of `day`: [{ day, entries, acts (count), today, past }] for the week strip */
export function week(day, entries, actDays = new Map(), today = dayKey(Date.now())) {
  const m = monday(day); return [...Array(7)].map((_, i) => { const d = addDays(m, i); return { day: d, entries: entries.filter(e => e.day === d), acts: actDays.get(d) || 0, today: d === today, past: d < today }; });
}
/** where Start leads for an entry (the phone's existing entries): ride workout, watch strength workout, run, or the sport's page */
export function startHref(e) {
  if (!e) return null;
  if (e.kind === 'ride') return e.ref ? 'pure.html?workout=' + encodeURIComponent(e.ref) : 'outdoor.html';
  if (e.kind === 'run') return 'outdoor.html?sport=run';
  if (e.kind === 'strength') return e.ref ? 'kraft.html?watch=' + encodeURIComponent(e.ref) : 'kraft.html';
  return null;
}
