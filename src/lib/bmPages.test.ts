import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { listApprovedBmPages, readBmPages, requireBmPageAdmin, validateBmPageAssignment } from "./bmPages.server";
import { encryptToken } from "./metaGraph.server";

describe("BM Page import", () => {
  it("rejects clients and permits only a verified admin", () => {
    assert.throws(() => requireBmPageAdmin(false), /Admin/);
    assert.doesNotThrow(() => requireBmPageAdmin(true));
  });
  it("requires the account to belong to the selected BM and client", () => {
    assert.throws(() => validateBmPageAssignment("other-bm", "arazshop", true), /BM/);
    assert.throws(() => validateBmPageAssignment("arazshop", "arazshop", false), /ক্লায়েন্ট/);
    assert.doesNotThrow(() => validateBmPageAssignment("arazshop", "arazshop", true));
  });
  it("imports granted partner and owned Pages, follows cursors and deduplicates", async () => {
    const calls: string[] = [];
    const pages = await listApprovedBmPages({ get: async (path, params) => {
      calls.push(`${path}:${params?.after || ""}`);
      if (path.endsWith("owned_pages")) return { data: [{ id: "123456789", name: "Raiyanshop" }, { id: "987654321", name: "Arazshop" }] };
      if (params?.after) return { data: [{ id: "555555555", name: "Second page" }] };
      return { data: [{ id: "123456789", name: "Raiyanshop" }], paging: { next: "next", cursors: { after: "second" } } };
    } }, "arazshop");
    assert.deepEqual(pages.map(p => p.id), ["123456789", "555555555", "987654321"]);
    assert.deepEqual(calls, ["arazshop/client_pages:", "arazshop/client_pages:second", "arazshop/owned_pages:"]);
  });
  it("does not report denied or pending requests as imported Pages", async () => {
    await assert.rejects(listApprovedBmPages({ get: async () => { throw new Error("permission denied"); } }, "arazshop"), /permission denied/);
    assert.deepEqual(await listApprovedBmPages({ get: async () => ({ data: [] }) }, "arazshop"), []);
  });
  it("reads an already connected plaintext BM token without encryption secrets", async () => {
    await checkStoredToken("test-bm-token", undefined);
  });
  it("reads encrypted BM tokens using the normalized saved server key", async () => {
    await checkStoredToken(await encryptToken("test-bm-token", "test-key"), 'Bearer "test-key"');
  });
});

async function checkStoredToken(stored: string, key: string | undefined) {
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldSecret = process.env.BM_TOKEN_SECRET;
  const oldFetch = globalThis.fetch;
  let calls = 0;
  try {
    delete process.env.BM_TOKEN_SECRET;
    if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    globalThis.fetch = async (input, init) => {
      calls++;
      const url = String(input);
      // Graph helpers may use the configured proxy; check either request shape.
      if (url.includes("graph.facebook.com")) assert.equal(new URL(url).searchParams.get("access_token"), "test-bm-token");
      else assert.ok(String(init?.body).includes("test-bm-token"));
      return new Response(JSON.stringify({ data: [{ id: "123456789", name: "Raiyanshop" }] }), { headers: { "content-type": "application/json" } });
    };
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { bm_id: "1759026254761677", name: "ArazShop", access_token: stored }, error: null }) };
    const pages = await readBmPages({ from: () => query }, "arazshop-bm");
    assert.equal(pages[0]?.id, "123456789");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    if (oldSecret === undefined) delete process.env.BM_TOKEN_SECRET;
    else process.env.BM_TOKEN_SECRET = oldSecret;
  }
}