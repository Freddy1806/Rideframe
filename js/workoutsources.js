// Every workout of the three sports in one list each (27.11.): the Workouts page (js/workoutspage.js) and the week planner (js/weekplan.js)
// read the same lists, so a workout built in one place is pickable in the other.
//   ride:     own (the builder's personal workouts and the old "My workouts"), coach (coach/workouts.json), standard (js/workouts.js)
//   run:      own run workouts (js/runworkouts.js)
//   strength: the account's watch workouts (exercises × sets × reps; Start = kraft.html?watch=<id>) and this phone's templates (kraft.html?tpl=)
// item = { id, name, min, group: 'own' | 'coach' | 'std' | 'watch' | 'tpl', href (Start), shape (svg) | line, w (the source) }
const enc = encodeURIComponent;
export async function loadSources({ acc = null, S = {} } = {}) {
  const out = { ride: [], run: [], strength: [] };
  try {
    const W = await import('./workouts.js'); W.setMyWorkouts(S.myWorkouts); if (S.ftp) W.setFtp(S.ftp);
    await Promise.all([import('./myworkouts-store.js').then(m => m.loadPersonal()).catch(() => {}), import('./coachworkouts.js').then(m => m.loadCoach({ timeout: 2500 })).catch(() => {})]);
    const it = (w, group) => ({ id: w.id, name: w.name, min: Math.round(W.workoutDuration(w) / 60), group, href: 'pure.html?workout=' + enc(w.id), shape: W.workoutSVG(w, null, 40), what: w.what || '', w });
    out.ride = [...W.PERSONAL.map(w => it(w, 'own')), ...W.MY.map(w => it(w, 'own')), ...W.catalog().map(w => it(w, w.coach ? 'coach' : 'std'))];
    const G = { own: 0, coach: 1, std: 2 }; out.ride.sort((a, b) => G[a.group] - G[b.group]); // stable: own, then coach, then standard
  } catch {}
  try { const R = await import('./runworkouts.js'), l = await R.loadRuns();
    out.run = l.map(w => ({ id: w.id, name: w.name, min: R.runMinutes(w), group: 'own', href: 'outdoor.html?sport=run', shape: R.runSVG(w, 40), what: R.runLine(w), w })); } catch {}
  try {
    const { db } = await import('./db.js'), tpls = (await db.kvGet('kraftTpl').catch(() => null)) || S.kraftTpl || [];
    const { CATALOG } = await import('./kraftlib.js'), exN = k => CATALOG.find(e => e.k === k)?.n || k;
    let watch = [];
    if (acc) try { const r = await fetch('/api/watch/config', { cache: 'no-store', headers: { 'X-RF-Token': acc.token || '' } }); if (r.ok) watch = ((await r.json()).config?.workouts || []).filter(w => w.items?.length); } catch {}
    out.strength = [...watch.map(w => ({ id: w.id, name: w.name, min: Math.round(w.items.reduce((a, x) => a + (+x.sets || 1) * ((+x.rest || 90) + 40), 0) / 60), group: 'watch', href: 'kraft.html?watch=' + enc(w.id),
        what: w.items.map(x => `${+x.sets || 1} × ${exN(x.ex)}`).join(' · '), n: w.items.length, w })),
      ...tpls.map((t, i) => ({ id: 'tpl' + i, name: t.name, min: 0, group: 'tpl', href: 'kraft.html?tpl=' + enc(t.name), what: (t.ex || []).map(x => `${x.n || 3} × ${exN(x.k)}`).join(' · '), n: (t.ex || []).length, w: t }))];
  } catch {}
  return out;
}
export const GROUP_NAME = { own: 'Mine', coach: 'Coach', std: 'Standard', watch: 'Watch workout', tpl: 'Template' };
