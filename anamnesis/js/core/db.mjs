// Local persistence: one IndexedDB database, one append-only "events" store.
// Falls back to in-memory storage (clearly reported) where IndexedDB is unavailable.

const DB_NAME = 'anamnesis-os';
const DB_VERSION = 1;
const STORE = 'events';

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export async function openLog(name = DB_NAME) {
  if (!globalThis.indexedDB) return memoryLog('IndexedDB unavailable');
  try {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'seq' });
    };
    const db = await req(open);
    return {
      kind: 'indexeddb',
      async all() { return req(db.transaction(STORE).objectStore(STORE).getAll()); },
      async append(ev) {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).add(ev); // add() fails on duplicate seq: no silent overwrite
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
      },
      async replaceAll(events) {
        const tx = db.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        st.clear();
        for (const ev of events) st.add(ev);
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
      },
    };
  } catch (err) {
    return memoryLog(`IndexedDB failed: ${err?.message || err}`);
  }
}

export function memoryLog(reason = 'memory') {
  let events = [];
  return {
    kind: 'memory', reason,
    async all() { return events.slice(); },
    async append(ev) { if (events.some(e => e.seq === ev.seq)) throw new Error('duplicate seq'); events.push(ev); },
    async replaceAll(list) { events = list.slice(); },
  };
}

export async function storageStatus() {
  const out = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); out.usage = e.usage; out.quota = e.quota; }
  } catch { /* not supported */ }
  return out;
}

export async function requestPersistence() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
