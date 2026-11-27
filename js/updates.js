// "Updates" (27.11., owner: "What changed" leaves the Today page): the insight lines (js/insights.js) become a small history behind a
// bell in the page header, with a dot while something is new since it was last opened. Kept on this device (db kv 'updates', per
// account): the last 30 lines, each with the day it first showed up; the same line again is not new.
//   merge(store, lines, now) and unseen(store) are pure (tools/updates-test.mjs); the sheet needs a page.
export const KEEP = 30;
const norm = t => String(t || '').replace(/\b(today|yesterday|on \w+day|\w+day)\b/gi, '').replace(/\d+([.,]\d+)?/g, '#').replace(/\s+/g, ' ').trim(); // "Weight trend down 0.4 kg" and "… 0.5 kg" are the same line, the newer wording wins
/** store = { u, seen, list: [{ k, text, href, at }] } (newest first); lines = insights() */
export function merge(store, lines, u = '', now = Date.now()) {
  const st = store && store.u === u ? { u, seen: store.seen || 0, list: (store.list || []).slice() } : { u, seen: 0, list: [] };
  for (const l of [...(lines || [])].reverse()) {
    if (!l?.text || l.k === 'last') continue; // "Last session …" is not news, the feed has it
    const i = st.list.findIndex(x => norm(x.text) === norm(l.text) && x.k === l.k);
    if (i >= 0) { const x = st.list[i]; if (x.text !== l.text && now - x.at > 3 * 864e5) st.list.unshift({ k: l.k, text: l.text, href: l.href, at: now }); /* a few days on with new numbers: a new line, the old one stays as history */ else st.list[i] = { ...x, text: l.text, href: l.href || x.href }; continue; }
    st.list.unshift({ k: l.k, text: l.text, href: l.href, at: now });
  }
  st.list.sort((a, b) => b.at - a.at); st.list = st.list.slice(0, KEEP);
  return st;
}
export const unseen = st => (st?.list || []).filter(x => x.at > (st.seen || 0)).length;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function loadStore() { try { const { db } = await import('./db.js'); return (await db.kvGet('updates').catch(() => null)) || null; } catch { return null; } }
export async function saveStore(st) { try { const { db } = await import('./db.js'); await db.kvSet('updates', st); } catch {} }
const dayLabel = (t, now = Date.now()) => { const n = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 864e5);
  return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : n < 7 ? new Date(t).toLocaleDateString('en-GB', { weekday: 'long' }) : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
/** the sheet: the lines grouped by day, newest first; marks everything seen */
export function openUpdates(st, onSeen = () => {}) {
  document.getElementById('upSheet')?.remove();
  const s = document.createElement('div'); s.className = 'psheet'; s.id = 'upSheet'; document.body.append(s);
  const was = st?.seen || 0, list = st?.list || [], groups = [];
  for (const x of list) { const d = dayLabel(x.at); (groups.at(-1)?.d === d ? groups.at(-1) : (groups.push({ d, l: [] }), groups.at(-1))).l.push(x); }
  s.innerHTML = `<div class="psheetin up" role="dialog" aria-modal="true" aria-labelledby="upT"><div class="label" id="upT">Updates</div>
    ${list.length ? groups.map(g => `<h3 class="ksec uph">${esc(g.d)}</h3><ul class="upl">${g.l.map(x => `<li><a class="tdins tdi-${esc(x.k)}${x.at > was ? ' new' : ''}" href="${esc(x.href || '#')}"><span>${esc(x.text)}</span><i aria-hidden="true">›</i></a></li>`).join('')}</ul>`).join('')
    : '<p class="phint">Nothing yet. New records, your fitness and weight trend and streaks show up here as your data comes in.</p>'}
    <div class="pfoot"><button class="btn" id="upOk">Done</button></div></div>`;
  const close = () => s.remove();
  s.onclick = e => { if (e.target === s) close(); }; s.querySelector('#upOk').onclick = close;
  if (st) { st.seen = Date.now(); saveStore(st); } onSeen();
  return s;
}
