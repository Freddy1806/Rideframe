// Dense meadow grass: instanced clumps of thin curved blades, coloured per instance, swaying in the wind.
import * as THREE from 'three';

function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** One clump: `blades` tapered blades, 2 segments each, root at y=0, height ~1 (scaled per instance). */
export function clumpGeometry(blades = 9, seed = 3) {
  const r = rng(seed), pos = [], col = [], nrm = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = r() * Math.PI * 2, rad = r() * 0.18, ox = Math.cos(a) * rad, oz = Math.sin(a) * rad;
    const yaw = r() * Math.PI, lean = 0.15 + r() * 0.35, h = 0.55 + r() * 0.45, w = 0.04 + r() * 0.035;
    const dx = Math.cos(yaw), dz = Math.sin(yaw), lx = Math.cos(a), lz = Math.sin(a);
    const base = pos.length / 3, shade = 0.75 + r() * 0.25;
    for (let s = 0; s <= 2; s++) {
      const t = s / 2, y = h * t, bend = lean * t * t * h, ww = w * (1 - t * 0.85);
      const cx = ox + lx * bend, cz = oz + lz * bend;
      pos.push(cx - dx * ww, y, cz - dz * ww, cx + dx * ww, y, cz + dz * ww);
      const c = 0.35 + 0.65 * t; // dark root -> light tip
      for (let k = 0; k < 2; k++) { col.push(c * shade, c * shade, c * shade); nrm.push(0, 1, 0); }
      if (s < 2) { const q = base + s * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export function grassMaterial(timeU) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = timeU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    vec3 ip = vec3(instanceMatrix[3][0], 0., instanceMatrix[3][2]);
    float k = transformed.y * transformed.y;
    float gust = sin(uTime * 1.3 + ip.x * 0.07 + ip.z * 0.05) * 0.5 + 0.5;
    transformed.x += k * (0.10 + 0.18 * gust) * sin(uTime * 2.1 + ip.x * 0.9 + ip.z * 0.4);
    transformed.z += k * (0.06 + 0.10 * gust) * cos(uTime * 1.7 + ip.z * 0.8);
  }`);
  };
  return m;
}

// per-instance colour palette: fresh green, olive, yellowish, a few dry straw clumps
const PAL = [[0.3, 0.55, 0.08], [0.38, 0.6, 0.1], [0.46, 0.62, 0.12], [0.28, 0.46, 0.1], [0.62, 0.58, 0.22], [0.72, 0.62, 0.3]].map(c => new THREE.Color(...c));
export function grassColor(r, out) {
  const i = r() < 0.06 ? 4 + Math.floor(r() * 2) : Math.floor(r() * 4);
  return out.copy(PAL[i]).multiplyScalar(0.85 + r() * 0.3);
}
