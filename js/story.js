// "The Bet" (story plan by Fable, 12.11.2026): every Monday the Wizard, the King and the Devil sit in the inn and bet on
// the new messenger, you. Nobody tells a story while you have to ride: the three speak short English lines (max 8 words,
// ElevenLabs recordings via assets/audio/manifest.json "voices") in the warm-up, at a few road marks, at the wizard's trial,
// in hell and at the finish. How you ride is your vote:
//   King   = kilometres and riding regularly      Devil = climbing and surviving hell      Wizard = watts and trials
// Week points reset on Monday 00:00 local time; the leader colours the next week. The life total (km, Hm) never expires
// and builds your village (stage 2). Structured workouts: no lines, no wizard, but km/Hm/minutes count in full.
import { db } from './db.js';

export const WHO = {
  wizard: { name: 'Wizard', icon: '🧙', color: '#6fb6ff' },
  king: { name: 'King', icon: '👑', color: '#f2c14e' },
  devil: { name: 'Devil', icon: '😈', color: '#ff5a3c' },
};
const DAY_KM_CAP = 150, DAY_HM_CAP = 3000, WIZ_MIN_CAP = 40, DUELS_CAP = 3;
const OWNER = { knight: 'king', gull: 'wizard', eagle: 'wizard', oma: 'devil', kid: 'devil' }; // whose man each challenger is

/** Monday-based week key in local time, e.g. "2026-11-09" (the Monday) */
export function weekKey(t = Date.now()) {
  const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const zero = () => ({ wizard: 0, king: 0, devil: 0 });
export const leaderOf = pts => { const e = Object.entries(pts || {}).sort((a, b) => b[1] - a[1]); return e.length && e[0][1] > 0 && e[0][1] > (e[1]?.[1] ?? 0) ? e[0][0] : null; };

/** the saved ledger, rolled over to this week (last week's leader becomes the colour of this week) */
export async function loadLedger() {
  const L = (await db.kvGet('story').catch(() => null)) || {};
  L.life ||= { km: 0, hm: 0, hells: 0, trials: 0, rides: 0, training: 0, routes: {} };
  L.day ||= { key: dayKey(), km: 0, hm: 0, rideDay: false };
  if (L.day.key !== dayKey()) L.day = { key: dayKey(), km: 0, hm: 0, rideDay: false };
  const wk = weekKey();
  if (L.week !== wk) { const last = L.pts && leaderOf(L.pts); L.colour = L.week ? last : null; L.lastPts = L.pts || null; L.week = wk; L.pts = zero(); L.newWeek = true; }
  L.pts ||= zero();
  return L;
}
export const saveLedger = L => db.kvSet('story', L).catch(() => {});

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
    this.pts = zero(); this.km = 0; this.hm = 0; this.wizMin = 0; this.duels = 0; this.hiT = 0; this.t = 0;
    this.lastLine = -1e9; this.nextKm = 10; this.nextHm = 100; this.said = new Set(); this.hellT = null; this.queue = [];
  }
  _add(who, n) { if (n > 0) this.pts[who] += n; }
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
    if (moving && pedalling) {
      const k = Math.max(0, Math.min(dd, DAY_KM_CAP * 1000 - (L.day.km + this.km) * 1000)) / 1000;
      const h = Math.max(0, Math.min(dh, DAY_HM_CAP - (L.day.hm + this.hm)));
      this.km += k; this.hm += h;
      if (power >= 0.9 * this.ftp) { this.hiT += dt; if (this.wizMin < WIZ_MIN_CAP && this.hiT >= 60 * (this.wizMin + 1)) { this.wizMin++; this._add('wizard', 1); } }
      if (power >= 0.9 * this.ftp) this.hiRun = (this.hiRun || 0) + dt; else this.hiRun = 0;
    }
    // points as you go (king: 1/km; devil: 10 per 100 Hm)
    while (this.km >= (this._kmPaid || 0) + 1) { this._kmPaid = (this._kmPaid || 0) + 1; this._add('king', 1); }
    while (this.hm >= (this._hmPaid || 0) + 100) { this._hmPaid = (this._hmPaid || 0) + 100; this._add('devil', 10); }
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
    if (this.queue.length && power < 1.05 * this.ftp) { const q = this.queue.shift(); if (this.t < q.until) this.say?.(q.who, q.text); }
  }
  // ---- events from the ride ----
  trialPass() { this.L.life.trials++; this._add('wizard', 20); this._line('wizard', 'pass'); }
  hellIn() { this.hellT = 0; this._line('devil', 'hellIn'); }
  hellOut() { if (this.hellT == null) return; this.hellT = null; this.L.life.hells++; this._add('devil', 15); this._line('devil', 'hellOut'); }
  challenge(id, type) { const who = OWNER[id]; if (!who) return;
    if (type === 'accept' && this.duels < DUELS_CAP) { this.duels++; this._accepted = (this._accepted || new Set()).add(id + this.duels); this._add(who, 2); }
    else if (type === 'win' && this.duels <= DUELS_CAP) this._add(who, 3); }
  /** ride over: book the points, return the summary for the result screen; minutes = ride time */
  finish(minutes) {
    const L = this.L;
    if (minutes >= 20 && !L.day.rideDay) { L.day.rideDay = true; this._add('king', 10); }
    for (const k of Object.keys(this.pts)) L.pts[k] = (L.pts[k] || 0) + this.pts[k];
    L.day.km += this.km; L.day.hm += this.hm;
    L.life.km += this.km; L.life.hm += this.hm; L.life.rides++; if (this.training) L.life.training++;
    if (this.routeId) L.life.routes[this.routeId] = (L.life.routes[this.routeId] || 0) + this.km;
    L.newWeek = false;
    const today = Object.entries(this.pts).sort((a, b) => b[1] - a[1])[0];
    if (!this.training && today[1] > 0) this._line(today[0], 'finish');
    const q = this.queue.shift(); if (q) this.say?.(q.who, q.text);
    saveLedger(L);
    return { ride: { ...this.pts }, week: { ...L.pts }, leader: leaderOf(L.pts), life: { km: L.life.km, hm: L.life.hm } };
  }
}

/** result-screen block: today's points and the week's bet as three bars */
export function storyHTML(s) {
  if (!s) return '';
  const max = Math.max(1, ...Object.values(s.week));
  const row = k => { const w = WHO[k]; return `<div class="betrow" style="display:grid;grid-template-columns:110px 1fr 90px;gap:10px;align-items:center;margin:4px 0">
    <span>${w.icon} ${w.name}</span><span style="height:10px;border-radius:5px;background:#ffffff14;overflow:hidden"><i style="display:block;height:100%;width:${(s.week[k] / max * 100).toFixed(0)}%;background:${w.color}"></i></span>
    <span style="text-align:right">${s.week[k]}${s.ride[k] ? ` <small style="opacity:.7">+${s.ride[k]}</small>` : ''}</span></div>`; };
  return `<div class="chsum betsum" style="margin:14px 0 18px"><div class="label" style="margin-bottom:6px">The Bet · this week${s.leader ? ` · ${WHO[s.leader].name} leads` : ''}</div>${['wizard', 'king', 'devil'].map(row).join('')}</div>`;
}
