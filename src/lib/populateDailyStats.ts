import { supabase } from "@/integrations/supabase/client";

/**
 * Populate client_daily_stats for ALL users based on current ad_account_insights.
 * Call after "Update All from Meta" completes.
 */
export async function populateClientDailyStats(forUserId?: string): Promise<void> {
  try {
    // Use Asia/Dhaka calendar date so the daily stat row rolls over at 12 AM BD time.
    const bdMs = Date.now() + 6 * 60 * 60 * 1000;
    const todayStr = new Date(bdMs).toISOString().slice(0, 10);

    // Fetch user_ad_accounts assignments
    let assignmentQuery = supabase.from("user_ad_accounts").select("user_id, ad_account_id");
    if (forUserId) {
      assignmentQuery = assignmentQuery.eq("user_id", forUserId);
    }
    const { data: assignments } = await assignmentQuery;
    if (!assignments || assignments.length === 0) return;

    // Fetch all relevant insights
    const accountIds = [...new Set(assignments.map((a: any) => a.ad_account_id))];
    
    // Supabase has 1000 row limit, fetch in chunks if needed
    const allInsights: any[] = [];
    for (let i = 0; i < accountIds.length; i += 500) {
      const chunk = accountIds.slice(i, i + 500);
      const { data: ins } = await supabase
        .from("ad_account_insights")
        .select("ad_account_id, today_spend, today_orders")
        .in("ad_account_id", chunk);
      if (ins) allInsights.push(...ins);
    }

    const insightsMap: Record<string, { spend: number; orders: number }> = {};
    allInsights.forEach((i: any) => {
      insightsMap[i.ad_account_id] = {
        spend: Number(i.today_spend ?? 0),
        orders: Number(i.today_orders ?? 0),
      };
    });

    // Aggregate per user
    const userStats: Record<string, { spend: number; orders: number; count: number }> = {};
    for (const a of assignments) {
      if (!userStats[a.user_id]) userStats[a.user_id] = { spend: 0, orders: 0, count: 0 };
      const ins = insightsMap[a.ad_account_id];
      if (ins) {
        userStats[a.user_id].spend += ins.spend;
        userStats[a.user_id].orders += ins.orders;
      }
      userStats[a.user_id].count++;
    }

    // Upsert into client_daily_stats in chunks
    const statsRows = Object.entries(userStats).map(([userId, s]) => ({
      user_id: userId,
      stat_date: todayStr,
      total_spend: s.spend,
      total_orders: s.orders,
      account_count: s.count,
    }));

    for (let i = 0; i < statsRows.length; i += 100) {
      const chunk = statsRows.slice(i, i + 100);
      await supabase.from("client_daily_stats").upsert(chunk, { onConflict: "user_id,stat_date" });
    }

    console.log(`client_daily_stats: upserted ${statsRows.length} users for ${todayStr}`);
  } catch (err) {
    console.error("populateClientDailyStats error:", err);
  }
}
