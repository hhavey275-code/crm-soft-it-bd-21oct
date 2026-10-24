// Browser-only cache for slow Meta reads (page info, posts, pixels, video library).
// Data is reused until the user presses "Update now".
const PREFIX = "adsCache:";

export function readCache<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch { return undefined; }
}

export function writeCache(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* full */ }
}

/** Returns cached data unless `force`; otherwise fetches and stores it. */
export async function cached<T>(key: string, fetcher: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    const hit = readCache<T>(key);
    if (hit !== undefined) return hit;
  }
  const v = await fetcher();
  writeCache(key, v);
  return v;
}
