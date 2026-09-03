import { supabase } from "@/integrations/supabase/client";

const BUCKET = "payment-proofs";
// Long-lived signed URL (10 years) — the bucket is private, so access relies on
// this unguessable token instead of a public URL.
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

/** Extract the object path inside the payment-proofs bucket from any stored URL. */
export function proofStoragePath(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.includes(`${BUCKET}/`)) return null;
  const afterBucket = url.split(`${BUCKET}/`).pop();
  if (!afterBucket) return null;
  return decodeURIComponent(afterBucket.split("?")[0]);
}

/** Create a long-lived signed URL for a freshly uploaded proof object path. */
export async function createProofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, TEN_YEARS);
  if (error || !data?.signedUrl) throw error || new Error("Could not create proof URL");
  return data.signedUrl;
}

/**
 * Resolve a stored proof URL into a viewable URL.
 * Legacy public URLs (and expired signed URLs) are re-signed on demand.
 */
export async function resolveProofUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const path = proofStoragePath(url);
  if (!path) return url;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl || url;
}

/** Open a payment proof in a new tab using a fresh signed URL. */
export async function openProof(url: string | null | undefined) {
  const resolved = await resolveProofUrl(url);
  if (resolved) window.open(resolved, "_blank", "noopener,noreferrer");
}
