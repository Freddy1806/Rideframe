// The wizard: a rare encounter on free rides. Announced 1 km ahead, he stands in the middle of the road, vanishes in a
// cloud of sparks as you reach him and casts his trial: hold a wattage from your FTP for a minute.
// Pass and he lets you fly over the island for 30 s; fail and the ground tears open: five minutes of hell.
export const WIZ = { ann: 1000, near: 200, cast: 15, hold: 60, fly: 30, hell: 300, k: 1.2 };

export class Wizard {
  /** chance: probability that this ride has a wizard at all; avoid(d) = true where something else is planned */
  constructor({ length, startD, ftp, chance = 0.35, force = false, avoid = () => false, rng = Math.random, workout = 0, timed = 0 }) {
    this.state = 'off'; this.ftp = ftp;
    // free ride alone (owner 19.11.: "der Wizard auf jeden Fall in den ersten 30 Minuten"): no spot on the road either; the ride
    // calls him once `timed` seconds are ridden (js/ride.js _wizTick), early enough that his trial is over by minute 30
    if (timed > 0) { this.timed = true; this.at = Infinity; this.armAt = timed; this.W = Math.round(ftp * WIZ.k / 5) * 5; this.state = 'wait'; return; }
    // in a workout (owner 17.11.): no spot on the road; from armAt (s, 30–75 % into the workout) he is called inside the next
    // hard interval with time left for his trial (ivgate.js wizardGate), and his target is that interval's target
    if (workout > 0) { if (!(force || rng() < chance)) return; this.wk = true; this.at = Infinity; this.armAt = force ? 0 : workout * (0.3 + rng() * 0.45); this.W = Math.round(ftp * WIZ.k / 5) * 5; this.state = 'wait'; return; }
    if (length - startD < 6000 || !(force || rng() < chance)) return;
    for (let k = 0; k < 20; k++) {
      const at = force ? startD + 1500 : startD + (length - startD) * (0.3 + rng() * 0.45);
      if (force || !avoid(at)) { this.at = at; break; }
    }
    if (!this.at || this.at > length - 4000) return;
    this.W = Math.round(ftp * WIZ.k / 5) * 5; this.state = 'wait';
  }
  /** call him now, gap metres ahead (workout interval, or a friend in the group met him) */
  summon(d, gap) { if (this.state !== 'wait' && this.state !== 'ann') return; this.at = d + gap; this.state = 'wait'; }
  /** the interval ends before his trial could start: he leaves and waits for the next one; returns his figure to remove */
  dismiss() { const h = this.h; this.h = null; this.at = Infinity; this.state = 'wait'; return h; }
  get busy() { return this.state === 'cast' || this.state === 'fly' || this.state === 'hell' || this.state === 'near'; }
  /** events: ann, near, cast, pass, fail, end */
  /** W: the target right now when it is not his own (workout: the interval target incl. the rider's offset) */
  tick(dt, d, power, W = 0) {
    if (W > 0 && this.state !== 'cast') this.W = Math.round(W);
    const ev = [];
    if (this.state === 'wait' && d >= this.at - WIZ.ann) { this.state = 'ann'; ev.push('ann'); }
    else if (this.state === 'ann' && d >= this.at - WIZ.near) { this.state = 'near'; ev.push('near'); }
    else if (this.state === 'near' && d >= this.at - WIZ.cast) { this.state = 'cast'; this.t = 0; this.work = 0; this.tw = 0; ev.push('cast'); }
    else if (this.state === 'cast') {
      if (W > 0) this.W = Math.round(W); // the rider tunes his interval: the trial follows, judged against the average target
      this.t += dt; this.work += power * dt; this.tw += this.W * dt; this.avg = this.work / Math.max(1, this.t); this.tgt = this.tw / Math.max(1e-6, this.t);
      if (this.t >= WIZ.hold) { const ok = this.avg >= this.tgt * 0.97; this.pct = Math.round(this.avg / this.tgt * 100); this.state = ok ? 'fly' : 'hell'; this.t = 0; ev.push(ok ? 'pass' : 'fail'); }
    } else if (this.state === 'fly' || this.state === 'hell') {
      this.t += dt; if (this.t >= (this.state === 'fly' ? WIZ.fly : WIZ.hell)) { this.was = this.state; this.state = 'done'; ev.push('end'); }
    }
    return ev;
  }
  card(d) {
    const s = this.state;
    if (s === 'ann' || s === 'near') return { title: 'A Wizard awaits you', big: `${Math.max(0, Math.round((this.at - d) / 10) * 10)} m`, sub: `His test: ${this.W} W for ${WIZ.hold} s` };
    if (s === 'cast') return { title: 'The Wizard’s test', big: `${Math.ceil(WIZ.hold - this.t)} s`, sub: `Target ${this.W} W · avg ${Math.round(this.avg || 0)} W${this.tgt ? ` · ${Math.round((this.avg || 0) / this.tgt * 100)} %` : ''}`, bar: this.t / WIZ.hold, lead: (this.avg || 0) >= (this.tgt || this.W) * 0.97 };
    if (s === 'fly') return { title: 'Passed!', big: 'You fly', sub: 'The Wizard gives you the sky' };
    if (s === 'hell') return { title: 'Failed', big: `${Math.ceil((WIZ.hell - this.t) / 60)} min of hell`, sub: 'Ride your way back out', bar: this.t / WIZ.hell, lead: false };
    return null;
  }
}
