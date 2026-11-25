// Who stood on the scale? (25.11., owner: "it must recognise that it is me", flatmate Riley uses the same scale). Pure, no I/O.
// Candidates are the household's members. Each member's reference = the median of their last REF weigh-ins (any source, so a
// manual entry helps a new member too); their window = reference ± tolerance, the tolerance growing with the days since their
// last weigh-in: 1.5 kg + 0.15 kg per day, at most 4 kg. A measurement goes to a member automatically only when
//   - it lies inside exactly one member's window, at least MARGIN inside it away from every other member's window,
//   - that member's window does not overlap any other member's window (78 vs 80 kg: always ask),
//   - no member is "new" (joined within NEW_DAYS and fewer than NEW_N weigh-ins): their weight is unknown, so it could be theirs,
//   - and the member has at least NEW_N weigh-ins (a member's first weigh-ins are always asked).
// Everything else becomes a question for every member ("82.4 kg at 07:12 · Was that you?").
export const BASE = 1.5, PER_DAY = 0.15, MAX = 4, MARGIN = 0.5, REF = 5, NEW_DAYS = 14, NEW_N = 2;

const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
/** a member's reference from their measurements (any order); null without data */
export function reference(list, now) {
  const l = (list || []).filter(m => m.t <= now).sort((a, b) => b.t - a.t); if (!l.length) return null;
  const ref = median(l.slice(0, REF).map(m => m.kg)), daysAgo = Math.max(0, (now - l[0].t) / 864e5);
  return { ref, tol: Math.min(MAX, BASE + PER_DAY * daysAgo), n: l.length, last: l[0].t };
}
/** members: [{ id, joined, list }]; returns { decision: 'auto' | 'ask', id?, reason, scores } */
export function assign(kg, members, now = Date.now()) {
  const sc = members.map(m => ({ id: m.id, joined: m.joined || 0, ...(reference(m.list, now) || { ref: null, tol: null, n: 0 }) }));
  const scores = sc.map(s => ({ id: s.id, ref: s.ref, tol: s.tol, d: s.ref == null ? null : Math.abs(kg - s.ref), n: s.n }));
  const ask = reason => ({ decision: 'ask', reason, scores });
  if (!sc.length) return ask('no members');
  if (sc.some(s => s.n < NEW_N && now - s.joined < NEW_DAYS * 864e5)) return ask('new member');
  const known = sc.filter(s => s.ref != null), inside = known.filter(s => Math.abs(kg - s.ref) <= s.tol);
  if (!inside.length) return ask(known.length ? 'nobody near' : 'no data');
  if (inside.length > 1) return ask('several near');
  const w = inside[0];
  if (w.n < NEW_N) return ask('first weigh-ins');
  for (const o of known) { if (o === w) continue;
    if (Math.abs(w.ref - o.ref) <= w.tol + o.tol) return ask('windows overlap');
    if (Math.abs(kg - o.ref) <= o.tol + MARGIN) return ask('too close to another member'); }
  return { decision: 'auto', id: w.id, reason: 'one member', scores };
}
