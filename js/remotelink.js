// The phone remote's line to the server (tools/remote-api.mjs), shared by the desktop (js/remotepad.js) and the phone
// (js/remote.js): Server-Sent Events first (low latency, plain HTTP, works through the Tailscale funnel), a long-poll loop
// when the stream does not come up, and a calm retry after the phone was locked or the network dropped.
// listen(params, onMsg, onState): params is the query ('id=…&key=…' or 'tok=…'); onMsg(type, data) gets 'hello', 'ev',
// 'status' and 'bye'; onState('live' | 'retry' | 'gone'). Returns { close, kick }.
export async function post(op, body) {
  const r = await fetch('/api/remote/' + op, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(body?.$token ? { 'X-RF-Token': body.$token } : {}) },
    body: JSON.stringify({ ...body, $token: undefined }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'The server is not answering.'), { status: r.status });
  return j;
}
export function listen(params, onMsg, onState) {
  let es = null, closed = false, mode = 'sse', last = 0, opened = false, fails = 0, timer = 0, ctl = null, state = '';
  const set = s => { if (s !== state) { state = s; onState?.(s); } };
  const gone = () => { if (closed) return; stop(); closed = true; set('gone'); };
  const msg = (type, d) => { if (d && typeof d.n === 'number' && type !== 'hello') last = Math.max(last, d.n); if (type === 'bye') return gone(); onMsg(type, d); };
  function stop() { clearTimeout(timer); es?.close(); es = null; ctl?.abort(); ctl = null; }
  function sse() {
    stop(); if (closed) return;
    es = new EventSource('/api/remote/stream?' + params);
    const watchdog = setTimeout(() => { if (!opened) { mode = 'poll'; poll(); } }, 6000); // no stream after 6 s (a proxy that buffers): long-poll
    es.onopen = () => { opened = true; fails = 0; clearTimeout(watchdog); set('live'); };
    for (const t of ['hello', 'ev', 'status', 'bye']) es.addEventListener(t, e => { try { msg(t, JSON.parse(e.data)); } catch {} });
    es.onerror = () => {
      if (closed || !es) return;
      if (es.readyState === EventSource.CLOSED) { // refused (404: the session is gone) or the server is away: ask once by poll
        clearTimeout(watchdog); es = null; set('retry'); check();
      } else set('retry'); // the browser reconnects by itself
    };
  }
  async function check() {
    try { const r = await fetch(`/api/remote/poll?${params}&peek=1`, { cache: 'no-store', signal: AbortSignal.timeout?.(2500) }); if (r.status === 404) return gone(); } catch {}
    if (!closed) timer = setTimeout(() => (mode === 'sse' && ++fails < 4 ? sse() : (mode = 'poll', poll())), Math.min(8000, 1000 * 2 ** fails));
  }
  async function poll() {
    stop(); if (closed) return;
    ctl = new AbortController(); const my = ctl;
    try {
      const r = await fetch(`/api/remote/poll?${params}&after=${last}`, { cache: 'no-store', signal: my.signal });
      if (r.status === 404) return gone();
      if (!r.ok) throw 0;
      const j = await r.json(); fails = 0; set('live');
      if (Array.isArray(j.evs)) { for (const e of j.evs) msg('ev', e); if (typeof j.phones === 'number') onMsg('ev', { t: 'phones', c: j.phones }); }
      else if (j.s !== undefined) msg('status', { n: j.n, s: j.s });
      if (typeof j.n === 'number') last = Math.max(last, j.n);
      if (!closed && my === ctl) timer = setTimeout(poll, 30);
    } catch (e) { if (closed || my !== ctl) return; set('retry'); timer = setTimeout(poll, Math.min(8000, 1000 * 2 ** Math.min(3, fails++))); }
  }
  sse();
  return {
    close() { closed = true; stop(); },
    /** after the phone was locked: start over at once when the line is not live */
    kick() { if (closed) return; if (state !== 'live' || (mode === 'sse' && (!es || es.readyState !== EventSource.OPEN))) { fails = 0; mode === 'sse' ? sse() : poll(); } },
    get state() { return state; },
  };
}
