// Cleans a pasted server key: hosting dashboards often keep stray spaces, quotes,
// a "Bearer " prefix or a whole "NAME=value" line, which silently breaks every read.
export function cleanKey(raw: string | undefined | null): string {
  let k = String(raw ?? "").trim();
  const eq = k.match(/^[A-Z0-9_]+\s*=\s*(.+)$/);
  if (eq) k = eq[1].trim();
  k = k.replace(/^bearer\s+/i, "").replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, "");
  return k;
}

export function serviceKey(): string {
  return cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Safe description of a key's shape (never its value).
export function describeKey(raw: string | undefined | null) {
  const original = String(raw ?? "");
  const k = cleanKey(original);
  let role: string | null = null;
  let ref: string | null = null;
  try {
    const p = JSON.parse(atob(k.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    role = p.role ?? null; ref = p.ref ?? null;
  } catch {
    role = k.startsWith("sb_secret_") ? "service_role" : k.startsWith("sb_publishable_") ? "publishable" : k ? "unknown" : null;
  }
  return {
    role, projectRef: ref, length: k.length, startsWith: k.slice(0, 3), dots: (k.match(/\./g) ?? []).length,
    hadExtraCharacters: original !== k,
  };
}
