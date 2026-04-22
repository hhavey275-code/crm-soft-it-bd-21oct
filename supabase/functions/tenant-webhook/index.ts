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

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e: any) {
    console.error("tenant-webhook error:", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
});
