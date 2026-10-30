// Reads GPS from GoPro MP4 files (GPMF telemetry track "gpmd").
// Only the moov box and the small telemetry samples are read, so multi-GB files are fine.

async function readBytes(file, start, len) {
  return new DataView(await file.slice(start, start + len).arrayBuffer());
}

const fourcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

async function findTopBox(file, type) {
  let pos = 0;
  while (pos < file.size) {
    const h = await readBytes(file, pos, 16);
    let size = h.getUint32(0);
    const t = fourcc(h, 4);
    let header = 8;
    if (size === 1) { size = Number(h.getBigUint64(8)); header = 16; }
    else if (size === 0) size = file.size - pos;
    if (t === type) return { start: pos, size, header };
    if (size < 8) break;
    pos += size;
  }
  return null;
}

function children(dv, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = fourcc(dv, p + 4);
    let header = 8;
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); header = 16; }
    else if (size === 0) size = end - p;
    if (size < 8) break;
    out.push({ type, start: p, body: p + header, end: p + size });
    p += size;
  }
  return out;
}
const child = (dv, box, type) => children(dv, box.body, box.end).find(b => b.type === type);

function parseTrak(dv, trak) {
  const mdia = child(dv, trak, 'mdia'); if (!mdia) return null;
  const hdlr = child(dv, mdia, 'hdlr');
  const mdhd = child(dv, mdia, 'mdhd');
  const minf = child(dv, mdia, 'minf'); if (!minf || !mdhd) return null;
  const stbl = child(dv, minf, 'stbl'); if (!stbl) return null;
  const stsd = child(dv, stbl, 'stsd');
  const format = stsd ? fourcc(dv, stsd.body + 12) : '';
  const handler = hdlr ? fourcc(dv, hdlr.body + 8) : '';
  const v = dv.getUint8(mdhd.body);
  const timescale = v === 1 ? dv.getUint32(mdhd.body + 20) : dv.getUint32(mdhd.body + 12);
  const duration = v === 1 ? Number(dv.getBigUint64(mdhd.body + 24)) : dv.getUint32(mdhd.body + 16);
  return { handler, format, timescale, duration, stbl };
}

function sampleTable(dv, stbl) {
  const sizes = [];
  const stsz = child(dv, stbl, 'stsz');
  if (stsz) {
    const fixed = dv.getUint32(stsz.body + 4), n = dv.getUint32(stsz.body + 8);
    for (let i = 0; i < n; i++) sizes.push(fixed || dv.getUint32(stsz.body + 12 + i * 4));
  }
  const chunks = [];
  const stco = child(dv, stbl, 'stco'), co64 = child(dv, stbl, 'co64');
  if (stco) { const n = dv.getUint32(stco.body + 4); for (let i = 0; i < n; i++) chunks.push(dv.getUint32(stco.body + 8 + i * 4)); }
  if (co64) { const n = dv.getUint32(co64.body + 4); for (let i = 0; i < n; i++) chunks.push(Number(dv.getBigUint64(co64.body + 8 + i * 8))); }
  const stsc = child(dv, stbl, 'stsc');
  const stscE = [];
  if (stsc) { const n = dv.getUint32(stsc.body + 4); for (let i = 0; i < n; i++) { const o = stsc.body + 8 + i * 12; stscE.push([dv.getUint32(o), dv.getUint32(o + 4)]); } }
  // sample offsets
  const offsets = [];
  let s = 0;
  for (let c = 0; c < chunks.length; c++) {
    let per = 1;
    for (const [first, n] of stscE) if (c + 1 >= first) per = n;
    let off = chunks[c];
    for (let k = 0; k < per && s < sizes.length; k++, s++) { offsets.push(off); off += sizes[s]; }
  }
  // sample times
  const times = [], durs = [];
  const stts = child(dv, stbl, 'stts');
  if (stts) {
    const n = dv.getUint32(stts.body + 4); let t = 0;
    for (let i = 0; i < n; i++) {
      const cnt = dv.getUint32(stts.body + 8 + i * 8), d = dv.getUint32(stts.body + 12 + i * 8);
      for (let k = 0; k < cnt; k++) { times.push(t); durs.push(d); t += d; }
    }
  }
  return { sizes, offsets, times, durs };
}

// ---------- GPMF KLV ----------
const TYPE_SIZE = { b: 1, B: 1, c: 1, s: 2, S: 2, l: 4, L: 4, f: 4, d: 8, j: 8, J: 8, F: 4, G: 16, q: 4, Q: 8, U: 16 };

function readNum(dv, o, t) {
  switch (t) {
    case 'b': return dv.getInt8(o); case 'B': return dv.getUint8(o);
    case 's': return dv.getInt16(o); case 'S': return dv.getUint16(o);
    case 'l': return dv.getInt32(o); case 'L': return dv.getUint32(o);
    case 'f': return dv.getFloat32(o); case 'd': return dv.getFloat64(o);
    case 'j': return Number(dv.getBigInt64(o)); case 'J': return Number(dv.getBigUint64(o));
    case 'q': return dv.getInt32(o) / 65536; case 'Q': return Number(dv.getBigInt64(o)) / 4294967296;
    default: return 0;
  }
}

function walkKLV(dv, start, end, cb, ctx = {}) {
  let p = start;
  while (p + 8 <= end) {
    const key = fourcc(dv, p);
    const type = String.fromCharCode(dv.getUint8(p + 4));
    const ssize = dv.getUint8(p + 5);
    const repeat = dv.getUint16(p + 6);
    const len = ssize * repeat;
    const body = p + 8;
    if (key === '\0\0\0\0') break;
    if (type === '\0') {
      walkKLV(dv, body, body + len, cb, {}); // nested container (DEVC / STRM): fresh context
    } else {
      cb(key, type, ssize, repeat, body, ctx);
    }
    p = body + ((len + 3) & ~3);
  }
}

function parsePayload(dv, start, end) {
  const out = []; // [{lat,lon,alt,speed,fix,dop}]
  walkKLV(dv, start, end, (key, type, ssize, repeat, body, ctx) => {
    if (key === 'SCAL') {
      const sz = TYPE_SIZE[type] || ssize;
      const n = ssize / sz * repeat;
      ctx.scal = [];
      for (let i = 0; i < n; i++) ctx.scal.push(readNum(dv, body + i * sz, type));
    } else if (key === 'TYPE') {
      let s = ''; for (let i = 0; i < ssize * repeat; i++) { const c = dv.getUint8(body + i); if (c) s += String.fromCharCode(c); }
      ctx.type = s;
    } else if (key === 'GPSF') ctx.fix = readNum(dv, body, type);
    else if (key === 'GPSP') ctx.dop = readNum(dv, body, type) / 100;
    else if (key === 'GPS5' || key === 'GPS9') {
      const types = key === 'GPS9' && type === '?' ? (ctx.type || 'lllllllSS') : type.repeat(ssize / (TYPE_SIZE[type] || 4));
      const scal = ctx.scal || [];
      for (let r = 0; r < repeat; r++) {
        let o = body + r * ssize; const v = [];
        for (let i = 0; i < types.length; i++) {
          const t = types[i]; v.push(readNum(dv, o, t) / (scal.length > 1 ? (scal[i] || 1) : (scal[0] || 1)));
          o += TYPE_SIZE[t] || 4;
        }
        const s = { lat: v[0], lon: v[1], alt: v[2], speed: v[3] };
        if (key === 'GPS9') { s.dop = v[7]; s.fix = v[8]; } else { s.dop = ctx.dop; s.fix = ctx.fix; }
        out.push(s);
      }
    }
  });
  return out;
}

/**
 * Returns { duration, fps, width, height, points: [{t, lat, lon, alt, speed}] } for one GoPro file.
 * t = seconds from the start of this file.
 */
export async function readGoProGPS(file, onProgress) {
  const moovRef = await findTopBox(file, 'moov');
  if (!moovRef) throw new Error('Keine gültige MP4-Datei (moov fehlt).');
  const buf = await file.slice(moovRef.start, moovRef.start + moovRef.size).arrayBuffer();
  const dv = new DataView(buf);
  const moov = { body: moovRef.header, end: moovRef.size };
  const tracks = children(dv, moov.body, moov.end).filter(b => b.type === 'trak').map(t => parseTrak(dv, t)).filter(Boolean);
  const video = tracks.find(t => t.handler === 'vide');
  const meta = tracks.find(t => t.format === 'gpmd');
  const info = { duration: 0, fps: 0, points: [] };
  if (video) {
    info.duration = video.duration / video.timescale;
    const st = sampleTable(dv, video.stbl);
    info.fps = st.times.length / info.duration;
  }
  if (!meta) return info;
  const st = sampleTable(dv, meta.stbl);
  const n = st.offsets.length;
  for (let i = 0; i < n; i++) {
    const pdv = await readBytes(file, st.offsets[i], st.sizes[i]);
    const pts = parsePayload(pdv, 0, st.sizes[i]);
    const t0 = st.times[i] / meta.timescale, dur = st.durs[i] / meta.timescale;
    pts.forEach((p, k) => {
      if (p.fix !== undefined && p.fix < 2) return;     // no 2D/3D lock
      if (p.dop !== undefined && p.dop > 5) return;     // poor precision
      if (!p.lat && !p.lon) return;
      info.points.push({ t: t0 + dur * k / pts.length, lat: p.lat, lon: p.lon, alt: p.alt, speed: p.speed });
    });
    if (onProgress && i % 20 === 0) onProgress(i / n);
  }
  return info;
}
