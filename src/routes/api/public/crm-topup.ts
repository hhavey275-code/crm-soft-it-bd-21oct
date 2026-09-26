// Public endpoint used by the "CRM Top-Up Helper" browser extension.
// Every call must carry a short-lived HMAC token minted by an admin
// (see src/lib/crmAutomation.functions.ts). No token = no access.
import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
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

        const action = String(body?.action ?? "");
        // Diagnostics: helper calls that fail are hard to trace from the
        // browser, so every request records its action in the server log.
        console.log(`[crm-topup] action=${action || "(none)"} hasToken=${!!body?.token}`);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Mint and verify on this same deployment. This avoids invalid
        // signatures when the dashboard is served from a custom domain whose
        // runtime has a different secret binding.
        if (action === "create_job" || action === "create_learn" || action === "create_autopilot") {
          const auth = request.headers.get("authorization") ?? "";
          const accessToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
          if (!accessToken) return json({ ok: false, error: "Admin login required" }, 401);

          const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
          const userId = authData.user?.id;
          if (authError || !userId) return json({ ok: false, error: "Admin session expired" }, 401);

          const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
            supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
            supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "superadmin" }),
          ]);
          if (!isAdmin && !isSuper) return json({ ok: false, error: "Admin access required" }, 403);

          // Long-lived Auto-pilot token (30 days). The extension stores it and
          // uses it to list/claim pending requests — no CRM URL needed.
          if (action === "create_autopilot") {
            const { signCrmToken } = await import("@/lib/crmToken.server");
            const token = signCrmToken({
              scope: "autopilot",
              host: "*",
              actorId: userId,
              exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            });
            return json({ ok: true, token });
          }

          let crmUrl: URL;
          try {
            crmUrl = new URL(String(body?.url ?? ""));
          } catch {
            return json({ ok: false, error: "Invalid CRM URL" }, 400);
          }
          if (crmUrl.protocol !== "https:" && crmUrl.protocol !== "http:") {
            return json({ ok: false, error: "Invalid CRM URL" }, 400);
          }

          const host = crmUrl.host.toLowerCase();
          const { signCrmToken } = await import("@/lib/crmToken.server");

          if (action === "create_learn") {
            const token = signCrmToken({
              scope: "learn",
              host,
              exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
            });
            return json({ ok: true, token, host });
          }

          const requestId = String(body?.requestId ?? "");
          if (!requestId) return json({ ok: false, error: "Request is required" }, 400);
          const { data: topup, error: topupError } = await supabaseAdmin
            .from("external_topup_requests" as any)
            .select("id, amount, status, wallet_kind, ad_account_id")
            .eq("id", requestId)
            .maybeSingle();
          if (topupError) return json({ ok: false, error: topupError.message }, 400);
          if (!topup || (topup as any).status !== "pending") {
            return json({ ok: false, error: "Pending request not found" }, 404);
          }
          const { data: account } = await supabaseAdmin
            .from("ad_accounts")
            .select("account_id")
            .eq("id", (topup as any).ad_account_id)
            .maybeSingle();
          const accountId = String(account?.account_id ?? "").replace(/^act_/, "");
          if (!accountId) return json({ ok: false, error: "Ad account ID missing" }, 400);

          const token = signCrmToken({
            scope: "topup",
            host,
            requestId: (topup as any).id,
            accountId,
            amount: Number((topup as any).amount),
            walletKind: (topup as any).wallet_kind ?? "primary",
             actorId: userId,
            exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
          });
          await supabaseAdmin
            .from("external_topup_requests" as any)
            .update({ crm_provider: host, automation_started_at: new Date().toISOString() })
            .eq("id", requestId);
          return json({ ok: true, token, host, accountId, amount: Number((topup as any).amount) });
        }

        const { verifyCrmTokenDetailed } = await import("@/lib/crmToken.server");
        const { payload, reason } = verifyCrmTokenDetailed(String(body?.token ?? ""));
        if (!payload) {
          const msg =
            reason === "expired"
              ? "Link expired — press Teach / Approve & Top-Up again"
              : reason === "no_secret"
                ? "Server not configured (CRM_JOB_SECRET missing)"
                : "Invalid token — reopen from the dashboard";
          return json({ ok: false, error: msg, reason }, 401);
        }

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
                    autopilot: !!payload.autopilot,
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
               auto_confirm: true,
            },
            { onConflict: "host" }
          );
          if (error) return json({ ok: false, error: error.message }, 400);
          return json({ ok: true });
        }

        // ---- Auto-pilot: list & claim pending requests ------------------
        if (action === "list_pending") {
          if (payload.scope !== "autopilot") return json({ ok: false, error: "Auto-pilot token required" }, 403);
          const { data, error } = await supabaseAdmin
            .from("external_topup_requests" as any)
            .select(
              "id, amount, wallet_kind, external_topup_url, created_at, ad_accounts(account_id, external_topup_url, external_topup_url_secondary, external_topup_url_credit_line)"
            )
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(20);
          if (error) return json({ ok: false, error: error.message }, 400);
          const items = (data ?? []).map((r: any) => {
            const a = r.ad_accounts ?? {};
            const url =
              r.wallet_kind === "credit_line"
                ? a.external_topup_url_credit_line || a.external_topup_url || r.external_topup_url || ""
                : r.wallet_kind === "secondary"
                  ? a.external_topup_url_secondary || a.external_topup_url || r.external_topup_url || ""
                  : a.external_topup_url || r.external_topup_url || "";
            return {
              id: r.id,
              amount: Number(r.amount),
              walletKind: r.wallet_kind ?? "primary",
              accountId: String(a.account_id ?? "").replace(/^act_/, ""),
              url,
            };
          });
          return json({ ok: true, items });
        }

        if (action === "claim") {
          if (payload.scope !== "autopilot") return json({ ok: false, error: "Auto-pilot token required" }, 403);
          const requestId = String(body?.requestId ?? "");
          if (!requestId) return json({ ok: false, error: "requestId is required" }, 400);

          const now = new Date().toISOString();
          const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();

          // Only one external top-up may run at a time across every helper /
          // PC — the CRM cannot handle two spend-cap forms at once.
          const { data: inFlight } = await supabaseAdmin
            .from("external_topup_requests" as any)
            .select("id")
            .eq("status", "pending")
            .not("automation_started_at", "is", null)
            .gt("automation_started_at", staleBefore)
            .neq("id", requestId)
            .limit(1);
          if (inFlight && inFlight.length > 0) {
            return json({ ok: false, error: "Another top-up is running", reason: "busy" }, 409);
          }

          // Atomic claim: only one Auto-pilot instance can take a request.
          const { data: claimed, error: claimErr } = await supabaseAdmin
            .from("external_topup_requests" as any)
            .update({ automation_started_at: now, last_error: null, updated_at: now })
            .eq("id", requestId)
            .eq("status", "pending")
            .or(`automation_started_at.is.null,automation_started_at.lt.${staleBefore}`)
            .select("id, amount, wallet_kind, ad_account_id, external_topup_url")
            .maybeSingle();
          if (claimErr) return json({ ok: false, error: claimErr.message }, 400);
          if (!claimed) return json({ ok: false, error: "Already claimed or no longer pending" }, 409);

          // The request stays pending until the helper confirms the CRM
          // top-up actually went through (action=result).

          const { data: acct } = await supabaseAdmin
            .from("ad_accounts")
            .select("account_id, external_topup_url, external_topup_url_secondary, external_topup_url_credit_line")
            .eq("id", (claimed as any).ad_account_id)
            .maybeSingle();
          const accountId = String(acct?.account_id ?? "").replace(/^act_/, "");
          const url =
            (claimed as any).wallet_kind === "credit_line"
              ? (acct as any)?.external_topup_url_credit_line || acct?.external_topup_url || (claimed as any).external_topup_url || ""
              : (claimed as any).wallet_kind === "secondary"
                ? acct?.external_topup_url_secondary || acct?.external_topup_url || (claimed as any).external_topup_url || ""
                : acct?.external_topup_url || (claimed as any).external_topup_url || "";
          if (!accountId || !url) {
            return json({ ok: false, error: "Ad account ID or CRM URL missing" }, 400);
          }

          const { signCrmToken } = await import("@/lib/crmToken.server");
          const host = new URL(url).host.toLowerCase();
          const token = signCrmToken({
            scope: "topup",
            host,
            requestId,
            accountId,
            amount: Number((claimed as any).amount),
            walletKind: (claimed as any).wallet_kind ?? "primary",
            actorId: payload.actorId,
            autopilot: true,
            exp: Math.floor(Date.now() / 1000) + 60 * 60,
          });
          return json({ ok: true, token, url, accountId, amount: Number((claimed as any).amount) });
        }


        // ---- automation result ----------------------------------------
        if (action === "result") {
          if (payload.scope !== "topup" || !payload.requestId) {
            return json({ ok: false, error: "Top-up token required" }, 403);
          }
          if (body?.success) {
             const completedAt = new Date().toISOString();
             const completion = {
               status: "completed",
               completed_by: payload.actorId ?? null,
               completed_at: completedAt,
               updated_at: completedAt,
               last_error: null,
               ...(body?.providerTxnId
                 ? { provider_txn_id: String(body.providerTxnId).slice(0, 120) }
                 : {}),
             };
             const { data, error } = await supabaseAdmin
               .from("external_topup_requests" as any)
               .update(completion)
               .eq("id", payload.requestId)
               .eq("status", "pending")
               .select("id")
               .maybeSingle();
             if (error) return json({ ok: false, error: error.message }, 400);
             if (!data) {
               const { data: existing } = await supabaseAdmin
                 .from("external_topup_requests" as any)
                 .select("status")
                 .eq("id", payload.requestId)
                 .maybeSingle();
               if ((existing as any)?.status !== "completed") {
                 return json({ ok: false, error: "Request is no longer pending" }, 409);
               }
             }
            // Pull the new spend cap from Meta right away so history shows
            // old → new limit without anyone pressing "manual update".
            const capUpdated = await refreshCapFromMeta(supabaseAdmin, payload.requestId);
            return json({ ok: true, capUpdated });
          }
          // Auto-pilot failure: release the claim so the request stays visible
          // as pending with the reason, and can be retried or done by hand.
          if (payload.autopilot) {
            const failedAt = new Date().toISOString();
            const { error: relErr } = await supabaseAdmin
              .from("external_topup_requests" as any)
              .update({
                automation_started_at: null,
                last_error: String(body?.error ?? "Automation failed").slice(0, 500),
                updated_at: failedAt,
              })
              .eq("id", payload.requestId)
              .eq("status", "pending");
            if (relErr) return json({ ok: false, error: relErr.message }, 400);
            return json({ ok: true, recorded: "released" });
          }
          const { error } = await supabaseAdmin.rpc("fail_external_topup" as any, {
            p_id: payload.requestId,
            p_error: String(body?.error ?? "Automation failed").slice(0, 500),
          });
          if (error) return json({ ok: false, error: error.message }, 400);
          return json({ ok: true, recorded: "failure" });

        }

        console.warn(`[crm-topup] UNKNOWN ACTION: ${JSON.stringify(action)} keys=${Object.keys(body ?? {}).join(",")}`);
        return json({ ok: false, error: `Unknown action: ${action || "(empty)"}` }, 400);
      },
    },
  },
});
