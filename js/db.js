/* Storage layer.
 *
 * IndexedDB is the real store. If it is unavailable (older iOS Safari in
 * Private Browsing, for instance) we transparently fall back to localStorage
 * so the app still works rather than showing an error the user can't act on.
 */

const DB_NAME = 'journal';
const DB_VERSION = 1;
const LS_ENTRIES = 'journal.fallback.entries';
const LS_META = 'journal.fallback.meta';

let dbPromise = null;
let usingFallback = false;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ── localStorage fallback ─────────────────────────────────────────────── */

function lsRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function lsWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const fallback = {
  async allEntries() {
    return lsRead(LS_ENTRIES, []);
  },
  async putEntry(entry) {
    const list = lsRead(LS_ENTRIES, []).filter((e) => e.id !== entry.id);
    list.push(entry);
    lsWrite(LS_ENTRIES, list);
  },
  async putEntries(entries) {
    const byId = new Map(lsRead(LS_ENTRIES, []).map((e) => [e.id, e]));
    entries.forEach((e) => byId.set(e.id, e));
    lsWrite(LS_ENTRIES, [...byId.values()]);
  },
  async deleteEntry(id) {
    lsWrite(LS_ENTRIES, lsRead(LS_ENTRIES, []).filter((e) => e.id !== id));
  },
  async clearEntries() {
    lsWrite(LS_ENTRIES, []);
  },
  async getMeta(key, dflt) {
    const meta = lsRead(LS_META, {});
    return key in meta ? meta[key] : dflt;
  },
  async setMeta(key, value) {
    const meta = lsRead(LS_META, {});
    meta[key] = value;
    lsWrite(LS_META, meta);
  },
};

/* ── Public API ────────────────────────────────────────────────────────── */

export async function init() {
  try {
    await openDb();
    usingFallback = false;
  } catch {
    usingFallback = true;
  }
  return { usingFallback };
}

export function isFallback() {
  return usingFallback;
}

export async function allEntries() {
  if (usingFallback) return fallback.allEntries();
  try {
    const db = await openDb();
    const list = await wrap(tx(db, 'entries', 'readonly').getAll());
    return list.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    usingFallback = true;
    return fallback.allEntries();
  }
}

export async function putEntry(entry) {
  if (usingFallback) return fallback.putEntry(entry);
  try {
    const db = await openDb();
    await wrap(tx(db, 'entries', 'readwrite').put(entry));
  } catch {
    usingFallback = true;
    return fallback.putEntry(entry);
  }
}

export async function putEntries(entries) {
  if (!entries.length) return;
  if (usingFallback) return fallback.putEntries(entries);
  try {
    const db = await openDb();
    const t = db.transaction('entries', 'readwrite');
    const store = t.objectStore('entries');
    entries.forEach((e) => store.put(e));
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } catch {
    usingFallback = true;
    return fallback.putEntries(entries);
  }
}

export async function deleteEntry(id) {
  if (usingFallback) return fallback.deleteEntry(id);
  try {
    const db = await openDb();
    await wrap(tx(db, 'entries', 'readwrite').delete(id));
  } catch {
    usingFallback = true;
    return fallback.deleteEntry(id);
  }
}

export async function clearEntries() {
  if (usingFallback) return fallback.clearEntries();
  try {
    const db = await openDb();
    await wrap(tx(db, 'entries', 'readwrite').clear());
  } catch {
    usingFallback = true;
    return fallback.clearEntries();
  }
}

export async function getMeta(key, dflt = null) {
  if (usingFallback) return fallback.getMeta(key, dflt);
  try {
    const db = await openDb();
    const row = await wrap(tx(db, 'meta', 'readonly').get(key));
    return row ? row.value : dflt;
  } catch {
    usingFallback = true;
    return fallback.getMeta(key, dflt);
  }
}

export async function setMeta(key, value) {
  if (usingFallback) return fallback.setMeta(key, value);
  try {
    const db = await openDb();
    await wrap(tx(db, 'meta', 'readwrite').put({ key, value }));
  } catch {
    usingFallback = true;
    return fallback.setMeta(key, value);
  }
}

/** Rough estimate of space used, for the settings screen. */
export async function estimateUsage() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage } = await navigator.storage.estimate();
      if (typeof usage === 'number') return usage;
    }
  } catch { /* not supported — fall through */ }
  return null;
}

/** Ask the browser not to evict this data when storage runs low. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch { /* not supported */ }
  return false;
}
