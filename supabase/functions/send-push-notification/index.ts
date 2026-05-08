// Sends a Web Push to all of a user's saved push_subscriptions.
// Triggered by the DB `trigger_push_notification` trigger on notifications table,
// and may also be invoked directly by other edge functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VAPID_PUBLIC_KEY = "BKJ1G9G2poDwFKSkU_btVIWLP5CdTQ195LjlsB-tNyYw-3bw7IGKxHZuVmArYYbxSrMFZyMnPyCRb_bSYoRVjdM";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

if (VAPID_PRIVATE_KEY) {
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); } catch (e) { console.error("VAPID setup error", e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!VAPID_PRIVATE_KEY) {
      return new Response(JSON.stringify({ error: "VAPID_PRIVATE_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const { user_id, title, message, type, url } = body || {};
    if (!user_id || !title) {
      return new Response(JSON.stringify({ error: "user_id and title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", user_id);
    if (error) throw error;

    const payload = JSON.stringify({ title, message: message || "", type: type || "info", url: url || "/" });
    const results: any[] = [];
    const stale: string[] = [];

    await Promise.all((subs || []).map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 }
        );
        results.push({ id: s.id, ok: true });
      } catch (e: any) {
        const status = e?.statusCode || 0;
        results.push({ id: s.id, ok: false, status, error: e?.body || e?.message });
        if (status === 404 || status === 410) stale.push(s.id);
      }
    }));

    if (stale.length) {
      await supabase.from("push_subscriptions").delete().in("id", stale);
    }

    return new Response(JSON.stringify({ ok: true, sent: results.filter(r => r.ok).length, total: results.length, stale: stale.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("send-push-notification error:", e?.message);
    return new Response(JSON.stringify({ error: e?.message || "push failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
