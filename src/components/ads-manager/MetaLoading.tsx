// Centered loading indicator for My Ads — animated Meta infinity mark.
export function MetaLoading({ label = "লোড হচ্ছে…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10" role="status" aria-live="polite">
      <svg viewBox="0 0 60 34" className="meta-loading h-10 w-[72px]" aria-hidden="true">
        <defs>
          <linearGradient id="metaLoadingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-fb-blue)" />
            <stop offset="100%" stopColor="var(--color-fb-blue)" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <path
          d="M11 28C4.5 28 2 22.5 2 17S4.5 6 11 6c8.5 0 12.5 8 19 11 6.5-3 10.5-11 19-11 6.5 0 9 5.5 9 11s-2.5 11-9 11c-8.5 0-12.5-8-19-11-6.5 3-10.5 11-19 11z"
          fill="none"
          stroke="url(#metaLoadingGrad)"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
      <p className="text-[13px] text-fb-muted">{label}</p>
      <style>{`.meta-loading path{stroke-dasharray:150;stroke-dashoffset:150;animation:meta-loading-draw 1.6s ease-in-out infinite}@keyframes meta-loading-draw{0%{stroke-dashoffset:150}55%{stroke-dashoffset:0}100%{stroke-dashoffset:-150}}`}</style>
    </div>
  );
}
export default MetaLoading;
