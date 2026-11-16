// Quick entry (Freddy 16.11.: "Ich habe gerade 100 Liegestütze und 50 Klimmzüge gemacht, ungefähr 45 Minuten trainiert" -> the
// app enters it). parseQuick understands plain sentences on the device, without any AI. aiQuick is optional: with the
// user's own API key (kept in localStorage of this device only, never in the synced settings) the sentence goes straight
// from the phone to the Claude API and comes back in the same shape. Pure functions; kraft.js draws the sheet.
const KEY = 'rf_ai_key';
export const aiKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setAiKey = k => { try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch {} };

const norm = s => String(s).toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
const WORDS = { ein: 1, eine: 1, einen: 1, one: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, funf: 5, five: 5, sechs: 6, six: 6, sieben: 7, seven: 7, acht: 8, eight: 8, neun: 9, nine: 9,
  zehn: 10, ten: 10, elf: 11, zwolf: 12, funfzehn: 15, zwanzig: 20, twenty: 20, dreissig: 30, thirty: 30, vierzig: 40, funfzig: 50, fifty: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90,
  hundert: 100, einhundert: 100, hundred: 100, zweihundert: 200 };
// what people say instead of the catalogue name
const ALIAS = { push: ['liegestutz', 'pushup', 'push-up', 'push up'], pull: ['klimmzug', 'klimmzuge', 'pullup', 'pull-up', 'pull up'], chin: ['chinup', 'chin-up'], situp: ['situp', 'sit-up', 'sit up', 'crunch'],
  burpee: ['burpee'], dip: ['dips', 'dip'], plank: ['plank', 'unterarmstutz'], airsquat: ['kniebeuge', 'squat'], bench: ['bankdruck', 'bench'], dead: ['kreuzheb', 'deadlift'], ohp: ['schulterdruck', 'overhead press'],
  lunge: ['ausfallschritt', 'lunge'], curl: ['bizeps', 'curl'], row: ['rudern', 'barbell row', 'row'], lat: ['latzug', 'latziehen'], legpress: ['beinpresse'], wallsit: ['wandsitz'], sideplank: ['seitstutz', 'side plank'] };
const stem = n => norm(n).replace(/\(.*?\)/g, '').trim();
const DE = { squat: 'Kniebeugen (Langhantel)', dead: 'Kreuzheben', rdl: 'Rumänisches Kreuzheben', bench: 'Bankdrücken', incline: 'Schrägbankdrücken (Kurzhantel)', ohp: 'Schulterdrücken', row: 'Rudern (Langhantel)', lat: 'Latzug', cable: 'Rudern am Kabel', legpress: 'Beinpresse', lunge: 'Ausfallschritte', legcurl: 'Beinbeuger', legext: 'Beinstrecker', calf: 'Wadenheben', curl: 'Bizepscurls', tri: 'Trizepsdrücken (Kabel)', lateral: 'Seitheben', pull: 'Klimmzüge', push: 'Liegestütze', legraise: 'Beinheben hängend', airsquat: 'Kniebeugen ohne Gewicht', sideplank: 'Seitstütz', wallsit: 'Wandsitzen' };
const names = e => [stem(e.n), ...(DE[e.k] ? [stem(DE[e.k])] : [])];
const FILL = /\b(ich|habe|hab|gerade|eben|jetzt|heute|gemacht|geschafft|trainiert|ungefahr|circa|ca|etwa|noch|dann|danach|i|did|just|have|done|about|for|mit|with|je|a|the|x|mal|wdh|wiederholungen|reps|satze|satz|sets|set|insgesamt|gesamt|lang|training|workout|dauer|trained|worked|out|today|around|roughly|approx|total|in)\b/g;

function findEx(seg, exs, hasKg) {
  let hit = null, len = 0;
  for (const e of exs) for (const name of [...names(e), ...(ALIAS[e.k] || [])]) {
    if (name.length < 3) continue; const short = name.length > 6 ? name.replace(/(en|e|n|s)$/, '') : name;
    if (seg.includes(short) && short.length > len) { hit = e; len = short.length; }
  }
  if (hit && (hit.k === 'airsquat' || hit.k === 'squat')) hit = exs.find(e => e.k === (hasKg ? 'squat' : 'airsquat')) || hit; // "Kniebeugen mit 80 kg" is the barbell squat, without weight the air squat
  return hit;
}

/** "100 Liegestütze, 3x10 Bankdrücken mit 80 kg, 2 Minuten Plank, 45 Minuten trainiert" -> { ex: [{ k, n, t, sets, neu? }], dur (s), miss: [text] } */
export function parseQuick(text, exs) {
  let t = ' ' + norm(text).replace(/(\d),(\d)/g, '$1.$2') + ' ';
  t = t.replace(/[a-z]+/g, w => WORDS[w] != null ? String(WORDS[w]) : w).replace(/\b(1) (halbe|halb)\b/g, '0.5').replace(/\banderthalb\b/g, '1.5');
  const src = String(text).split(/[^\p{L}\-]+/u), orig = r => r.split(' ').map(w => src.find(o => norm(o) === w) || w).map(w => w[0].toUpperCase() + w.slice(1)).join(' '); // the name as it was said, with umlauts
  const out = { ex: [], dur: 0, miss: [] };
  for (let seg of t.split(/\.(?!\d)|[;,\n]| und | and | dann | danach | then | plus /)) {
    seg = ' ' + seg.trim() + ' '; if (!seg.trim()) continue;
    let kg = 0, sec = 0, sets = 0, reps = 0, m;
    if ((m = seg.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilo\w*)\b/))) { kg = +m[1]; seg = seg.replace(m[0], ' '); }
    if ((m = seg.match(/(\d+(?:\.\d+)?)\s*(stunden|stunde|std|hours|hour|h|minuten|minute|min|minutes|sekunden|sekunde|sek|sec|seconds|s)\b/))) {
      sec = Math.round(+m[1] * (/^(st|h)/.test(m[2]) ? 3600 : /^m/.test(m[2]) ? 60 : 1)); seg = seg.replace(m[0], ' '); }
    if ((m = seg.match(/(\d+)\s*(?:x|×|\*|mal|satze|satz|sets|set)\s*(?:a|mit|je|zu|of|with)?\s*(\d+)/))) { sets = +m[1]; reps = +m[2]; seg = seg.replace(m[0], ' '); }
    else if ((m = seg.match(/(\d+)/))) { reps = +m[1]; sets = 1; seg = seg.replace(m[0], ' '); }
    const rest0 = seg.replace(FILL, ' ').replace(/[^a-z\- ]/g, ' ').replace(/\s+/g, ' ').trim();
    const e = findEx(seg, exs, kg > 0) || (rest0.length >= 4 && exs.find(y => names(y).some(n => n.startsWith(rest0)))) || null, rest = seg.replace(FILL, ' ').replace(/[^a-z\- ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!e && sec && !reps && rest.length < 3) { out.dur += sec; continue; }              // "45 Minuten trainiert"
    if (!e && !reps && !sec) { if (rest.length > 2) out.miss.push(rest); continue; }
    const x = e ? { k: e.k, n: e.n, t: e.t } : rest.length > 2 ? { k: '', n: orig(rest), t: sec && !reps ? 'time' : kg ? 'w' : 'bw', neu: true } : null;
    if (!x) { if (seg.trim()) out.miss.push(seg.trim()); continue; }
    const n = Math.min(20, Math.max(1, sets || 1));
    x.sets = [...Array(n)].map(() => x.t === 'time' ? { kg: '', r: '', s: sec || reps, done: true } : { kg: kg || '', r: reps || '', s: '', done: true });
    if (x.t !== 'time' && !reps) { out.miss.push(seg.trim()); continue; }
    const same = out.ex.find(y => y.k ? y.k === x.k : y.n === x.n); if (same) same.sets.push(...x.sets); else out.ex.push(x);
  }
  return out;
}

const MODEL = 'claude-opus-5-5';
/** the same result through the Claude API with the user's own key; throws a readable German message */
export async function aiQuick(text, exs, key = aiKey()) {
  if (!key) throw new Error('No AI key saved.');
  const schema = { type: 'object', additionalProperties: false, required: ['exercises', 'duration_minutes'], properties: {
    duration_minutes: { type: 'number', description: 'Total training time in minutes, 0 when not said' },
    exercises: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'name', 'kind', 'sets'], properties: {
      key: { type: 'string', description: 'key from the list when the exercise is in it, otherwise an empty string' },
      name: { type: 'string' }, kind: { type: 'string', enum: ['w', 'bw', 'time'] },
      sets: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kg', 'reps', 'seconds'], properties: { kg: { type: 'number' }, reps: { type: 'number' }, seconds: { type: 'number' } } } } } } } } };
  const sys = `You turn one spoken sentence about a finished strength workout into structured data. The athlete speaks German or English. `
    + `Use a key from this list when the exercise matches one (kind: w = weight x reps, bw = bodyweight reps, time = held for seconds):\n${exs.map(e => `${e.k} | ${e.n} | ${e.t}`).join('\n')}\n`
    + `For an exercise that is not in the list set key to "" and choose a short name and the fitting kind. A total without sets ("100 push-ups") is one set. Unused numbers are 0. Do not invent exercises or numbers that were not said.`;
  let r;
  try { r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: sys, messages: [{ role: 'user', content: text }], output_config: { effort: 'low', format: { type: 'json_schema', schema } } }) });
  } catch { throw new Error('AI not reachable. Are you online?'); }
  if (!r.ok) throw new Error(r.status === 401 ? 'The AI key was not accepted.' : r.status === 429 ? 'AI limit reached, try again later.' : `AI error ${r.status}.`);
  const j = await r.json(); if (j.stop_reason === 'refusal' || j.stop_reason === 'max_tokens') throw new Error('The AI did not give a complete answer.');
  let d; try { d = JSON.parse((j.content || []).filter(b => b.type === 'text').map(b => b.text).join('')); } catch { throw new Error('The AI answer was not readable.'); }
  const out = { ex: [], dur: Math.round((+d.duration_minutes || 0) * 60), miss: [] };
  for (const x of d.exercises || []) { const e = exs.find(y => y.k === x.key), t = e ? e.t : x.kind;
    const sets = (x.sets || []).slice(0, 20).map(s => t === 'time' ? { kg: '', r: '', s: Math.round(+s.seconds || 0), done: true } : { kg: +s.kg || '', r: Math.round(+s.reps || 0) || '', s: '', done: true }).filter(s => s.s || s.r);
    if (sets.length) out.ex.push(e ? { k: e.k, n: e.n, t, sets } : { k: '', n: String(x.name).slice(0, 60), t, sets, neu: true }); }
  return out;
}
