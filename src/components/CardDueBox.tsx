import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CardDueBoxProps {
  userId: string;
  size?: "sm" | "default";
  className?: string;
}

export function CardDueBox({ userId, size = "default", className }: CardDueBoxProps) {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  // Check if this client has card billing configured
  const { data: hasConfig } = useQuery({
    queryKey: ["card-billing-config-check", userId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("card_billing_config")
        .select("id")
        .eq("user_id", userId)
        .limit(1);
      return data && data.length > 0;
    },
    enabled: !!userId,
  });

  // Fetch current card bill
  const { data: cardBill } = useQuery({
    queryKey: ["card-bill-due", userId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("card_bills")
        .select("due_amount_bdt, last_synced_at, status")
        .eq("user_id", userId)
        .eq("status", "pending")
        .limit(1);
      return data?.[0] ?? null;
    },
    enabled: !!userId && hasConfig === true,
  });

  // Fetch wallet balance + usd_rate to compute total due (card + wallet in BDT)
  const { data: walletInfo } = useQuery({
    queryKey: ["card-due-wallet-info", userId],
    queryFn: async () => {
      const [{ data: w }, { data: p }] = await Promise.all([
        supabase.from("wallets").select("balance").eq("user_id", userId).maybeSingle(),
        supabase.from("profiles").select("usd_rate").eq("user_id", userId).maybeSingle(),
      ]);
      return {
        balance: Number((w as any)?.balance ?? 0),
        rate: Number((p as any)?.usd_rate ?? 0),
      };
    },
    enabled: !!userId && hasConfig === true,
  });

  if (!hasConfig) return null;

  const dueAmount = Number(cardBill?.due_amount_bdt ?? 0);
  const walletBdt = Number(walletInfo?.balance ?? 0) * Number(walletInfo?.rate ?? 0);
  // negative wallet = owes wallet money (add to card due); positive wallet = prepaid credit (subtract)
  const totalDue = dueAmount - walletBdt;
  const lastSynced = cardBill?.last_synced_at
    ? new Date(cardBill.last_synced_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-card-bills", {
        body: { action: "sync_dues" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Card bill synced from Google Sheet");
      queryClient.invalidateQueries({ queryKey: ["card-bill-due", userId] });
    } catch (err: any) {
      toast.error(err.message || "Failed to sync");
    } finally {
      setSyncing(false);
    }
  };

  const isSmall = size === "sm";

  return (
    <Card className={cn(
      "border overflow-hidden relative",
      dueAmount > 0
        ? "border-warning/50 bg-gradient-to-br from-warning/10 to-warning/5 dark:from-warning/15 dark:to-warning/5"
        : "border-success/50 bg-gradient-to-br from-success/10 to-success/5 dark:from-success/15 dark:to-success/5",
      className
    )}>
      <CardContent className={isSmall ? "p-3" : "p-4"}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex shrink-0 items-center justify-center rounded-xl",
            isSmall ? "h-9 w-9" : "h-11 w-11",
            dueAmount > 0
              ? "bg-warning"
              : "bg-success"
          )}>
            <CreditCard className={cn("text-warning-foreground", isSmall ? "h-4 w-4" : "h-5 w-5")} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn(
              "font-semibold uppercase tracking-wider text-muted-foreground/80",
              isSmall ? "text-[10px]" : "text-[11px]"
            )}>
              Card Due Bill
            </p>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 mt-0.5">
              <p className={cn(
                "font-extrabold tracking-tight leading-snug",
                isSmall ? "text-lg" : "text-xl",
                dueAmount > 0 ? "text-warning" : "text-success"
              )}>
                ৳{dueAmount.toLocaleString()}
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className={cn(
                  "font-semibold uppercase tracking-wider text-muted-foreground/70",
                  isSmall ? "text-[9px]" : "text-[10px]"
                )}>
                  Total Due
                </span>
                <span className={cn(
                  "font-bold tracking-tight",
                  isSmall ? "text-sm" : "text-base",
                  totalDue > 0 ? "text-warning" : "text-success"
                )}>
                  ৳{totalDue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
            {lastSynced && (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                Synced: {lastSynced}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-8 gap-1 text-xs rounded-full", isSmall && "h-7 text-[10px]")}
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
            Sync
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
