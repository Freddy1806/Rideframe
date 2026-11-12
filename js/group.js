// Group ride: ride live together with friends, everyone on their own trainer at home.
// Peer to peer over WebRTC (PeerJS). The public PeerJS server only introduces the browsers to each other;
// the ride data then goes directly between them. One rider opens a group and gets a 5-letter code, the others
// join with it. The host relays every rider's position to all, about twice a second, and starts the ride for all.
import { cleanLook } from './look.js';

const PREFIX = 'rideframe-grp-';
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';

let peerLib;
async function loadPeer() {
  if (window.Peer) return window.Peer;
  peerLib ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = new URL('../vendor/peerjs.min.js', import.meta.url).href;
    s.onload = () => res(window.Peer); s.onerror = () => rej(new Error('PeerJS konnte nicht geladen werden'));
    document.head.append(s);
  });
  return peerLib;
}

// rejoin (Freddy 12.11.): the same rider id in this browser, and where you last were in which group, survive a reload
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
function riderId() { // per tab (two tabs in one browser stay two riders), kept over a reload of that tab
  let id = null; try { id = sessionStorage.getItem('rf_rider_id'); if (!id) sessionStorage.setItem('rf_rider_id', id = Math.random().toString(36).slice(2, 10)); } catch {} return id || Math.random().toString(36).slice(2, 10); }
/** the group you last rode in (4 h): { code, host, routeId, d, t } */
export function lastGroup() { const l = LS.get('rf_group_last'); return l && typeof l.code === 'string' && Date.now() - l.t < 4 * 3600e3 ? l : null; }
/** where to (re)start on this route in this group: your own last spot first, else what the host suggests */
export function rejoinAt(code, routeId, suggested = 0) { const l = lastGroup(); return l && l.code === code && l.routeId === routeId && l.d > 0 ? l.d : suggested; }
export const newCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

export class Group {
  /** opts: { name, code (join) or none (host), onChange(group), onStart({ routeId, at }), onError(msg) } */
  constructor(opts) {
    Object.assign(this, opts);
    this.host = !opts.code; this.code = opts.code || opts.hostCode || newCode(); this.lastD = new Map(); // host: rider id -> last distance (for rejoins)
    this.me = { id: riderId(), name: opts.name || 'Ich', look: opts.look ? cleanLook(opts.look) : null, d: 0, v: 0, w: 0, hr: 0, riding: false };
    this.riders = new Map(); // id -> state of the others
    this.conns = []; this.open = false; this.routeId = null;
  }

  async connect() {
    const Peer = await loadPeer();
    return new Promise((resolve, reject) => {
      const fail = e => { const m = this._msg(e); this.onError?.(m); reject(new Error(m)); };
      this.peer = this.host ? new Peer(PREFIX + this.code, { debug: 0 }) : new Peer({ debug: 0 });
      this.peer.on('error', e => { if (!this.open) fail(e); else this.onError?.(this._msg(e)); });
      this.peer.on('open', id => {
        this.me.pid = id; // peer id: the voice chat calls riders directly with it (see voice.js)
        if (this.host) {
          this.open = true; this.peer.on('connection', c => this._wire(c)); this._relayT = setInterval(() => this._relayAll(), 1000); resolve(this);
        } else {
          const c = this.peer.connect(PREFIX + this.code, { reliable: true });
          const to = setTimeout(() => fail({ type: 'ice-timeout' }), 15000);
          c.on('open', () => { clearTimeout(to); this.open = true; resolve(this); });
          this._wire(c);
        }
      });
      this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch {} });
    });
  }

  _msg(e) {
    if (e?.type === 'unavailable-id') return 'Dieser Gruppen-Code ist gerade belegt. Bitte neu erstellen.';
    if (e?.type === 'peer-unavailable') return 'Keine Gruppe mit diesem Code gefunden. Ist der Gastgeber online?';
    if (e?.type === 'ice-timeout') return 'Die Gruppe ist da, aber eure Router lassen keine direkte Verbindung zu. Probiert es nochmal, sonst über einen Handy-Hotspot.';
    if (e?.type === 'network' || e?.type === 'server-error' || e?.type === 'socket-error') return 'Keine Verbindung zum Vermittlungs-Server. Internet prüfen.';
    return 'Verbindung: ' + (e?.message || e?.type || e);
  }

  _wire(c) {
    this.conns.push(c);
    c.on('open', () => { c.send({ t: 'hello', r: this.me }); if (this.host && this.routeId) c.send({ t: 'route', routeId: this.routeId }); });
    c.on('data', m => this._recv(m, c));
    c.on('close', () => {
      this.conns = this.conns.filter(x => x !== c);
      if (c._rid) { this.riders.delete(c._rid); this._relayAll(); }
      if (!this.host && !this._closed) { this.onError?.('Verbindung zur Gruppe getrennt · verbinde neu …'); this._retry(); } // the host reloads: same code, back in a few seconds
      this.onChange?.(this);
    });
  }

  _retry(n = 0) {
    if (this._closed || n > 60 || this.conns.some(c => c.open)) return;
    setTimeout(() => { if (this._closed || this.conns.some(c => c.open)) return;
      try { const c = this.peer.connect(PREFIX + this.code, { reliable: true }); c.on('open', () => this.onError?.('Wieder mit der Gruppe verbunden')); this._wire(c);
        setTimeout(() => { if (!c.open) { this.conns = this.conns.filter(x => x !== c); this._retry(n + 1); } }, 8000); } catch { this._retry(n + 1); } }, 4000);
  }

  _recv(m, c) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello' || m.t === 'state') {
      const r = this._clean(m.r); if (!r || r.id === this.me.id) return;
      c._rid ||= r.id; r.seen = performance.now(); this.riders.set(r.id, r);
      if (this.host && r.d > 0) this.lastD.set(r.id, r.d);
      if (this.host && m.t === 'hello') { this._relayAll();
        // late joiner or rejoin: the host is already out there, so the newcomer starts at once, at his own last spot or next to the host
        if (this.routeId && this.rolling && !(r.d > 0)) c.send({ t: 'start', routeId: this.routeId, at: Date.now() + 1500, d: this.lastD.get(r.id) ?? Math.max(0, (this.me.d || 0) - 20) }); }
      this.onChange?.(this);
    } else if (m.t === 'all' && !this.host) { // host's list of everyone
      const now = performance.now();
      for (const x of m.list || []) { const r = this._clean(x); if (r && r.id !== this.me.id) { r.seen = now; this.riders.set(r.id, r); } }
      const ids = new Set((m.list || []).map(x => x.id)); for (const id of this.riders.keys()) if (!ids.has(id)) this.riders.delete(id);
      this.onChange?.(this);
    } else if (m.t === 'route' && !this.host) { this.routeId = String(m.routeId); this.onChange?.(this); }
    else if (m.t === 'start' && !this.host && !(this.me.d > 0 && !this.me.done)) this.onStart?.({ routeId: String(m.routeId), at: Number(m.at) || 0, d: Math.max(0, Number(m.d) || 0) });
  }

  _clean(r) { // never trust what comes over the wire
    if (!r || typeof r.id !== 'string') return null;
    const n = v => (Number.isFinite(+v) ? +v : 0);
    return { id: r.id.slice(0, 16), name: String(r.name || 'Fahrer').slice(0, 20), d: n(r.d), v: n(r.v), w: Math.round(n(r.w)), hr: Math.round(n(r.hr)), riding: !!r.riding, done: !!r.done, pid: typeof r.pid === 'string' ? r.pid.slice(0, 64) : '', vo: !!r.vo, sg: Array.isArray(r.sg) ? r.sg.slice(-6).filter(x => Array.isArray(x) && typeof x[0] === 'string').map(x => [x[0].slice(0, 40), n(x[1])]) : [], look: r.look && typeof r.look === 'object' ? cleanLook(r.look) : null };
  }

  _relayAll() {
    if (!this.host) return;
    const list = [this.me, ...this.riders.values()].map(({ seen, ...r }) => r);
    for (const c of this.conns) if (c.open) c.send({ t: 'all', list });
  }

  /** new look from the editor: everyone sees it right away */
  setLook(look) { this.me.look = cleanLook(look); this._sent = 0; this.update({}); this.onChange?.(this); }

  /** voice chat on/off: everyone learns it with the next state, so the others can call (voice.js) */
  setVoice(on) { this.me.vo = !!on; this._sent = 0; this.update({}); }

  /** host: choose the route everybody rides */
  setRoute(routeId) { this.routeId = routeId; if (this.host) for (const c of this.conns) if (c.open) c.send({ t: 'route', routeId }); this.onChange?.(this); }

  /** host: start the ride for everyone in 5 seconds (each rider's own clock; a second off is fine) */
  start(routeId) {
    const at = Date.now() + 5000;
    for (const c of this.conns) if (c.open) c.send({ t: 'start', routeId, at });
    return at;
  }

  /** own position, called from the ride loop (sent at most twice a second) */
  update(s) {
    const { look, ...rest } = s; Object.assign(this.me, rest); if (this.me.riding) this.rolling = true;
    if (look && look !== this._lookSrc) { this._lookSrc = look; this.me.look = cleanLook(look); }
    const now = performance.now(); if (now - (this._sent || 0) < 500) return; this._sent = now;
    if (this.routeId && this.me.d > 0) LS.set('rf_group_last', { code: this.code, host: this.host, routeId: this.routeId, d: Math.round(this.me.d), el: Math.round(this.me.el || 0), t: Date.now() });
    if (this.host) this._relayAll();
    else for (const c of this.conns) if (c.open) c.send({ t: 'state', r: this.me });
  }

  others() { const now = performance.now(); return [...this.riders.values()].filter(r => now - r.seen < 15000); }

  get link() { return `${location.origin}${location.pathname}?join=${this.code}`; }

  close() { this._closed = true; this.voice?.stop(); this.voice = null; clearInterval(this._relayT); try { for (const c of this.conns) c.close(); this.peer?.destroy(); } catch {} this.open = false; }
}
