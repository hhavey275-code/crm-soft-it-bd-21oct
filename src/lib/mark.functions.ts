// Mark — voice assistant server function.
// Admin/superadmin only. Answers CRM questions deterministically from live
// database data (no LLM), so answers are instant, free, and accurate.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const [a, s] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" }),
  ]);
  if (!a.data && !s.data) throw new Error("Forbidden: admins only");
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function startOfTodayDhaka(): string {
  // Dhaka is UTC+6
  const now = new Date(Date.now() + 6 * 3600 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(d.getTime() - 6 * 3600 * 1000).toISOString();
}

export const askMark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { question: string }) => {
    if (!data?.question?.trim()) throw new Error("Empty question");
    return { question: data.question.trim().toLowerCase() };
  })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const q = data.question;

    // ── Today's total spend ──
    if (/spend|খরচ|স্পেন্ড|খরোচ/.test(q) && !/কে|who|কোন|top|বেশি/.test(q)) {
      const { data: rows, error } = await supabase
        .from("ad_account_insights")
        .select("today_spend");
      if (error) throw new Error(error.message);
      const total = (rows ?? []).reduce((s: number, r: any) => s + (Number(r.today_spend) || 0), 0);
      return { answer: `Sir, আজকে মোট ${money(total)} spend হয়েছে।` };
    }

    // ── Top spending client today ──
    if (/বেশি|top|সবচেয়ে/.test(q) && /spend|খরচ|স্পেন্ড|client|ক্লায়েন্ট/.test(q)) {
      const { data: insights, error } = await supabase
        .from("ad_account_insights")
        .select("ad_account_id, today_spend")
        .gt("today_spend", 0);
      if (error) throw new Error(error.message);
      if (!insights?.length) return { answer: "Sir, আজকে এখনও কোনো spend হয়নি।" };

      const byAccount = new Map<string, number>();
      for (const r of insights) byAccount.set(r.ad_account_id, Number(r.today_spend) || 0);

      const { data: links } = await supabase
        .from("user_ad_accounts")
        .select("user_id, ad_account_id")
        .in("ad_account_id", [...byAccount.keys()]);
      const byUser = new Map<string, number>();
      for (const l of links ?? []) {
        byUser.set(l.user_id, (byUser.get(l.user_id) ?? 0) + (byAccount.get(l.ad_account_id) ?? 0));
      }
      if (!byUser.size) return { answer: "Sir, আজকের spend-এর সাথে কোনো client মিলছে না।" };

      const [topUser, topAmount] = [...byUser.entries()].sort((x, y) => y[1] - x[1])[0];
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", topUser)
        .maybeSingle();
      const name = profile?.full_name || profile?.email || "Unknown client";
      return { answer: `Sir, আজকে সবচেয়ে বেশি spend করছে ${name} — মোট ${money(topAmount)}।` };
    }

    // ── Disabled accounts today ──
    if (/disable|ডিজেবল|বন্ধ/.test(q)) {
      const since = startOfTodayDhaka();
      const { data: rows, error } = await supabase
        .from("ad_accounts")
        .select("account_name, account_id")
        .neq("meta_account_status", 1)
        .gte("updated_at", since);
      if (error) throw new Error(error.message);
      const count = rows?.length ?? 0;
      if (count === 0) return { answer: "Sir, আজকে কোনো account disable হয়নি।" };
      const names = rows.slice(0, 3).map((r: any) => r.account_name || r.account_id).join(", ");
      return {
        answer: `Sir, আজকে ${count}টা account disable হয়েছে। ${names}${count > 3 ? " সহ আরও" : ""}।`,
      };
    }

    // ── Pending top-ups ──
    if (/pending|টপ.?আপ|top.?up|টপআপ/.test(q)) {
      const { count, error } = await supabase
        .from("top_up_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw new Error(error.message);
      return {
        answer: count
          ? `Sir, এখন ${count}টা top-up request pending আছে।`
          : "Sir, এখন কোনো pending top-up request নেই।",
      };
    }

    return {
      answer:
        "Sir, আমি এগুলো বলতে পারি: আজকের মোট spend, আজকে কয়টা account disable হয়েছে, কোন client সবচেয়ে বেশি spend করছে, আর pending top-up কয়টা।",
    };
  });
