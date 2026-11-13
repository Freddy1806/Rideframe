// Procedural textures (canvas) so the world needs no image downloads.
import * as THREE from 'three';
import { createNoise2D } from '../../vendor/simplex-noise.js';

function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

/** Tiling meadow ground: short grass strokes, clover, a bit of soil. */
export function grassGround(size = 512, seed = 3) {
  const [c, g] = canvas(size); const r = rng(seed); const n = createNoise2D(r);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // tileable noise via torus mapping
    const a = x / size * Math.PI * 2, b = y / size * Math.PI * 2;
    const v = n(Math.cos(a) * 2 + Math.sin(b) * 0.5, Math.sin(a) * 2 + Math.cos(b) * 2) * .5 + n(Math.cos(a) * 9, Math.sin(b) * 9) * .25;
    const i = (y * size + x) * 4;
    img.data[i] = 70 + v * 22; img.data[i + 1] = 98 + v * 26; img.data[i + 2] = 40 + v * 10; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 9000; k++) {
    const x = r() * size, y = r() * size, len = 3 + r() * 9, ang = -Math.PI / 2 + (r() - .5) * 1.2;
    g.strokeStyle = hsl(70 + r() * 30, 35 + r() * 25, 22 + r() * 26, .8); g.lineWidth = 1 + r();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
  }
  for (let k = 0; k < 140; k++) { g.fillStyle = hsl(40, 25, 28 + r() * 10, .35); g.beginPath(); g.arc(r() * size, r() * size, 2 + r() * 5, 0, 7); g.fill(); }
  return tex(c);
}

/** Dirt / gravel road strip. u = across (0..1), v = along. Edges fade into grass. */
export function dirtRoad(w = 256, h = 1024, seed = 5) {
  const [c, g] = canvas(w, h); const r = rng(seed); const n = createNoise2D(r);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w; const b = y / h * Math.PI * 2;
    const v = n(u * 6, Math.sin(b) * 3 + Math.cos(b) * 3) * .5 + n(u * 30, Math.cos(b) * 20) * .3;
    const track = Math.exp(-((u - .3) ** 2) / .004) + Math.exp(-((u - .7) ** 2) / .004); // wheel tracks
    const middle = Math.exp(-((u - .5) ** 2) / .003);
    let R = 150 + v * 25 - track * 12, G = 128 + v * 22 - track * 12, B = 98 + v * 16 - track * 10;
    // grass in the middle strip and at edges
    const edge = Math.min(1, Math.max(0, (Math.abs(u - .5) - .36) / .14));
    const grass = Math.max(edge, middle * (n(u * 10, Math.sin(b) * 40) > -.1 ? .75 : .2));
    R = R * (1 - grass) + (78 + v * 20) * grass; G = G * (1 - grass) + (100 + v * 22) * grass; B = B * (1 - grass) + (44 + v * 10) * grass;
    const i = (y * w + x) * 4; img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 2600; k++) { const x = (.12 + r() * .76) * w, y = r() * h; g.fillStyle = hsl(30, 10 + r() * 15, 40 + r() * 35, .9); g.fillRect(x, y, 1 + r() * 2.5, 1 + r() * 2.5); }
  return tex(c);
}

/** Asphalt with edge lines. */
export function asphalt(w = 256, h = 1024, seed = 9, centerDash = true, lines = true) { // lines = false: markings drawn elsewhere (lofoten: roadlines.js)
  const [c, g] = canvas(w, h); const r = rng(seed); const n = createNoise2D(r);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, b = y / h * Math.PI * 2;
    const v = n(u * 8, Math.sin(b) * 4 + Math.cos(b) * 4) * .5 + (r() - .5) * .35;
    let L = 62 + v * 12;
    const wear = Math.exp(-((u - .27) ** 2) / .003) + Math.exp(-((u - .73) ** 2) / .003);
    L -= wear * 6;
    const i = (y * w + x) * 4; img.data[i] = L + 2; img.data[i + 1] = L + 1; img.data[i + 2] = L + 3; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(232,232,224,.92)';
  if (lines) { g.fillRect(w * .055, 0, w * .022, h); g.fillRect(w * .923, 0, w * .022, h); }
  if (lines && centerDash) for (let y = 0; y < h; y += h / 4) g.fillRect(w * .493, y, w * .014, h / 8);
  // shoulder gravel at edges
  for (let k = 0; k < 4000; k++) { const s = r() < .5 ? r() * .045 : 1 - r() * .045; g.fillStyle = hsl(35, 8, 35 + r() * 30); g.fillRect(s * w, r() * h, 2, 2); }
  return tex(c);
}

/** Grass tuft card (alpha). */
export function grassTuft(size = 256, seed = 11, flowers = false) {
  const [c, g] = canvas(size); const r = rng(seed);
  for (let k = 0; k < 70; k++) {
    const x0 = size * (.15 + r() * .7), hgt = size * (.45 + r() * .5), bend = (r() - .5) * size * .35, wid = 2 + r() * 4;
    const grd = g.createLinearGradient(0, size, 0, size - hgt);
    const hue = 70 + r() * 25, l = 26 + r() * 16;
    grd.addColorStop(0, hsl(hue, 45, l * .55)); grd.addColorStop(1, hsl(hue - 8, 55, l + 14));
    g.fillStyle = grd; g.beginPath(); g.moveTo(x0 - wid, size); g.quadraticCurveTo(x0 + bend * .3, size - hgt * .55, x0 + bend, size - hgt); g.quadraticCurveTo(x0 + bend * .3 + wid * .4, size - hgt * .55, x0 + wid, size); g.fill();
  }
  if (flowers) for (let k = 0; k < 6; k++) {
    const x = size * (.2 + r() * .6), y = size * (.15 + r() * .4);
    g.strokeStyle = hsl(90, 40, 30); g.lineWidth = 2; g.beginPath(); g.moveTo(x, size); g.lineTo(x, y); g.stroke();
    const col = r() < .6 ? '#f4f1e6' : r() < .5 ? '#f2cf3a' : '#b98ad8';
    for (let p = 0; p < 6; p++) { const a = p / 6 * Math.PI * 2; g.fillStyle = col; g.beginPath(); g.ellipse(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 4.5, 3, a, 0, 7); g.fill(); }
    g.fillStyle = '#e8b020'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
  }
  return tex(c, { repeat: false });
}

/** Leaf cluster for deciduous trees (alpha). */
export function leafCluster(size = 256, seed = 13, hue = 95) {
  const [c, g] = canvas(size); const r = rng(seed);
  for (let k = 0; k < 420; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * size * .44;
    const x = size / 2 + Math.cos(a) * d, y = size / 2 + Math.sin(a) * d;
    const l = 20 + r() * 26 + (1 - d / (size * .44)) * 6;
    g.fillStyle = hsl(hue + (r() - .5) * 22, 40 + r() * 20, l);
    g.beginPath(); g.ellipse(x, y, 7 + r() * 6, 3.5 + r() * 3, r() * Math.PI, 0, 7); g.fill();
  }
  return tex(c, { repeat: false });
}

/** Spruce branch card (alpha), branch grows from left to right. */
export function needleBranch(w = 256, h = 128, seed = 17) {
  const [c, g] = canvas(w, h); const r = rng(seed);
  g.strokeStyle = '#3d2c1e'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w * .95, h / 2); g.stroke();
  for (let k = 0; k < 1500; k++) {
    const t = r(), x = t * w * .95, spread = (1 - t * .55) * h * .46;
    const y = h / 2 + (r() - .5) * 2 * spread * Math.sqrt(r());
    const len = 6 + r() * 9, ang = (y < h / 2 ? -1 : 1) * (0.3 + r() * .7);
    g.strokeStyle = hsl(135 + r() * 25, 30 + r() * 20, 16 + r() * 18); g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
  }
  return tex(c, { repeat: false });
}

export function bark(size = 128, seed = 19, light = false) {
  const [c, g] = canvas(size); const r = rng(seed);
  g.fillStyle = light ? '#8a8378' : '#4a3a2c'; g.fillRect(0, 0, size, size);
  for (let k = 0; k < 220; k++) { g.strokeStyle = light ? hsl(30, 6, 30 + r() * 40, .6) : hsl(25, 25, 12 + r() * 18, .7); g.lineWidth = 1 + r() * 2; const x = r() * size; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - .5) * 6, size); g.stroke(); }
  return tex(c);
}

/** Weathered vertical wood planks. */
export function planks(w = 512, h = 512, seed = 23) {
  const [c, g] = canvas(w, h); const r = rng(seed);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const base = 48 + r() * 18;
    g.fillStyle = hsl(24 + r() * 8, 32, base * .55); g.fillRect(i * w / n, 0, w / n, h);
    for (let k = 0; k < 90; k++) { g.strokeStyle = hsl(26, 30, base * (.35 + r() * .35), .5); g.lineWidth = 1; const x = i * w / n + r() * w / n; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - .5) * 3, h); g.stroke(); }
    g.fillStyle = 'rgba(20,12,6,.75)'; g.fillRect(i * w / n, 0, 2.5, h);
  }
  return tex(c);
}

export function roofTin(w = 256, h = 256, seed = 29) {
  const [c, g] = canvas(w, h); const r = rng(seed);
  for (let x = 0; x < w; x += 8) { g.fillStyle = hsl(20, 18, 22 + (x / 8 % 2) * 6); g.fillRect(x, 0, 8, h); }
  for (let k = 0; k < 400; k++) { g.fillStyle = hsl(18 + r() * 14, 45, 25 + r() * 18, .25); g.beginPath(); g.arc(r() * w, r() * h, 1 + r() * 7, 0, 7); g.fill(); }
  return tex(c);
}

export function stone(size = 256, seed = 31) {
  const [c, g] = canvas(size); const r = rng(seed);
  g.fillStyle = '#5a5650'; g.fillRect(0, 0, size, size);
  for (let k = 0; k < 120; k++) { g.fillStyle = hsl(30, 6, 32 + r() * 30); g.beginPath(); g.ellipse(r() * size, r() * size, 10 + r() * 14, 7 + r() * 9, r() * 3, 0, 7); g.fill(); }
  return tex(c);
}

/** Cobblestones for the old-town lanes: rows of rounded setts, tileable, worn in the middle. */
export function cobble(size = 512, seed = 37) {
  const [c, g] = canvas(size); const r = rng(seed);
  g.fillStyle = '#4a443c'; g.fillRect(0, 0, size, size); // dark joints
  const rows = 12, h = size / rows;
  for (let j = 0; j < rows; j++) { let x = -(j % 2) * h * 0.6 - r() * 6;
    while (x < size) { const w = h * (0.85 + r() * 0.7), l = 38 + r() * 26;
      for (const dx of [0, size]) { g.fillStyle = hsl(30 + r() * 12, 9 + r() * 8, l + 8); g.beginPath(); g.roundRect(x + 2 - dx * 0 + (dx ? -size : 0), j * h + 2, w - 4, h - 4, h * 0.28); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.beginPath(); g.ellipse(x + w * 0.42, j * h + h * 0.38, w * 0.26, h * 0.2, 0, 0, 7); g.fill(); // worn, shiny crown
      x += w; } }
  return tex(c);
}
