import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WalletKind = "primary" | "secondary" | "credit_line";

export interface WalletsInfo {
  mainBalance: number;
  secondaryBalance: number;
  creditLineBalance: number;
  mainRate: number;
  secondaryRate: number;
  creditLineRate: number;
  mainEnabled: boolean;
  secondaryEnabled: boolean;
  creditLineEnabled: boolean;
  /** Combined BDT value of every enabled wallet (positive = advance, negative = due) */
  totalBdt: number;
  currency: string;
  isLoading: boolean;
}

export const WALLET_LABELS: Record<WalletKind, string> = {
  primary: "Main wallet",
  secondary: "Secondary wallet",
  credit_line: "Credit line wallet",
};

/**
 * Reads all three wallets (main + secondary sheet-rate + credit line) for a user
 * plus each wallet's own USD rate. Each extra wallet has its own per-client
 * toggle, so a client may have any combination of them.
 */
export function useWallets(userId?: string | null): WalletsInfo {
  const { data, isLoading } = useQuery({
    queryKey: ["dual-wallets", userId],
    enabled: !!userId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const [walletRes, secondaryRes, creditLineRes, profileRes, siteRateRes] = await Promise.all([
        supabase.from("wallets").select("balance, currency").eq("user_id", userId!).maybeSingle(),
        (supabase as any).from("secondary_wallets").select("balance").eq("user_id", userId!).maybeSingle(),
        (supabase as any).from("credit_line_wallets").select("balance").eq("user_id", userId!).maybeSingle(),
        supabase
          .from("profiles")
          .select(
            "usd_rate, main_wallet_enabled, secondary_usd_rate, secondary_wallet_enabled, credit_line_usd_rate, credit_line_wallet_enabled"
          )
          .eq("user_id", userId!)
          .maybeSingle(),
        supabase.from("site_settings").select("value").eq("key", "usd_rate").maybeSingle(),
      ]);

      const profile = profileRes.data as any;
      const fallbackRate = Number((siteRateRes.data as any)?.value ?? 0) || 0;
      const secondaryRateRaw = Number(profile?.secondary_usd_rate ?? 0) || 0;
      const creditLineRateRaw = Number(profile?.credit_line_usd_rate ?? 0) || 0;
      // If no per-client main rate is set, fall back to the site rate, then to the
      // secondary rate so the combined BDT total is never silently zero.
      const mainRate = Number(profile?.usd_rate ?? 0) || fallbackRate || secondaryRateRaw || creditLineRateRaw;
      const secondaryRate = secondaryRateRaw || mainRate;
      const creditLineRate = creditLineRateRaw || mainRate;

      return {
        mainBalance: Number((walletRes.data as any)?.balance ?? 0),
        secondaryBalance: Number((secondaryRes.data as any)?.balance ?? 0),
        creditLineBalance: Number((creditLineRes.data as any)?.balance ?? 0),
        currency: ((walletRes.data as any)?.currency as string) ?? "USD",
        mainRate,
        secondaryRate,
        creditLineRate,
        mainEnabled: profile?.main_wallet_enabled !== false || !profile?.credit_line_wallet_enabled,
        secondaryEnabled: !!profile?.secondary_wallet_enabled,
        creditLineEnabled: !!profile?.credit_line_wallet_enabled,
      };
    },
  });

  const mainBalance = data?.mainBalance ?? 0;
  const secondaryBalance = data?.secondaryBalance ?? 0;
  const creditLineBalance = data?.creditLineBalance ?? 0;
  const mainRate = data?.mainRate ?? 0;
  const secondaryRate = data?.secondaryRate ?? 0;
  const creditLineRate = data?.creditLineRate ?? 0;
  const mainEnabled = data?.mainEnabled ?? true;
  const secondaryEnabled = data?.secondaryEnabled ?? false;
  const creditLineEnabled = data?.creditLineEnabled ?? false;

  return {
    mainBalance,
    secondaryBalance,
    creditLineBalance,
    mainRate,
    secondaryRate,
    creditLineRate,
    mainEnabled,
    secondaryEnabled,
    creditLineEnabled,
    totalBdt:
      mainBalance * mainRate +
      (secondaryEnabled ? secondaryBalance * secondaryRate : 0) +
      (creditLineEnabled ? creditLineBalance * creditLineRate : 0),
    currency: data?.currency ?? "USD",
    isLoading,
  };
}

export function formatBdt(value: number): string {
  return `৳${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
}
