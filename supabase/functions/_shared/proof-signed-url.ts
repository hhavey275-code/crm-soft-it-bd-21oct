// The `payment-proofs` bucket is PRIVATE. Telegram cannot fetch a public URL
// anymore ("Bad Request: failed to get HTTP URL content"), so every forwarder
// must convert the stored proof URL into a short-lived signed URL first.

const BUCKET = 'payment-proofs';

/** Extract the object path inside the payment-proofs bucket from any stored URL. */
export function proofStoragePath(url: string): string | null {
  if (!url) return null;
  try {
    const clean = url.split('?')[0];
    const marker = `/${BUCKET}/`;
    const idx = clean.indexOf(marker);
    if (idx === -1) {
      // Already a bare path like "userid/file.png"
      if (!clean.startsWith('http')) return clean.replace(/^\/+/, '');
      return null;
    }
    return decodeURIComponent(clean.slice(idx + marker.length));
  } catch {
    return null;
  }
}

/**
 * Returns a URL Telegram can actually download. Falls back to the original
 * URL if signing is not possible (e.g. external/non-storage links).
 */
export async function resolveProofUrlForTelegram(
  supabase: any,
  url: string | null | undefined,
  expiresIn = 60 * 60,
): Promise<string | null> {
  if (!url) return null;
  const path = proofStoragePath(url);
  if (!path) return url;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
      console.warn('resolveProofUrlForTelegram: sign failed', path, error?.message);
      return url;
    }
    return data.signedUrl;
  } catch (e) {
    console.warn('resolveProofUrlForTelegram: exception', (e as any)?.message);
    return url;
  }
}
