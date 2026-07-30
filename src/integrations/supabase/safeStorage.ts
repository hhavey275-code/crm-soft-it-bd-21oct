// Resilient auth storage for iOS Safari (private mode / ITP / quota errors).
// Order: localStorage -> cookie -> in-memory. Never throws.

const memory = new Map<string, string>();

function localStorageWorks(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const probe = "__sb_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function cookieGet(key: string): string | null {
  try {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(
      new RegExp("(?:^|; )" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function cookieSet(key: string, value: string) {
  try {
    if (typeof document === "undefined") return;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

function cookieRemove(key: string) {
  try {
    if (typeof document === "undefined") return;
    document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

export const safeAuthStorage = {
  getItem(key: string): string | null {
    if (localStorageWorks()) {
      try {
        const v = window.localStorage.getItem(key);
        if (v !== null) return v;
      } catch {
        /* fall through */
      }
    }
    return cookieGet(key) ?? memory.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    memory.set(key, value);
    if (localStorageWorks()) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch {
        /* fall through to cookie */
      }
    }
    cookieSet(key, value);
  },
  removeItem(key: string): void {
    memory.delete(key);
    try {
      if (typeof window !== "undefined" && window.localStorage) window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    cookieRemove(key);
  },
};
