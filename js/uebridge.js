// Sends the live ride to the Unreal view (via tools/ue-relay.mjs on ws://localhost:8790), 10 times a second.
// Unreal builds its road from the same track file, so it only needs the distance: heights can never disagree.
//   {type:'hello', route, length}   once per connection
//   {type:'ride', d, v, grade, watt, hr, cad, paused, t}   every 100 ms
export class UEBridge {
  constructor(route, length, url = 'ws://localhost:8790') { this.route = route; this.length = length; this.url = url; this.last = 0; this.dead = false; this._open(); }
  _open() {
    if (this.dead) return;
    try { this.ws = new WebSocket(this.url); } catch { return this._retry(); }
    this.ws.onopen = () => this._send({ type: 'hello', route: this.route, length: this.length });
    this.ws.onclose = () => this._retry(); this.ws.onerror = () => {};
  }
  _retry() { if (!this.dead) setTimeout(() => this._open(), 3000); }
  _send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  get connected() { return this.ws?.readyState === 1; }
  update(now, s) { if (now - this.last < 100) return; this.last = now; this._send({ type: 'ride', ...s }); }
  close() { this.dead = true; try { this.ws?.close(); } catch { /* already closed */ } }
}
