import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { FACEBOOK_CONNECT_SCOPES } from "./facebookPermissions";

describe("Facebook campaign connection permissions", () => {
  it("requests ads_management to run campaigns", () => {
    assert.equal(FACEBOOK_CONNECT_SCOPES.split(",").includes("ads_management"), true);
  });

  it("requests ads_read to read campaigns", () => {
    assert.equal(FACEBOOK_CONNECT_SCOPES.split(",").includes("ads_read"), true);
  });
});