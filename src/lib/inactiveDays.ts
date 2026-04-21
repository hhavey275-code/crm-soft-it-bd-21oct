// Helper to compute how many days an ad account has been inactive
// using Asia/Dhaka timezone for consistency with the rest of the app.
//
// IMPORTANT (rule change): `created_at` is NO LONGER used as a fallback
// "last activity" date. If we don't have a verified `last_spend_date`,
// we report `tier = "unknown"` so the UI can show "Needs sync" instead
// of falsely counting the account as inactive (e.g. "29d").

export type InactiveTier = "active" | "warning" | "alert" | "critical" | "unknown";

export interface InactiveInfo {
  /** Verified inactive days. 0 when tier === "unknown". */
  days: number;
  tier: InactiveTier;
  /** True only when a real last_spend_date was provided. */
  hasEverSpent: boolean;
  /** True when we cannot verify activity (no last_spend_date recorded). */
  isUnknown: boolean;
}

function dhakaDateString(d: Date): string {
  // Returns YYYY-MM-DD in Asia/Dhaka (UTC+6)
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000;
  const dhaka = new Date(utcMs + 6 * 60 * 60_000);
  return dhaka.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  const f = new Date(from + "T00:00:00Z").getTime();
  const t = new Date(to + "T00:00:00Z").getTime();
  return Math.floor((t - f) / (1000 * 60 * 60 * 24));
}

/**
 * @param lastSpendDate verified last spend date (YYYY-MM-DD) from ad_account_insights
 * @param _fallbackDate (DEPRECATED) created_at — accepted for backwards compatibility
 *        but intentionally NOT used. Pass it or omit it; it has no effect.
 */
export function getInactiveDays(
  lastSpendDate?: string | null,
  _fallbackDate?: string | null,
): InactiveInfo {
  if (!lastSpendDate) {
    return { days: 0, tier: "unknown", hasEverSpent: false, isUnknown: true };
  }

  const today = dhakaDateString(new Date());
  const days = Math.max(0, diffDays(lastSpendDate.slice(0, 10), today));

  let tier: InactiveTier = "active";
  if (days >= 30) tier = "critical";
  else if (days >= 20) tier = "alert";
  else if (days >= 7) tier = "warning";

  return { days, tier, hasEverSpent: true, isUnknown: false };
}
