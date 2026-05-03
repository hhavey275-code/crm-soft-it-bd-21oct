// Tenant → Master webhook. Receives heartbeat/chat/bm/withdraw from tenant projects.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

        // Forward proof to Telegram group (best-effort, non-blocking failure)
        if (proof_url) {
          try {
            // Resolve target group strictly from the selected bank only.
            // Never fall back to a global group: that can leak one bank/seller proof into another group.
            let targetGroupId = "";
            let groupSource = "";
            if (bank_account_id) {
              const { data: bank } = await supabase
                .from("bank_accounts")
                .select("telegram_group_id, bank_name, account_number")
                .eq("id", bank_account_id)
                .maybeSingle();
              if (bank?.telegram_group_id) {
                targetGroupId = String(bank.telegram_group_id).trim();
                groupSource = `bank:${bank.bank_name ?? bank_account_id}`;
              }
            }
            if (!targetGroupId) console.log("Tenant proof forward skipped: selected bank has no Telegram group ID", bank_account_id);

            const { data: tokRow } = await supabase
              .from("site_settings")
              .select("value")
              .eq("key", "telegram_bot_token")
              .maybeSingle();
            const botToken = tokRow?.value || "";

            // Compute seller's running Due/Advance total (same as forward-proof / forward-seller-proof).
            // The bank is owned by a seller; we include this tenant payment as a `tenant_payment` style credit.
            let runningTotalLine = "";
            try {
              let sellerId: string | null = null;
              if (bank_account_id) {
                const { data: bankRow } = await supabase
                  .from("bank_accounts")
                  .select("seller_id")
                  .eq("id", bank_account_id)
                  .maybeSingle();
                sellerId = bankRow?.seller_id ?? null;
              }
              if (sellerId) {
                const { data: txns } = await supabase
                  .from("seller_transactions")
                  .select("type, bdt_amount, usdt_amount, rate, status, created_at")
                  .eq("seller_id", sellerId);
                let running = 0;
                const sorted = [...(txns || [])].sort(
                  (a: any, b: any) =>
                    new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                );
                for (const t of sorted) {
                  if ((t.status || "approved") !== "approved") continue;
                  if (t.type === "bdt_payment" || t.type === "client_topup" || t.type === "tenant_payment") {
                    running += Number(t.bdt_amount || 0);
                  } else if (t.type === "withdraw") {
                    running -= Number(t.bdt_amount || 0);
                  } else if (t.type === "usdt_received") {
                    running -= Number(t.usdt_amount || 0) * Number(t.rate || 0);
                  }
                }
                // Include this incoming tenant payment as a credit (it's pending but the
                // forward should reflect what total will be once approved).
                running += Number(amount || 0);
                const fmt = (v: number) => Math.round(Math.abs(v)).toLocaleString("en-IN");
                if (running > 0) runningTotalLine = `\n🟢 Total: Advance +৳${fmt(running)}`;
                else if (running < 0) runningTotalLine = `\n🔴 Total: Due −৳${fmt(running)}`;
                else runningTotalLine = `\n⚪ Total: ৳0`;
              }
            } catch (totalErr) {
              console.warn("tenant payment running total compute failed:", totalErr);
            }

            if (targetGroupId && botToken) {
              const amtLine = `💰 ৳${Number(amount).toLocaleString("en-IN")}`;
              const limitLine = limit_amount
                ? `\n📈 Limit: $${Number(limit_amount).toLocaleString()}`
                : "";
              const refLine = payment_reference ? `\n🔖 Ref: ${payment_reference}` : "";
              const typeLabel = payment_type === "subscription" ? "Subscription" : "Limit Purchase";
              const caption =
                `🏢 <b>Tenant Payment</b> (${typeLabel})\n` +
                `🏷 ${tenant.name}\n` +
                `${amtLine}${limitLine}${refLine}${runningTotalLine}`;
              // Retry up to 4 times with exponential backoff so transient
              // Telegram errors / rate limits don't drop the proof when a
              // bank-specific group is configured.
              const maxAttempts = 4;
              let delivered = false;
              let lastErr: any = null;
              for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                  // Try sendPhoto first; if Telegram can't fetch the photo URL
                  // (some storage URLs return non-image content-type), fall
                  // back to sendMessage with the link so the proof is never
                  // silently lost.
                  const tgRes = await fetch(
                    `https://api.telegram.org/bot${botToken}/sendPhoto`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        chat_id: targetGroupId,
                        photo: proof_url,
                        caption,
                        parse_mode: "HTML",
                      }),
                    },
                  );
                  const tgJson = await tgRes.json().catch(() => ({}));
                  if (tgJson?.ok) {
                    delivered = true;
                    console.log(
                      `Tenant proof forwarded (attempt ${attempt}) → ${groupSource} (${targetGroupId})`,
                    );
                    break;
                  }
                  lastErr = tgJson;
                  // Honor Telegram retry_after for 429s
                  const retryAfter = Number(tgJson?.parameters?.retry_after);
                  const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : Math.min(8000, 500 * 2 ** (attempt - 1));
                  console.warn(
                    `Tenant proof forward attempt ${attempt}/${maxAttempts} failed; retrying in ${waitMs}ms`,
                    tgJson,
                  );
                  if (attempt < maxAttempts) {
                    await new Promise((r) => setTimeout(r, waitMs));
                  }
                } catch (netErr) {
                  lastErr = netErr;
                  const waitMs = Math.min(8000, 500 * 2 ** (attempt - 1));
                  console.warn(
                    `Tenant proof forward attempt ${attempt}/${maxAttempts} threw; retrying in ${waitMs}ms`,
                    netErr,
                  );
                  if (attempt < maxAttempts) {
                    await new Promise((r) => setTimeout(r, waitMs));
                  }
                }
              }

              // Final fallback: send a plain text message with the proof link
              // so the group always sees the payment even if the photo upload
              // keeps failing.
              if (!delivered) {
                try {
                  const fbRes = await fetch(
                    `https://api.telegram.org/bot${botToken}/sendMessage`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        chat_id: targetGroupId,
                        text: `${caption}\n\n🖼 Proof: ${proof_url}`,
                        parse_mode: "HTML",
                        disable_web_page_preview: false,
                      }),
                    },
                  );
                  const fbJson = await fbRes.json().catch(() => ({}));
                  if (fbJson?.ok) {
                    console.log(
                      `Tenant proof forwarded via text fallback → ${groupSource} (${targetGroupId})`,
                    );
                  } else {
                    console.error(
                      "Tenant proof forward FAILED after retries + fallback",
                      { lastErr, fallback: fbJson, group: targetGroupId },
                    );
                  }
                } catch (fbErr) {
                  console.error(
                    "Tenant proof forward fallback threw",
                    { lastErr, fbErr, group: targetGroupId },
                  );
                }
              }
            } else {
              console.warn("Tenant proof forward skipped: missing token or group", {
                hasToken: !!botToken,
                hasGroup: !!targetGroupId,
              });
            }
          } catch (fwdErr) {
            console.error("Tenant proof forward error:", fwdErr);
          }
        }

        return json({ ok: true, payment_id: data.id });
      }

      case "verify-tenant-payment":
      case "verify_tenant_payment": {
        // Lightweight stub: just return pending. Master admin reviews manually
        // via AdminTenants UI; auto-approval pipeline is not yet wired.
        const payment_id = field<string>("payment_id");
        return json({ ok: true, auto_approved: false, payment_id });
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
