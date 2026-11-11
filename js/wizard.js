// The wizard: a rare encounter on free rides. Announced 1 km ahead, he stands in the middle of the road, vanishes in a
// cloud of sparks as you reach him and casts his trial: hold a wattage from your FTP for a minute.
// Pass and he lets you fly over the island for 30 s; fail and the ground tears open: five minutes of hell.
export const WIZ = { ann: 1000, near: 200, cast: 15, hold: 60, fly: 30, hell: 300, k: 1.2 };

export class Wizard {
  /** chance: probability that this ride has a wizard at all; avoid(d) = true where something else is planned */
  constructor({ length, startD, ftp, chance = 0.35, force = false, avoid = () => false, rng = Math.random }) {
    this.state = 'off'; this.ftp = ftp;
    if (length - startD < 6000 || !(force || rng() < chance)) return;
    for (let k = 0; k < 20; k++) {
      const at = force ? startD + 1500 : startD + (length - startD) * (0.3 + rng() * 0.45);
      if (force || !avoid(at)) { this.at = at; break; }
    }
    if (!this.at || this.at > length - 4000) return;
    this.W = Math.round(ftp * WIZ.k / 5) * 5; this.state = 'wait';
  }
  get busy() { return this.state === 'cast' || this.state === 'fly' || this.state === 'hell' || this.state === 'near'; }
  /** events: ann, near, cast, pass, fail, end */
  tick(dt, d, power) {
    const ev = [];
    if (this.state === 'wait' && d >= this.at - WIZ.ann) { this.state = 'ann'; ev.push('ann'); }
    else if (this.state === 'ann' && d >= this.at - WIZ.near) { this.state = 'near'; ev.push('near'); }
    else if (this.state === 'near' && d >= this.at - WIZ.cast) { this.state = 'cast'; this.t = 0; this.work = 0; ev.push('cast'); }
    else if (this.state === 'cast') {
      this.t += dt; this.work += power * dt; this.avg = this.work / Math.max(1, this.t);
      if (this.t >= WIZ.hold) { const ok = this.avg >= this.W * 0.97; this.state = ok ? 'fly' : 'hell'; this.t = 0; ev.push(ok ? 'pass' : 'fail'); }
    } else if (this.state === 'fly' || this.state === 'hell') {
      this.t += dt; if (this.t >= (this.state === 'fly' ? WIZ.fly : WIZ.hell)) { this.was = this.state; this.state = 'done'; ev.push('end'); }
    }
    return ev;
  }
  card(d) {
    const s = this.state;
    if (s === 'ann' || s === 'near') return { title: 'Ein Zauberer erwartet dich', big: `${Math.max(0, Math.round((this.at - d) / 10) * 10)} m`, sub: `Seine Prüfung: ${this.W} W für ${WIZ.hold} s` };
    if (s === 'cast') return { title: 'Die Prüfung des Zauberers', big: `${Math.ceil(WIZ.hold - this.t)} s`, sub: `Ziel ${this.W} W · Ø ${Math.round(this.avg || 0)} W`, bar: this.t / WIZ.hold, lead: (this.avg || 0) >= this.W * 0.97 };
    if (s === 'fly') return { title: 'Bestanden!', big: 'Du fliegst', sub: 'Der Zauberer schenkt dir den Himmel' };
    if (s === 'hell') return { title: 'Durchgefallen', big: `${Math.ceil((WIZ.hell - this.t) / 60)} min Hölle`, sub: 'Fahr dich hier wieder raus', bar: this.t / WIZ.hell, lead: false };
    return null;
  }
}
