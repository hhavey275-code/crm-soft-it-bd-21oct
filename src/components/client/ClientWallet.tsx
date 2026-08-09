import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { Wallet } from "lucide-react";
import { useWallets, formatBdt } from "@/hooks/useWallets";

export function ClientWallet() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const wallets = useWallets(user?.id);


  const { data: wallet } = useQuery({
    queryKey: ["client-wallet", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("*").eq("user_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: profile } = useQuery({
    queryKey: ["client-wallet-profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("due_limit,due_limit_expires_at").eq("user_id", user!.id).single();
      return data as any;
    },
    enabled: !!user,
  });

  const { data: topUps } = useQuery({
    queryKey: ["client-topup-history", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any).from("topups").select("*").eq("user_id", user!.id).order("created_at", { ascending: false });
      return (data as any[]) ?? [];
    },
    enabled: !!user,
  });

  const dueLimit = Number(profile?.due_limit ?? 0);
  const dueExpiresAt = profile?.due_limit_expires_at ? new Date(profile.due_limit_expires_at) : null;

  return (
    <div className="space-y-4 md:space-y-6">
      <h1 className="text-xl md:text-2xl font-bold">Wallet</h1>

      {/* Wallet Balance Card */}
      {isMobile ? (
        <div data-tutorial="wallet-balance" className="rounded-2xl bg-gradient-to-br from-primary via-primary/85 to-primary/65 p-5 text-primary-foreground shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">{wallets.secondaryEnabled ? "Main Wallet Balance" : "Available Balance"}</p>
              <p className="text-3xl font-bold tracking-tight mt-1">
                ${Number(wallet?.balance ?? 0).toLocaleString()}
              </p>
              <p className="text-xs opacity-70 mt-1">{wallet?.currency ?? "USD"}</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
              <Wallet className="h-6 w-6" />
            </div>
          </div>
        </div>
      ) : (
        <Card data-tutorial="wallet-balance" className="bg-primary text-primary-foreground">
          <CardContent className="p-8">
            <p className="text-sm opacity-80">{wallets.secondaryEnabled ? "Main Wallet Balance" : "Available Balance"}</p>
            <p className="text-4xl font-bold mt-1">${Number(wallet?.balance ?? 0).toLocaleString()}</p>
            <p className="text-sm mt-2 opacity-70">{wallet?.currency ?? "USD"}</p>
          </CardContent>
        </Card>
      )}

      {/* Secondary wallet + combined total (only when enabled for this client) */}
      {wallets.secondaryEnabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="border-teal-300/70 bg-teal-50 dark:bg-teal-950/20 dark:border-teal-800/50">
            <CardContent className="p-5">
              <p className="text-sm text-teal-700 dark:text-teal-400">Secondary Wallet Balance</p>
              <p className="text-2xl font-bold mt-1 text-teal-800 dark:text-teal-300">
                ${wallets.secondaryBalance.toLocaleString()}
              </p>
              <p className="text-xs text-teal-700/70 dark:text-teal-400/70 mt-1">Rate ৳{wallets.secondaryRate}/USD</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">
                Combined Due / Adv
              </p>
              <p className={`text-2xl font-bold mt-1 ${wallets.totalBdt < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                {formatBdt(wallets.totalBdt)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Main ${wallets.mainBalance.toLocaleString()} × ৳{wallets.mainRate} + Secondary ${wallets.secondaryBalance.toLocaleString()} × ৳{wallets.secondaryRate}
              </p>
            </CardContent>
          </Card>
        </div>
      )}


      {/* Due Limit Notice */}
      {dueLimit > 0 && dueExpiresAt && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40 p-3 flex items-start gap-2.5">
          <div className="h-8 w-8 shrink-0 rounded-full bg-amber-500/20 flex items-center justify-center">
            <span className="text-amber-700 dark:text-amber-400 text-sm font-bold">!</span>
          </div>
          <div className="flex-1 text-xs">
            <p className="font-semibold text-amber-800 dark:text-amber-300">
              Due limit ${dueLimit.toLocaleString()} active
            </p>
            <p className="text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              {dueExpiresAt.getTime() > Date.now()
                ? `Expires on ${format(dueExpiresAt, "MMM d, yyyy 'at' h:mm a")}`
                : "Expired — pending auto-reset"}
            </p>
          </div>
        </div>
      )}

      <Card data-tutorial="wallet-history">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base md:text-lg">Top-Up History</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {isMobile ? (
            <div className="space-y-2.5">
              {topUps?.map((t: any) => (
                <div key={t.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">${Number(t.amount).toLocaleString()}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
                    <span>Cap: ${Number(t.old_spend_cap).toLocaleString()} → ${Number(t.new_spend_cap).toLocaleString()}</span>
                    <span>{format(new Date(t.created_at), "MMM d, yyyy")}</span>
                  </div>
                </div>
              ))}
              {(!topUps || topUps.length === 0) && (
                <p className="text-center text-muted-foreground py-6 text-sm">No top-ups yet</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Amount</TableHead>
                  <TableHead>Old Cap</TableHead>
                  <TableHead>New Cap</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topUps?.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-semibold">${Number(t.amount).toLocaleString()}</TableCell>
                    <TableCell>${Number(t.old_spend_cap).toLocaleString()}</TableCell>
                    <TableCell>${Number(t.new_spend_cap).toLocaleString()}</TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{format(new Date(t.created_at), "MMM d, yyyy")}</TableCell>
                  </TableRow>
                ))}
                {(!topUps || topUps.length === 0) && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No top-ups yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
