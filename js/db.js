// IndexedDB storage: routes (incl. video files), rides, settings.
const DB_NAME = 'rideframe';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('routes')) db.createObjectStore('routes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('rides')) {
        const s = db.createObjectStore('rides', { keyPath: 'id' });
        s.createIndex('routeId', 'routeId');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async put(store, value) { return tx(store, 'readwrite', s => req2p(s.put(value))); },
  async get(store, key) { return tx(store, 'readonly', s => req2p(s.get(key))); },
  async all(store) { return tx(store, 'readonly', s => req2p(s.getAll())); },
  async del(store, key) { return tx(store, 'readwrite', s => req2p(s.delete(key))); },
  async ridesFor(routeId) {
    return tx('rides', 'readonly', s => req2p(s.index('routeId').getAll(routeId)));
  },
  async kvGet(key) { return tx('kv', 'readonly', s => req2p(s.get(key))); },
  async kvSet(key, value) { return tx('kv', 'readwrite', s => req2p(s.put(value, key))); },
  async deleteRoute(id) {
    const route = await this.get('routes', id);
    if (route) for (const p of route.parts) await this.del('videos', p.videoId);
    const rides = await this.ridesFor(id);
    for (const r of rides) await this.del('rides', r.id);
    await this.del('routes', id);
  },
  async persist() {
    try { return await navigator.storage?.persist?.(); } catch { return false; }
  },
  async usage() {
    try { return await navigator.storage.estimate(); } catch { return null; }
  },
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
