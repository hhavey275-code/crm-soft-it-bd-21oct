import { cn } from "@/lib/utils";
import { getInactiveDays } from "@/lib/inactiveDays";

interface InactiveBadgeProps {
  lastSpendDate?: string | null;
  /** @deprecated kept for backwards compatibility — no longer used. */
  fallbackDate?: string | null;
  className?: string;
  /** When true, also render a small badge during the active (0-6 day) tier. Default false. */
  showActive?: boolean;
  /** When true, also render a badge for the "unknown" tier (no verified spend history). Default false. */
  showUnknown?: boolean;
}

/**
 * Tiny visual indicator showing how many days an ad account has been unused.
 * Tiers (Asia/Dhaka):
 *   no last_spend_date → "Needs sync" (only when showUnknown=true)
 *   0–6 days  → hidden (active)
 *   7–19      → yellow "Unused Xd"
 *   20–29     → orange "Unused Xd"
 *   30+       → red "Inactive 30d+"
 */
export function InactiveBadge({
  lastSpendDate,
  fallbackDate: _fallbackDate,
  className,
  showActive,
  showUnknown,
}: InactiveBadgeProps) {
  const info = getInactiveDays(lastSpendDate);

  if (info.tier === "active" && !showActive) return null;
  if (info.tier === "unknown" && !showUnknown) return null;

  const tierClass = {
    active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    alert: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
    critical: "bg-destructive/15 text-destructive border-destructive/30 animate-pulse",
    unknown: "bg-muted text-muted-foreground border-border",
  }[info.tier];

  const label =
    info.tier === "critical"
      ? `Inactive ${info.days}d`
      : info.tier === "active"
      ? `Active`
      : info.tier === "unknown"
      ? `Needs sync`
      : `Unused ${info.days}d`;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap",
        tierClass,
        className,
      )}
      title={
        info.isUnknown
          ? "No verified spend history yet — sync this account to populate."
          : info.hasEverSpent
          ? `Last spend: ${lastSpendDate?.slice(0, 10)}`
          : "No spend recorded yet"
      }
    >
      {label}
    </span>
  );
}
