// Temporary helper: fetches edge function source via Supabase Management API.
// Parses eszip body and returns extracted source files.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as eszip from "https://deno.land/x/eszip@v0.83.0/mod.ts";

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
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*",
      },
    });
  }
  try {
    const { action, slug, files, verify_jwt, entrypoint, filterPath } = await req.json();

    if (action === "list") {
      const r = await mgmt(`/projects/${PROJECT_REF}/functions`);
      return Response.json(r);
    }

    if (action === "get") {
      const meta = await mgmt(`/projects/${PROJECT_REF}/functions/${slug}`);
      const bodyRes = await fetch(
        `${API}/projects/${PROJECT_REF}/functions/${slug}/body`,
        { headers: { Authorization: `Bearer ${PAT}` } },
      );
      if (!bodyRes.ok) {
        return Response.json({
          error: "body fetch failed",
          status: bodyRes.status,
          text: await bodyRes.text(),
        });
      }
      const buf = new Uint8Array(await bodyRes.arrayBuffer());
      const parser = await eszip.Parser.createInstance();
      const specifiers: string[] = await parser.parseBytes(buf);
      await parser.load();
      const sourceFiles: Record<string, string> = {};
      for (const spec of specifiers) {
        if (filterPath && !spec.includes(filterPath)) continue;
        try {
          const mod = await parser.getModuleSource(spec);
          if (typeof mod === "string") sourceFiles[spec] = mod;
        } catch (e) {
          sourceFiles[spec] = `[ERROR: ${(e as Error).message}]`;
        }
      }
      return Response.json({ meta: meta.body, specifiers, sourceFiles });
    }

    if (action === "deploy") {
      const form = new FormData();
      const metadata = {
        name: slug,
        verify_jwt: verify_jwt ?? true,
        entrypoint_path: entrypoint || "index.ts",
      };
      form.append(
        "metadata",
        new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      );
      for (const f of files) {
        form.append(
          "file",
          new Blob([f.content], { type: "application/typescript" }),
          f.name,
        );
      }
      const res = await fetch(
        `${API}/projects/${PROJECT_REF}/functions/deploy?slug=${slug}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${PAT}` },
          body: form,
        },
      );
      const text = await res.text();
      return Response.json({ status: res.status, body: text });
    }

    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
});
