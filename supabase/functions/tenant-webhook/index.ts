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
        await supabase
          .from("tenants")
          .update({ last_heartbeat_at: new Date().toISOString() } as any)
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
            // Resolve target group: bank-specific first, then global fallback
            let targetGroupId = "";
            if (bank_account_id) {
              const { data: bank } = await supabase
                .from("bank_accounts")
                .select("telegram_group_id")
                .eq("id", bank_account_id)
                .maybeSingle();
              if (bank?.telegram_group_id) targetGroupId = bank.telegram_group_id;
            }
            if (!targetGroupId) {
              const { data: gRow } = await supabase
                .from("site_settings")
                .select("value")
                .eq("key", "tenant_forward_group_id")
                .maybeSingle();
              targetGroupId = gRow?.value || "";
            }
            if (!targetGroupId) {
              const { data: gRow2 } = await supabase
                .from("site_settings")
                .select("value")
                .eq("key", "telegram_forward_group_id")
                .maybeSingle();
              targetGroupId = gRow2?.value || "";
            }

            const { data: tokRow } = await supabase
              .from("site_settings")
              .select("value")
              .eq("key", "telegram_bot_token")
              .maybeSingle();
            const botToken = tokRow?.value || "";

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
                `${amtLine}${limitLine}${refLine}`;
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
              if (!tgJson.ok) {
                console.warn("Tenant proof Telegram forward failed:", tgJson);
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
      case "report_usage": {
        const amount = Number(field("amount") ?? 0);
        if (!amount || amount <= 0) return json({ error: "amount required" }, 400);
        const newUsed = Number(tenant.total_used ?? 0) + amount;
        const { error } = await supabase
          .from("tenants")
          .update({ total_used: newUsed } as any)
          .eq("id", tenant.id);
        if (error) throw error;
        await logSystem("report_usage", { amount, new_total_used: newUsed });
        return json({
          success: true,
          ok: true,
          total_used: newUsed,
          system_limit: tenant.system_limit ?? null,
        });
      }

      case "refund-usage":
      case "refund_usage": {
        const amount = Number(field("amount") ?? 0);
        if (!amount || amount <= 0) return json({ error: "amount required" }, 400);
        const newUsed = Math.max(0, Number(tenant.total_used ?? 0) - amount);
        const { error } = await supabase
          .from("tenants")
          .update({ total_used: newUsed } as any)
          .eq("id", tenant.id);
        if (error) throw error;
        await logSystem("refund_usage", { amount, new_total_used: newUsed });
        return json({
          success: true,
          ok: true,
          total_used: newUsed,
          system_limit: tenant.system_limit ?? null,
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
