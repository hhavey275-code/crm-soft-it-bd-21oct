import { useAuth } from "@/contexts/AuthContext";

// Full-screen loading overlay, keeping the current campaign view behind frosted glass.
export function MetaLoading() {
  const { profile, user } = useAuth();
  const username = profile?.full_name?.trim() || user?.user_metadata?.full_name || user?.user_metadata?.name || "there";
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background/60 px-6 text-center backdrop-blur-md" role="status" aria-live="polite" aria-label="Campaign loading">
      <svg viewBox="0 0 60 34" className="meta-loading h-16 w-28 shrink-0" aria-hidden="true">
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
      <div className="w-full max-w-md space-y-1.5">
        <p className="break-words text-lg font-semibold text-fb-text">Hi {username},</p>
        <p className="text-sm text-fb-muted">your campaign is loading</p>
      </div>
      <style>{`.meta-loading path{stroke-dasharray:150;stroke-dashoffset:150;animation:meta-loading-draw 1.6s ease-in-out infinite}@keyframes meta-loading-draw{0%{stroke-dashoffset:150}55%{stroke-dashoffset:0}100%{stroke-dashoffset:-150}}@media(prefers-reduced-motion:reduce){.meta-loading path{animation:none;stroke-dashoffset:0}}`}</style>
    </div>
  );
}
export default MetaLoading;
