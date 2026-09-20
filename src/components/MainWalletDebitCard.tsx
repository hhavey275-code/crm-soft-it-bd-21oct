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
 * Main wallet rendered as a physical-style debit card:
 * chip, contactless mark, balance and a subtle sheen.
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
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary/85 to-primary/65 text-primary-foreground border-0 shadow-lg ${className}`}
      {...props}
    >
      {/* Card sheen */}
      <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-primary-foreground/10" />
      <div className="pointer-events-none absolute -left-12 -bottom-14 h-32 w-32 rounded-full bg-primary-foreground/10" />
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-primary-foreground/5" />

      <div className="relative z-10 flex h-full min-h-[148px] flex-col justify-between gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0 rounded-md bg-primary-foreground/25 p-1.5 text-primary-foreground/95">
              <ChipIcon className="h-4 w-5" />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-widest opacity-85 truncate">{title}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            <ContactlessIcon className="h-4.5 w-4.5 opacity-80" />
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider opacity-70">Balance</p>
          <p className="text-2xl md:text-3xl font-bold tracking-tight truncate">{balanceLabel}</p>
        </div>

        {footer != null && (
          <p className="text-[11px] opacity-75 truncate">{footer}</p>
        )}
      </div>
    </div>
  );
}
