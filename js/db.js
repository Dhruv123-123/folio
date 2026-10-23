// Tiny IndexedDB wrapper. Book metadata and book content live in separate stores
// so the library can load quickly without pulling every chapter into memory.

const DB_NAME = 'folio';
const VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('content')) db.createObjectStore('content', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async allBooks() { return tx('books', 'readonly', (s) => req2p(s.getAll())); },
  async getBook(id) { return tx('books', 'readonly', (s) => req2p(s.get(id))); },
  async putBook(book) { return tx('books', 'readwrite', (s) => { s.put(book); }); },
  async getContent(id) { return tx('content', 'readonly', (s) => req2p(s.get(id))); },
  async putContent(c) { return tx('content', 'readwrite', (s) => { s.put(c); }); },
  async deleteBook(id) {
    await tx('books', 'readwrite', (s) => { s.delete(id); });
    await tx('content', 'readwrite', (s) => { s.delete(id); });
  },
  async get(key) { return tx('kv', 'readonly', (s) => req2p(s.get(key))); },
  async set(key, val) { return tx('kv', 'readwrite', (s) => { s.put(val, key); }); },
};

// Debounced partial updates to a book record (progress, bookmarks, highlights).
const pending = new Map();
export function patchBook(id, patch) {
  const p = pending.get(id) || { patch: {}, timer: 0 };
  Object.assign(p.patch, patch);
  clearTimeout(p.timer);
  p.timer = setTimeout(() => flushBook(id), 400);
  pending.set(id, p);
}
export async function flushBook(id) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  const book = await db.getBook(id);
  if (!book) return;
  await db.putBook({ ...book, ...p.patch });
}
export async function flushAll() {
  await Promise.all([...pending.keys()].map(flushBook));
}
