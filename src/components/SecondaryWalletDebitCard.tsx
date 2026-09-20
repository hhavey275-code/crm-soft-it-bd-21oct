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

      <div className="relative z-10 flex h-full min-h-[108px] flex-col justify-between gap-0.5 p-3 md:min-h-[136px] md:gap-1 md:p-3.5">
        <div className="flex items-start justify-between gap-2">
          {/* Silver metallic chip */}
          <div className="shrink-0 rounded-md bg-gradient-to-br from-zinc-100 via-zinc-300 to-zinc-500 p-1 text-zinc-700 shadow-inner ring-1 ring-zinc-400/60 md:p-1.5">
            <ChipIcon className="h-3.5 w-4 md:h-4 md:w-5" />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            <p className="text-base font-extrabold italic tracking-tight text-white/95 md:text-lg">secondary</p>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[9px] font-medium uppercase tracking-wider text-white/70 md:text-[10px]">Balance</p>
          <p className="text-xl font-bold tracking-tight truncate md:text-2xl lg:text-3xl">{balanceLabel}</p>
          {footer != null && (
            <p className="mt-0.5 text-[10px] text-white/75 truncate md:text-[11px]">{footer}</p>
          )}
        </div>

        <div className="flex items-end justify-end md:hidden">
          <div className="text-right leading-none">
            <p className="text-xs font-black italic tracking-wide text-white/90">WALLET</p>
            <p className="text-[7px] font-semibold uppercase tracking-[0.3em] text-white/70">Credit</p>
          </div>
        </div>
      </div>
    </div>
  );
}
