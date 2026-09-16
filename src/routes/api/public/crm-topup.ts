// Public endpoint used by the "CRM Top-Up Helper" browser extension.
// Every call must carry a short-lived HMAC token minted by an admin
// (see src/lib/crmAutomation.functions.ts). No token = no access.
import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

export const Route = createFileRoute("/api/public/crm-topup")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        const { verifyCrmToken } = await import("@/lib/crmToken.server");
        const payload = verifyCrmToken(String(body?.token ?? ""));
        if (!payload) return json({ ok: false, error: "Invalid or expired token" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const action = String(body?.action ?? "");

        // ---- layout the helper learned / needs -------------------------
        if (action === "get_config") {
          const { data } = await supabaseAdmin
            .from("crm_automation_configs" as any)
            .select("host, name, selectors, auto_confirm")
            .eq("host", payload.host)
            .maybeSingle();
          return json({
            ok: true,
            job:
              payload.scope === "topup"
                ? {
                    requestId: payload.requestId,
                    accountId: payload.accountId,
                    amount: payload.amount,
                    walletKind: payload.walletKind,
                  }
                : null,
            scope: payload.scope,
            config: data ?? null,
          });
        }

        if (action === "save_config") {
          if (payload.scope !== "learn") return json({ ok: false, error: "Learn token required" }, 403);
          const selectors = body?.selectors;
          if (!selectors || typeof selectors !== "object") {
            return json({ ok: false, error: "selectors is required" }, 400);
          }
          const { error } = await supabaseAdmin.from("crm_automation_configs" as any).upsert(
            {
              host: payload.host,
              name: body?.name ? String(body.name).slice(0, 120) : payload.host,
              selectors,
            },
            { onConflict: "host" }
          );
          if (error) return json({ ok: false, error: error.message }, 400);
          return json({ ok: true });
        }

        // ---- automation result ----------------------------------------
        if (action === "result") {
          if (payload.scope !== "topup" || !payload.requestId) {
            return json({ ok: false, error: "Top-up token required" }, 403);
          }
          if (body?.success) {
            const { data, error } = await supabaseAdmin.rpc("complete_external_topup" as any, {
              p_id: payload.requestId,
            });
            if (error) return json({ ok: false, error: error.message }, 400);
            if (!(data as any)?.ok) return json({ ok: false, error: (data as any)?.error ?? "Failed" }, 400);
            if (body?.providerTxnId) {
              await supabaseAdmin
                .from("external_topup_requests" as any)
                .update({ provider_txn_id: String(body.providerTxnId).slice(0, 120), last_error: null })
                .eq("id", payload.requestId);
            }
            return json({ ok: true });
          }
          const { error } = await supabaseAdmin.rpc("fail_external_topup" as any, {
            p_id: payload.requestId,
            p_error: String(body?.error ?? "Automation failed").slice(0, 500),
          });
          if (error) return json({ ok: false, error: error.message }, 400);
          return json({ ok: true, recorded: "failure" });
        }

        return json({ ok: false, error: "Unknown action" }, 400);
      },
    },
  },
});
