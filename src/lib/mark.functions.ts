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
  `${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ডলার`;

function dhakaDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 6 * 3600 * 1000 - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function startOfTodayDhaka(): string {
  return new Date(`${dhakaDate()}T00:00:00+06:00`).toISOString();
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
function normalize(q: string) {
  return q
    .toLowerCase()
    .replace(/[০-৯]/g, (c) => String(BN_DIGITS.indexOf(c)))
    .replace(/দশ/g, "10")
    .replace(/সাত/g, "7")
    .replace(/পনেরো|পনের/g, "15")
    .replace(/তিরিশ|ত্রিশ/g, "30");
}

function extractDays(q: string, fallback: number) {
  const m = q.match(/(\d{1,3})\s*(দিন|day)/);
  return m ? Math.min(365, Math.max(1, Number(m[1]))) : fallback;
}

async function fetchAll(query: () => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function clientIds(supabase: any): Promise<Set<string>> {
  const rows = await fetchAll(() => supabase.from("user_roles").select("user_id").eq("role", "client"));
  return new Set(rows.map((r) => r.user_id));
}

async function names(supabase: any, ids: string[]) {
  if (!ids.length) return [] as string[];
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids.slice(0, 5));
  return (data ?? []).map((p: any) => p.full_name || p.email || "Unknown");
}

const has = (q: string, re: RegExp) => re.test(q);
const CLIENT = /client|ক্লায়েন্ট|ক্লাইন্ট|কাস্টমার|customer/;
const ACCOUNT = /account|অ্যাকাউন্ট|একাউন্ট|এ্যাকাউন্ট|অ্যাড অ্যাকাউন্ট/;
const SPEND = /spend|খরচ|স্পেন্ড|স্পেন্ডিং|spending/;
const NOT = /না|নাই|নেই|not|inactive|বন্ধ রেখেছে|চালাচ্ছে না|করছে না/;

export const askMark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { question: string }) => {
    if (!data?.question?.trim()) throw new Error("Empty question");
    return { question: data.question.trim().slice(0, 500) };
  })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const q = normalize(data.question);

    // ── Clients not running ads for N days ──
    if (has(q, CLIENT) && (has(q, /ad|অ্যাড|এড|বিজ্ঞাপন/) || has(q, SPEND)) && has(q, NOT)) {
      const days = extractDays(q, 10);
      const cutoff = dhakaDate(days);
      const [clients, links, insights] = await Promise.all([
        clientIds(supabase),
        fetchAll(() => supabase.from("user_ad_accounts").select("user_id, ad_account_id")),
        fetchAll(() => supabase.from("ad_account_insights").select("ad_account_id, last_spend_date, today_spend")),
      ]);
      const lastByAcc = new Map<string, string>();
      for (const i of insights) {
        const d = Number(i.today_spend) > 0 ? dhakaDate() : i.last_spend_date;
        if (d) lastByAcc.set(i.ad_account_id, d);
      }
      const lastByUser = new Map<string, string>();
      for (const l of links) {
        if (!clients.has(l.user_id)) continue;
        const d = lastByAcc.get(l.ad_account_id) ?? "";
        const prev = lastByUser.get(l.user_id) ?? "";
        lastByUser.set(l.user_id, d > prev ? d : prev);
      }
      const idle = [...lastByUser.entries()].filter(([, d]) => !d || d < cutoff).map(([id]) => id);
      if (!idle.length) return { answer: `Sir, গত ${days} দিনে সব client-ই ad চালিয়েছে।` };
      const n = await names(supabase, idle);
      return {
        answer: `Sir, গত ${days} দিন ধরে ${idle.length} জন client ad চালাচ্ছে না। যেমন: ${n.join(", ")}${idle.length > n.length ? " সহ আরও অনেকে" : ""}।`,
      };
    }

    // ── Active / spending clients ──
    if (has(q, CLIENT) && has(q, /active|অ্যাক্টিভ|একটিভ|সক্রিয়|spend|খরচ|স্পেন্ড|চালাচ্ছে/) && !has(q, /বেশি|top|সবচেয়ে/)) {
      const days = extractDays(q, 0);
      const since = days ? dhakaDate(days) : null;
      const [clients, links, insights] = await Promise.all([
        clientIds(supabase),
        fetchAll(() => supabase.from("user_ad_accounts").select("user_id, ad_account_id")),
        fetchAll(() => supabase.from("ad_account_insights").select("ad_account_id, last_spend_date, today_spend")),
      ]);
      const activeAcc = new Set(
        insights
          .filter((i) => Number(i.today_spend) > 0 || (since && i.last_spend_date && i.last_spend_date >= since))
          .map((i) => i.ad_account_id),
      );
      const users = new Set(links.filter((l) => clients.has(l.user_id) && activeAcc.has(l.ad_account_id)).map((l) => l.user_id));
      return {
        answer: days
          ? `Sir, গত ${days} দিনে ${users.size} জন client spend করেছে।`
          : `Sir, আজকে ${users.size} জন client active আছে, মানে spend করছে। মোট client ${clients.size} জন।`,
      };
    }

    // ── Top spending client today ──
    if (has(q, /বেশি|top|সবচেয়ে/) && (has(q, SPEND) || has(q, CLIENT))) {
      const yesterday = has(q, /গতকাল|yesterday/);
      const col = yesterday ? "yesterday_spend" : "today_spend";
      const insights = await fetchAll(() => supabase.from("ad_account_insights").select(`ad_account_id, ${col}`).gt(col, 0));
      const label = yesterday ? "গতকাল" : "আজকে";
      if (!insights.length) return { answer: `Sir, ${label} এখনও কোনো spend হয়নি।` };
      const byAccount = new Map<string, number>();
      for (const r of insights) byAccount.set(r.ad_account_id, Number(r[col]) || 0);
      const links = await fetchAll(() => supabase.from("user_ad_accounts").select("user_id, ad_account_id").in("ad_account_id", [...byAccount.keys()]));
      const byUser = new Map<string, number>();
      for (const l of links) byUser.set(l.user_id, (byUser.get(l.user_id) ?? 0) + (byAccount.get(l.ad_account_id) ?? 0));
      if (!byUser.size) return { answer: `Sir, ${label}কের spend-এর সাথে কোনো client মিলছে না।` };
      const top = [...byUser.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", top.map((t) => t[0]));
      const nm = (id: string) => {
        const p = (profs ?? []).find((x: any) => x.id === id);
        return p?.full_name || p?.email || "Unknown";
      };
      const [first, ...rest] = top;
      return {
        answer: `Sir, ${label} সবচেয়ে বেশি spend করছে ${nm(first[0])}, ${money(first[1])}।${rest.length ? " তারপর " + rest.map((r) => `${nm(r[0])} ${money(r[1])}`).join(", ") + "।" : ""}`,
      };
    }

    // ── Disabled accounts ──
    if (has(q, /disable|ডিজেবল|ডিসেবল|বন্ধ হয়ে|ব্যান|ban/)) {
      const today = has(q, /আজ|today/);
      let query = () => supabase.from("ad_accounts").select("account_name, account_id").neq("meta_account_status", 1);
      if (today) {
        const since = startOfTodayDhaka();
        const base = query;
        query = () => base().gte("updated_at", since);
      }
      const rows = await fetchAll(query);
      const label = today ? "আজকে" : "এখন মোট";
      if (!rows.length) return { answer: `Sir, ${label} কোনো account disable নেই।` };
      const nm = rows.slice(0, 3).map((r: any) => r.account_name || r.account_id).join(", ");
      return { answer: `Sir, ${label} ${rows.length}টা account disable। যেমন: ${nm}${rows.length > 3 ? " সহ আরও" : ""}।` };
    }

    // ── Spend totals (today / yesterday / last N days) ──
    if (has(q, SPEND)) {
      const days = extractDays(q, 0);
      if (days > 1 || has(q, /সপ্তাহ|week|মাস|month/)) {
        const n = days > 1 ? days : has(q, /মাস|month/) ? 30 : 7;
        const rows = await fetchAll(() =>
          supabase.from("daily_spend_snapshots").select("total_spend, snapshot_date").gte("snapshot_date", dhakaDate(n - 1)),
        );
        const total = rows.reduce((s, r) => s + (Number(r.total_spend) || 0), 0);
        return { answer: `Sir, গত ${n} দিনে মোট ${money(total)} spend হয়েছে।` };
      }
      const yesterday = has(q, /গতকাল|yesterday/);
      const col = yesterday ? "yesterday_spend" : "today_spend";
      const rows = await fetchAll(() => supabase.from("ad_account_insights").select(col));
      const total = rows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
      return { answer: `Sir, ${yesterday ? "গতকাল" : "আজকে"} মোট ${money(total)} spend হয়েছে।` };
    }

    // ── Ad account counts ──
    if (has(q, ACCOUNT)) {
      const [{ count: total }, { count: active }] = await Promise.all([
        supabase.from("ad_accounts").select("id", { count: "exact", head: true }),
        supabase.from("ad_accounts").select("id", { count: "exact", head: true }).eq("meta_account_status", 1),
      ]);
      const insights = await fetchAll(() => supabase.from("ad_account_insights").select("ad_account_id").gt("today_spend", 0));
      return {
        answer: `Sir, আমাদের মোট ${total ?? 0}টা ad account আছে। এর মধ্যে ${active ?? 0}টা active, আর আজকে ${insights.length}টা account-এ spend হচ্ছে।`,
      };
    }

    // ── Client counts ──
    if (has(q, CLIENT)) {
      const clients = await clientIds(supabase);
      return { answer: `Sir, আমাদের মোট ${clients.size} জন client আছে।` };
    }

    // ── Pending top-ups ──
    if (has(q, /pending|টপ.?আপ|top.?up|রিকোয়েস্ট|request/)) {
      const { count, error } = await supabase.from("top_up_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
      if (error) throw new Error(error.message);
      return { answer: count ? `Sir, এখন ${count}টা top-up request pending আছে।` : "Sir, এখন কোনো pending top-up request নেই।" };
    }

    return {
      answer:
        "Sorry sir, বুঝতে পারিনি। আপনি জিজ্ঞেস করতে পারেন: আজকে কত spend হয়েছে, কতজন client আছে, কতজন client active, গত দশ দিন কোন client ad চালাচ্ছে না, কয়টা ad account আছে, কয়টা disable, অথবা pending top-up কয়টা।",
    };
  });
