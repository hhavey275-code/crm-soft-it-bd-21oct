import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { facebookPageReference, resolveFacebookPage } from "./facebookPageResolution.server";

describe("Facebook Page request resolution", () => {
  it("resolves Raiyanshop from Arazshop BM without the marketer's Page login", async () => {
    const bm = { get: async (path: string) => {
      assert.equal(path, "arazshop-bm/client_pages");
      return { data: [{ id: "123456789012345", name: "Raiyanshop", link: "https://www.facebook.com/raiyanshop" }] };
    } };
    const page = await resolveFacebookPage("https://facebook.com/Raiyanshop/", bm, undefined, undefined, "arazshop-bm");
    assert.equal(page.id, "123456789012345");
    assert.equal("bmAccess" in page && page.bmAccess, true);
  });
  it("resolves a profile.php alias to the BM's canonical Page ID", async () => {
    const page = await resolveFacebookPage("https://facebook.com/profile.php?id=100078746184144", {
      get: async () => ({ data: [{ id: "950812028110247", name: "Raiyanshop", link: "https://facebook.com/profile.php?id=100078746184144" }] }),
    }, undefined, undefined, "arazshop-bm");
    assert.equal(page.id, "950812028110247");
  });
  it("searches later BM pages and then owned Pages by cursor", async () => {
    const calls: string[] = [];
    const page = await resolveFacebookPage("123456789012345", { get: async (path: string, params?: Record<string, string>) => {
      calls.push(`${path}:${params?.after || ""}`);
      if (path.endsWith("client_pages")) return params?.after ? { data: [] } : { data: [], paging: { next: "next", cursors: { after: "cursor-2" } } };
      return { data: [{ id: "123456789012345", name: "Raiyanshop" }] };
    } }, undefined, undefined, "arazshop-bm");
    assert.equal(page.id, "123456789012345");
    assert.deepEqual(calls, ["arazshop-bm/client_pages:", "arazshop-bm/client_pages:cursor-2", "arazshop-bm/owned_pages:"]);
  });
  it("never matches unrelated BM Pages or treats failed membership reads as approved access", async () => {
    const page = await resolveFacebookPage("61593375281848", { get: async (path: string) => {
      if (path.endsWith("client_pages")) return { data: [{ id: "123456789012345", name: "Other Page" }] };
      throw new Error("no access");
    } }, undefined, undefined, "arazshop-bm");
    assert.equal(page.id, "61593375281848");
    assert.equal("bmAccess" in page, false);
    assert.equal("unverified" in page && page.unverified, true);
  });
  it("reads IT Corner's pasted profile.php reference without guessing its type", () => {
    assert.equal(facebookPageReference("https://www.facebook.com/profile.php?id=100078746184144"), "100078746184144");
  });
  it("uses the canonical Page ID from the consenting client's Page list", async () => {
    const page = await resolveFacebookPage("https://www.facebook.com/profile.php?id=100078746184144", { get: async () => { throw new Error("no BM access"); } }, { get: async () => ({ data: [{ id: "950812028110247", name: "IT Corner", link: "https://facebook.com/profile.php?id=100078746184144" }] }) });
    assert.equal(page.id, "950812028110247");
  });
  it("lets Facebook validate a typed Page ID the BM cannot read yet, marked unverified", async () => {
    const page: any = await resolveFacebookPage("61593375281848", { get: async () => { throw new Error("denied"); } });
    assert.equal(page.id, "61593375281848");
    assert.equal(page.unverified, true);
  });
  it("does not use a profile.php link number when unverifiable", async () => {
    await assert.rejects(resolveFacebookPage("https://www.facebook.com/profile.php?id=100078746184144", { get: async () => { throw new Error("denied"); } }), /Page নিশ্চিত করা যায়নি/);
  });
  it("does not treat a person id/name lookup as proof of a Page", async () => {
    await assert.rejects(resolveFacebookPage("100078746184144", { get: async () => ({ id: "100078746184144", name: "A person" }) }), /Page নিশ্চিত করা যায়নি/);
  });
  it("turns a username Page link into its numeric ID for the BM request", async () => {
    const page: any = await resolveFacebookPage("https://www.facebook.com/scaleup", { get: async () => { throw new Error("denied"); } }, undefined, async () => ({ id: "61593375281848", name: "ScaleUp" }));
    assert.equal(page.id, "61593375281848");
    assert.equal(page.unverified, true);
  });
  it("accepts a BM-readable Page with a Page-specific category", async () => {
    const page = await resolveFacebookPage("ITCorner", { get: async () => ({ id: "123456789012345", name: "IT Corner", category: "Business" }) });
    assert.equal(page.id, "123456789012345");
  });
});