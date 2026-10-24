import { describe, expect, it } from "vitest";
import { FACEBOOK_CONNECT_SCOPES } from "./facebookPermissions";

describe("Facebook campaign connection permissions", () => {
  it("requests ads_management to run campaigns", () => {
    expect(FACEBOOK_CONNECT_SCOPES.split(",")).toContain("ads_management");
  });

  it("requests ads_read to read campaigns", () => {
    expect(FACEBOOK_CONNECT_SCOPES.split(",")).toContain("ads_read");
  });
});