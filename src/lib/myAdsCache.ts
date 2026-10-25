// Browser-only IndexedDB cache for My Ads lists. Big accounts (thousands of campaigns)
// overflow localStorage, so saved Facebook results live here to open instantly next time.
const DB = "myads-cache";
const STORE = "lists";

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function cacheGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => resolve(undefined);
  });
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Apply confirmed mutations to every saved date/account view for this user. */
export async function cacheTransform(userId: string, transform: (value: any) => any): Promise<void> {
  const prefix = `myads-list2:${userId}:`;
  const db = await open();
  if (db) await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const request = tx.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(prefix)) cursor.update(transform(cursor.value));
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith(prefix))) {
      const raw = localStorage.getItem(key);
      if (raw) localStorage.setItem(key, JSON.stringify(transform(JSON.parse(raw))));
    }
  } catch { /* IndexedDB is the primary cache. */ }
}
