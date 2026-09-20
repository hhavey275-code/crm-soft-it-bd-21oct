import type { HTMLAttributes, ReactNode } from "react";

/** Blue rounded-square document icon, like the Google payment-method card */
function DocIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      <path d="M7 9.5h7M7 13h10M7 16.5h6" strokeLinecap="round" />
    </svg>
  );
}

/** Solid green check circle */
function CheckCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.1 14.3-4-4 1.6-1.6 2.4 2.4 5.6-5.6 1.6 1.6-7.2 7.2Z" />
    </svg>
  );
}

interface CreditLineWalletDebitCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Available credit shown as the big balance, e.g. "$50.48" */
  balanceLabel: string;
  /** Bottom-left line (rate / due limit) — omitted when not provided */
  footer?: ReactNode;
  /** Optional controls rendered next to the title (e.g. admin +/− buttons) */
  actions?: ReactNode;
}

/**
 * Credit line wallet rendered like a Google payment-method card:
 * light surface, blue document icon, "Credit line" title with a pill badge,
 * big "Credit available" balance with a green check and the softitbd
 * brand mark at the bottom. Same footprint as the Main / Secondary cards.
 */
export function CreditLineWalletDebitCard({
  balanceLabel,
  footer,
  actions,
  className = "",
  ...props
}: CreditLineWalletDebitCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-zinc-300/70 bg-gradient-to-br from-zinc-50 via-[#f2f4f6] to-[#e4e8ec] text-zinc-900 shadow-lg shadow-zinc-500/10 dark:border-zinc-600/60 dark:from-zinc-800 dark:via-[#232833] dark:to-[#1b2029] dark:text-zinc-100 dark:shadow-black/30 ${className}`}
      {...props}
    >
      <div className="relative z-10 flex h-full min-h-[136px] flex-col justify-between gap-1 p-3.5">
        <div className="flex items-start gap-2.5">
          {/* Blue rounded icon square */}
          <div className="shrink-0 rounded-lg bg-[#1a73e8] p-1.5 text-white shadow-md shadow-blue-600/20">
            <DocIcon className="h-4.5 w-4.5" />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-700 dark:text-zinc-200">Credit line</p>
            <span className="shrink-0 rounded-full border border-zinc-400/60 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:border-zinc-500/60 dark:bg-zinc-700/60 dark:text-zinc-200">
              Credit
            </span>
            {actions}
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Credit available</p>
          <div className="flex items-center gap-2">
            <p className="truncate text-2xl md:text-3xl font-bold tracking-tight">{balanceLabel}</p>
            <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>

        <div className="flex items-end justify-between gap-2">
          {footer != null && (
            <p className="min-w-0 truncate text-[11px] text-zinc-600 dark:text-zinc-400">{footer}</p>
          )}
          <p className="ml-auto shrink-0 text-sm font-extrabold italic tracking-tight text-zinc-500 dark:text-zinc-400">softitbd</p>
        </div>
      </div>
    </div>
  );
}
