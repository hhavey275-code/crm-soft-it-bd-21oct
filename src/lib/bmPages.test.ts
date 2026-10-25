import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { listApprovedBmPages, requireBmPageAdmin, validateBmPageAssignment } from "./bmPages.server";

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
});