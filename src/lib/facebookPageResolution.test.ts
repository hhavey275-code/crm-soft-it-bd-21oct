import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { facebookPageReference, resolveFacebookPage } from "./facebookPageResolution.server";

describe("Facebook Page request resolution", () => {
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