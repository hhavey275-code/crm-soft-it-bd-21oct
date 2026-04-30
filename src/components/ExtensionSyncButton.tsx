import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { syncSingleAccountViaExtension } from "@/lib/extensionBridge";

interface ExtensionSyncButtonProps {
  /** Meta ad account id (with or without the act_ prefix). */
  accountId: string | null | undefined;
  /** Called after a successful sync so caller can invalidate queries. */
  onSynced?: () => void;
  /** Visual variant. */
  size?: "icon" | "sm";
  className?: string;
}

export function ExtensionSyncButton({ accountId, onSynced, size = "icon", className }: ExtensionSyncButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!accountId) {
      toast.error("This account has no Meta account id yet");
      return;
    }
    setBusy(true);
    const t = toast.loading("Opening Meta billing page in background…");
    try {
      const res = await syncSingleAccountViaExtension(String(accountId));
      if (res.ok) {
        toast.success("Live data synced from Meta", { id: t });
        onSynced?.();
      } else {
        toast.error(res.error, { id: t });
      }
    } finally {
      setBusy(false);
    }
  };

  const button = size === "icon" ? (
    <Button
      variant="ghost"
      size="icon"
      className={`h-7 w-7 ${className ?? ""}`}
      disabled={busy}
      onClick={handleClick}
      aria-label="Sync from Meta"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={busy}
      onClick={handleClick}
    >
      <RefreshCw className={`h-3.5 w-3.5 mr-1 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Syncing…" : "Sync from Meta"}
    </Button>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          Sync live daily limit, threshold &amp; balance from Meta (requires the DSL Sync extension).
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
