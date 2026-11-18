// A small QR code maker (byte mode, error correction M, versions 1-10: up to 213 bytes), enough for the phone remote's link
// "…/remote.html#c=123456". Follows ISO 18004 the way Project Nayuki's reference does; checked module for module against
// the Python "qrcode" package for every mask (tools/qr-test.mjs). No dependency, no network.
const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]; // per version, level M
const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
function divisor(n) { const r = new Array(n).fill(0); r[n - 1] = 1; let root = 1;
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { r[j] = mul(r[j], root); if (j + 1 < n) r[j] ^= r[j + 1]; } root = mul(root, 2); } return r; }
function remainder(data, div) { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); } return r; }
function rawModules(v) { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; }
const dataCap = v => Math.floor(rawModules(v) / 8) - ECC[v] * BLOCKS[v];
function alignPos(v, size) { if (v === 1) return []; const n = Math.floor(v / 7) + 2, step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, r = [6];
  for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p); return r; }
const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];

/** the modules as rows of booleans (true = dark), without the quiet zone; mask 0-7, or the best by the penalty rules */
export function qrMatrix(text, mask = -1) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let v = 1; while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCap(v) * 8) v++;
  if (v > 10) throw new Error('Text too long for the QR code');
  // data bits: mode 0100, count, bytes, terminator, pad
  const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  const cap = dataCap(v) * 8; put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
  for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) put(p, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  // blocks with error correction, interleaved
  const nb = BLOCKS[v], ec = ECC[v], raw = Math.floor(rawModules(v) / 8), short = nb - raw % nb, sLen = Math.floor(raw / nb), div = divisor(ec), blocks = [];
  for (let i = 0, k = 0; i < nb; i++) { const d = data.slice(k, k + sLen - ec + (i < short ? 0 : 1)); k += d.length; const e = remainder(d, div); if (i < short) d.push(0); blocks.push(d.concat(e)); }
  const cw = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== sLen - ec || j >= short) cw.push(b[i]); });
  // the function patterns
  const size = 17 + 4 * v, m = Array.from({ length: size }, () => new Array(size).fill(false)), fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy)); if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = alignPos(v, size);
  al.forEach((a, i) => al.forEach((b, j) => { if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
  const format = mk => { const d = (0 << 3) | mk; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const b = ((d << 10) | r) ^ 0x5412, g = i => ((b >>> i) & 1) === 1; // level M = 00
    for (let i = 0; i <= 5; i++) set(8, i, g(i)); set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, g(i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, g(i)); set(8, size - 8, true); };
  format(0);
  if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const d = ((b >>> i) & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, d); set(c, a, d); } }
  // the codewords, two columns at a time, zigzag from the bottom right
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x] && i < cw.length * 8) { m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; } } }
  const apply = mk => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mk](x, y)) m[y][x] = !m[y][x]; };
  if (mask < 0) { let best = 0, low = Infinity; for (let k = 0; k < 8; k++) { apply(k); format(k); const p = penalty(m); if (p < low) { low = p; best = k; } apply(k); } mask = best; }
  apply(mask); format(mask);
  return m;
}
/** the four penalty rules of the standard (runs, 2×2 boxes, finder look-alikes, dark balance) */
function penalty(m) {
  const n = m.length; let p = 0;
  const line = get => { let run = 1, s = 0; for (let i = 1; i < n; i++) { if (get(i) === get(i - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; }
    const pat = [true, false, true, true, true, false, true]; for (let i = 0; i + 7 <= n; i++) if (pat.every((d, k) => get(i + k) === d)) {
      const before = [1, 2, 3, 4].every(k => i - k < 0 || !get(i - k)), after = [1, 2, 3, 4].every(k => i + 6 + k >= n || !get(i + 6 + k)); if (before || after) s += 40; } return s; };
  for (let y = 0; y < n; y++) p += line(x => m[y][x]);
  for (let x = 0; x < n; x++) p += line(y => m[y][x]);
  let dark = 0; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { if (m[y][x]) dark++; if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3; }
  return p + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
}
/** an SVG of the code (dark on light, 4 modules of quiet zone), one path, scales to any size */
export function qrSvg(text, { dark = '#0b0b0b', light = '#f4f4ef' } = {}) {
  const m = qrMatrix(text), n = m.length + 8; let d = '';
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
