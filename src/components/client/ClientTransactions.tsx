import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWallets } from "@/hooks/useWallets";
import { TransactionHistoryPanel } from "@/components/TransactionHistoryPanel";
import { MonthlyUsageExport } from "@/components/client/MonthlyUsageExport";

export function ClientTransactions() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { secondaryEnabled } = useWallets(user?.id);

  const { data: transactions } = useQuery({
    queryKey: ["client-transactions", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return (data as any[]) ?? [];
    },
    enabled: !!user,
  });

  const { data: adAccounts } = useQuery({
    queryKey: ["client-tx-ad-accounts", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("ad_accounts")
        .select("id, account_name, account_id")
        .eq("user_id", user!.id);
      return (data as any[]) ?? [];
    },
    enabled: !!user,
  });

  const profileIds = [
    ...new Set(
      (transactions ?? [])
        .map((tx: any) => {
          const pb = tx.processed_by || "";
          if (pb.startsWith("admin:") || pb.startsWith("client:")) return pb.split(":")[1];
          return null;
        })
        .filter(Boolean),
    ),
  ];

  const { data: profiles } = useQuery({
    queryKey: ["tx-profiles", profileIds.join(",")],
    queryFn: async () => {
      if (profileIds.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", profileIds);
      return (data as any[]) ?? [];
    },
    enabled: profileIds.length > 0,
  });

  const getProcessedBy = (tx: any) => {
    const pb = tx.processed_by || "";
    if (pb === "system") return "Auto Approved";
    if (pb.startsWith("admin:") || pb.startsWith("client:")) {
      const id = pb.split(":")[1];
      const p = profiles?.find((pr: any) => pr.user_id === id);
      return p?.full_name || p?.email || "—";
    }
    return "—";
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <h1 className="text-xl md:text-2xl font-bold">Transaction History</h1>
      <MonthlyUsageExport
        transactions={transactions}
        adAccounts={adAccounts}
        secondaryEnabled={secondaryEnabled}
        clientName={user?.email ?? undefined}
      />
      <TransactionHistoryPanel
        transactions={transactions}
        adAccounts={adAccounts}
        resolveProcessedBy={getProcessedBy}
        secondaryEnabled={secondaryEnabled}
        isMobile={isMobile}
      />
    </div>
  );
}
