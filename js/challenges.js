// Challenges on open rides (never in a workout or group ride): now and then someone at the roadside dares you to a
// short race, e.g. "300 W for 1 km". You accept by simply kicking (holding ~90 % of the target for 1.5 s) or with K;
// ignore it and the dare expires. 3-2-1, then the challenger races you to a flag at the finish at exactly the pace
// the target power would give you on this road, so holding the target is a dead heat and more wins it.
// Each challenger has its own difficulty: the knight is easy, the child is very hard.
import { powerFor, step as physStep } from './physics.js';

export const CHALLENGERS = [
  { id: 'knight', name: 'Der Ritter', models: ['reiter_ritter', 'pferd'], k: 0.95, kind: 'ride',
    ask: 'Ha! Race me to the flag, cyclist!', win: 'By my sword... you are fast!', lose: 'Too slow for the King!' },
  { id: 'oma', name: 'Die Oma', models: ['oma_fahrrad', 'alte_frau'], k: 1.03, kind: 'run', // on her old bicycle once the MacBook has built it
    ask: 'Think you can beat granny?', win: 'Oh my, what legs!', lose: 'Hah! Granny wins again!' },
  { id: 'gull', name: 'Die Möwe', models: ['moewe'], k: 1.1, kind: 'fly',
    ask: 'Skraa! Catch me if you can!', win: "Fine. You win. I wasn't even trying.", lose: 'Skraa! Pedal harder, featherless!' },
  { id: 'eagle', name: 'Der Seeadler', models: ['seeadler'], k: 1.18, kind: 'fly',
    ask: 'The sky is mine. Prove me wrong!', win: 'Hmph. Lucky tailwind, I suppose.', lose: 'Nobody outruns the eagle.' },
  { id: 'kid', name: 'Das Kind', models: ['kind_fahrrad'], k: 1.32, kind: 'run', // never on foot: a child running 37 km/h looked wrong (Freddy); comes back on its bike
    ask: 'Bet you can\'t beat me! Go go go!', win: 'Nooo! Again! Again!', lose: "I won! I won! You're so slow!" },
];
const DIST = [[600, 0.1], [1000, 0], [1500, -0.06]], GAP = 3200; // min metres between two dares (Freddy: never too many in a row) // distance and how much harder (shorter) or easier (longer)
const OFFER_S = 14, LEAD = 150;

/** speed (m/s) that power W gives on grade g: steady state, by bisection */
export function paceFor(W, g, p) { let a = 0.5, b = 25; for (let i = 0; i < 32; i++) { const m = (a + b) / 2; if (powerFor(m, g, p) > W) b = m; else a = m; } return (a + b) / 2; }

export class Challenges {
  /** n challenges spread over the ride; has(models) tells which challengers the world can show */
  constructor({ length, startD, n, ftp, params, gradeAt, has = () => true, rng = Math.random }) {
    Object.assign(this, { length, ftp, params, gradeAt });
    this.list = []; this.stats = { offered: 0, accepted: 0, won: 0 };
    const who = CHALLENGERS.filter(c => has(c.models)), from = startD + Math.max(1200, length * 0.06), to = length - 1800;
    if (!who.length || n <= 0 || to - from < 2500) return;
    n = Math.min(n, Math.floor((to - from) / GAP)); if (n <= 0) return; // room for a race between two dares
    const span = (to - from) / n;
    const deck = [...who].sort(() => rng() - 0.5); // every challenger once before anyone comes twice
    for (let i = 0; i < n; i++) {
      const c = deck[i % deck.length], [D, dk] = DIST[Math.floor(rng() * DIST.length)];
      const W = Math.round(ftp * (c.k + dk) / 5) * 5;
      this.list.push({ c, at: from + span * i + Math.max(0, span - GAP + 600) * rng() + 100, D, W, state: 'wait' });
    }
  }
  get active() { return this.list.find(x => x.state === 'offer' || x.state === 'count' || x.state === 'race'); }

  /** per tick: d = your position, power = your watts now. Returns events [{type, ch}] for the HUD and the world. */
  tick(dt, d, power, accept = false, v = 0) {
    const ev = [], x = this.active;
    if (!x) {
      for (const y of this.list) if (y.state === 'wait' && d > y.at - 40) y.state = 'skipped'; // passed during another race: never offered from behind
      const n = this.list.find(y => y.state === 'wait' && d >= y.at - LEAD);
      if (n) { n.state = 'offer'; n.t = 0; n.hold = 0; n.spot = n.at; n.base = power; this.stats.offered++; ev.push({ type: 'offer', ch: n }); }
      return ev;
    }
    x.t += dt;
    if (x.state === 'offer') {
      x.hold = power >= Math.max(x.W * 0.9, x.base * 1.15) ? x.hold + dt : 0; // a kick: well above what you rode when the dare came
      if (accept || x.hold >= 1.5) { x.state = 'count'; x.t = 0; this.stats.accepted++; ev.push({ type: 'accept', ch: x }); }
      else if (x.t > OFFER_S || d > x.spot + 25) { x.state = 'gone'; ev.push({ type: 'expire', ch: x }); }
    } else if (x.state === 'count') {
      if (d >= x.spot - 30 && x.t0 == null) x.t0 = x.t; // the start line is where the challenger waits: 3-2-1 on the last metres
      if (x.t0 != null && x.t - x.t0 >= 3) { x.state = 'race'; x.t = 0; x.start = d; x.finish = Math.min(this.length - 20, d + x.D); x.opp = d; x.ov = v; x.work = 0; ev.push({ type: 'go', ch: x }); }
    } else if (x.state === 'race') {
      // the challenger is a rider of your weight holding exactly the target from the speed you had at the start:
      // same physics, so riding the target is a dead heat, every watt more wins metres
      x.ov = physStep(x.ov, x.W, this.gradeAt(x.opp), dt, this.params); x.opp += x.ov * dt; x.work += power * dt;
      x.avg = x.work / Math.max(0.1, x.t);
      if (d >= x.finish || x.opp >= x.finish) {
        x.won = d >= x.finish && (x.opp < x.finish || d - x.finish >= x.opp - x.finish);
        x.state = 'done'; if (x.won) this.stats.won++;
        ev.push({ type: x.won ? 'win' : 'lose', ch: x });
      }
    }
    return ev;
  }
  /** the line for the HUD card */
  /** everything about challenges lives in ONE panel at the left edge, mirrored to the grade on the right (Freddy 12.11.):
   *  the next one coming, the dare, the countdown, the race (target watts + your watts as a bar + metres to go) */
  card(d) {
    const x = this.active;
    if (!x) { const n = this.list.find(y => y.state === 'wait' && y.at > d); if (!n || n.at - d > 5000) return null;
      return { kind: 'next', name: n.c.name, left: n.at - LEAD - d }; }
    if (x.state === 'offer') return { kind: 'offer', name: x.c.name, W: x.W, D: x.D, t: 1 - x.t / OFFER_S, hold: Math.min(1, x.hold / 1.5) };
    if (x.state === 'count') return x.t0 == null ? { kind: 'count', name: x.c.name, W: x.W, D: x.D, left: Math.max(0, x.spot - d) }
      : { kind: 'count', name: x.c.name, W: x.W, D: x.D, n: Math.max(1, 3 - Math.floor(x.t - x.t0)) };
    // the race: the gap itself you see on the road (the challenger is drawn where it really is)
    return { kind: 'race', name: x.c.name, W: x.W, left: Math.max(0, x.finish - d), lead: d - x.opp >= 0 };
  }
}
const fmtD = m => m >= 1000 ? (m / 1000).toFixed(m % 1000 ? 1 : 0).replace('.', ',') + ' km' : Math.round(m) + ' m';
