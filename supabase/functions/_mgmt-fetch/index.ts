// Temporary helper: fetches edge function source via Supabase Management API
// Usage: POST { action: "list" } or { action: "get", slug: "topup" } or { action: "deploy", slug, files: [{name, content}] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PAT = Deno.env.get("SB_MGMT_PAT")!;
const PROJECT_REF = "dhswrfzdqcavgmymllat";
const API = "https://api.supabase.com/v1";

async function mgmt(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" } });
  }
  try {
    const { action, slug, files, verify_jwt, entrypoint } = await req.json();

    if (action === "list") {
      const r = await mgmt(`/projects/${PROJECT_REF}/functions`);
      return Response.json(r);
    }

    if (action === "get") {
      // Get metadata
      const meta = await mgmt(`/projects/${PROJECT_REF}/functions/${slug}`);
      // Get body (eszip download)
      const bodyRes = await fetch(`${API}/projects/${PROJECT_REF}/functions/${slug}/body`, {
        headers: { Authorization: `Bearer ${PAT}` },
      });
      const ct = bodyRes.headers.get("content-type") || "";
      let bodyData: any;
      if (ct.includes("application/json")) {
        bodyData = await bodyRes.json();
      } else {
        bodyData = await bodyRes.text();
      }
      return Response.json({ meta, body: { status: bodyRes.status, contentType: ct, data: bodyData } });
    }

    if (action === "deploy") {
      // Deploy via multipart form-data per Supabase mgmt API
      const form = new FormData();
      const metadata = {
        name: slug,
        verify_jwt: verify_jwt ?? true,
        entrypoint_path: entrypoint || "index.ts",
      };
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      for (const f of files) {
        form.append("file", new Blob([f.content], { type: "application/typescript" }), f.name);
      }
      const res = await fetch(`${API}/projects/${PROJECT_REF}/functions/deploy?slug=${slug}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${PAT}` },
        body: form,
      });
      const text = await res.text();
      return Response.json({ status: res.status, body: text });
    }

    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
});
