// "The Bet" (story plan by Fable, 12.11.2026): every Monday the Wizard, the King and the Devil sit in the inn and bet on
// the new messenger, you. Nobody tells a story while you have to ride: the three speak short English lines (max 8 words,
// ElevenLabs recordings via assets/audio/manifest.json "voices") in the warm-up, at a few road marks, at the wizard's trial,
// in hell and at the finish.
// Points (owner 19.11.): only ONE kind, Wizard points (js/wizpoints.js), from kilometres, metres climbed and intensity, spent
// in the shop (js/shop.js). The three figures still talk, and which of distance (King) / climbing (Devil) / intensity
// (Wizard) brought most points last week still colours the world (L.colour); no screen shows three kinds of points.
// Ledger (kv 'story'): life (km, Hm, never expires, builds your village), day caps, week key + this week's points (weekWp,
// the leaderboard), wallet wp = { earned, spent, owned }. Structured workouts: no lines, no wizard, but everything counts.
import { db } from './db.js';
import { loadStep, ridePoints, splitOf, migrateLedger, earn, balanceOf, fmtWp, PARTS, WP, STR_DAY, STR_DAYS, EXERCISES, strengthPts } from './wizpoints.js';

export const WHO = {
  wizard: { name: 'Wizard', icon: '🧙', color: '#6fb6ff' },
  king: { name: 'King', icon: '👑', color: '#f2c14e' },
  devil: { name: 'Devil', icon: '😈', color: '#ff5a3c' },
};
const OWNER = { knight: 'king', gull: 'wizard', eagle: 'wizard', oma: 'devil', kid: 'devil' }; // whose man each challenger is

/** Monday-based week key in local time, e.g. "2026-11-09" (the Monday) */
export function weekKey(t = Date.now()) {
  const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const zero = () => ({ wizard: 0, king: 0, devil: 0 });
export const leaderOf = pts => { const e = Object.entries(pts || {}).sort((a, b) => b[1] - a[1]); return e.length && e[0][1] > 0 && e[0][1] > (e[1]?.[1] ?? 0) ? e[0][0] : null; };

let GRANT = null;
/** ?wp=5000 together with &laptest: the balance in memory for tests and screenshots, never saved to the account */
export function testGrant() {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search); return q.has('laptest') && q.get('wp') != null && Number.isFinite(+q.get('wp')) ? Math.max(0, +q.get('wp')) : null;
}
/** the saved ledger: migrated to Wizard points once, rolled over to this week (L.pts = last week's split by kind, only for the colour) */
export async function loadLedger() {
  const L = (await db.kvGet('story').catch(() => null)) || {};
  L.life ||= { km: 0, hm: 0, hells: 0, trials: 0, rides: 0, training: 0, routes: {} };
  L.day ||= { key: dayKey(), km: 0, hm: 0, rideDay: false };
  if (L.day.key !== dayKey()) L.day = { key: dayKey(), km: 0, hm: 0, rideDay: false };
  const wk = weekKey();
  migrateLedger(L, wk); // before the roll-over: this week's old three-figure points still count
  if (L.week !== wk) { const last = L.pts && leaderOf(L.pts); L.colour = L.week ? last : null; L.lastPts = L.pts || null; L.week = wk; L.pts = zero(); L.weekWp = 0; L.newWeek = true; }
  L.pts ||= zero(); L.weekWp ||= 0;
  const g = testGrant(); if (g != null) L.wp.grant = GRANT ??= g - (L.wp.earned - L.wp.spent); // once per page: buying lowers it
  return L;
}
/** saves locally and to the account; under the ?wp test hook only locally and without the grant */
export const saveLedger = L => {
  const test = L.wp?.grant != null, out = test ? { ...L, wp: { ...L.wp } } : L; if (test) delete out.wp.grant;
  if (!test) import('./account.js').then(a => a.pushStory?.(L)).catch(() => {});
  return db.kvSet('story', out).catch(() => {});
};

// ---- the lines (English, max 8 words); keys are the ElevenLabs file names, text is the manifest key ----
export const LINES = { // 12 per figure (stage 1); Fable's wording where the plan has it
  wizard: {
    lead: ['The numbers favour me this week.', 'My wager stands. Prove me right.'],
    newweek: ['A new week. I bet on watts.'],
    effort: ['Show me twenty seconds of truth.', 'Now that is honest power.', "Numbers don't lie. You, occasionally."],
    pass: ['Passed. I am barely surprised.', 'Fly, then. You earned the sky.'],
    fail: ['The Devil is already smiling.', "You fool. You didn't make it. Boom!"],
    hellExit: ['Up you go. Do try harder next time.', 'Out of the fire. You owe me one.'],
    land: ['Back on earth. Show-off.', 'Welcome down. Try not to gloat.'],
    goal: ['The finish. I knew you would make it.', 'There. Now go and boast about it.'],
    finish: ['Today, you were mine. Mathematically.', 'A fine day for arithmetic.', 'I shall collect my winnings.'],
  },
  king: {
    lead: ['We lead the wager. Splendid!', 'Our messenger rides for the crown.', 'The crown is ahead. Naturally.'],
    newweek: ['We bet on diligence. Ours.'],
    km: ['Ten more kilometres. Royal work!', 'A mile is a mile. Carry on.', 'Our road, your pace.', 'We are counting on you. Literally.'],
    streak: ['Third day running. Positively royal!'],
    finish: ['Today, you were ours!', 'The crown thanks you. Warmly.', 'Splendid ride. We take the credit.'],
  },
  devil: {
    lead: ['I am winning. Shocking, I know.', 'My mountains, my week. Lovely.'],
    newweek: ["New week. My money's on mountains."],
    climb: ['Climbing suits you. Truly.', 'Another hundred metres. Delicious.', 'Up you go, darling. I am watching.'],
    hellIn: ['Welcome. I kept it warm for you.', 'Failed? Down here, that counts.'],
    hellMid: ['Five minutes. Then you may leave.'],
    hellOut: ['Leaving already? Do come back.'],
    finish: ['Today, you were mine.', 'Lovely suffering. Same time tomorrow?'],
  },
};
const pick = a => a[Math.floor(Math.random() * a.length)];

/** one ride's part of the story */
export class StoryRide {
  /** opts: { L (ledger), ftp, training, routeId, say(who, text) } */
  constructor(opts) {
    Object.assign(this, opts);
    this.km = 0; this.hm = 0; this.load = 0; this.trials = 0; this.wins = 0; this.t = 0;
    this.lastLine = -1e9; this.nextKm = 10; this.nextHm = 100; this.said = new Set(); this.hellT = null; this.queue = [];
  }
  /** a line now, or soon when the rider is too deep in the red to listen (>105 % FTP); roadside lines keep 10 min apart */
  _line(who, key, { road = false } = {}) {
    if (this.training || !LINES[who]?.[key]) return;
    if (road && this.t - this.lastLine < 600) return;
    this.queue.push({ who, text: pick(LINES[who][key]), until: this.t + 45 }); if (road) this.lastLine = this.t;
  }
  /** every frame: dt s, dd metres ridden, dh metres climbed (>0 only), power W, cadence rpm, moving (not paused, not flying) */
  tick(dt, { dd = 0, dh = 0, power = 0, cadence = null, moving = true }) {
    this.t += dt;
    const L = this.L, pedalling = power > 0 && (cadence == null || cadence > 30);
    if (moving && pedalling) { // jumped or flown metres never count; the day caps of the old wager stay
      const k = Math.max(0, Math.min(dd, WP.dayKm * 1000 - (L.day.km + this.km) * 1000)) / 1000;
      const h = Math.max(0, Math.min(dh, WP.dayHm - (L.day.hm + this.hm)));
      this.km += k; this.hm += h; this.load += loadStep(dt, power, this.ftp);
      if (power >= 0.9 * this.ftp) this.hiRun = (this.hiRun || 0) + dt; else this.hiRun = 0;
    } else this.hiRun = 0;
    // the warm-up: the week's leader at 0:20 (or the three announce the new week)
    if (this.t > 20 && !this.said.has('open')) { this.said.add('open'); const ld = leaderOf(L.pts);
      if (L.newWeek) this._line(pick(['wizard', 'king', 'devil']), 'newweek'); else if (ld) this._line(ld, 'lead'); }
    if (this.t < 180) { /* warm-up: nothing else */ }
    else {
      if (this.km >= this.nextKm) { this.nextKm += 10; this._line('king', 'km', { road: true }); }
      if (this.hm >= this.nextHm) { this.nextHm += 100; this._line('devil', 'climb', { road: true }); }
      if (this.hiRun >= 300 && !this.said.has('effort' + Math.floor(this.t / 900))) { this.said.add('effort' + Math.floor(this.t / 900)); this._line('wizard', 'effort', { road: true }); }
    }
    if (this.hellT != null) { this.hellT += dt; if (this.hellT > 150 && !this.said.has('hellMid')) { this.said.add('hellMid'); this._line('devil', 'hellMid'); } }
    // hand out queued lines, but never into a sprint
    if (this.queue.length && power < 1.05 * this.ftp && this.t >= (this.quietUntil || 0)) { const q = this.queue.shift(); if (this.t < q.until) { this.say?.(q.who, q.text); this.quietUntil = this.t + 4.5; } }
  }
  // ---- events from the ride ----
  trialPass() { this.L.life.trials++; this.trials++; this._line('wizard', 'pass'); }
  hellIn() { this.hellT = 0; this._line('devil', 'hellIn'); }
  hellOut() { if (this.hellT == null) return; this._hadHell = true; this.hellT = null; this.L.life.hells++; this._line('devil', 'hellOut'); }
  challenge(id, type) { if (!OWNER[id]) return;
    this._acc ||= new Set();
    if (type === 'accept') this._acc.add(id);
    else if (type === 'win' && this._acc.delete(id)) this.wins++; }
  /** the points so far (the HUD could show them; the result screen uses finish) */
  points(minutes) { return ridePoints({ km: this.km, hm: this.hm, load: this.load, trials: this.trials, wins: this.wins, minutes }); }
  /** ride over: book the Wizard points, return the summary for the result screen; minutes = ride time */
  finish(minutes) {
    const L = this.L, p = this.points(minutes), paid = p.total > 0 || minutes >= WP.minMin;
    earn(L, p.total);
    const sp = splitOf(p); for (const k of Object.keys(sp)) L.pts[k] = (L.pts[k] || 0) + sp[k];
    if (paid) { L.day.km += this.km; L.day.hm += this.hm; }
    L.life.km += this.km; L.life.hm += this.hm; L.life.rides++; if (this.training) L.life.training++;
    if (this.routeId) L.life.routes[this.routeId] = (L.life.routes[this.routeId] || 0) + this.km;
    L.newWeek = false;
    const today = Object.entries(sp).sort((a, b) => b[1] - a[1])[0];
    if (!this.training && today[1] > 0) this._line(today[0], 'finish');
    const q = this.queue.shift(); if (q) this.say?.(q.who, q.text);
    saveLedger(L);
    return { wp: p, km: this.km, hm: this.hm, load: this.load, wins: this.wins, week: L.weekWp, balance: balanceOf(L.wp), minutes, hell: !!this._hadHell, L };
  }
}

/** what Wizard points are, in two sentences (the "?" on the result screen and the leaderboard) */
export const WP_INFO = `Every ride earns Wizard points: 1 per kilometre, 1 per ${WP.hmPer} metres climbed and half your training load (one hour exactly at FTP = 100), plus ${WP.trial} for a passed wizard trial and ${WP.win} for a won challenge. Spend them in the shop on hats, jerseys, bikes and gloves for your rider; they only change the look, never the riding.`;
/** modal: what the points mean */
export function betInfo() {
  const m = document.createElement('div'); m.className = 'modal'; m.style.zIndex = 400;
  m.innerHTML = `<div class="box" style="max-width:560px"><div class="label">Wizard points</div><h2 class="display" style="font-size:34px;margin:6px 0 12px">🧙 How it works</h2>
    <p style="line-height:1.5">${WP_INFO}</p>
    <div class="hint" style="margin-top:10px">Rides under ${WP.minMin} minutes earn nothing. At most ${WP.dayKm} km and ${WP.dayHm} m a day count. Strength after the ride counts per rep: ${EXERCISES.map(e => `${e.what} ${rate(e)}`).join(' · ')}; at most ${STR_DAY} points a day, on ${STR_DAYS} days a week.</div>
    <div class="actions"><button class="btn" id="biOk">Got it</button></div></div>`;
  document.body.append(m); const close = () => m.remove(); m.querySelector('#biOk').onclick = close; m.onclick = e => { if (e.target === m) close(); };
}

// ---- "Nachspiel im Wirtshaus" (Freddy 13.11., rules by Fable): an optional strength set after the ride for extra points.
// Honour-based, points PER REP (1 point = about a minute of honest work incl. rests); since 19.11. paid in Wizard points. ----
const rate = e => e.unit === 'min' ? `${1 / e.per} pt/min` : `1 pt per ${e.per}`;
const strDay = L => L.day.strength === true ? STR_DAY : (L.day.strength || 0); // true: a set booked under the old rules
/** points left today for this ride's strength set (0 = no offer): 20 min+, 30 a day, 4 days a week */
export function strengthLeft(sum) {
  const L = sum?.L; if (!L || sum.minutes < 20) return 0;
  if (L.strWeek?.week !== L.week) L.strWeek = { week: L.week, n: 0 };
  const today = strDay(L); if (!today && L.strWeek.n >= STR_DAYS) return 0;
  return Math.max(0, STR_DAY - today);
}
export const strengthOpen = sum => strengthLeft(sum) > 0;
export { strengthPts };

const DETAIL = { distance: s => `${(s.km || 0).toFixed(1)} km`, climbing: s => `${Math.round(s.hm || 0)} m`, intensity: s => `load ${Math.round(s.load || 0)}`,
  trial: () => 'wizard trial passed', challenges: s => `${s.wins} won`, strength: () => 'after the ride' };
/** result-screen block: this ride's Wizard points with the breakdown, the week, the balance with the shop, the strength offer */
export function storyHTML(s) {
  if (!s?.wp) return '';
  const p = s.wp, rows = PARTS.filter(([k]) => k === 'distance' || k === 'climbing' || k === 'intensity' || p[k] > 0);
  const left = strengthLeft(s);
  const line = e => `<div class="strrow" data-ex="${e.id}">
      <span class="strname"><b>${e.what}</b><small>${rate(e)}</small></span>
      <input type="number" inputmode="decimal" min="0" step="${e.unit === 'min' ? 0.5 : 1}" placeholder="${e.unit === 'min' ? 'Minutes' : 'Reps'}" aria-label="${e.what}">
      <button class="btn small" data-add disabled>+0</button></div>`;
  const offer = left > 0 ? `<div class="strength" id="strBox"><div class="label" style="margin:14px 0 8px">Back at the inn · strength for extra Wizard points · ${left} of ${STR_DAY} left today</div>
    <div class="strrows">${EXERCISES.filter(e => !e.more).map(line).join('')}</div>
    <details class="strmore"><summary>Other exercise (burpees, squats, plank)</summary><div class="strrows">${EXERCISES.filter(e => e.more).map(line).join('')}</div></details>
    <div class="hint" style="margin-top:6px">Enter what you really did; splitting it into sets is fine. Every rep counts.</div></div>` : '';
  return `<div class="chsum wpsum"><div class="wphead"><div class="label">Wizard points <button class="betinfo" title="How do Wizard points work?">?</button></div></div>
    <div class="wpgrid"><div class="wpride"><span class="wpbig">+${fmtWp(p.total)}</span><span class="wpsub">this ride</span>
      ${s.minutes < WP.minMin ? `<span class="wpsub">Rides under ${WP.minMin} minutes earn no points.</span>` : ''}</div>
    <div class="wplines">${rows.map(([k, n]) => `<div class="wpl" data-part="${k}"><span>${n}</span><span class="wpd">${DETAIL[k](s)}</span><b>+${fmtWp(p[k])}</b></div>`).join('')}</div></div>
    <div class="wpfoot"><span class="wpw">This week <b>${fmtWp(s.week)}</b></span><span class="wpbal">Balance <b>🧙 ${fmtWp(s.balance)}</b></span><button class="btn small" id="wpShop">Shop</button></div>${offer}</div>`;
}

/** wires the "?", the shop button and the strength cards on the result screen */
export function wireStory(root, s) {
  root.querySelector('.wpsum .betinfo')?.addEventListener('click', betInfo);
  root.querySelector('#wpShop')?.addEventListener('click', () => import('./shop-ui.js').then(m => m.shopModal({ onClose: () => { if (!s?.L) return; s.balance = balanceOf(s.L.wp); const b = root.querySelector('.wpbal b'); if (b) b.textContent = `🧙 ${fmtWp(s.balance)}`; } })));
  const box = root.querySelector('#strBox'); if (!box || !s?.L) return;
  box.querySelectorAll('.strrow').forEach(row => {
    const e = EXERCISES.find(x => x.id === row.dataset.ex), inp = row.querySelector('input'), btn = row.querySelector('[data-add]');
    const pts = () => strengthPts(e, inp.value, strengthLeft(s));
    inp.oninput = () => { const p = pts(); btn.textContent = `+${p}`; btn.disabled = !p; };
    btn.onclick = () => {
      const p = pts(); if (!p) return;
      const L = s.L, first = !strDay(L);
      earn(L, p); L.day.strength = strDay(L) + p;
      if (first) L.strWeek = { week: L.week, n: (L.strWeek?.week === L.week ? L.strWeek.n : 0) + 1 };
      saveLedger(L);
      s.wp.strength += p; s.wp.total += p; s.week = L.weekWp; s.balance = balanceOf(L.wp);
      root.querySelector('.wpsum').outerHTML = storyHTML(s); wireStory(root, s);
      root.querySelector('.wpsum')?.insertAdjacentHTML('beforeend', `<div class="strq" style="margin-top:8px">🧙 +${p} Wizard points for ${e.what.toLowerCase()}</div>`);
    };
  });
}
