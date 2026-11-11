// "Eigene Musik": every player can pick a folder with their own songs on their computer (Chrome/Edge, File System Access).
// The game never ships or uploads them, it only plays what lies on this machine (so no rights problem).
// Subfolders name the mood they play in: welt, regen, intervall (motivation in hard workout parts), training, flug, hoelle,
// fest, rennen (English names work too). Songs directly in the folder play everywhere a mood has no folder of its own.
import { db } from './db.js';

const MOODS = { world: ['welt', 'world', 'frei'], rain: ['regen', 'rain'], hard: ['intervall', 'intervalle', 'hard', 'motivation'],
  workout: ['training', 'workout'], fly: ['flug', 'fly'], hell: ['hoelle', 'hölle', 'hell'], fest: ['fest', 'kirchenfest', 'dorf'], race: ['rennen', 'race', 'gruppe'] };
const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
export const ownMusicSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** ask for the folder (needs a click); returns a short description or null */
export async function pickOwnMusic() {
  if (!ownMusicSupported()) return null;
  const h = await window.showDirectoryPicker({ id: 'rideframe-music', mode: 'read' }).catch(() => null); if (!h) return null;
  await db.kvSet('ownMusic', h); const l = await scan(h); return { name: h.name, ...count(l) };
}
export async function forgetOwnMusic() { await db.kvSet('ownMusic', null); }
/** folder name and how many songs per mood, or null; ask = true may show Chrome's permission prompt (only inside a click) */
export async function ownMusicInfo(ask = false) {
  const h = await db.kvGet('ownMusic').catch(() => null); if (!h) return null;
  if (!(await allowed(h, ask))) return { name: h.name, locked: true };
  return { name: h.name, ...count(await scan(h)) };
}
/** { mood: [object URL] } for the ride, or null without a folder or without permission */
export async function ownMusicLists() {
  const h = await db.kvGet('ownMusic').catch(() => null); if (!h || !(await allowed(h, false))) return null;
  const l = await scan(h), out = {};
  for (const [k, files] of Object.entries(l)) out[k] = files.map(f => ({ url: URL.createObjectURL(f), name: f.name }));
  return Object.values(out).some(a => a.length) ? out : null;
}
async function allowed(h, ask) {
  try { if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true; return ask && (await h.requestPermission({ mode: 'read' })) === 'granted'; }
  catch { return false; }
}
async function scan(h) { try { return await scanDir(h); } catch { return { all: [] }; } } // folder moved or deleted: nothing in it
async function scanDir(h) {
  const l = { all: [] };
  for await (const [name, e] of h.entries()) {
    if (e.kind === 'file' && AUDIO.test(name)) l.all.push(await e.getFile());
    else if (e.kind === 'directory') {
      const mood = Object.keys(MOODS).find(k => MOODS[k].includes(name.toLowerCase())); if (!mood) continue;
      for await (const [n2, f] of e.entries()) if (f.kind === 'file' && AUDIO.test(n2)) (l[mood] ||= []).push(await f.getFile());
    }
  }
  return l;
}
function count(l) { const n = Object.values(l).reduce((s, a) => s + a.length, 0), moods = Object.keys(l).filter(k => k !== 'all' && l[k].length); return { n, moods }; }
