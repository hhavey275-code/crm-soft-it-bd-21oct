import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WalletKind = "primary" | "secondary";

export interface WalletsInfo {
  mainBalance: number;
  secondaryBalance: number;
  mainRate: number;
  secondaryRate: number;
  secondaryEnabled: boolean;
  /** Combined BDT value of both wallets (positive = advance, negative = due) */
  totalBdt: number;
  currency: string;
  isLoading: boolean;
}

/**
 * Reads both wallets (main + secondary sheet-rate wallet) for a user plus each
 * wallet's own USD rate. When the secondary wallet is not enabled for that
 * client, everything behaves exactly like the single-wallet setup.
 */
export function useWallets(userId?: string | null): WalletsInfo {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["dual-wallets", userId],
    enabled: !!userId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [walletRes, secondaryRes, profileRes, siteRateRes] = await Promise.all([
        supabase.from("wallets").select("balance, currency").eq("user_id", userId!).maybeSingle(),
        (supabase as any).from("secondary_wallets").select("balance").eq("user_id", userId!).maybeSingle(),
        supabase
          .from("profiles")
          .select("usd_rate, secondary_usd_rate, secondary_wallet_enabled")
          .eq("user_id", userId!)
          .maybeSingle(),
        supabase.from("site_settings").select("value").eq("key", "usd_rate").maybeSingle(),
      ]);

      const profile = profileRes.data as any;
      const fallbackRate = Number((siteRateRes.data as any)?.value ?? 0) || 0;
      const secondaryRateRaw = Number(profile?.secondary_usd_rate ?? 0) || 0;
      // If no per-client main rate is set, fall back to the site rate, then to the
      // secondary rate so the combined BDT total is never silently zero.
      const mainRate = Number(profile?.usd_rate ?? 0) || fallbackRate || secondaryRateRaw;
      const secondaryRate = secondaryRateRaw || mainRate;


      return {
        mainBalance: Number((walletRes.data as any)?.balance ?? 0),
        secondaryBalance: Number((secondaryRes.data as any)?.balance ?? 0),
        currency: ((walletRes.data as any)?.currency as string) ?? "USD",
        mainRate,
        secondaryRate,
        secondaryEnabled: !!profile?.secondary_wallet_enabled,
      };
    },
  });

  useEffect(() => {
    if (!userId) return;

    const refreshWallets = () => {
      void queryClient.invalidateQueries({ queryKey: ["dual-wallets", userId] });
      void queryClient.invalidateQueries({ queryKey: ["client-wallet", userId] });
    };

    const channel = supabase
      .channel(`wallet-live-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${userId}` },
        refreshWallets,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "secondary_wallets", filter: `user_id=eq.${userId}` },
        refreshWallets,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${userId}` },
        refreshWallets,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);

  const mainBalance = data?.mainBalance ?? 0;
  const secondaryBalance = data?.secondaryBalance ?? 0;
  const mainRate = data?.mainRate ?? 0;
  const secondaryRate = data?.secondaryRate ?? 0;

  return {
    mainBalance,
    secondaryBalance,
    mainRate,
    secondaryRate,
    secondaryEnabled: data?.secondaryEnabled ?? false,
    totalBdt: mainBalance * mainRate + secondaryBalance * secondaryRate,
    currency: data?.currency ?? "USD",
    isLoading,
  };
}

export function formatBdt(value: number): string {
  return `৳${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
}
