import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDebouncedCallback } from "@/lib/debounce";

export function useSidebarBadges(): Record<string, number> {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const [badges, setBadges] = useState<Record<string, number>>({});

  const isAdminUser = isAdmin || isSuperAdmin;

  const fetchCounts = useCallback(async () => {
    if (!user) return;

    if (isAdminUser) {
      const [topUpRes, chatRes, clientsRes, failedRes, adReqRes, bmReqRes, sellerUsdtRes, withdrawReqRes, referralPayoutRes, externalTopupRes] = await Promise.all([
        (supabase as any)
          .from("top_up_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        (supabase as any)
          .from("chat_messages")
          .select("*", { count: "exact", head: true })
          .eq("is_read", false)
          .neq("sender_id", user.id),
        supabase
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending")
          .not("phone", "is", null)
          .not("company", "is", null),
        (supabase as any)
          .from("failed_topups")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        (supabase as any)
          .from("ad_account_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        (supabase as any)
          .from("bm_access_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        (supabase as any)
          .from("seller_transactions")
          .select("*", { count: "exact", head: true })
          .in("type", ["usdt_received", "withdraw"])
          .eq("status", "pending"),
        (supabase as any)
          .from("spend_cap_withdraw_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        (supabase as any)
          .from("referral_payout_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        (supabase as any)
          .from("external_topup_requests")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending")
          .eq("requested_by_client", true),
      ]);

      setBadges({
        "top-up": topUpRes.count || 0,
        chat: chatRes.count || 0,
        clients: clientsRes.count || 0,
        "failed-topups": failedRes.count || 0,
        requests: (adReqRes.count || 0) + (bmReqRes.count || 0) + (withdrawReqRes.count || 0),
        "external-top-up": externalTopupRes.count || 0,
        sellers: sellerUsdtRes.count || 0,
        referral: referralPayoutRes.count || 0,
      });

    } else {
      // Client: show own failed topups count
      const failedRes = await (supabase as any)
        .from("failed_topups")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("user_id", user.id);

      setBadges({
        "failed-topups": failedRes.count || 0,
      });
    }
  }, [user, isAdminUser]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // No polling — rely entirely on realtime subscriptions above.
  // Counts only change when a client submits a request or a topup fails,
  // both of which fire postgres_changes events.

  // Debounce refetches: under heavy write load (many top-ups / chats per
  // minute) we'd otherwise fire 7 COUNT queries per event. Coalesce into a
  // single refetch every 3s so the sidebar still feels live but the DB
  // doesn't get hammered.
  const debouncedFetch = useDebouncedCallback(fetchCounts, 3000);

  // Realtime subscriptions
  useEffect(() => {
    if (!user) return;

    const tables = isAdminUser
      ? ["top_up_requests", "chat_messages", "profiles", "failed_topups", "ad_account_requests", "bm_access_requests", "spend_cap_withdraw_requests", "referral_payout_requests", "external_topup_requests", "notifications", "seller_transactions"]
      : ["failed_topups", "notifications"];

    let channel = supabase.channel("sidebar-badges");
    tables.forEach((table) => {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        if (table === "external_topup_requests") {
          void fetchCounts();
          return;
        }
        debouncedFetch();
      });
    });
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isAdminUser, debouncedFetch, fetchCounts]);

  return badges;
}
