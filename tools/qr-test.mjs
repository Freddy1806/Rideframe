// js/qr.js (the phone remote's QR code) module for module against the Python "qrcode" package 8.2 (byte mode, level M,
// border 0, mask_pattern 0-7): SHA-256 of the module bits (row by row, "1" = dark), first 16 hex digits, and the version.
// The reference was made once with: QRCode(error_correction=M, border=0, mask_pattern=m).add_data(QRData(utf8, MODE_8BIT_BYTE)).
// Usage: node --test tools/qr-test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qrMatrix, qrSvg } from '../js/qr.js';

const REF = [ // text, version, hash per mask 0-7
  ["https://rf.example.ts.net/remote.html#c=123456", 4, ["307885fe28027e24", "e1e5ecda3fc47d99", "c50d02bed17abe44", "4bb4033100c927ef", "63aac6e8d12485a4", "e1d10849de6fb5ad", "22ce227132aa5e22", "8333319789f0c413"]],
  ["http://localhost:8814/remote.html#c=000042", 3, ["83194ab2d2328937", "d2ef4c036610ae62", "7293cf7b73fef2a1", "7c16f76d40a0c69b", "72727d3a3cb9bc2f", "68d389735292ae70", "43719ad42210aee0", "e5b9ff15c2c0bfcc"]],
  ["A", 1, ["3f594cfc1843904d", "b13656d3f3aedff5", "e7897faf8824acb3", "2092585037e9da56", "8e0f600c0a22ae37", "508b70347f197279", "59df51b0ccc995ff", "54c30e10497d65da"]],
  ["https://ridef.tail1234.ts.net/remote.html#c=987654&x=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy", 8, ["2d2222468c10095c", "306a750bdcf86e23", "2d2d9800901eaf58", "cfec9da1efa89707", "be00905db379feff", "c7d338adaba31657", "c597c7eedc126479", "bc7cd1bd415db1e6"]],
  ["xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", 8, ["92d8ae06b19d3e04", "ec316c9cf6499536", "1336208e16162851", "f8551ceddc822c73", "9cccce1d662df2c4", "ceeb4938731354aa", "4f6ca4bd965cfb1d", "77f7c79b02667376"]],
  ["Grüße 😀 remote", 2, ["ed01d3a610220078", "b5d7954cde778c29", "11fa4261a5014048", "fe4e3b71b8b53c6f", "d682aaff812bd82f", "c0cd0f834f71f129", "556d997563dc33cf", "3b7fe356770f2c1b"]],
];
const hash = m => createHash('sha256').update(m.map(r => r.map(c => (c ? '1' : '0')).join('')).join('')).digest('hex').slice(0, 16);

test('every mask matches the reference, versions 1 to 8 (version info from 7 on), UTF-8 text', () => {
  for (const [t, v, hs] of REF) hs.forEach((h, mask) => { const m = qrMatrix(t, mask); assert.equal((m.length - 17) / 4, v, t); assert.equal(hash(m), h, `${t.slice(0, 30)} mask ${mask}`); });
});
test('the automatic mask is one of the eight, the SVG has a quiet zone and one path; too long throws', () => {
  const t = REF[0][0], auto = hash(qrMatrix(t)); assert.ok(REF[0][2].includes(auto));
  const svg = qrSvg(t); assert.match(svg, /^<svg [^>]*viewBox="0 0 41 41"/); assert.equal((svg.match(/<path/g) || []).length, 1);
  assert.throws(() => qrMatrix('x'.repeat(300)));
});
