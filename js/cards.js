// The overview on the start page (25.11., owner: "Rebuild RIDEFRAME so that the activities are only one part … when you open
// RIDEFRAME you see all your current data, the VO2max values and so on; you can arrange it yourself; the weight values go in there
// too." All data in one place, so the coach sees everything.) A registry of self-contained cards and the page that shows them:
//   card = { id, title, area (its colour, css/cards.css), sizes ['half' | 'full'], size (default), on (shown by default),
//            account (needs a sign-in), load(ctx) -> data (sync or async; { empty: true } = nothing yet), render(el, data, ctx, size),
//            href (the detail page, or link(data) -> href), empty(ctx) -> the honest empty text, host (filled by the start page) }
// Every card loads on its own (a slow or failing one never holds up the others): a skeleton first, then its content, a quiet
// line when it fails. The arrangement (order, size, hidden cards) is js/cardlayout.js, kept per account on the server
// (tools/home-api.mjs) and in this browser's settings (signed out, offline). Numbers: js/cardlib.js (from js/fitness.js & co.).
import { db } from './db.js';
import { esc, fmtNum, weekStat } from './util.js';
import { MODES, icon } from './theme.js';
import { sportOf } from './fitness.js';
import { lineOf, nameOf, keyOf } from './feed.js';
import * as LY from './cardlayout.js';
import * as C from './cardlib.js';

const DAY = 864e5;
const $ = (s, r = document) => r.querySelector(s);
export const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const IC = {
  today: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  last: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  fitness: '<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/>',
  vo2: '<path d="M12 4v7M12 11c-2 0-3 1-4 3s-1 6-4 6M12 11c2 0 3 1 4 3s1 6 4 6"/>',
  ftp: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  weight: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8.5 9.5a5 5 0 0 1 7 0M12 9.5l1.2-1.6"/>',
  recovery: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  battery: '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2M6 10v4M10 10v4"/>',
  rhr: '<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  sleep: '<path d="M3 18h18M3 18V8M21 18v-5a3 3 0 0 0-3-3h-7v8M7 12h.01"/>',
  strength: '<path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/>',
  load: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>',
  records: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  watch: '<circle cx="12" cy="12" r="6"/><path d="M12 9.5V12l1.8 1.2M9 6.8 9.6 2h4.8l.6 4.8M9 17.2l.6 4.8h4.8l.6-4.8"/>',
  friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2c2.1.7 3.5 2.8 3.5 5.8"/>',
  coach: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.8A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>',
};

/* ---------- small formatters ---------- */
const hmS = s => `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
export const dayTxt = (t, now = Date.now()) => { const d0 = new Date(now).setHours(0, 0, 0, 0), d = new Date(t).setHours(0, 0, 0, 0), n = Math.round((d0 - d) / DAY);
  return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : n < 7 ? new Date(t).toLocaleDateString('en-GB', { weekday: 'long' }) : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const healthDay = day => { const [y, m, d] = String(day).split('-').map(Number); return dayTxt(new Date(y, m - 1, d).getTime()); };
const sc = m => `--mc:${MODES[m]?.color || MODES.other.color};--mcl:${MODES[m]?.light || MODES.other.light}`; // the sport's colour (css/cards.css honours "one colour")
const plural = (n, w) => `${fmtNum(n)} ${w}${n === 1 ? '' : 's'}`;
const word = (v, l) => l.find(([x]) => v >= x)?.[1] || l[l.length - 1][1];
/** a small line: pts [{ v }] (oldest first), w × h in viewBox units; a second faint line optional */
function spark(pts, { w = 120, h = 36, k = 'v', k2 = null, cls = 'cdspark' } = {}) {
  const vals = pts.flatMap(p => [p[k], k2 ? p[k2] : null]).filter(v => v != null); if (pts.length < 2 || !vals.length) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1, x = i => 2 + i / (pts.length - 1) * (w - 4), y = v => 3 + (hi - v) / r * (h - 6);
  const line = key => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${k2 ? `<path class="cdsp2" d="${line(k2)}" vector-effect="non-scaling-stroke"/>` : ''}<path d="${line(k)}" vector-effect="non-scaling-stroke"/><circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(pts[pts.length - 1][k]).toFixed(1)}" r="2.6"/></svg>`;
}

/* ---------- the account's answers, fetched once per page and shared by the cards ---------- */
const memoFetch = new Map(); // key -> { at, p, u }: a redraw of the start page within a minute asks the server nothing again
export function getJSON(key, url, acc, maxAge = 60e3) {
  const m = memoFetch.get(key); if (m && Date.now() - m.at < maxAge && m.u === acc?.name) return m.p;
  const p = fetch(url, { cache: 'no-store', headers: { 'X-RF-Token': acc?.token || '' } }).then(async r => { if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status }); return r.json(); });
  memoFetch.set(key, { at: Date.now(), p, u: acc?.name }); p.catch(() => memoFetch.delete(key)); return p;
}
export const body = ctx => ctx.acc ? getJSON('body', '/api/body?from=' + Math.floor(Date.now() - 90 * DAY), ctx.acc) : Promise.resolve(null); // the weight card's 90 days (js/bodycard.js)
export const health = ctx => ctx.acc ? getJSON('health', '/api/account/health?days=8', ctx.acc) : Promise.resolve(null); // the recovery card's 8 days (js/healthcard.js)

/* ---------- the cards ---------- */
const head = (c, right = '', size) => `<div class="cdh"><span class="cdt">${svg(IC[c.id] || '')}<span>${esc(size === 'half' && c.short || c.title)}</span></span>${right ? `<span class="cdr">${right}</span>` : ''}</div>`;
const go = '<i class="cdgo" aria-hidden="true">›</i>';
const stat2 = (v, u, l) => `<div class="cdbig"><b>${v}${u ? `<small> ${u}</small>` : ''}</b>${l ? `<span>${l}</span>` : ''}</div>`;

export const CARDS = [
  { id: 'today', title: 'This week', area: 'main', sizes: ['full', 'half'], size: 'full', href: 'statistik.html', desc: 'Sessions, time, distance and load against last week',
    load: ctx => C.weekSummary(ctx.acts, ctx.ld), quickEmpty: ctx => !ctx.acts.length,
    empty: () => 'Your week shows up here after your first session.',
    render(el, W, ctx, size) {
      const t = W.cur, p = W.prev, today = W.today.n ? `Today ${plural(W.today.n, 'session')} · ${hmS(W.today.sec)} h` : 'Nothing logged today yet';
      el.innerHTML = head(this, size === 'full' ? 'vs last week' : '') + (size === 'full'
        ? `<div class="kstats cdk">${weekStat(t.n, p.n, 'Sessions')}${weekStat(t.sec, p.sec, 'Time (h)', hmS)}${weekStat(Math.round(t.m / 1000), Math.round(p.m / 1000), 'km')}${weekStat(t.pts, p.pts, 'Load')}</div>`
        : `<div class="kstats cdk k2">${weekStat(t.n, p.n, 'Sessions')}${weekStat(t.sec, p.sec, 'Time (h)', hmS)}</div>`) + `<p class="cdf">${today}</p>${go}`;
    } },
  { id: 'last', title: 'Last activity', area: 'main', sizes: ['full', 'half'], size: 'full', href: 'aktivitaeten.html', desc: 'Your newest ride, run or workout with its key numbers',
    link: d => d?.act ? 'aktivitaeten.html?open=' + encodeURIComponent(keyOf(d.act)) : 'aktivitaeten.html',
    load: ctx => ctx.acts.length ? { act: ctx.acts[0], pts: Math.round(ctx.ld(ctx.acts[0])) } : { empty: true }, quickEmpty: ctx => !ctx.acts.length,
    empty: () => 'Nothing recorded yet. Start a ride, a run or a workout above, or import your activities from Strava.',
    render(el, d, ctx, size) {
      const a = d.act, m = sportOf(a);
      el.innerHTML = head(this, esc(dayTxt(a.date))) + `<div class="cdact" style="${sc(m)}">${icon(m, 'cdsi')}<div><b>${esc(nameOf(a))}</b><small>${lineOf(a)}</small></div>
        ${size === 'full' ? `<span class="cdpts"><b>${fmtNum(d.pts)}</b><small>pts</small></span>` : ''}</div>${go}`;
    } },
  { id: 'recovery', title: 'Recovery', area: 'rec', sizes: ['full'], size: 'full', account: true, bare: true, elId: 'hHealth', desc: 'Sleep score, body battery, resting heart rate, recovery time from your watch',
    load: async ctx => { const h = await health(ctx); return h?.days?.length ? h : { empty: true }; },
    empty: () => 'Open the RIDEFRAME app on your Garmin watch once a day: it sends sleep score, body battery, resting heart rate and recovery time.',
    async render(el, h) { (await import('./healthcard.js')).renderHealthCard(el, h); } },
  { id: 'weight', title: 'Weight', area: 'body', sizes: ['full'], size: 'full', account: true, bare: true, elId: 'hBody', href: 'body.html', desc: 'Your newest weigh-in, the trend and the 7-day change',
    load: async ctx => { const j = await body(ctx); if (!j) return { empty: true }; import('./bodycard.js').then(m => m.syncWeight(j.list, j.prefs)).catch(() => {}); return j.list?.length || j.prompts?.length ? j : { ...j, empty: true }; },
    empty: () => 'No weigh-ins yet. Add one on the Body page or connect your bathroom scale.', emptyLink: 'body.html',
    async render(el, j) { (await import('./bodycard.js')).renderWeightCard(el, j); } },
  { id: 'fitness', title: 'Fitness & form', short: 'Fitness', area: 'main', sizes: ['half', 'full'], size: 'half', href: 'profil.html', desc: 'Fitness, fatigue and form over all sports, 6 weeks',
    load: ctx => C.fitnessSummary(ctx.acts, ctx.ld), quickEmpty: ctx => !ctx.acts.length,
    empty: () => 'Fitness builds from every session you record: rides, runs and strength.',
    render(el, F, ctx, size) {
      const f = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v)), line = spark(F.series, { k: 'ctl', k2: 'atl', w: size === 'full' ? 300 : 120 });
      el.innerHTML = head(this, size === 'full' ? '6 weeks' : '', size) + (size === 'full'
        ? `<div class="kstats cdk k3"><div><b>${fmtNum(F.ctl)}</b><small>Fitness</small><em class="wd">${f(F.d28)} in 4 weeks</em></div><div><b>${fmtNum(F.atl)}</b><small>Fatigue</small><em class="wd">7 days</em></div><div><b>${f(F.tsb)}</b><small>Form</small><em class="wd">${esc(F.words)}</em></div></div>${line}`
        : `${stat2(fmtNum(F.ctl), '', 'fitness')}<p class="cds">Form <b>${f(F.tsb)}</b> · ${esc(F.words)}</p>${line}`) + go;
    } },
  { id: 'strength', title: 'Strength', area: 'kraft', sizes: ['half', 'full'], size: 'half', href: 'kraft.html', desc: 'Your last session, sets this week and the newest records',
    load: ctx => C.strengthSummary(ctx.acts), quickEmpty: ctx => !ctx.acts.some(a => a.kraft),
    empty: () => 'Log your sets on the Strength page or with the watch: every set, weight and record lands here.',
    render(el, K, ctx, size) {
      const d = K.setsWeek - K.setsPrev, rec = K.records.slice(0, size === 'full' ? 3 : 1);
      el.innerHTML = head(this, size === 'full' ? esc(dayTxt(K.last.t)) : '') + stat2(fmtNum(K.setsWeek), K.setsWeek === 1 ? 'set' : 'sets', 'this week')
        + `<p class="cds"><em class="wd ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${fmtNum(K.setsPrev)}</em> last week</p>`
        + `<p class="cdf">Last: <b>${esc(K.last.name)}</b>${size === 'full' ? ` · ${plural(K.last.sets, 'set')} · ${hmS(K.last.sec)} h` : ` · ${esc(dayTxt(K.last.t))}`}</p>`
        + (rec.length ? `<ul class="cdrec">${rec.map(r => `<li><i aria-hidden="true">🏆</i><span>${esc(r.name)}</span><b>${r.type === 'time' ? `${r.s} s` : r.type === 'bw' ? `${r.r} reps` : `${fmtNum(r.kg, r.kg % 1 ? 1 : 0)} kg × ${r.r}`}</b></li>`).join('')}</ul>` : '') + go;
    } },
  { id: 'vo2', title: 'VO2max', area: 'main', sizes: ['half', 'full'], size: 'half', href: 'profil.html', desc: 'Bike and run: the app\'s estimate and your watch\'s value',
    load: async ctx => C.vo2Summary(ctx.acts, ctx.P, await health(ctx).catch(() => null)),
    empty: ctx => `Needs 5 minutes with power on the bike or a run of 6 minutes or more${ctx.acc ? ', or the value from your watch' : ''}.`,
    render(el, V, ctx, size) {
      const rows = []; for (const [k, l] of [['bike', 'Bike'], ['run', 'Run']]) {
        if (V[k].watch) rows.push(`<div class="cdl"><span>${l}</span><b>${V[k].watch.v}</b><small>watch</small></div>`);
        if (V[k].app) rows.push(`<div class="cdl"><span>${V[k].watch ? '' : l}</span><b>≈ ${V[k].app.v}</b><small>${size === 'full' ? `estimate · from ${esc(V[k].app.from)}` : '<abbr title="estimate">est.</abbr>'}</small></div>`); }
      el.innerHTML = head(this, size === 'full' ? 'ml/kg/min' : '') + `<div class="cdls">${rows.join('')}</div>` + go;
    } },
  { id: 'ftp', title: 'FTP & W/kg', short: 'FTP', area: 'main', sizes: ['half', 'full'], size: 'half', href: 'profil.html', desc: 'Your FTP, the estimate from your rides and watts per kilo',
    load: async ctx => C.ftpSummary(ctx.S, ctx.P, await body(ctx).catch(() => null)),
    empty: () => 'Set your FTP in Profile, or ride with a power meter and RIDEFRAME estimates it.',
    render(el, F, ctx, size) {
      const est = F.est && F.est.w !== F.ftp ? `<p class="cdf">Estimate <b>${F.est.w} W</b>${size === 'full' ? ` · ${esc(F.est.from)}` : ''}</p>` : '';
      el.innerHTML = head(this, '', size) + (F.ftp ? stat2(fmtNum(F.ftp), 'W', '') : stat2('≈ ' + fmtNum(F.est.w), 'W', 'estimate'))
        + `<p class="cds">${F.wkg ? `<b>${fmtNum(F.wkg, 2)}</b> W/kg` : 'Add your weight for W/kg'}${F.kg && size === 'full' ? ` · ${fmtNum(F.kg, 1)} kg (${F.kgFrom})` : ''}</p>` + est + go;
    } },
  { id: 'load', title: 'Training load', area: 'main', sizes: ['full', 'half'], size: 'full', href: 'statistik.html', desc: 'The last 7 days, a bar per day in the colour of each sport',
    load: ctx => C.loadDays(ctx.acts, ctx.ld), quickEmpty: ctx => !ctx.acts.length,
    empty: () => 'Every session adds load points: 100 = one hour at your threshold.',
    render(el, L, ctx, size) {
      const hi = Math.max(60, ...L.days.map(d => d.total)), today = L.days.length - 1;
      el.innerHTML = head(this, `7 days · <b>${fmtNum(L.total)}</b> pts`) + `<div class="cdbars" role="img" aria-label="Load per day, last 7 days: ${L.days.map(d => `${new Date(d.t).toLocaleDateString('en-GB', { weekday: 'short' })} ${Math.round(d.total)}`).join(', ')}">${L.days.map((d, i) =>
        `<div class="cdbar${i === today ? ' now' : ''}"><span class="cdcol">${d.parts.map(p => `<i style="${sc(p.sport)};height:${(p.pts / hi * 100).toFixed(1)}%"></i>`).join('')}</span><small>${new Date(d.t).toLocaleDateString('en-GB', { weekday: size === 'full' ? 'short' : 'narrow' })}</small></div>`).join('')}</div>` + go;
    } },
  { id: 'records', title: 'Records', area: 'main', sizes: ['full', 'half'], size: 'full', href: 'statistik.html', desc: 'Your newest best efforts: power, run times, longest ride, lifts',
    load: ctx => C.recentRecords(ctx.acts), quickEmpty: ctx => !ctx.acts.length,
    empty: () => 'Your best efforts show up here: 5 and 20 minute power, fastest 1, 5 and 10 km, the longest ride and every lift record.',
    render(el, R, ctx, size) {
      el.innerHTML = head(this, size === 'full' ? 'newest' : '') + `<ul class="cdrl">${R.list.slice(0, size === 'full' ? 4 : 2).map(r => `<li style="${sc(r.sport)}">${icon(r.sport, 'cdri')}<span><b>${esc(r.value)}</b><small>${esc(r.what)}</small></span>${size === 'full' ? `<em>${esc(dayTxt(r.t))}</em>` : ''}</li>`).join('')}</ul>` + go;
    } },
  { id: 'watch', title: 'Watch', area: 'watch', sizes: ['full'], size: 'full', account: true, host: 'watch', desc: 'Your paired Garmin watch: screens and workouts',
    empty: () => 'No watch paired yet. Pair your Garmin watch in Settings: it records with RIDEFRAME and sends your recovery values.', emptyLink: 'handy.html#settings-watch' },
  { id: 'friends', title: 'Friends', area: 'friends', sizes: ['full'], size: 'full', account: true, host: 'friends', desc: 'Who is online and who is riding right now',
    empty: () => 'Nobody else here yet. Everyone with an account on this RIDEFRAME shows up with a green dot when they are online.' },
  { id: 'coach', title: 'Coach', area: 'coach', sizes: ['full', 'half'], size: 'full', account: true, href: 'handy.html#settings-coach', desc: 'Your Claude connector: your coach sees all of this',
    load: async ctx => { const j = await getJSON('mcp', '/api/account/mcp', ctx.acc); const l = j.links || []; return l.length ? { links: l } : { empty: true }; },
    empty: () => 'Connect your coach: Claude then sees your activities, strength, weight and recovery and plans watch workouts with you.',
    render(el, d, ctx, size) {
      const used = Math.max(0, ...d.links.map(l => l.used || 0));
      el.innerHTML = head(this, '') + `<p class="cdbig cdon"><b>Connected</b></p><p class="cds">${used ? `Last looked ${esc(dayTxt(used).toLowerCase())}` : 'Not used yet'}${size === 'full' ? ` · ${plural(d.links.length, 'link')}` : ''}</p>${size === 'full' ? '<p class="cdf">Claude reads your activities, strength, fitness, weight and recovery.</p>' : ''}` + go;
    } },
  { id: 'battery', title: 'Body battery', area: 'rec', sizes: ['half', 'full'], size: 'half', on: false, account: true, desc: 'Your energy reserve from the watch, 0 to 100',
    load: async ctx => C.healthValue(await health(ctx), 'bb'),
    empty: () => 'Comes from your Garmin watch with the RIDEFRAME app.',
    async render(el, d, ctx, size) { const W = (await import('./healthcard.js')).WORDS;
      el.innerHTML = head(this, esc(healthDay(d.day))) + stat2(d.v, '', word(d.v, W.bb)) + (size === 'full' ? spark(d.series, { w: 300 }) : ''); } },
  { id: 'rhr', title: 'Resting HR', area: 'rec', sizes: ['half', 'full'], size: 'half', on: false, account: true, desc: 'Resting heart rate with its last 7 days',
    load: async ctx => { const h = await health(ctx), v = C.healthValue(h, 'rhr', 7); if (v.empty) return v; return { ...v, cmp: (await import('./healthcard.js')).rhrCompare(h.days) }; },
    empty: () => 'Comes from your Garmin watch with the RIDEFRAME app.',
    render(el, d, ctx, size) {
      const c = d.cmp, txt = !c || c.d == null ? 'first day' : c.d === 0 ? '= 7 days' : `${c.d > 0 ? '+' : '−'}${Math.abs(c.d)} vs 7 days`;
      el.innerHTML = head(this, esc(healthDay(d.day))) + stat2(d.v, 'bpm', `<span class="${c?.d != null && c.d <= 0 ? 'cdgood' : ''}">${txt}</span>`) + spark(d.series, { w: size === 'full' ? 300 : 120 }); } },
  { id: 'sleep', title: 'Sleep', area: 'rec', sizes: ['half', 'full'], size: 'half', on: false, account: true, onlyData: true, desc: 'Shows as soon as sleep data arrives (the watch app cannot send it yet)',
    load: async ctx => C.healthValue(await health(ctx), 'ss'),
    async render(el, d) { const W = (await import('./healthcard.js')).WORDS; el.innerHTML = head(this, esc(healthDay(d.day))) + stat2(d.v, '', 'sleep score · ' + word(d.v, W.ss)); } },
];
const BY = new Map(CARDS.map(c => [c.id, c]));
export const CATALOG = CARDS.map(({ id, sizes, size, on }) => ({ id, sizes, size, on: on !== false }));

/* ---------- which cards were empty for this account last time (the default puts them lower) ---------- */
const EKEY = 'rf-home-empty';
const emptyKnown = u => { try { const v = JSON.parse(localStorage.getItem(EKEY) || 'null'); return v && v.u === (u || '') && Array.isArray(v.ids) ? v.ids : []; } catch { return []; } };
const emptySave = (u, ids) => { try { localStorage.setItem(EKEY, JSON.stringify({ u: u || '', ids: [...ids].sort() })); } catch {} };

/* ---------- the page ---------- */
const memo = new Map(); // card id -> its last data, so a redraw of the start page paints at once
let synced = '', sendT = 0, pending = null, flushNow = null, editOn = false; // editOn: a redraw of the start page (new activities arrived) keeps the edit mode

/** ctx: { acts (newest first), P, S (settings; S.homeCards), acc, hosts: { watch(el), friends(el) }, signIn(), openAct(a) } */
if (typeof addEventListener === 'function') { const f = () => flushNow?.(); addEventListener('pagehide', f); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') f(); }); }
export function mountOverview(root, ctx) {
  if (!root) return;
  ctx.ld ||= C.loads(ctx.P);
  const u = ctx.acc?.name || '', st = { edit: editOn, L: null }, emp = new Set(emptyKnown(u));
  for (const c of CARDS) if (c.quickEmpty) { if (c.quickEmpty(ctx)) emp.add(c.id); else emp.delete(c.id); }
  const layout = x => LY.normalize(x, CATALOG, { empty: [...emp] });
  st.L = layout(LY.clean(ctx.S?.homeCards));
  const fresh = () => !ctx.acts.length;
  const shown = () => st.L.cards.filter(x => !BY.get(x.id).account || ctx.acc);

  function draw() {
    if (!root.isConnected) return;
    root.className = 'ov' + (fresh() && !st.edit ? ' ovfresh' : '') + (st.edit ? ' ovediting' : '');
    root.innerHTML = (fresh() && !st.edit ? welcome(ctx) : '')
      + `<div class="ovhead"><h2 class="label" id="ovTitle">${st.edit ? 'Arrange your overview' : 'Your overview'}</h2><button type="button" class="ovbtn${st.edit ? ' on' : ''}" id="ovEdit" aria-pressed="${st.edit}">${st.edit ? 'Done' : 'Edit'}</button></div>
      <p class="ovsr" id="ovLive" role="status" aria-live="polite"></p>`
      + (st.edit ? editHTML() : `<div class="ovgrid" id="ovGrid"></div>${!ctx.acc && st.L.cards.some(x => BY.get(x.id).account) ? `<button type="button" class="ovsign" id="ovSign"><b>Sign in for the rest</b><small>Weight, recovery, your watch, friends and your coach live in your account.</small><i aria-hidden="true">›</i></button>` : ''}`);
    $('#ovEdit', root).onclick = () => { st.edit = editOn = !st.edit; draw(); $('#ovEdit', root)?.focus(); };
    root.querySelectorAll('#ovSign, #ovIn').forEach(b => b.onclick = () => ctx.signIn?.());
    const ch = $('#ovChoose', root); if (ch) ch.onclick = () => { st.edit = editOn = true; draw(); $('#ovEdit', root)?.focus(); };
    const fi = $('#ovFirst', root); if (fi) fi.onclick = e => { e.preventDefault(); const b = document.querySelector('.hstart a'); scrollTo({ top: 0, behavior: 'smooth' }); b?.focus({ preventScroll: true }); };
    if (st.edit) return wireEdit();
    const grid = $('#ovGrid', root);
    for (const x of shown()) grid.append(cardEl(BY.get(x.id), x.size));
    root.dataset.shown = String(grid.children.length);
  }

  function cardEl(c, size) {
    const a = !!(c.href || c.link) && !c.bare && !c.host, el = document.createElement(a ? 'a' : 'section');
    el.className = `cd cd-${size} a-${c.area}${c.bare ? ' cd-bare' : ''}${c.host ? ' cd-host' : ''}`; el.dataset.card = c.id; if (c.elId) el.id = c.elId;
    if (a) { el.href = c.href || 'aktivitaeten.html'; el.setAttribute('aria-label', c.title); } else el.setAttribute('aria-label', c.title);
    if (c.host) { el.dataset.state = 'ok'; el.innerHTML = `<div class="cdhost"></div><div class="cdhempty">${head(c)}<p class="cde">${esc(c.empty(ctx))}</p>${c.emptyLink ? `<a class="cdcta" href="${c.emptyLink}">${c.host === 'watch' ? 'Pair a watch' : 'Open'} ›</a>` : ''}</div>`;
      try { ctx.hosts?.[c.host]?.($('.cdhost', el)); } catch {} return el; }
    const m = memo.get(c.id);
    if (m && m.u === u) paint(el, c, m.data, size); else { el.dataset.state = 'loading'; el.innerHTML = head(c) + `<div class="cdsk" aria-hidden="true"><i></i><i></i></div>`; el.setAttribute('aria-busy', 'true'); }
    if (a && c.id === 'last') el.addEventListener('click', e => { const d = memo.get('last')?.data; if (d?.act && ctx.openAct && !e.metaKey && !e.ctrlKey) { e.preventDefault(); ctx.openAct(d.act); } });
    setTimeout(() => fill(el, c, size), 0); // after the first paint; each card on its own
    return el;
  }
  async function fill(el, c, size) {
    let data;
    try { data = await Promise.race([Promise.resolve().then(() => c.load(ctx)), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 12e3))]); }
    catch (e) {
      if (e?.status === 401) data = { empty: true }; // signed out on the server: the honest empty state, no error
      else { if (!el.isConnected || memo.get(c.id)?.u === u) return; el.dataset.state = 'error'; el.removeAttribute('aria-busy'); el.innerHTML = head(c) + '<p class="cde cderr">Could not load this right now. It tries again next time.</p>'; return; }
    }
    memo.set(c.id, { data, u });
    const was = emp.has(c.id); if (data?.empty) emp.add(c.id); else emp.delete(c.id); if (was !== emp.has(c.id)) emptySave(u, emp);
    if (el.isConnected) await paint(el, c, data, size);
  }
  async function paint(el, c, data, size) {
    el.removeAttribute('aria-busy');
    if (data?.empty) {
      el.dataset.state = c.onlyData ? 'none' : 'empty';
      el.innerHTML = head(c) + (c.empty ? `<p class="cde">${esc(c.empty(ctx))}</p>` : '') + (c.emptyLink && el.tagName !== 'A' ? `<a class="cdcta" href="${c.emptyLink}">${c.id === 'weight' ? 'Add a weigh-in' : 'Open'} ›</a>` : el.tagName === 'A' ? go : '');
      if (el.tagName === 'A') el.href = c.link ? c.link(data) : c.href;
      return;
    }
    if (el.tagName === 'A') el.href = c.link ? c.link(data) : c.href;
    try { await c.render(el, data, ctx, size); el.dataset.state = 'ok'; }
    catch { el.dataset.state = 'error'; el.innerHTML = head(c) + '<p class="cde cderr">Could not show this right now.</p>'; }
  }

  /* ----- edit: reorder (drag handle, keys, up/down), remove, add back, size, reset ----- */
  function editHTML() {
    const row = (x, i, n) => { const c = BY.get(x.id), two = c.sizes.length > 1;
      return `<li class="ovrow a-${c.area}" data-id="${c.id}"><button type="button" class="ovgrip" aria-label="Move ${esc(c.title)}, position ${i + 1} of ${n}. Arrow keys move it." aria-describedby="ovHelp">${svg('<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/>')}</button>
        <span class="ovname"><i aria-hidden="true"></i><b>${esc(c.title)}</b>${c.account && !ctx.acc ? '<small>Shows when signed in</small>' : ''}</span>
        <span class="ovctl">${two ? `<button type="button" class="ovsz" data-size="${x.size === 'full' ? 'half' : 'full'}" aria-label="${esc(c.title)}: ${x.size === 'full' ? 'full' : 'half'} width. Make it ${x.size === 'full' ? 'half' : 'full'} width.">${x.size === 'full' ? 'Full' : 'Half'}</button>` : ''}
        <button type="button" class="ovmv" data-d="-1" aria-label="Move ${esc(c.title)} up" ${i ? '' : 'disabled'}>${svg('<path d="m6 15 6-6 6 6"/>')}</button><button type="button" class="ovmv" data-d="1" aria-label="Move ${esc(c.title)} down" ${i < n - 1 ? '' : 'disabled'}>${svg('<path d="m6 9 6 6 6-6"/>')}</button>
        <button type="button" class="ovrm" aria-label="Remove ${esc(c.title)}">${svg('<path d="M5 12h14"/>')}</button></span></li>`; };
    const n = st.L.cards.length;
    return `<p class="ovhelp" id="ovHelp">Drag a card by its handle, or use the arrows. Your arrangement is saved ${ctx.acc ? 'in your account, on every device' : 'on this device (sign in to keep it everywhere)'}.</p>
      <ol class="ovlist" id="ovList">${st.L.cards.map((x, i) => row(x, i, n)).join('')}</ol>
      ${!n ? '<p class="hint">No cards on your overview. Add some below.</p>' : ''}
      <h3 class="ksec ovaddh" id="ovAddH">Add cards</h3>
      ${st.L.hidden.length ? `<ul class="ovadd" aria-labelledby="ovAddH">${st.L.hidden.map(id => BY.get(id)).map(c => `<li class="a-${c.area}"><span class="ovname"><i aria-hidden="true"></i><b>${esc(c.title)}</b><small>${esc(c.desc)}${c.account && !ctx.acc ? ' · needs sign-in' : ''}</small></span><button type="button" class="btn ghost ksmall" data-add="${c.id}" aria-label="Add ${esc(c.title)}">Add</button></li>`).join('')}</ul>` : '<p class="hint" id="ovAll">Every card is on your overview.</p>'}
      <div class="ovfoot"><button type="button" class="btn ghost ksmall" id="ovReset">Reset to default</button><button type="button" class="btn ksmall" id="ovDone">Done</button></div>`;
  }
  const say = t => { const l = $('#ovLive', root); if (l) { l.textContent = ''; requestAnimationFrame(() => { l.textContent = t; }); } };
  function change(nl, msg, focus) {
    if (nl === st.L) return; st.L = nl; draw(); save(nl); if (msg) say(msg);
    if (focus) { const [id, sel] = focus, r = root.querySelector(`.ovrow[data-id="${id}"] ${sel}`) || root.querySelector(`.ovrow[data-id="${id}"] .ovgrip`) || $('#ovDone', root); r?.focus(); }
  }
  const pos = id => st.L.cards.findIndex(x => x.id === id) + 1, title = id => BY.get(id).title;
  function wireEdit() {
    $('#ovDone', root).onclick = () => { st.edit = editOn = false; draw(); $('#ovEdit', root)?.focus(); };
    $('#ovReset', root).onclick = () => { if (!confirm('Put the cards back the way they were at the start?')) return; change(LY.normalize(LY.reset(CATALOG, Date.now(), { empty: [...emp] }), CATALOG, { empty: [...emp] }), 'Back to the default cards.'); $('#ovReset', root)?.focus(); };
    root.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const id = b.dataset.add; change(LY.add(st.L, id, CATALOG), `${title(id)} added at the end.`, [id, '.ovgrip']); });
    root.querySelectorAll('.ovrow').forEach(r => {
      const id = r.dataset.id;
      r.querySelector('.ovrm').onclick = () => { const i = pos(id) - 1, next = st.L.cards[i + 1]?.id || st.L.cards[i - 1]?.id; change(LY.remove(st.L, id), `${title(id)} removed. It is under Add cards.`, next ? [next, '.ovrm'] : null); };
      r.querySelectorAll('.ovmv').forEach(b => b.onclick = () => { const d = +b.dataset.d; change(LY.moveBy(st.L, id, d), `${title(id)}: position ${pos(id) + d} of ${st.L.cards.length}.`, [id, `.ovmv[data-d="${d}"]:not([disabled])`]); });
      const sz = r.querySelector('.ovsz'); if (sz) sz.onclick = () => change(LY.setSize(st.L, id, sz.dataset.size, CATALOG), `${title(id)}: ${sz.dataset.size} width.`, [id, '.ovsz']);
      const g = r.querySelector('.ovgrip');
      g.onkeydown = e => { const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0; if (!d) return; e.preventDefault(); const nl = LY.moveBy(st.L, id, d); if (nl !== st.L) change(nl, `${title(id)}: position ${pos(id) + d} of ${st.L.cards.length}.`, [id, '.ovgrip']); };
      g.onpointerdown = e => drag(e, r, id);
    });
  }
  /** drag by the handle (mouse, pen, touch): the row follows the pointer, the others make room; near the top or bottom edge the page scrolls */
  function drag(e, row, id) {
    if (e.button > 0) return; e.preventDefault();
    const list = $('#ovList', root), g = e.currentTarget, r0 = row.getBoundingClientRect(), grab = e.clientY - r0.top; let y = e.clientY, raf = 0, moved = false;
    try { g.setPointerCapture(e.pointerId); } catch {}
    row.classList.add('ovdrag'); list.classList.add('ovdragging');
    const place = () => { // layout positions (offsetTop: the others may be gliding), the list is the rows' offset parent
      const ly = y - list.getBoundingClientRect().top, others = [...list.children].filter(x => x !== row); let before = null;
      for (const o of others) if (ly < o.offsetTop + o.offsetHeight / 2) { before = o; break; }
      if ((before && before !== row.nextElementSibling) || (!before && row !== list.lastElementChild)) {
        const f = new Map(others.map(o => [o, o.offsetTop])); list.insertBefore(row, before); moved = true;
        for (const [o, t0] of f) { const d = t0 - o.offsetTop; if (d) { o.style.transition = 'none'; o.style.transform = `translateY(${d}px)`; o.getBoundingClientRect(); o.style.transition = ''; o.style.transform = ''; } } // the others glide into place
      }
      row.style.transform = `translateY(${ly - grab - row.offsetTop}px)`;
    };
    const y0 = e.clientY, edge = () => { const m = 72, v = Math.abs(y - y0) < 12 ? 0 : y < m ? -(m - y) / 4 : y > innerHeight - m ? (y - innerHeight + m) / 4 : 0; if (v) { scrollBy(0, Math.max(-18, Math.min(18, v))); place(); } raf = requestAnimationFrame(edge); };
    const mv = ev => { if (ev.pointerId !== e.pointerId) return; y = ev.clientY; place(); };
    const up = ev => { if (ev?.pointerId !== e.pointerId) return;
      cancelAnimationFrame(raf); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      row.classList.remove('ovdrag'); list.classList.remove('ovdragging'); row.style.transform = '';
      const to = [...list.children].indexOf(row);
      if (moved && to !== pos(id) - 1) change(LY.move(st.L, id, to), `${title(id)}: position ${to + 1} of ${st.L.cards.length}.`, [id, '.ovgrip']); else g.focus();
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up); raf = requestAnimationFrame(edge); // on the window: moving the row in the list ends the handle's pointer capture
  }

  /* ----- saving: this browser's settings at once, the account a moment later (the newer arrangement wins everywhere) ----- */
  async function save(nl) {
    const v = LY.clean(nl); if (!v) return; if (ctx.S) ctx.S.homeCards = v;
    try { const s = (await db.kvGet('settings').catch(() => null)) || {}; s.homeCards = v; await db.kvSet('settings', s); } catch {}
    if (!ctx.acc) return; clearTimeout(sendT); pending = v; sendT = setTimeout(() => { pending = null; put(v); }, 500);
  }
  async function put(v, keepalive = false) {
    try { const r = await fetch('/api/account/home', { method: 'PUT', cache: 'no-store', keepalive, headers: { 'Content-Type': 'application/json', 'X-RF-Token': ctx.acc?.token || '' }, body: JSON.stringify({ layout: v }) });
      const j = await r.json().catch(() => ({})); if (r.ok && j.layout && !j.saved) adopt(j.layout); } catch {}
  }
  /** a newer arrangement from the account: take it (not in the middle of editing) */
  async function adopt(x) {
    const v = LY.clean(x); if (!v) return; if (ctx.S) ctx.S.homeCards = v;
    try { const s = (await db.kvGet('settings').catch(() => null)) || {}; s.homeCards = v; await db.kvSet('settings', s); } catch {}
    const nl = layout(v); if (JSON.stringify(nl) === JSON.stringify(st.L)) return; st.L = nl; if (!st.edit) draw();
  }
  /* leaving the page inside the 500 ms: send the waiting arrangement now (keepalive outlives the page) */
  flushNow = () => { if (!pending || !ctx.acc) return; clearTimeout(sendT); const v = pending; pending = null; put(v, true); };
  draw();
  if (ctx.acc && synced !== u) { synced = u; // once per page and account: the account's arrangement against this browser's
    getJSON('home', '/api/account/home', ctx.acc, 0).then(j => { const here = LY.clean(ctx.S?.homeCards), win = LY.newer(here, j.layout);
      if (win && (!here || win.at > here.at)) adopt(win); else if (here && (!j.layout || here.at > j.layout.at)) put(here); }).catch(() => {});
  }
  return { get layout() { return st.L; }, edit: on => { st.edit = editOn = !!on; draw(); } };
}

/** brand-new account or signed out without any activity: a short explanation and where to begin, not a wall of empty cards */
function welcome(ctx) {
  const step = (href, ic, b, s, id = '') => `<a class="hrow hlink ovstep" href="${href}"${id ? ` id="${id}"` : ''}><span class="ovsi" aria-hidden="true">${svg(ic)}</span><div><b>${b}</b><small>${s}</small></div><i>›</i></a>`;
  if (!ctx.acc) return `<section class="ovwel" aria-labelledby="ovWelT"><h2 id="ovWelT">All your training in one place</h2>
    <p>Rides, runs, strength sessions with every set, your weight and your recovery, side by side on this page, for you and your coach.</p>
    <p class="ovwelgo">Start something above, it works without an account. Sign in to keep everything on every device and add your scale, your watch and your coach.</p>
    <div class="ovwelbtn"><button type="button" class="btn ksmall" id="ovIn">Sign in or create an account</button><button type="button" class="btn ghost ksmall" id="ovChoose">Choose cards</button></div></section>`;
  return `<section class="ovwel" aria-labelledby="ovWelT"><h2 id="ovWelT">Welcome, ${esc(ctx.acc.name)}</h2>
    <p>This page fills up as your data comes in: training, strength, weight and recovery, the way you arrange it. Good first steps:</p>
    <div class="ovsteps">${step('#', IC.today, 'Record your first activity', 'Tap a sport above: ride, run, indoor, strength', 'ovFirst')}
      ${step('body.html', IC.weight, 'Add a weigh-in', 'By hand or from your bathroom scale')}
      ${step('handy.html#settings-watch', IC.watch, 'Pair your Garmin watch', 'Record with it and get your recovery values')}
      ${step('aktivitaeten.html', IC.last, 'Import from Strava', 'Your earlier rides and runs, in one go')}
      ${step('handy.html#settings-coach', IC.coach, 'Connect your coach', 'Claude sees everything here and plans with you')}</div>
    <button type="button" class="ovlink" id="ovChoose">Choose which cards you see</button></section>`;
}
