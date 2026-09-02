import { supabase } from "@/integrations/supabase/client";

const REF_KEY = "pending_referral_code";

/** Capture ?ref=CODE from the current URL and remember it until signup finishes. */
export function captureReferralCodeFromUrl() {
  if (typeof window === "undefined") return null;
  try {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (code && code.trim()) {
      localStorage.setItem(REF_KEY, code.trim().toUpperCase());
      return code.trim().toUpperCase();
    }
    return localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

export function getPendingReferralCode() {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

export function clearPendingReferralCode() {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Bind the signed-in user to the referrer stored at signup time.
 * Safe to call repeatedly — the DB blocks self-referral and re-linking.
 */
export async function attachPendingReferral() {
  const code = getPendingReferralCode();
  if (!code) return;
  try {
    const { data, error } = await supabase.rpc("attach_referral", { p_code: code });
    if (error) {
      console.warn("attach_referral failed:", error.message);
      return;
    }
    const res = data as { ok?: boolean; error?: string } | null;
    // Stop retrying on anything except a transient failure.
    if (res?.ok || ["already_referred", "self_referral", "invalid_code"].includes(res?.error ?? "")) {
      clearPendingReferralCode();
    }
  } catch (err) {
    console.warn("attach_referral error:", err);
  }
}

export function buildReferralLink(code: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/signup?ref=${code}`;
}
