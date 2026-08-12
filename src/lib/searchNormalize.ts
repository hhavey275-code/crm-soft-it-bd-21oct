/**
 * Normalizes text for search matching.
 * Handles pasted text quirks: non-breaking / zero-width spaces, smart dashes,
 * curly quotes, multiple spaces, and unicode variants.
 */
export function normalizeSearchText(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  try {
    s = s.normalize("NFKC");
  } catch {
    /* ignore */
  }
  return s
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ") // exotic spaces
    .replace(/[\u2010-\u2015\u2212]/g, "-") // dashes
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Splits a normalized query into tokens (all must match). */
export function searchTokens(query: string): string[] {
  const q = normalizeSearchText(query);
  return q ? q.split(" ") : [];
}

/** True when every token of the query appears in any of the given fields. */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const haystack = fields.map(normalizeSearchText).filter(Boolean);
  if (!haystack.length) return false;
  const joined = haystack.join(" | ");
  return tokens.every((t) => joined.includes(t));
}
