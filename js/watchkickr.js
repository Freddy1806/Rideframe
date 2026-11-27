// A pretend KICKR for the watch's indoor trainer (23.11.): answers the radio actions of js/watchtrainer.js (L.act) with the events a
// real trainer would cause on the watch (found, conn, done, ind), so the preview (js/watchsim.js) and the tests (tools/watchtrainer-test.mjs)
// run the whole protocol without Bluetooth. FTMS like the KICKR Core 2 (or the Wahoo fallback with wahoo: true); refuse = another app
// has control (result 0x05 "control not permitted"); hold = write answers wait until release() (a slow trainer, for latest-wins).
export function fakeKickr(o = {}) {
  const K = { name: o.name || 'KICKR CORE 2 5A1F', ftms: o.ftms !== false, wahoo: !!o.wahoo, others: o.others || [], on: true, paired: false, scanning: false,
    refuse: !!o.refuse, cps: o.cps !== false, hold: false, pend: [], tgt: 0, writes: [], sub: {} };
  const ok = { k: 'done', ok: true };
  /** the events one radio action causes (the watch's BleDelegate callbacks) */
  K.handle = a => {
    if (a.k === 'scan') { K.scanning = a.on; return a.on && K.on ? [{ k: 'found', list: [{ name: K.name, ftms: K.ftms, cps: true, rssi: -58 }, ...K.others] }] : []; }
    if (a.k === 'pair') { if (!K.on || a.name !== K.name) return []; K.paired = true; return [{ k: 'conn', ftms: K.ftms, wahoo: K.wahoo, cps: K.cps }]; }
    if (a.k === 'unpair') { K.paired = false; K.sub = {}; return []; }
    if (a.k === 'cccd') { K.sub[a.ch] = a.v[0]; return [ok]; }
    if (a.k !== 'write') return [];
    K.writes.push([a.ch, ...a.v]);
    const res = K.refuse ? 0x05 : 0x01;
    if (!K.refuse && (a.v[0] === 0x05 || a.v[0] === 0x42)) K.tgt = a.v[1] + (a.v[2] << 8);
    const ev = a.ch === 'fcp' ? [ok, { k: 'ind', ch: 'fcp', v: [0x80, a.v[0], res] }] : [{ k: 'done', ok: !K.refuse }];
    if (K.hold) { K.pend.push(...ev); return []; }
    return ev;
  };
  /** the answers held back while hold was on */
  K.release = () => { K.hold = false; return K.pend.splice(0); };
  /** one notification of the trainer's data: FTMS Indoor Bike Data (speed, cadence, power) or Cycling Power Measurement */
  K.data = (pw, cad) => {
    pw = Math.max(0, Math.round(pw)); const c2 = Math.round(cad * 2);
    if (K.ftms && o.ibdCad === 'none') return { k: 'ind', ch: 'ibd', v: [0x40, 0x00, 0x10, 0x0e, pw & 255, pw >> 8] }; // 28.11.: speed + power, no cadence field
    if (K.ftms && o.ibdCad === 'zero') return { k: 'ind', ch: 'ibd', v: [0x44, 0x00, 0x10, 0x0e, 0, 0, pw & 255, pw >> 8] }; // the cadence field, always 0
    return K.ftms ? { k: 'ind', ch: 'ibd', v: [0x44, 0x00, 0x10, 0x0e, c2 & 255, c2 >> 8, pw & 255, pw >> 8] } : { k: 'ind', ch: 'cpm', v: [0x00, 0x00, pw & 255, pw >> 8] };
  };
  /** 28.11.: one Cycling Power Measurement with crank revolution data (flags 0x20): power, cumulative revolutions, last crank event (1/1024 s) */
  K.crank = (pw, revs, t) => ({ k: 'ind', ch: 'cpm', v: [0x20, 0x00, pw & 255, (pw >> 8) & 255, revs & 255, (revs >> 8) & 255, t & 255, (t >> 8) & 255] });
  return K;
}
