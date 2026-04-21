interface SpendProgressBarProps {
  amountSpent: number;
  spendCap: number;
  balanceAfterTopup?: number;
  platform?: "meta" | "tiktok";
}

export function SpendProgressBar({ amountSpent, spendCap, balanceAfterTopup, platform }: SpendProgressBarProps) {
  if (spendCap <= 0) {
    return (
      <div className="w-full">
        <div className="text-sm font-medium text-muted-foreground">No cap</div>
      </div>
    );
  }

  const remaining = Math.max(spendCap - amountSpent, 0);
  const percentage = Math.min((amountSpent / spendCap) * 100, 100);

  // Color based on how much of the last top-up balance has been spent
  let ratio: number;
  if (balanceAfterTopup && balanceAfterTopup > 0) {
    const spentSinceTopup = balanceAfterTopup - remaining;
    ratio = Math.max(spentSinceTopup / balanceAfterTopup, 0);
  } else {
    // Fallback to overall ratio if no top-up data
    ratio = amountSpent / spendCap;
  }

  const normalColor = platform === "tiktok"
    ? "bg-teal-500 dark:bg-teal-400"
    : "bg-primary";

  const barColor =
    ratio >= 0.8
      ? "bg-destructive"
      : ratio >= 0.5
        ? "bg-yellow-500 dark:bg-yellow-400"
        : normalColor;

  return (
    <div className="w-full min-w-[80px]">
      <div className="text-sm font-semibold whitespace-nowrap text-foreground">
        ${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} left
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden mt-1">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
