import type { HTMLAttributes, ReactNode } from "react";

function ChipIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19M2.5 14h19M9.5 5.5v13M14.5 5.5v13" />
    </svg>
  );
}

function ContactlessIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6.5 9a7 7 0 0 1 0 6" />
      <path d="M10 6.5a11 11 0 0 1 0 11" />
      <path d="M13.5 4a15 15 0 0 1 0 16" />
   </svg>
  );
}

interface MainWalletDebitCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Small label at the top (defaults to "Main Wallet") */
  title?: string;
  /** The big balance text */
  balanceLabel: string;
  /** Bottom line (rate / due limit / etc.) — omitted when not provided */
  footer?: ReactNode;
  /** Optional controls rendered at the top-right (e.g. admin +/− buttons) */
  actions?: ReactNode;
}

/**
 * Main wallet rendered as a physical-style silver debit card:
 * chip, contactless mark, demo card number / expiry / CVV,
 * balance and a subtle metallic sheen.
 */
export function MainWalletDebitCard({
  title = "Main Wallet",
  balanceLabel,
  footer,
  actions,
  className = "",
  ...props
}: MainWalletDebitCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-100 via-zinc-300 to-zinc-400 text-zinc-800 border border-zinc-300/80 shadow-lg ${className}`}
      {...props}
    >
      {/* Metallic sheen */}
      <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/50" />
      <div className="pointer-events-none absolute -left-12 -bottom-14 h-32 w-32 rounded-full bg-white/30" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/70" />
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-zinc-500/10" />

      <div className="relative z-10 flex h-full min-h-[168px] flex-col justify-between gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0 rounded-md bg-gradient-to-br from-amber-200 to-amber-400/80 p-1.5 text-amber-800/90 shadow-inner">
              <ChipIcon className="h-4 w-5" />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600 truncate">{title}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            <ContactlessIcon className="h-4.5 w-4.5 text-zinc-500/80" />
          </div>
        </div>

        {/* Demo card number — subtle, like a real card */}
        <p className="font-mono text-[13px] md:text-sm tracking-[0.18em] text-zinc-500/80 select-none">
          5241&nbsp;&nbsp;8890&nbsp;&nbsp;4312&nbsp;&nbsp;7654
        </p>

        <div className="flex items-end justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Balance</p>
            <p className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-800 truncate">{balanceLabel}</p>
          </div>
          <div className="flex shrink-0 gap-3 text-right">
            <div>
              <p className="text-[8px] uppercase tracking-wider text-zinc-500/80">Valid Thru</p>
              <p className="font-mono text-[11px] text-zinc-600">12/29</p>
            </div>
            <div>
              <p className="text-[8px] uppercase tracking-wider text-zinc-500/80">CVV</p>
              <p className="font-mono text-[11px] text-zinc-600 select-none">•••</p>
            </div>
          </div>
        </div>

        {footer != null && (
          <p className="text-[11px] text-zinc-600 truncate">{footer}</p>
        )}
      </div>
    </div>
  );
}
