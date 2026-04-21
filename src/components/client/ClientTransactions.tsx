import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

export function ClientTransactions() {
  const { user } = useAuth();
  const isMobile = useIsMobile();

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

  const profileIds = [
    ...new Set(
      (transactions ?? [])
        .map((tx: any) => {
          const pb = tx.processed_by || "";
          if (pb.startsWith("admin:") || pb.startsWith("client:")) return pb.split(":")[1];
          return null;
        })
        .filter(Boolean)
    ),
  ];

  const { data: profiles } = useQuery({
    queryKey: ["tx-profiles", profileIds.join(",")],
    queryFn: async () => {
      if (profileIds.length === 0) return [];
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", profileIds);
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

  const renderDescription = (tx: any) => {
    const desc = tx.description || "—";
    if (desc.includes("\n")) {
      const [name, accountId] = desc.split("\n");
      return (
        <div>
          <span>{name}</span>
          <span className="block text-xs text-muted-foreground">{accountId}</span>
        </div>
      );
    }
    return desc;
  };

  const getDescriptionText = (tx: any) => {
    const desc = tx.description || "—";
    if (desc.includes("\n")) return desc.split("\n")[0];
    return desc;
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <h1 className="text-xl md:text-2xl font-bold">Transaction History</h1>

      {isMobile ? (
        <div className="space-y-2.5">
          {transactions?.map((tx: any) => {
            const isPositive = Number(tx.amount) >= 0;
            return (
              <Card key={tx.id} className="border border-border/60 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "h-9 w-9 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      isPositive ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"
                    )}>
                      {isPositive
                        ? <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                        : <ArrowUpRight className="h-4 w-4 text-destructive" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium capitalize truncate">{tx.type.replace(/_/g, " ")}</p>
                        <p className={cn("text-sm font-bold", isPositive ? "text-emerald-600" : "text-destructive")}>
                          {isPositive ? "+" : ""}${Math.abs(Number(tx.amount)).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{getDescriptionText(tx)}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[11px] text-muted-foreground">
                          {format(new Date(tx.created_at), "MMM d, yyyy HH:mm")}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Bal: <span className="font-medium text-foreground">${Number(tx.balance_after ?? 0).toLocaleString()}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(!transactions || transactions.length === 0) && (
            <p className="text-center text-muted-foreground py-8 text-sm">No transactions yet</p>
          )}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Balance After</TableHead>
                  <TableHead>Processed By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions?.map((tx: any) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{format(new Date(tx.created_at), "MMM d, yyyy HH:mm")}</TableCell>
                    <TableCell className="capitalize font-medium">{tx.type.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-sm">{renderDescription(tx)}</TableCell>
                    <TableCell className={cn("font-semibold", Number(tx.amount) >= 0 ? "text-emerald-600" : "text-destructive")}>
                      {Number(tx.amount) >= 0 ? "+" : ""}${Math.abs(Number(tx.amount)).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">${Number(tx.balance_after ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{getProcessedBy(tx)}</TableCell>
                  </TableRow>
                ))}
                {(!transactions || transactions.length === 0) && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No transactions yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
