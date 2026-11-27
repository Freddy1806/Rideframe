// RIDEFRAME on a Garmin watch, 23.11.: the indoor trainer (ERG) as pure state machines, no Bluetooth, no DOM. garmin/source/Trainer.mc
// is the same code in Monkey C, one function per function; js/watchflow.js drives it (screens TSCAN, TREC, TEND, TSUM) and
// tools/watchtrainer-test.mjs tests it. The protocol is the one js/trainer.js speaks over Web Bluetooth:
//   FTMS (0x1826): Indoor Bike Data 0x2AD2 (notify), Fitness Machine Control Point 0x2AD9 (write with response + indicate):
//     0x00 request control, 0x07 start / resume, 0x05 + watts (uint16 LE) = ERG target; answers 0x80, op, result (0x01 = ok).
//   Wahoo fallback (Cycling Power 0x1818 + a026e005-0a7d-4ab3-97fa-f1500f9feb8b): Cycling Power Measurement 0x2A63 (notify),
//     unlock 0x20 0xEE 0xFC, ERG 0x42 + watts LE.
// The link: L (newLink) takes BLE events (bleEv: found, conn, drop, done, ind) and the 200 ms tick, and puts what the radio must do
// into L.act: { k: 'scan', on }, { k: 'pair', name }, { k: 'unpair' }, { k: 'cccd', ch, v: [1, 0] | [2, 0] }, { k: 'write', ch, v }.
// Channels: 'ibd' (0x2AD2), 'fcp' (0x2AD9), 'cpm' (0x2A63), 'wcp' (Wahoo). One GATT operation at a time (Connect IQ throws
// "Operation already in progress" otherwise): setup steps wait in L.q, the next one starts on 'done' (or a 3 s timeout).
// Latest wins: an ERG target is never queued. L.tgt is what the rider wants; when nothing is under way and the trainer has not
// got L.tgt yet, exactly one write goes out (so a burst of +5 presses = at most one write in flight, then the newest value).
// Time is in seconds (the watch: Time.now(), whole seconds; the preview: Date.now() / 1000).

export const W_MIN = 30, W_MAX = 1000, W_START = 100, W_PAUSE = 30, HOLD_W = 25, STEPS = [5, 10, 25];
/** GATT operation timeout, connect timeout, re-pair cycle while lost, control retry while refused, data older than this = 0 */
export const OP_S = 3, CONN_S = 12, REPAIR_S = 15, CTL_S = 5, DATA_S = 3;
export const LST = { OFF: 'off', SCAN: 'scan', CONN: 'conn', SETUP: 'setup', READY: 'ready', REFUSED: 'refused', LOST: 'lost' };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const le = w => [w & 255, (w >> 8) & 255];

/** a fresh link; want = the trainer used last (its advertised name): connected by itself when the scan sees it */
export function newLink(want = '') {
  return { st: LST.OFF, list: [], name: '', want: want || '', mode: '', ever: false, q: [], op: null, opAt: 0, erg: false, tgt: W_START, sent: -1, ctl: false,
    pw: 0, cad: 0, at: -1e9, crank: null, cadAt: -1e9, icAt: -1e9, ccAt: -1e9, t0: 0, setAt: 0, lostAt: 0, ctlAt: 0, act: [] };
}
function act(L, a) { L.act.push(a); }
/** start searching: FTMS trainers, else Cycling Power devices with a name */
export function scan(L, now) { L.st = LST.SCAN; L.list = []; L.t0 = now; act(L, { k: 'scan', on: true }); }
/** connect to the trainer of the list with this name */
export function connect(L, name, now) { act(L, { k: 'scan', on: false }); act(L, { k: 'pair', name }); L.name = name; L.st = LST.CONN; L.t0 = now; }
/** let it go (finish, discard, BACK): the laptop or the Wahoo app may take it then */
export function stop(L) {
  if (L.st === LST.SCAN || L.st === LST.LOST) act(L, { k: 'scan', on: false });
  if (L.st !== LST.OFF && L.st !== LST.SCAN) act(L, { k: 'unpair' });
  L.st = LST.OFF; L.q = []; L.op = null; L.erg = false; L.sent = -1; L.ctl = false; L.ever = false; L.pw = 0; L.cad = 0; L.list = [];
}
/** the rider's target (the flow keeps it inside 30..1000 W, pause sends W_PAUSE): goes out when the line is free, the newest wins.
 *  Nothing is sent before the first target (connected on the list = no ERG yet). */
export function setTarget(L, w, now) { L.tgt = clamp(Math.round(w), 0, 2000); L.erg = true; pump(L, now); }
/** the trainer has the target the rider wants (or there is nothing to control) */
export const applied = L => !L.ctl || L.sent === L.tgt && !(L.op && L.op.k === 'tgt');
/** the live values, 0 when the trainer has been silent for DATA_S */
export const live = (L, now) => now - L.at > DATA_S ? { pw: 0, cad: 0 } : { pw: L.pw, cad: L.cad };
/** 28.11. (the owner saw no cadence on his KICKR CORE 2): a cadence value came in the last DATA_S s (FTMS Indoor Bike Data with the
 *  cadence field, or Cycling Power crank revolutions); without one the screens show "--", not a 0 that looks like "not pedalling" */
export const hasCad = (L, now) => now - L.cadAt <= DATA_S;
/** what the screens say: 'scan' | 'conn' | 'ready' | 'refused' | 'lost' (connecting again after it had worked) | 'off' */
export function shown(L) {
  if (L.ever && (L.st === LST.LOST || L.st === LST.CONN || L.st === LST.SETUP)) return 'lost';
  return L.st === LST.SETUP ? 'conn' : L.st;
}

/** the next GATT operation: a setup step from the queue, else the newest target when the trainer does not have it yet */
function pump(L, now) {
  if (L.op) return;
  if (L.q.length) { L.op = L.q.shift(); L.opAt = now; act(L, L.op.k === 'cccd' ? { k: 'cccd', ch: L.op.ch, v: L.op.v } : { k: 'write', ch: L.op.ch, v: L.op.v }); return; }
  if (!L.erg || L.st !== LST.READY || !L.ctl || (L.mode !== 'ftms' && L.mode !== 'wahoo') || L.tgt === L.sent) return;
  const w = L.tgt, v = [L.mode === 'ftms' ? 0x05 : 0x42, ...le(w)], ch = L.mode === 'ftms' ? 'fcp' : 'wcp';
  L.op = { k: 'tgt', ch, v, w }; L.opAt = now; L.sent = w; act(L, { k: 'write', ch, v });
}
const step = (k, ch, v) => ({ k, ch, v });
/** connected: subscribe, take control, start; the target goes out again by itself (sent = -1) */
function setup(L, e, now) {
  L.st = LST.SETUP; L.setAt = now; L.sent = -1; L.ctl = false; L.op = null; L.crank = null;
  L.mode = e.ftms ? 'ftms' : e.wahoo ? 'wahoo' : 'pm';
  // 28.11.: an FTMS trainer that also has Cycling Power: its measurement too (after control), for the crank revolutions: a KICKR may send
  // no cadence (or 0) in Indoor Bike Data and the cadence only there; a failed subscription is no data from it, the ride goes on
  if (L.mode === 'ftms') { L.q = [step('cccd', 'ibd', [1, 0]), step('cccd', 'fcp', [2, 0]), step('write', 'fcp', [0x00]), step('write', 'fcp', [0x07])]; if (e.cps) L.q.push(step('cccd', 'cpm', [1, 0])); }
  else if (L.mode === 'wahoo') L.q = [step('cccd', 'cpm', [1, 0]), step('cccd', 'wcp', [2, 0]), step('write', 'wcp', [0x20, 0xee, 0xfc])];
  else L.q = [step('cccd', 'cpm', [1, 0])];
  pump(L, now);
}
function ready(L) { L.st = LST.READY; L.ever = true; L.want = L.name; }
/** the trainer did not take the last command: say so, ask for control again later, send the target again */
function refused(L, now) { L.st = LST.REFUSED; L.ctl = false; L.sent = -1; L.ctlAt = now + CTL_S; }
function lost(L, now) { L.st = LST.LOST; L.lostAt = now; L.q = []; L.op = null; L.sent = -1; L.ctl = false; L.pw = 0; L.cad = 0; L.crank = null; }

/** one event from the radio:
 *  { k: 'found', list: [{ name, ftms, cps, rssi }] }    scan results (only trainers: FTMS, or Cycling Power with a name)
 *  { k: 'conn', ftms, wahoo }                            connected, which services the trainer has
 *  { k: 'drop' }                                         disconnected (or the pairing failed)
 *  { k: 'done', ok }                                     the operation under way finished (onDescriptorWrite / onCharacteristicWrite)
 *  { k: 'ind', ch, v }                                   a notification / indication (onCharacteristicChanged) */
export function bleEv(L, now, e) {
  if (!e) return;
  if (e.k === 'found') {
    if (L.st !== LST.SCAN && L.st !== LST.LOST) return;
    for (const d of e.list || []) {
      if (!d || !d.name || !(d.ftms || d.cps)) continue;
      const o = L.list.find(x => x.name === d.name); if (o) { o.rssi = d.rssi; o.ftms = o.ftms || !!d.ftms; } else L.list.push({ name: d.name, ftms: !!d.ftms, rssi: d.rssi | 0 });
    }
    L.list.sort((a, b) => b.ftms - a.ftms || b.rssi - a.rssi);
    const want = L.st === LST.LOST ? L.name : L.want; // lost: only the trainer of this ride; scan: the one used last
    if (want && L.list.some(x => x.name === want)) connect(L, want, now);
    return;
  }
  if (e.k === 'conn') { if (L.st === LST.CONN || L.st === LST.LOST) setup(L, e, now); return; }
  if (e.k === 'drop') { if (L.st === LST.CONN || L.st === LST.SETUP || L.st === LST.READY || L.st === LST.REFUSED) { if (L.ever) lost(L, now); else { act(L, { k: 'unpair' }); scan(L, now); } } return; }
  if (e.k === 'done') { done(L, now, !!e.ok); return; }
  if (e.k === 'ind') {
    const v = e.v || [];
    if (e.ch === 'fcp' && v[0] === 0x80 && v.length >= 3) {
      if (v[1] === 0x00) { if (v[2] === 0x01) { L.ctl = true; if (L.st === LST.SETUP || L.st === LST.REFUSED) ready(L); } else refused(L, now); }
      else if (v[1] === 0x05) { if (v[2] === 0x01) { if (L.st === LST.REFUSED) { L.ctl = true; ready(L); } } else refused(L, now); }
      pump(L, now);
    } else if (e.ch === 'ibd') ibd(L, v, now);
    else if (e.ch === 'cpm') cpm(L, v, now);
  }
}
/** the operation under way is over; a failed one: a target or the control request = refused, a subscription = no data from it */
function done(L, now, ok) {
  const o = L.op; if (!o) return; L.op = null;
  if (!ok && (o.k === 'tgt' || (o.ch === 'fcp' && o.v[0] === 0x00) || (o.ch === 'wcp' && o.v[0] === 0x20))) { L.q = []; refused(L, now); }
  if (L.st === LST.SETUP && !L.q.length && !L.op && L.mode !== 'ftms' && ok) { L.ctl = L.mode === 'wahoo'; ready(L); } // Wahoo / power only: no answer to wait for
  pump(L, now);
}
/** every 200 ms: timeouts, the control retry, the reconnect cycle */
export function linkTick(L, now) {
  if (L.op && now - L.opAt > OP_S) done(L, now, false);
  if (L.st === LST.CONN && now - L.t0 > CONN_S) { act(L, { k: 'unpair' }); if (L.ever) lost(L, now); else { L.want = ''; scan(L, now); } } // a first connect that hangs: back to the list
  // FTMS without an indication of the control request (VERIFY on the KICKR Core 2): the writes went through, so take it as control
  if (L.st === LST.SETUP && L.mode === 'ftms' && !L.q.length && !L.op && now - L.setAt > OP_S) { L.ctl = true; ready(L); }
  if (L.st === LST.REFUSED && L.mode === 'ftms' && !L.op && !L.q.length && now >= L.ctlAt) { L.ctlAt = now + CTL_S; L.q = [step('write', 'fcp', [0x00]), step('write', 'fcp', [0x07])]; }
  if (L.st === LST.REFUSED && L.mode === 'wahoo' && !L.op && !L.q.length && now >= L.ctlAt) { L.ctlAt = now + CTL_S; L.q = [step('write', 'wcp', [0x20, 0xee, 0xfc])]; L.ctl = true; L.st = LST.READY; }
  // lost: the watch reconnects a paired device by itself (VERIFY); if it is not back in REPAIR_S, pair it again from a new scan
  if (L.st === LST.LOST && now - L.lostAt >= REPAIR_S) { L.lostAt = now; L.list = []; act(L, { k: 'unpair' }); act(L, { k: 'scan', on: true }); }
  pump(L, now);
}

/* ---- the trainer's data ---- */
const u16 = (v, o) => (v[o] | 0) + ((v[o + 1] | 0) << 8);
const s16 = (v, o) => { const x = u16(v, o); return x >= 32768 ? x - 65536 : x; };
/** FTMS Indoor Bike Data (0x2AD2): flags, then the fields that are there; power and cadence are what the watch needs */
export function ibd(L, v, now) {
  if (v.length < 2) return; const f = u16(v, 0); let o = 2;
  if (!(f & 0x0001)) o += 2;                                   // instantaneous speed
  if (f & 0x0002) o += 2;                                      // average speed
  if (f & 0x0004) { if (o + 1 < v.length) { const c = Math.round(u16(v, o) / 2); if (c > 0 || now - L.ccAt > DATA_S) L.cad = c; if (c > 0) L.icAt = now; L.cadAt = now; } o += 2; } // cadence, 0.5 rpm; a 0 does not hide the crank's
  if (f & 0x0008) o += 2;                                      // average cadence
  if (f & 0x0010) o += 3;                                      // total distance
  if (f & 0x0020) o += 2;                                      // resistance level
  if (f & 0x0040) { if (o + 1 < v.length) L.pw = Math.max(0, s16(v, o)); o += 2; } // instantaneous power
  L.at = now;
}
/** Cycling Power Measurement (0x2A63): power, and the cadence from the crank revolutions when they are there */
export function cpm(L, v, now) {
  if (v.length < 4) return; const f = u16(v, 0); let o = 4;
  if (L.mode !== 'ftms') L.pw = Math.max(0, s16(v, 2)); // 28.11.: an FTMS trainer's power comes from Indoor Bike Data, here only its cadence
  if (f & 0x01) o += 1; if (f & 0x04) o += 2; if (f & 0x10) o += 6;
  if (f & 0x20 && o + 3 < v.length) { // crank revolutions (uint16, wrap) and the last crank event (uint16, 1/1024 s, wrap)
    const revs = u16(v, o), t = u16(v, o + 2), c = L.crank, use = L.mode !== 'ftms' || now - L.icAt > DATA_S;
    if (c) { const dr = (revs - c.revs + 65536) % 65536, dt = ((t - c.t + 65536) % 65536) / 1024; L.ccAt = now; if (use) L.cadAt = now;
      if (dt > 0) { if (use) L.cad = Math.round(dr / dt * 60); } else if (now - c.at > 2.5 && use) L.cad = 0; }
    if (!c || revs !== c.revs) L.crank = { revs, t, at: now };
  }
  L.at = now;
}

/* ---- the ride: target, steps, one second of data, the stats page, the summary, the upload ---- */
/** the series sent with the upload: one value per dt seconds (10 s), at most SER_MAX; when full, two become one and dt doubles */
export const SER_DT = 10, SER_MAX = 240;
export function newRide(now, tgt) {
  return { st: 'run', start: Math.round(now), ts: Math.floor(now), t: 0, tgt: clamp(tgt || W_START, W_MIN, W_MAX), step: STEPS[0], pg: 0,
    pwSum: 0, pwMax: 0, cadSum: 0, cadN: 0, hrSum: 0, hrN: 0, hrMax: 0, kj: 0, p30: [], np4: 0, npN: 0, bT0: 0, bSum: 0, bN: 0,
    dt: SER_DT, s: { pw: [], cad: [], hr: [], tgt: [] }, a: { pw: 0, cad: 0, hr: 0, tgt: 0, n: 0 },
    bw: new Array(BEST_N).fill(0), bwI: 0, b30: 0, b60: 0, b300: 0, best30: 0, best60: 0, best300: 0, zb: null, zs: [0, 0, 0, 0, 0] };
}
/** 27.11.4: the summary's numbers are kept second by second (a 4 h ride is 14400 seconds; nothing is scanned at the end): the best 30 s,
 *  1 min and 5 min power from a ring of the last BEST_N seconds (three running sums), the seconds in the five heart rate zones (R.zb: the
 *  profile's cycling zones, hrZones), and per interval / set in the workout (wkRec) */
export const BEST_N = 300;
/** the profile's heart rate zones (Garmin UserProfile.getHeartRateZones: min zone 1, max zone 1 ... max zone 5) when they are 6 rising
 *  numbers 30..250, else null (then the summary shows no zones: nothing guessed) */
export function hrZones(z) {
  if (!Array.isArray(z) || z.length < 6) return null; const r = [];
  for (let i = 0; i < 6; i++) { if (typeof z[i] !== 'number') return null; const v = Math.round(z[i]); if (v < 30 || v > 250 || (i > 0 && v <= r[i - 1])) return null; r.push(v); }
  return r;
}
/** a target a step on (d = +1 / -1, big = UP / DOWN held), on the step grid, inside 30..1000 W */
export function nextTarget(R, d, big) { return nextBy(R.tgt, d, big ? Math.max(R.step, HOLD_W) : R.step); }
/** 27.11.5: w a step of k W on (d > 0) or back, on the grid of k, inside W_MIN..W_MAX */
export function nextBy(w, d, k) { return clamp(d > 0 ? Math.floor(w / k) * k + k : Math.ceil(w / k) * k - k, W_MIN, W_MAX); }
/** the step size on a tap on the target: 5 -> 10 -> 25 -> 5 */
export const nextStep = s => STEPS[(STEPS.indexOf(s) + 1) % STEPS.length];
/** a new target starts a new block (the stats page: time and average power since the last change) */
export function newBlock(R) { R.bT0 = R.t; R.bSum = 0; R.bN = 0; }
/** one second of riding (not while paused): pw, cad from the trainer, hr from the watch */
export function rideSec(R, pw, cad, hr) {
  R.t++; R.pwSum += pw; R.pwMax = Math.max(R.pwMax, pw); R.kj += pw / 1000; R.bSum += pw; R.bN++;
  if (cad > 0) { R.cadSum += cad; R.cadN++; }
  if (hr > 0) { R.hrSum += hr; R.hrN++; R.hrMax = Math.max(R.hrMax, hr); }
  R.p30.push(pw); if (R.p30.length > 30) R.p30.shift();
  if (R.p30.length === 30) { const m = R.p30.reduce((a, b) => a + b, 0) / 30; R.np4 += m * m * m * m; R.npN++; }
  // 27.11.4: the best 30 s / 1 min / 5 min: the values 30, 60, 300 s ago leave the sums (the ring starts as zeros, so no count is needed)
  const o30 = R.bw[(R.bwI + 270) % BEST_N], o60 = R.bw[(R.bwI + 240) % BEST_N], o300 = R.bw[R.bwI];
  R.bw[R.bwI] = pw; R.bwI = (R.bwI + 1) % BEST_N; R.b30 += pw - o30; R.b60 += pw - o60; R.b300 += pw - o300;
  if (R.t >= 30 && R.b30 > R.best30) R.best30 = R.b30;
  if (R.t >= 60 && R.b60 > R.best60) R.best60 = R.b60;
  if (R.t >= 300 && R.b300 > R.best300) R.best300 = R.b300;
  const z = R.zb; if (hr > 0 && z) { const q = hr > z[4] ? 4 : (hr > z[3] ? 3 : (hr > z[2] ? 2 : (hr > z[1] ? 1 : (hr >= z[0] ? 0 : -1)))); if (q >= 0) R.zs[q]++; }
  const a = R.a; a.pw += pw; a.cad += cad; a.hr += hr; a.tgt += R.tgt; a.n++;
  if (a.n >= R.dt) { for (const k of ['pw', 'cad', 'hr', 'tgt']) { R.s[k].push(Math.round(a[k] / a.n)); a[k] = 0; } a.n = 0; if (R.s.pw.length > SER_MAX) halve(R); }
}
/** the series is full: neighbours averaged (an odd last value stays), dt doubles */
function halve(R) {
  for (const k of ['pw', 'cad', 'hr', 'tgt']) { const x = R.s[k], y = []; for (let i = 0; i < x.length; i += 2) y.push(i + 1 < x.length ? Math.round((x[i] + x[i + 1]) / 2) : x[i]); R.s[k] = y; }
  R.dt *= 2;
}
/** the summary: time, avg / max power, NP, avg cadence, avg / max heart rate, kJ */
export function rideSum(R) {
  return { t: R.t, avgPw: R.t ? Math.round(R.pwSum / R.t) : 0, maxPw: R.pwMax, np: R.npN ? Math.round(Math.pow(R.np4 / R.npN, .25)) : 0, cad: R.cadN ? Math.round(R.cadSum / R.cadN) : 0,
    hr: R.hrN ? Math.round(R.hrSum / R.hrN) : 0, maxHr: R.hrMax, kj: Math.round(R.kj), start: R.start,
    b30: R.t >= 30 ? Math.round(R.best30 / 30) : 0, b60: R.t >= 60 ? Math.round(R.best60 / 60) : 0, b300: R.t >= 300 ? Math.round(R.best300 / 300) : 0 };
}
/** POST /api/watch/activity for the ride (tools/watch-feed.mjs validateAct): a VirtualRide with power, cadence and the series */
export function rideBody(R, sum, id, now) {
  return { id, type: 'VirtualRide', start: R.start, duration: Math.max(1, Math.round(now - R.start)), moving: sum.t, dist: 0, climb: 0, hr: sum.hr, maxHr: sum.maxHr, kcal: sum.kj,
    power: sum.avgPw, maxPower: sum.maxPw, np: sum.np, kj: sum.kj, cad: sum.cad, s: { dt: R.dt, pw: R.s.pw.slice(), cad: R.s.cad.slice(), hr: R.s.hr.slice(), tgt: R.s.tgt.slice() } };
}

/* ---- 27.11.: a structured workout in ERG (garmin/source/Trainer.mc TWork, the same functions). The server sends the rider's ride
 *      workouts with the setup ("rides", tools/watch-api.mjs) in absolute watts: { id, n, s: [entry] }, an entry is a step
 *      [sec, watts, wattsEnd (ramp) | null, hard (1 / 0), label] or a repeat [n, [entry …], trim] (trim 1 = the last round leaves out
 *      its last entry: 13 × (30 s on + 15 s float) without the float after the 13th). The watch expands one workout when it starts
 *      (at most WK_STEPS steps) and steps through it by the ride's own clock (R.t: seconds ridden, so a pause keeps the place). ---- */
export const WK_STEPS = 400, WK_ADJ = 150, WK_FLOOR = 50, WK_SHORT = 60, WK_RI = 10, WK_RO = 5, WK_EASY = 100;
const wkLab = v => typeof v === 'string' ? v : '';
/** a step entry: [sec, w, w2, hard, label] with sec >= 1 (else it is a repeat or nothing) */
const isStep = e => Array.isArray(e) && e.length >= 2 && typeof e[1] === 'number';
const isRep = e => Array.isArray(e) && e.length >= 2 && typeof e[0] === 'number' && Array.isArray(e[1]);
/** the counter of a step inside repeats: "7/13" (the innermost), ", SET 2/3" for the one around it */
function wkCnt(ctx) {
  const k = ctx.length; if (!k) return '';
  return (ctx[k - 1][0] + 1) + '/' + ctx[k - 1][1] + (k > 1 ? ', SET ' + (ctx[k - 2][0] + 1) + '/' + ctx[k - 2][1] : '');
}
/** 28.11.: a step's kind, for its colour (the workout builder's step types, js/myworkouts.js STEP_TYPES): 1 work (hard), 2 warm-up (its label,
 *  or a ramp up), 3 cool-down (its label, or a ramp down), 0 recovery / rest / anything else easy */
export const WK_WORK = 1, WK_WARM = 2, WK_COOL = 3;
function wkKind(X, i) {
  const l = X.lab[i].toLowerCase();
  if (X.hard[i]) return WK_WORK;
  if (l.indexOf('warm') >= 0) return WK_WARM;
  if (l.indexOf('cool') >= 0) return WK_COOL;
  if (X.w2[i] >= 0) return X.w2[i] > X.w[i] ? WK_WARM : WK_COOL;
  return 0;
}
function wkAdd(X, l, ctx) {
  for (let j = 0; j < l.length; j++) {
    const e = l[j];
    if (X.dur.length >= WK_STEPS) return;
    if (isRep(e)) {
      const n = Math.max(0, Math.min(100, Math.round(e[0]))), sub = e[1], trim = e[2] === 1;
      for (let r = 0; r < n; r++) { ctx.push([r, n, X.rc++]); wkAdd(X, trim && r === n - 1 ? sub.slice(0, sub.length - 1) : sub, ctx); ctx.pop(); }
    } else if (isStep(e)) {
      const sec = Math.round(e[0]); if (!(sec >= 1 && sec <= 36000)) continue;
      X.dur.push(sec); X.w.push(Math.max(0, Math.min(2000, Math.round(e[1])))); X.w2.push(typeof e[2] === 'number' && e[2] >= 0 ? Math.min(2000, Math.round(e[2])) : -1);
      X.hard.push(e[3] === 1 || e[3] === true); X.lab.push(wkLab(e[4])); X.cnt.push(wkCnt(ctx)); X.kd.push(wkKind(X, X.dur.length - 1));
      X.sk.push(ctx.length >= 2 ? ctx[ctx.length - 2][2] : -1); // 27.11.4: the set it belongs to (the repeat round around its own repeat)
    }
  }
}
/** one workout from the server (or the built-in one), ready to ride: its steps as flat lists; null when it has no step */
export function newWk(def) {
  if (!def || !Array.isArray(def.s)) return null;
  const W = { id: String(def.id || ''), n: wkLab(def.n), dur: [], w: [], w2: [], hard: [], lab: [], cnt: [], kd: [], sk: [], rc: 0, tot: 0, i: 0, s0: 0, ha: 0, ea: 0, ri: WK_RI, ro: WK_RO };
  if (typeof def.ri === 'number') W.ri = Math.max(0, Math.round(def.ri));
  if (typeof def.ro === 'number') W.ro = Math.max(0, Math.round(def.ro));
  wkAdd(W, def.s, []);
  if (!W.dur.length) return null;
  for (let i = 0; i < W.dur.length; i++) W.tot += W.dur[i];
  wkUnits(W);
  return W;
}
/* ---- 27.11.4: the workout's intervals for the summary (garmin Trainer.mc TWork.units / rec / flush / close). An interval is a hard step of
 *      at least 5 s that is no warm-up, opener or spin (js/ivhistory.js: those are hard steps too, but no training to compare; under 5 s it
 *      counts nothing). A unit is a set (a workout whose intervals sit in two or more rounds of an outer repeat: 3 x 13 x 30/15), else one
 *      interval. Per second of the ride (wkRec): the power and target of the interval without its first IV_SKIP s (the trainer ramps
 *      the watts; intervals of at most 2 x IV_SKIP s count every second), the unit's peak heart rate (also over the HRR_S s after it) and
 *      its recovery: the drop of the heart rate in the HRR_S s after the unit's last interval (only where no hard step comes in that time) ---- */
export const IV_SKIP = 5, HRR_S = 60, REC_NONE = -999;
const wkPrep = l => /^(warm|opener|spin)/i.test(l);
function wkUnits(W) {
  const n = W.dur.length, keys = [];
  Object.assign(W, { un: [], uS: false, uEnd: [], uGap: [], uCnt: [], uPw: [], uPn: [], uTg: [], uHp: [], uRec: [], uDn: [], ivN: 0, ivD: 0, iw: [], it: [], iu: [],
    cPw: 0, cPn: 0, cTg: 0, cK: -1, recU: -1, recT: 0, recH: 0 });
  for (let k = 0; k < n; k++) {
    const on = W.hard[k] && W.dur[k] >= 5 && !wkPrep(W.lab[k]); W.un.push(on ? 0 : -1);
    if (on) { W.ivN++; if (W.sk[k] >= 0 && keys.indexOf(W.sk[k]) < 0) keys.push(W.sk[k]); }
  }
  W.uS = keys.length >= 2;
  let u = -1, last = -2;
  for (let k = 0; k < n; k++) {
    if (W.un[k] < 0) continue;
    const key = W.uS ? W.sk[k] : -1;
    if (u < 0 || key < 0 || key !== last) { u++; W.uEnd.push(0); W.uGap.push(0); W.uCnt.push(0); W.uPw.push(0); W.uPn.push(0); W.uTg.push(0); W.uHp.push(0); W.uRec.push(REC_NONE); W.uDn.push(0); }
    last = key; W.un[k] = u; W.uEnd[u] = k; W.uCnt[u]++;
  }
  for (let q = 0; q <= u; q++) { let g = 0, j = W.uEnd[q] + 1; while (j < n && !W.hard[j]) { g += W.dur[j]; j++; } W.uGap[q] = j >= n ? 99999 : g; }
}
/** one second of the ride (t = R.t after it was counted, before wkAt moves on: W.i is the step of this second), pw / hr ridden, tg the target */
export function wkRec(W, t, pw, hr, tg) {
  const u0 = W.recU;
  if (u0 >= 0) { if (hr > W.uHp[u0]) W.uHp[u0] = hr; if (t >= W.recT) { W.uRec[u0] = hr > 0 && W.recH > 0 ? W.recH - hr : REC_NONE; W.recU = -1; } }
  const k = W.i; if (k >= W.dur.length) return;
  const u = W.un[k]; if (u < 0) return;
  const into = t - W.s0;
  if (hr > W.uHp[u]) W.uHp[u] = hr;
  if (W.dur[k] <= 2 * IV_SKIP || into > IV_SKIP) { W.cPw += pw; W.cPn++; W.cTg += tg; W.uPw[u] += pw; W.uPn[u]++; W.uTg[u] += tg; }
  W.cK = k;
  if (into >= W.dur[k]) { // its last second
    wkFlush(W); W.ivD++; W.uDn[u]++;
    if (k === W.uEnd[u] && W.uGap[u] >= HRR_S) { W.recU = u; W.recH = hr; W.recT = t + HRR_S; }
  }
}
/** the interval under way into the lists (iw: its average watts, it: its average target, iu: its unit); nothing when no second counted */
function wkFlush(W) {
  if (W.cK >= 0 && W.cPn > 0) { W.iw.push(Math.round(W.cPw / W.cPn)); W.it.push(Math.round(W.cTg / W.cPn)); W.iu.push(W.un[W.cK]); }
  W.cPw = 0; W.cPn = 0; W.cTg = 0; W.cK = -1;
}
/** the ride ends: an interval under way counts as ridden in part (the last bar, iw.length > ivD), a recovery not yet 60 s old is none */
export function wkClose(W) { wkFlush(W); W.recU = -1; }
/** 27.11.4: the summary (js/watchflow.js tFinish, F.tsum; garmin tReport): o = rideSum + name, with the workout W (null = a free ride):
 *  wn, wt (s), wd (s ridden of it), ivN / ivD (intervals in it / done), uS (sets), uN / uD (units / done), per interval iw, it, iu, per unit
 *  uw, ut (average watts / target without the ramp seconds, 0 = not ridden), uhp (peak heart rate), urec (the drop, REC_NONE none);
 *  zs (seconds per zone, only with zones), hs (the heart rate series of the upload). 27.11.5: ivS / ivW the intervals' length (s) and
 *  target sent where all have the same (else 0), per unit udn / ucn its intervals done / in it (fewer done: cut short) */
export function rideReport(o, R, W) {
  if (R.zb) o.zs = R.zs.slice();
  o.hs = R.s.hr.slice();
  if (!W) { o.wn = ''; o.wt = 0; return o; }
  const nu = W.uCnt.length; let ud = 0; for (let u = 0; u < nu; u++) if (W.uDn[u] >= W.uCnt[u]) ud++;
  Object.assign(o, { wn: W.n, wt: W.tot, wd: Math.min(R.t, W.tot), ivN: W.ivN, ivD: W.ivD, uS: W.uS, uN: nu, uD: ud, iw: W.iw.slice(), it: W.it.slice(), iu: W.iu.slice(),
    uw: W.uPn.map((n, u) => n > 0 ? Math.round(W.uPw[u] / n) : 0), ut: W.uPn.map((n, u) => n > 0 ? Math.round(W.uTg[u] / n) : 0), uhp: W.uHp.slice(), urec: W.uRec.slice(),
    udn: W.uDn.slice(), ucn: W.uCnt.slice(), ivS: 0, ivW: W.it.length > 0 ? W.it[0] : 0 });
  for (let k = 0; k < W.dur.length; k++) if (W.un[k] >= 0) { if (o.ivS === 0) o.ivS = W.dur[k]; else if (W.dur[k] !== o.ivS) { o.ivS = -1; break; } }
  if (o.ivS < 0) o.ivS = 0;
  for (let k = 1; k < W.it.length; k++) if (W.it[k] !== o.ivW) { o.ivW = 0; break; }
  return o;
}
/** the step's own watts after into seconds (a ramp moves evenly from w to w2), without the rider's offset */
export function wkBase(W, i, into) {
  const a = W.w[i], b = W.w2[i]; if (b < 0) return a;
  const k = into <= 0 ? 0 : (into >= W.dur[i] ? 1 : into / W.dur[i]); return Math.round(a + (b - a) * k);
}
/** with the rider's offset (js/workouts.js workoutState W0): the hard one on hard steps, the easy one on the others, never below 50 W */
export function wkPlat(W, i, into) {
  const b = wkBase(W, i, into), d = W.hard[i] ? W.ha : W.ea;
  return d === 0 ? b : Math.max(WK_FLOOR, b + d);
}
/** moves the workout on to second t of the ride (forward only); W.i = W.dur.length when it is over */
export function wkAt(W, t) { while (W.i < W.dur.length && t >= W.s0 + W.dur[W.i]) { W.s0 += W.dur[W.i]; W.i++; } }
/** the target at second t (W.i is the step of t): the step's watts with the offset; a flat easy step next to a long hard one (more than
 *  WK_SHORT s) ramps into it over its last ri s and out of it over its first ro s; short efforts (30 / 15, sprints) jump */
export function wkTarget(W, t) {
  const i = W.i, n = W.dur.length; if (i >= n) return -1;
  const into = t - W.s0, left = W.dur[i] - into, p = wkPlat(W, i, into);
  if (W.hard[i] || W.w2[i] >= 0) return p;
  if (i + 1 < n && W.hard[i + 1] && W.dur[i + 1] > WK_SHORT && left < W.ri && W.ri > 0) { const a = wkPlat(W, i, W.dur[i]), b = wkPlat(W, i + 1, 0); return Math.round(a + (b - a) * (1 - left / W.ri)); }
  if (i > 0 && W.hard[i - 1] && W.dur[i - 1] > WK_SHORT && into < W.ro && W.ro > 0) { const a = wkPlat(W, i - 1, W.dur[i - 1]), b = wkPlat(W, i, 0); return Math.round(a + (b - a) * (into / W.ro)); }
  return p;
}
/** + / - in a workout (js/ride.js _wTune): d W on the hard offset in a hard step, else on the easy one; both stay for the rest of it */
export function wkTune(W, d) {
  if (W.i >= W.dur.length) return;
  const c = v => Math.max(-WK_ADJ, Math.min(WK_ADJ, v));
  if (W.hard[W.i]) W.ha = c(W.ha + d); else W.ea = c(W.ea + d);
}
/** the offset of the step now (the screen shows it when it is not 0) */
export const wkAdj = W => W.i < W.dur.length && W.hard[W.i] ? W.ha : W.ea;
/** seconds left in the step now and in the whole workout at second t */
export const wkLeft = (W, t) => W.i < W.dur.length ? W.s0 + W.dur[W.i] - t : 0;
export const wkTotLeft = (W, t) => Math.max(0, W.tot - t);
/** the easy watts after the end: the last step's end watts, at most WK_EASY */
export function wkEasy(W) { const k = W.dur.length - 1, b = wkBase(W, k, W.dur[k]); return Math.max(W_MIN, Math.min(WK_EASY, b)); }

/** 27.11. (the owner's session today, js/workouts.js c_30_15_3x13): built into the watch, so it can be ridden before the first sync.
 *  The ramps are % of the FTP the server sent last (setup "ftp"), else 250 W; the hard 30 s are WK_FB_HARD. 28.11. (the owner's new warm-up
 *  in js/workouts.js): a ramp 8 min 40 -> 75 %, a build ramp 3 min 75 -> 95 %, 2 min 130 W, openers 20 s at 300 / 335 / 370 W with 70 s
 *  at 130 W between, 190 s 130 W; then the sets as before (the coach review: 20 s, so only the 39 reps are 30 s hard). */
export const WK_FB_ID = 'c_30_15_3x13', WK_FB_HARD = 370;
export function wkFallback(ftp) {
  const f = ftp > 0 ? ftp : 250, p = x => Math.round(x * f / 100);
  return { id: WK_FB_ID, n: '30/15, 3 x 13', c: 'v', ri: 3, ro: 2, s: [[480, p(40), p(75), 0, 'Warm-up'], [180, p(75), p(95), 0, 'Build'], [120, 130, null, 0, 'Spin'],
    [20, 300, null, 1, 'Opener'], [70, 130, null, 0, 'Spin'], [20, 335, null, 1, 'Opener'], [70, 130, null, 0, 'Spin'], [20, WK_FB_HARD, null, 1, 'Opener'], [190, 130, null, 0, 'Spin'],
    [3, [[13, [[30, WK_FB_HARD, null, 1, '30/15'], [15, 125, null, 0, 'Float']], 1], [180, 130, null, 0, 'Rest']], 1],
    [600, p(50), p(35), 0, 'Cool-down']] };
}

/* ---- the server side (tools/watch-api.mjs): a workout of js/workouts.js shape in watts, made small ---- */
/** watch text: ASCII only (the watch fonts), "·" -> ",", "×" -> "x", no "|" (the screens' "long|short" variants), at most n characters */
export const wkTxt = (s, n) => String(s ?? '').replace(/·/g, ',').replace(/\|/g, '/').replace(/×/g, 'x').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim().slice(0, n).trim();
/** a label inside a repeat loses its counter (the watch counts): "30 / 15 · set 1 · 3/13" -> "30 / 15" */
export const wkStem = s => String(s ?? '').replace(/\s*\d+\/\d+\s*$/, '').replace(/[\s·]+$/, '').replace(/\s*·\s*set\s*\d+$/i, '').replace(/[\s·]+$/, '');
const LAB_N = 14;
/** flat steps [{ sec, w, w2 (null), hard, label }] -> entries with repeats ([n, [entry …], trim]), nested where a repeat repeats */
export function wkCompact(steps) {
  // neighbours that are the same flat step become one
  const flat = [];
  for (const s of steps) { const l = flat[flat.length - 1];
    if (l && l.w2 == null && s.w2 == null && l.w === s.w && l.hard === s.hard && l.label === s.label) l.sec += s.sec; else flat.push({ ...s }); }
  let items = flat.map(s => ({ e: [s.sec, s.w, s.w2 ?? null, s.hard ? 1 : 0, wkTxt(s.label, LAB_N)], k: JSON.stringify([s.sec, s.w, s.w2 ?? null, s.hard ? 1 : 0, wkStem(s.label)]), st: [s.sec, s.w, s.w2 ?? null, s.hard ? 1 : 0, wkTxt(wkStem(s.label), LAB_N)] }));
  for (let pass = 0; pass < 3; pass++) {
    const out = []; let i = 0, n = items.length, moved = false;
    const eq = (a, b, p) => { for (let j = 0; j < p; j++) if (items[a + j].k !== items[b + j].k) return false; return true; };
    while (i < n) {
      let best = null;
      for (let p = 1; p <= 12 && i + 2 * p - 1 <= n; p++) {
        let k = 1; while (i + (k + 1) * p <= n && eq(i, i + k * p, p)) k++;
        const trim = p > 1 && i + k * p + p - 1 <= n && eq(i, i + k * p, p - 1) ? 1 : 0, reps = k + trim, cov = k * p + trim * (p - 1);
        if (reps >= 2 && cov - p >= 2 && cov - p > (best ? best.cov - best.p : 0)) best = { p, reps, trim, cov };
      }
      if (best) { const blk = items.slice(i, i + best.p).map(x => x.st), e = [best.reps, blk, best.trim]; out.push({ e, k: JSON.stringify(e), st: e }); i += best.cov; moved = true; }
      else { out.push(items[i]); i++; }
    }
    items = out; if (!moved) break;
  }
  return items.map(x => x.e);
}
/** a js/workouts.js workout -> { id, n, s } for the watch in watts with this FTP, or null (an open-ended step, a step not in ERG / power) */
export function wkFromRide(w, ftp, isHard) {
  if (!w || !Array.isArray(w.steps) || !w.steps.length || !(ftp > 0)) return null;
  const steps = [];
  for (const st of w.steps) {
    if (!st || st.free || st.tgt || (st.end && st.end.kind !== 'time') || !(st.dur >= 1)) return null;
    const pct = typeof st.watts === 'number' ? null : st.pct; if (typeof st.watts !== 'number' && !(pct > 0)) return null;
    const wt = typeof st.watts === 'number' ? Math.round(st.watts) : Math.round(pct / 100 * ftp), w2 = st.pct2 != null ? Math.round(st.pct2 / 100 * ftp) : null;
    steps.push({ sec: Math.round(st.dur), w: wt, w2: w2 != null && w2 !== wt ? w2 : null, hard: !!isHard(st), label: st.label || '' });
  }
  const o = { id: String(w.id), n: wkTxt(w.name, 24) || 'Workout', s: wkCompact(steps) };
  if (typeof w.rampIn === 'number') o.ri = w.rampIn; if (typeof w.rampOut === 'number') o.ro = w.rampOut;
  if (typeof w.cat === 'string' && w.cat) o.c = w.cat[0]; // 27.11.6: the category's letter (e t v a f, js/workouts.js rideCat), the chooser
  return o;
}
/** the length of a workout's entries in seconds, without expanding them (the TPICK sub line) */
export function wkDur(l) {
  let t = 0; if (!Array.isArray(l)) return 0;
  for (let j = 0; j < l.length; j++) {
    const e = l[j];
    if (isRep(e)) { const n = Math.max(0, Math.min(100, Math.round(e[0]))), sub = e[1]; if (n > 0) { const a = wkDur(sub); t += n * a; if (e[2] === 1 && sub.length > 0) t -= wkDur([sub[sub.length - 1]]); } }
    else if (isStep(e)) { const s = Math.round(e[0]); if (s >= 1 && s <= 36000) t += s; }
  }
  return t;
}
/** the ERG page's step line: the counter in a hard step of a repeat ("7/13, SET 2"), else the step's label in capitals */
export function wkShown(W) { const i = W.i; if (i >= W.dur.length) return ''; return W.hard[i] && W.cnt[i].length > 0 ? W.cnt[i] : (W.lab[i].length > 0 ? W.lab[i].toUpperCase() : (W.hard[i] ? 'HARD' : 'EASY')); }
/** the next step's target with the offsets, -1 after the last */
export const wkNextW = W => W.i + 1 < W.dur.length ? wkPlat(W, W.i + 1, 0) : -1;
/** 28.11.: a ramp step now: [its start watts, its end watts] with the offset (the target page says "WARM-UP 100 TO 180 W"), else null */
export const wkRamp = W => W.i < W.dur.length && W.w2[W.i] >= 0 ? [wkPlat(W, W.i, 0), wkPlat(W, W.i, W.dur[W.i])] : null;
