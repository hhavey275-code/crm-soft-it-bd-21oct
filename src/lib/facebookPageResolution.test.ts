import { describe, expect, it } from "bun:test";
import { facebookPageReference, resolveFacebookPage } from "./facebookPageResolution.server";

describe("Facebook Page request resolution", () => {
  it("reads IT Corner's pasted profile.php reference without guessing its type", () => {
    expect(facebookPageReference("https://www.facebook.com/profile.php?id=100078746184144")).toBe("100078746184144");
  });
  it("uses the canonical Page ID from the consenting client's Page list", async () => {
    const page = await resolveFacebookPage("https://www.facebook.com/profile.php?id=100078746184144", { get: async () => { throw new Error("no BM access"); } }, { get: async () => ({ data: [{ id: "950812028110247", name: "IT Corner", link: "https://facebook.com/profile.php?id=100078746184144" }] }) });
    expect(page.id).toBe("950812028110247");
  });
  it("does not request access using an unverified numeric fallback", async () => {
    await expect(resolveFacebookPage("100078746184144", { get: async () => { throw new Error("denied"); } })).rejects.toThrow("Page নিশ্চিত করা যায়নি");
  });
  it("does not treat a person id/name lookup as proof of a Page", async () => {
    await expect(resolveFacebookPage("100078746184144", { get: async () => ({ id: "100078746184144", name: "A person" }) })).rejects.toThrow("Page নিশ্চিত করা যায়নি");
  });
  it("accepts a BM-readable Page with a Page-specific category", async () => {
    const page = await resolveFacebookPage("ITCorner", { get: async () => ({ id: "123456789012345", name: "IT Corner", category: "Business" }) });
    expect(page.id).toBe("123456789012345");
  });
});