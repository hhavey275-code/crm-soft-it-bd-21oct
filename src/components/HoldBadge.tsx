import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Lock } from "lucide-react";

interface Props {
  holdDetected?: boolean | null;
  holdReason?: string | null;
  metaStatus?: number | null;
  disableReason?: number | null;
  checkedAt?: string | null;
  compact?: boolean;
}

/**
 * Renders a "Hold" badge when Meta has flagged the ad account even if its
 * local status is still "active". Mirrors what Facebook UI shows users:
 *   - "Ad account restricted / disabled and unable to run ads" (status 2)
 *   - "We weren't able to place a temporary hold" (failed billing attempts)
 *   - "In grace period" / "Pending settlement" / "Pending risk review"
 */
export function HoldBadge({ holdDetected, holdReason, metaStatus, disableReason, checkedAt, compact }: Props) {
  if (!holdDetected) return null;
  const label = holdReason || "Account on hold";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="bg-destructive text-destructive-foreground gap-1 text-xs">
            <Lock className="w-3 h-3" />
            {compact ? "Hold" : label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-1 max-w-xs">
            <div className="font-semibold">Meta says this account is held</div>
            <div>{label}</div>
            {metaStatus !== null && metaStatus !== undefined && <div>Meta status: <b>{metaStatus}</b></div>}
            {disableReason ? <div>Disable reason: <b>{disableReason}</b></div> : null}
            {checkedAt && <div className="text-muted-foreground pt-1">Checked {new Date(checkedAt).toLocaleString()}</div>}
            <div className="text-muted-foreground pt-1">
              Common cause: card declined when Meta tried to place a temporary hold, or account flagged for risk review. Top up may still appear successful but ads won't deliver.
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
