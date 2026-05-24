// Tenant → Master webhook. Receives heartbeat/chat/bm/withdraw from tenant projects.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { runOcrWithFallback } from "../_shared/ocr-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BDT_TOLERANCE = 15;
const amountMatches = (a: number, b: number) => Math.abs(a - b) <= BDT_TOLERANCE;
const refsMatch = (a: string, b: string) => {
  const clean = (v: string) => String(v || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return !!clean(a) && clean(a) === clean(b);
};

function extractSmsCreditAmounts(text: string): number[] {
  const amounts = new Set<number>();
  const currencyRegex = /(?:tk\.?|bdt|৳)\s*([\d,]+(?:\.\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = currencyRegex.exec(text)) !== null) {
    const amount = Number(String(match[1]).replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const start = match.index;
    const end = start + match[0].length;
    const before = text.slice(Math.max(0, start - 45), start).toLowerCase();
    const after = text.slice(end, end + 45).toLowerCase();
    const near = `${before} ${after}`;
    const immediateBefore = before.slice(-18);
    const immediateAfter = after.slice(0, 24);
    const looksLikeCredit = /(deposit|credited|credit|cash\s*out|received|transfer|successful)/i.test(near);
    const looksLikeFeeOrBalance = /(fee\s*$|charge\s*$|vat\s*$|balance\s*$|bal\s*$|c\/b\s*$|available\s*$|a\/c\s*bal\s*$)/i.test(immediateBefore)
      || /^(\s*(balance|bal|c\/b|available balance|a\/c bal|fee|charge|vat)\b)/i.test(immediateAfter);
    if (looksLikeCredit && !looksLikeFeeOrBalance) amounts.add(amount);
  }
  return [...amounts];
}

function accountMatches(ocrAccNum: string, bankAccNum: string) {
  const ocr = String(ocrAccNum || "").replace(/\D/g, "");
  const bank = String(bankAccNum || "").replace(/\D/g, "");
  if (!ocr || !bank) return false;
  if (ocr === bank) return true;
  if (ocr.length >= 7 && bank.length >= 7) {
    return ocr.slice(0, 3) === bank.slice(0, 3) && ocr.slice(-4) === bank.slice(-4);
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const tenantKey = req.headers.get("x-tenant-key");
  if (!tenantKey) return json({ error: "Missing X-Tenant-Key" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // Resolve tenant by api_key
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("*")
    .eq("api_key", tenantKey)
    .maybeSingle();

  if (tenantErr || !tenant) return json({ error: "Invalid tenant key" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const action = body.action as string;
  const payload = body.payload ?? {};
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Some tenant calls send fields flat on the body (no `payload` wrapper).
  // Use this helper to read either shape.
  const field = <T = any>(key: string): T => (payload?.[key] ?? body?.[key]) as T;

  const logSystem = async (act: string, details: Record<string, unknown>) => {
    try {
      await supabase.from("system_logs").insert({
        action: `Tenant: ${act}`,
        actor_email: `tenant:${tenant.name}`,
        ip_address: ip,
        details: { tenant_id: tenant.id, tenant_name: tenant.name, ...details },
      } as any);
    } catch (e) {
      console.warn("system_logs insert failed:", (e as any)?.message);
    }
  };

  try {
    switch (action) {
      case "heartbeat": {
        // Heartbeat is license-only. Stats are pulled on-demand via "pull_stats"
        // so we don't bombard Meta with extra API calls every 5 minutes.
        await supabase
          .from("tenants")
          .update({ last_heartbeat_at: new Date().toISOString() })
          .eq("id", tenant.id);
        return json({
          status: tenant.status ?? "active",
          system_limit: tenant.system_limit ?? null,
          total_used: tenant.total_used ?? 0,
          subscription_type: tenant.subscription_type ?? "",
          subscription_paid_until: tenant.subscription_paid_until ?? "",
          subscription_fee: tenant.subscription_fee ?? 0,
          usd_rate: tenant.usd_rate ?? 0,
        });
      }

      case "pull_stats":
      case "pull-stats": {
        // Aggregate stats from tenant's own database. Does NOT call Meta API.
        // Tenant should run its own "Update All from Meta" periodically to keep
        // ad_account_insights fresh; this endpoint just reads what's there.
        // BD timezone day boundaries
        const bdMs = Date.now() + 6 * 60 * 60 * 1000;
        const todayBD = new Date(bdMs).toISOString().slice(0, 10);
        const monthStart = new Date(bdMs);
        monthStart.setUTCDate(1);
        const monthStartISO = monthStart.toISOString().slice(0, 10);

        const num = (v: any) => Number(v ?? 0) || 0;
        const int = (v: any) => Math.trunc(Number(v ?? 0)) || 0;

        try {
          // 1) ad accounts
          const { data: accounts } = await supabase
            .from("ad_accounts")
            .select("id, account_name, account_id, status");
          const accountsArr = (accounts as any[]) || [];
          const acctMap: Record<string, any> = {};
          accountsArr.forEach((a) => { acctMap[a.id] = a; });

          const accounts_total = accountsArr.length;
          const accounts_active = accountsArr.filter((a) => a.status === "active").length;
          const accounts_disabled = accountsArr.filter((a) => a.status === "disabled").length;
          const accounts_inactive = accountsArr.filter(
            (a) => a.status !== "active" && a.status !== "disabled"
          ).length;

          // 2) insights (chunked because of 1000-row Supabase default limit)
          const accountIds = accountsArr.map((a) => a.id);
          const insightsAll: any[] = [];
          for (let i = 0; i < accountIds.length; i += 500) {
            const chunk = accountIds.slice(i, i + 500);
            if (chunk.length === 0) break;
            const { data: ins } = await supabase
              .from("ad_account_insights")
              .select("ad_account_id, today_spend, yesterday_spend, today_orders, yesterday_orders, balance, last_spend_date")
              .in("ad_account_id", chunk);
            if (ins) insightsAll.push(...(ins as any[]));
          }

          let spend_today = 0, spend_yesterday = 0;
          let orders_today = 0, orders_yesterday = 0;
          let total_account_balance = 0;
          insightsAll.forEach((r) => {
            spend_today += num(r.today_spend);
            spend_yesterday += num(r.yesterday_spend);
            orders_today += int(r.today_orders);
            orders_yesterday += int(r.yesterday_orders);
            total_account_balance += num(r.balance);
          });

          // 3) lifetime spend from ad_accounts.amount_spent
          const { data: spendRows } = await supabase
            .from("ad_accounts")
            .select("amount_spent");
          const spend_lifetime = (spendRows as any[] || []).reduce(
            (s, r) => s + num(r.amount_spent), 0
          );

          // 4) month-to-date spend from client_daily_stats (already aggregated per day)
          const { data: monthStats } = await supabase
            .from("client_daily_stats")
            .select("stat_date, total_spend")
            .gte("stat_date", monthStartISO);
          const spend_this_month = (monthStats as any[] || []).reduce(
            (s, r) => s + num(r.total_spend), 0
          );

          // 5) wallets
          const { data: wallets } = await supabase
            .from("wallets")
            .select("balance");
          const total_wallet_balance = (wallets as any[] || []).reduce(
            (s, r) => s + num(r.balance), 0
          );

          // 6) clients (profiles count)
          const { count: clientCount } = await supabase
            .from("profiles")
            .select("id", { count: "exact", head: true });
          const total_clients = clientCount ?? 0;

          // 7) top-up requests today
          const { data: tups } = await supabase
            .from("top_up_requests")
            .select("amount, status, created_at")
            .gte("created_at", `${todayBD}T00:00:00Z`);
          const tupsArr = (tups as any[]) || [];
          const topups_today_count = tupsArr.length;
          const topups_today_amount = tupsArr.reduce((s, r) => s + num(r.amount), 0);

          const { count: pendingCount } = await supabase
            .from("top_up_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending");
          const topups_pending = pendingCount ?? 0;

          // 8) top 50 accounts by today_spend
          const top_accounts = insightsAll
            .map((r) => {
              const a = acctMap[r.ad_account_id] || {};
              return {
                id: r.ad_account_id,
                name: a.account_name || "—",
                external_id: a.account_id || "",
                status: a.status || "unknown",
                spend_today: num(r.today_spend),
                yesterday_spend: num(r.yesterday_spend),
                balance: num(r.balance),
                last_spend_date: r.last_spend_date || null,
              };
            })
            .sort((a, b) => b.spend_today - a.spend_today)
            .slice(0, 50);

          const stats = {
            accounts_total, accounts_active, accounts_disabled, accounts_inactive,
            spend_today, spend_yesterday, spend_this_month, spend_lifetime,
            orders_today, orders_yesterday,
            total_wallet_balance, total_account_balance,
            total_clients,
            topups_today_count, topups_today_amount, topups_pending,
            top_accounts,
            collected_at: new Date().toISOString(),
          };

          return json({ ok: true, stats });
        } catch (e: any) {
          console.error("pull_stats failed:", e);
          return json({ error: e?.message ?? "pull_stats failed" }, 500);
        }
      }

      case "chat_message": {
        const { tenant_user_id, tenant_user_name, tenant_user_email, message } = payload;
        if (!tenant_user_id || !message) return json({ error: "Missing fields" }, 400);

        // Upsert conversation
        let { data: conv } = await supabase
          .from("tenant_chat_conversations")
          .select("*")
          .eq("tenant_id", tenant.id)
          .eq("tenant_user_id", tenant_user_id)
          .maybeSingle();

        if (!conv) {
          const { data: newConv, error: cErr } = await supabase
            .from("tenant_chat_conversations")
            .insert({
              tenant_id: tenant.id,
              tenant_user_id,
              tenant_user_name,
              tenant_user_email,
              last_message_at: new Date().toISOString(),
            })
            .select("*")
            .single();
          if (cErr) throw cErr;
          conv = newConv;
        } else {
          await supabase
            .from("tenant_chat_conversations")
            .update({
              last_message_at: new Date().toISOString(),
              tenant_user_name: tenant_user_name ?? conv.tenant_user_name,
              tenant_user_email: tenant_user_email ?? conv.tenant_user_email,
            })
            .eq("id", conv.id);
        }

        const { data: msg, error: mErr } = await supabase
          .from("tenant_chat_messages")
          .insert({
            conversation_id: conv!.id,
            direction: "inbound",
            sender_label: tenant_user_name ?? "Tenant user",
            message,
          })
          .select("id")
          .single();
        if (mErr) throw mErr;

        await logSystem("chat_message", { user: tenant_user_name, conversation_id: conv!.id });
        return json({ ok: true, id: msg.id, conversation_id: conv!.id });
      }

      case "pull_chat": {
        const { tenant_user_id, since } = payload;
        if (!tenant_user_id) return json({ error: "Missing tenant_user_id" }, 400);
        const { data: conv } = await supabase
          .from("tenant_chat_conversations")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("tenant_user_id", tenant_user_id)
          .maybeSingle();
        if (!conv) return json({ ok: true, messages: [] });
        let q = supabase
          .from("tenant_chat_messages")
          .select("*")
          .eq("conversation_id", conv.id)
          .eq("direction", "outbound")
          .order("created_at", { ascending: true });
        if (since) q = q.gt("created_at", since);
        const { data: msgs } = await q;
        return json({ ok: true, messages: msgs ?? [] });
      }

      case "bm_share_request": {
        const { tenant_user_id, tenant_user_name, ad_account_external_id, ad_account_name, bm_id, bm_name, note } = payload;
        if (!tenant_user_id || !ad_account_external_id || !bm_id)
          return json({ error: "Missing fields" }, 400);
        const { data, error } = await supabase
          .from("tenant_bm_share_requests")
          .insert({
            tenant_id: tenant.id,
            tenant_user_id,
            tenant_user_name,
            ad_account_external_id,
            ad_account_name,
            bm_id,
            bm_name,
            note,
          })
          .select("id")
          .single();
        if (error) throw error;
        await logSystem("bm_share_request", { user: tenant_user_name, ad_account: ad_account_external_id, bm_id });
        return json({ ok: true, id: data.id });
      }

      case "spend_cap_withdraw_request": {
        const { tenant_user_id, tenant_user_name, ad_account_external_id, ad_account_name, amount_usd, note } = payload;
        if (!tenant_user_id || !ad_account_external_id || amount_usd == null)
          return json({ error: "Missing fields" }, 400);
        const { data, error } = await supabase
          .from("tenant_withdraw_requests")
          .insert({
            tenant_id: tenant.id,
            tenant_user_id,
            tenant_user_name,
            ad_account_external_id,
            ad_account_name,
            amount_usd,
            note,
          })
          .select("id")
          .single();
        if (error) throw error;
        await logSystem("withdraw_request", { user: tenant_user_name, ad_account: ad_account_external_id, amount_usd });
        return json({ ok: true, id: data.id });
      }

      case "get-banks":
      case "get_banks": {
        const { data: assigned, error } = await supabase
          .from("tenant_banks")
          .select("bank_account_id, bank_accounts(id, bank_name, account_name, account_number, branch, routing_number, logo_url, status)")
          .eq("tenant_id", tenant.id);
        if (error) throw error;
        const banks = (assigned || [])
          .map((r: any) => r.bank_accounts)
          .filter((b: any) => b && b.status === "active");
        return json({ ok: true, banks });
      }

      case "get-payments":
      case "get_payments": {
        const { data: payments, error } = await supabase
          .from("tenant_payments")
          .select("*")
          .eq("tenant_id", tenant.id)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        return json({ ok: true, payments: payments || [] });
      }

      case "get-ledger":
      case "get_ledger": {
        const requestedLimit = Number(field("limit") ?? 300);
        const rowLimit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 300, 1), 500);
        const { data: ledger, error } = await supabase
          .from("tenant_limit_ledger")
          .select("id, movement_type, amount_delta, system_limit_before, system_limit_after, total_used_before, total_used_after, remaining_before, remaining_after, reason, source, source_id, idempotency_key, meta, created_at")
          .eq("tenant_id", tenant.id)
          .order("created_at", { ascending: false })
          .limit(rowLimit);
        if (error) throw error;
        return json({ ok: true, ledger: ledger || [] });
      }

      case "submit-payment":
      case "submit_payment": {
        const amount = Number(field("amount") ?? 0);
        const proof_url = field<string>("proof_url");
        const payment_type = field<string>("payment_type") ?? "limit_purchase";
        const limit_amount = Number(field("limit_amount") ?? 0);
        const bank_account_id = field<string>("bank_account_id") ?? null;
        const payment_reference = field<string>("payment_reference") ?? null;
        const duration_months = field<number>("duration_months") ?? null;
        if (!amount || amount <= 0) return json({ error: "amount required" }, 400);
        const { data, error } = await supabase
          .from("tenant_payments")
          .insert({
            tenant_id: tenant.id,
            amount,
            proof_url,
            bank_account_id,
            payment_type,
            limit_amount,
            payment_reference,
            duration_months,
            status: "pending",
          })
          .select("id")
          .single();
        if (error) throw error;
        await logSystem("submit_payment", {
          payment_id: data.id, amount, payment_type, limit_amount,
        });

        // NOTE: Telegram forward + seller ledger sync happen ONLY on admin
        // approval (handled in AdminTopUp.tsx). Doing it here would cause
        // duplicate forwards and premature sheet entries for unverified payments.

        return json({ ok: true, payment_id: data.id });
      }

      case "verify-tenant-payment":
      case "verify_tenant_payment": {
        const payment_id = field<string>("payment_id");
        if (!payment_id) return json({ error: "payment_id required" }, 400);

        const { data: payment, error: payErr } = await supabase
          .from("tenant_payments")
          .select("*, tenants(name, usd_rate)")
          .eq("id", payment_id)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (payErr) throw payErr;
        if (!payment) return json({ error: "payment not found" }, 404);
        if (payment.status !== "pending" && payment.status !== "hold") {
          return json({ ok: true, auto_approved: false, reason: "already processed", payment_id });
        }

        const paymentReference = String(payment.payment_reference || "").trim();
        if (!paymentReference) return json({ ok: true, auto_approved: false, reason: "Missing transaction ID" });

        const bdtNum = Number(payment.amount || 0);
        const verificationLog: string[] = [];
        const { data: bank } = await supabase
          .from("bank_accounts")
          .select("account_number, bank_name, seller_id")
          .eq("id", payment.bank_account_id)
          .maybeSingle();
        const fullBankAccount = String(bank?.account_number || "").replace(/\s+/g, "");
        const bankFirst3 = fullBankAccount.slice(0, 3);
        const bankFirst4 = fullBankAccount.slice(0, 4);
        const bankLast4 = fullBankAccount.slice(-4);

        let ocrRef = "";
        let ocrAmount = 0;
        let ocrAccountNumber = "";
        if (payment.proof_url) {
          try {
            const { result } = await runOcrWithFallback(payment.proof_url);
            ocrRef = String(result.reference || "").trim();
            ocrAmount = Number(result.bdt_amount || 0);
            ocrAccountNumber = String(result.account_number || "").trim();
          } catch (e) {
            console.error("tenant OCR failed:", e);
          }
        }

        const ocrRefMatch = refsMatch(ocrRef, paymentReference);
        const ocrAmountMatch = ocrAmount > 0 && amountMatches(ocrAmount, bdtNum);
        const ocrAccountMatch = accountMatches(ocrAccountNumber, fullBankAccount);
        verificationLog.push(ocrRefMatch ? `✅ OCR Ref matched (${ocrRef})` : `❌ OCR Ref mismatch/missing (OCR: ${ocrRef}, Submitted: ${paymentReference})`);
        verificationLog.push(ocrAmountMatch ? `✅ OCR Amount matched (OCR: ৳${ocrAmount} vs Submitted: ৳${bdtNum})` : `❌ OCR Amount mismatch/missing (OCR: ৳${ocrAmount}, Submitted: ৳${bdtNum})`);
        verificationLog.push(ocrAccountMatch ? `✅ OCR Account matched (${ocrAccountNumber} ~ ${bankFirst3}...${bankLast4})` : `❌ OCR Account mismatch/missing (OCR: ${ocrAccountNumber}, Bank: ${bankFirst3}...${bankLast4})`);

        const requestTime = new Date(payment.created_at);
        const windowStart = new Date(requestTime.getTime() - 120 * 60 * 1000).toISOString();
        const windowEnd = new Date(requestTime.getTime() + 30 * 60 * 1000).toISOString();
        const { data: telegramMsgs } = await supabase
          .from("telegram_messages")
          .select("text, raw_update, created_at, update_id, chat_id, matched_request_id")
          .gte("created_at", windowStart)
          .lte("created_at", windowEnd)
          .order("created_at", { ascending: false })
          .limit(200);

        let telegramMatch = false;
        let telegramMatchDetail = "";
        let matchedMsg: any = null;
        let alreadyMatchedSkipped = 0;
        const perMsgReasons: string[] = [];
        for (const msg of telegramMsgs || []) {
          const raw = msg.raw_update || {};
          const payloadMsg = raw.message || raw.edited_message || raw.channel_post || raw.edited_channel_post || {};
          const text = msg.text || payloadMsg.text || payloadMsg.caption || "";
          const snippet = text.replace(/\s+/g, " ").slice(0, 80);
          if (msg.matched_request_id && msg.matched_request_id !== payment_id) {
            alreadyMatchedSkipped++;
            if (perMsgReasons.length < 5) perMsgReasons.push(`⏭ already matched to other req: "${snippet}"`);
            continue;
          }
          const digitsInText = text.replace(/[^\d]/g, "");
          const hasFullAccount = fullBankAccount && digitsInText.includes(fullBankAccount);
          const hasFirst3Last4 = bankFirst3 && bankLast4 && digitsInText.includes(bankFirst3) && digitsInText.includes(bankLast4);
          const hasFirst4Last4 = bankFirst4 && bankLast4 && digitsInText.includes(bankFirst4) && digitsInText.includes(bankLast4);
          const hasAccountMatch = hasFullAccount || hasFirst4Last4 || hasFirst3Last4;
          const numberMatches = extractSmsCreditAmounts(text);
          const matchedAmount = numberMatches.find((n) => amountMatches(n, bdtNum)) || 0;
          if (hasAccountMatch && matchedAmount) {
            telegramMatch = true;
            matchedMsg = msg;
            const matchType = hasFullAccount ? `full: ${fullBankAccount}` : hasFirst4Last4 ? `first4+last4: ${bankFirst4}...${bankLast4}` : `first3+last4: ${bankFirst3}...${bankLast4}`;
            telegramMatchDetail = `${matchType}, amount: ৳${matchedAmount}`;
            break;
          }
          if (perMsgReasons.length < 5) perMsgReasons.push(`${hasAccountMatch ? "✓acct" : `✗acct(need ${bankFirst3}...${bankLast4})`} ${matchedAmount ? "✓amt" : `✗amt(need ৳${bdtNum})`}: "${snippet}"`);
        }
        verificationLog.push(telegramMatch ? `✅ Telegram SMS matched (${telegramMatchDetail})` : `❌ Telegram SMS no match (bankAcct=${fullBankAccount}, bdt=${bdtNum}, total in window: ${telegramMsgs?.length ?? 0}, checked: ${(telegramMsgs?.length ?? 0) - alreadyMatchedSkipped}, already-matched skipped: ${alreadyMatchedSkipped})${perMsgReasons.length ? ` | tried: ${perMsgReasons.join(" ; ")}` : ""}`);

        const logText = `Tenant auto-verification: ${verificationLog.join(" | ")}`;
        await supabase.from("tenant_payments").update({
          verification_log: logText,
          last_verify_at: new Date().toISOString(),
          verify_attempts: Number(payment.verify_attempts || 0) + 1,
        }).eq("id", payment_id).in("status", ["pending", "hold"]);

        if (!(ocrRefMatch && ocrAmountMatch && ocrAccountMatch && telegramMatch)) {
          return json({ ok: true, auto_approved: false, reason: logText, retry_suggested: !telegramMatch, payment_id });
        }

        const { data: duplicateRef } = await supabase
          .from("tenant_payments")
          .select("id")
          .eq("payment_reference", paymentReference)
          .eq("status", "approved")
          .neq("id", payment_id)
          .limit(1);
        if (duplicateRef?.length) return json({ ok: true, auto_approved: false, reason: "Duplicate transaction ID", payment_id });

        const { data: rpcData, error: rpcErr } = await supabase.rpc("approve_tenant_limit_payment" as any, {
          p_payment_id: payment_id,
          p_admin: null,
        });
        if (rpcErr) throw rpcErr;
        await supabase.from("tenant_payments").update({ verification_log: logText }).eq("id", payment_id);
        if (matchedMsg) await supabase.from("telegram_messages").update({ matched_request_id: payment_id }).eq("update_id", matchedMsg.update_id);
        if (bank?.seller_id && bdtNum > 0) {
          const { data: sellerTxn, error: sellerErr } = await supabase
            .from("seller_transactions")
            .insert({
              seller_id: bank.seller_id,
              type: "tenant_payment",
              bdt_amount: bdtNum,
              usdt_amount: 0,
              rate: 0,
              description: `Tenant payment auto-approved — ${tenant.name || "Tenant"} (${payment.payment_type || "payment"})`,
              bank_account_id: payment.bank_account_id,
              tenant_payment_id: payment_id,
              proof_url: payment.proof_url,
              status: "approved",
              reviewed_by: null,
              reviewed_at: new Date().toISOString(),
              entry_by_name: `Tenant: ${tenant.name || "Unknown"}`,
            })
            .select("id")
            .maybeSingle();
          if (sellerErr && !String(sellerErr.message || "").toLowerCase().includes("duplicate")) {
            console.error("Tenant auto-approve seller ledger insert failed:", sellerErr);
          }
          let sellerTxnId = sellerTxn?.id || null;
          if (!sellerTxnId) {
            const { data: existingSellerTxn } = await supabase
              .from("seller_transactions")
              .select("id")
              .eq("tenant_payment_id", payment_id)
              .maybeSingle();
            sellerTxnId = existingSellerTxn?.id || null;
          }
          if (sellerTxnId && payment.proof_url) {
            await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/forward-seller-proof`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                seller_transaction_id: sellerTxnId,
                payment_kind: "bdt_payment",
                proof_url: payment.proof_url,
                seller_name: `Tenant: ${tenant.name || "Unknown"}`,
                seller_id: bank.seller_id,
                bdt_amount: bdtNum,
                bank_account_id: payment.bank_account_id,
                reference: paymentReference || `tenant:${payment_id.slice(0, 8)}`,
              }),
            }).catch((e) => console.error("Tenant auto-approve forward failed:", e));
          }
        }
        await logSystem("tenant_payment_auto_approved", { payment_id, amount: bdtNum, limit_amount: payment.limit_amount, rpc: rpcData });
        return json({ ok: true, auto_approved: true, payment_id, rpc: rpcData });
      }

      case "report-usage":
      case "report_usage":
      case "refund-usage":
      case "refund_usage": {
        const isRefund = action === "refund-usage" || action === "refund_usage";
        const amount = Number(field("amount") ?? 0);
        if (!amount || amount <= 0) return json({ error: "amount required" }, 400);
        const idempotencyKey = String(field("idempotency_key") ?? "").trim();
        const source = String(field("source") ?? "") || null;
        const meta = (field("meta") as any) ?? null;

        // Guard: only count usage if ad account name is present in meta.
        // If missing, ignore the call (treat as a separate sync/identification issue)
        // so we never silently deduct/top-up "nameless" amounts.
        const acctName = meta && typeof meta === "object"
          ? String((meta as any).account_name ?? "").trim()
          : "";
        if (!isRefund && !acctName) {
          await logSystem("report_usage_skipped_no_account_name", {
            amount,
            idempotency_key: idempotencyKey || null,
            source,
            meta,
          });
          return json({
            success: true,
            ok: true,
            skipped: true,
            reason: "missing meta.account_name — usage ignored",
          });
        }

        const { data: rpcData, error: rpcErr } = await supabase.rpc("apply_tenant_usage" as any, {
          p_tenant_id: tenant.id,
          p_amount: amount,
          p_action: isRefund ? "refund-usage" : "report-usage",
          p_key: idempotencyKey || null,
          p_source: source,
          p_meta: meta,
        });
        if (rpcErr) throw rpcErr;
        const result = (rpcData as any) || {};
        await logSystem(isRefund ? "refund_usage" : "report_usage", {
          amount,
          duplicate: !!result.duplicate,
          before_total_used: result.before_total_used ?? null,
          after_total_used: result.after_total_used ?? null,
          idempotency_key: idempotencyKey || null,
          source,
        });
        return json({
          success: true,
          ok: true,
          duplicate: !!result.duplicate,
          total_used: Number(result.total_used ?? 0),
          system_limit: result.system_limit ?? null,
          before_total_used: result.before_total_used ?? null,
          after_total_used: result.after_total_used ?? null,
        });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    console.error("tenant-webhook error:", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
});
