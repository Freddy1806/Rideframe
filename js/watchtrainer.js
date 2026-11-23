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
    pw: 0, cad: 0, at: -1e9, crank: null, t0: 0, setAt: 0, lostAt: 0, ctlAt: 0, act: [] };
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
  if (L.mode === 'ftms') L.q = [step('cccd', 'ibd', [1, 0]), step('cccd', 'fcp', [2, 0]), step('write', 'fcp', [0x00]), step('write', 'fcp', [0x07])];
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
  if (f & 0x0004) { if (o + 1 < v.length) L.cad = Math.round(u16(v, o) / 2); o += 2; } // cadence, 0.5 rpm
  if (f & 0x0008) o += 2;                                      // average cadence
  if (f & 0x0010) o += 3;                                      // total distance
  if (f & 0x0020) o += 2;                                      // resistance level
  if (f & 0x0040) { if (o + 1 < v.length) L.pw = Math.max(0, s16(v, o)); o += 2; } // instantaneous power
  L.at = now;
}
/** Cycling Power Measurement (0x2A63): power, and the cadence from the crank revolutions when they are there */
export function cpm(L, v, now) {
  if (v.length < 4) return; const f = u16(v, 0); L.pw = Math.max(0, s16(v, 2)); let o = 4;
  if (f & 0x01) o += 1; if (f & 0x04) o += 2; if (f & 0x10) o += 6;
  if (f & 0x20 && o + 3 < v.length) {
    const revs = u16(v, o), t = u16(v, o + 2), c = L.crank;
    if (c) { const dr = (revs - c.revs + 65536) % 65536, dt = ((t - c.t + 65536) % 65536) / 1024; if (dt > 0) L.cad = Math.round(dr / dt * 60); else if (now - c.at > 2.5) L.cad = 0; }
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
    dt: SER_DT, s: { pw: [], cad: [], hr: [], tgt: [] }, a: { pw: 0, cad: 0, hr: 0, tgt: 0, n: 0 } };
}
/** a target a step on (d = +1 / -1, big = UP / DOWN held), on the step grid, inside 30..1000 W */
export function nextTarget(R, d, big) { const k = big ? Math.max(R.step, HOLD_W) : R.step; return clamp(d > 0 ? Math.floor(R.tgt / k) * k + k : Math.ceil(R.tgt / k) * k - k, W_MIN, W_MAX); }
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
    hr: R.hrN ? Math.round(R.hrSum / R.hrN) : 0, maxHr: R.hrMax, kj: Math.round(R.kj), start: R.start };
}
/** POST /api/watch/activity for the ride (tools/watch-feed.mjs validateAct): a VirtualRide with power, cadence and the series */
export function rideBody(R, sum, id, now) {
  return { id, type: 'VirtualRide', start: R.start, duration: Math.max(1, Math.round(now - R.start)), moving: sum.t, dist: 0, climb: 0, hr: sum.hr, maxHr: sum.maxHr, kcal: sum.kj,
    power: sum.avgPw, maxPower: sum.maxPw, np: sum.np, kj: sum.kj, cad: sum.cad, s: { dt: R.dt, pw: R.s.pw.slice(), cad: R.s.cad.slice(), hr: R.s.hr.slice(), tgt: R.s.tgt.slice() } };
}
