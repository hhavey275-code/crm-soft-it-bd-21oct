import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { LimitWatchState } from "@/hooks/useLimitUpdateWatch";

/**
 * Small inline status shown beside an external ad account right after a
 * top-up request: blinking dot + "Updating your limit...", then either a
 * success note or an error asking the client to contact the admin.
 * Compact + wrap-safe so it never widens a table column or pushes buttons.
 */
export function LimitUpdateIndicator({ state }: { state?: LimitWatchState }) {
  if (!state) return null;

  if (state.status === "checking") {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <span className="whitespace-normal text-left leading-tight">Updating your limit…</span>
      </span>
    );
  }

  if (state.status === "updated") {
    return (
      <span className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3 shrink-0" />
        <span className="whitespace-normal text-left leading-tight">
          Limit updated
          {typeof state.newCap === "number" && (
            <span className="font-semibold"> ${state.newCap.toLocaleString()}</span>
          )}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex max-w-full items-start gap-1.5 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
      <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
      <span className="whitespace-normal text-left leading-tight">There is an error. Your limit is not updated — please contact your admin.</span>
    </span>
  );
}
