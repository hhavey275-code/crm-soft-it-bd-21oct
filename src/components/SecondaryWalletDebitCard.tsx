import type { HTMLAttributes, ReactNode } from "react";

function ChipIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19M2.5 14h19M9.5 5.5v13M14.5 5.5v13" />
    </svg>
  );
}

interface SecondaryWalletDebitCardProps extends HTMLAttributes<HTMLDivElement> {
  /** The big balance text */
  balanceLabel: string;
  /** Bottom-left line (rate / due limit / etc.) — omitted when not provided */
  footer?: ReactNode;
  /** Optional controls rendered at the top-right (e.g. admin +/− buttons) */
  actions?: ReactNode;
}

/**
 * Secondary wallet rendered as a Chime-style minimal green card:
 * silver chip top-left, brand wordmark top-right, big balance,
 * "WALLET CREDIT" mark bottom-right. Same footprint as MainWalletDebitCard.
 */
export function SecondaryWalletDebitCard({
  balanceLabel,
  footer,
  actions,
  className = "",
  ...props
}: SecondaryWalletDebitCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-700 text-white shadow-lg shadow-emerald-500/20 ${className}`}
      {...props}
    >
      {/* Soft light blobs for depth */}
      <div className="pointer-events-none absolute -right-12 -top-14 h-40 w-40 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -left-14 -bottom-16 h-36 w-36 rounded-full bg-emerald-300/20" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/40" />

      <div className="relative z-10 flex h-full min-h-[168px] flex-col justify-between gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          {/* Silver metallic chip */}
          <div className="shrink-0 rounded-md bg-gradient-to-br from-zinc-100 via-zinc-300 to-zinc-500 p-1.5 text-zinc-700 shadow-inner ring-1 ring-zinc-400/60">
            <ChipIcon className="h-4 w-5" />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            <p className="text-lg font-extrabold italic tracking-tight text-white/95">secondary</p>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-white/70">Balance</p>
          <p className="text-2xl md:text-3xl font-bold tracking-tight truncate">{balanceLabel}</p>
          {footer != null && (
            <p className="mt-0.5 text-[11px] text-white/75 truncate">{footer}</p>
          )}
        </div>

        <div className="flex items-end justify-end">
          <div className="text-right leading-none">
            <p className="text-base font-black italic tracking-wide text-white/90">WALLET</p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.3em] text-white/70">Credit</p>
          </div>
        </div>
      </div>
    </div>
  );
}
