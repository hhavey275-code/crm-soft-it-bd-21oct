import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { myAdsAvailability } from "./myAdsAvailability";

describe("My Ads Create availability", () => {
  test("Disabled status 2 blocks creation", () => {
    const result = myAdsAvailability({ status: 2 });
    assert.equal(result.canCreate, false);
    assert.equal(result.status, 2);
  });
  test("Unsettled status 3 blocks creation", () => {
    const result = myAdsAvailability({ status: "3" });
    assert.equal(result.canCreate, false);
    assert.equal(result.status, 3);
  });
  test("a failed status read cannot enable Create or imply Disabled", () => {
    const result = myAdsAvailability({ error: "(#200) Permission denied" });
    assert.equal(result.canCreate, false);
    assert.equal(result.status, null);
  });
  test("pending verification blocks creation", () => {
    assert.equal(myAdsAvailability().canCreate, false);
  });
  test("verified Active status 1 enables creation", () => {
    assert.equal(myAdsAvailability({ status: 1 }).canCreate, true);
  });
  test("closed and pending review states block creation", () => {
    for (const status of [7, 8, 9, 100, 101]) assert.equal(myAdsAvailability({ status }).canCreate, false);
  });
  test("a request failure blocks creation", () => {
    assert.equal(myAdsAvailability(null, "Network failed").canCreate, false);
  });
});