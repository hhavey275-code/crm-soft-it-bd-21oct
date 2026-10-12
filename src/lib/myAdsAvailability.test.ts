import { describe, expect, test } from "bun:test";
import { myAdsAvailability } from "./myAdsAvailability";

describe("My Ads Create availability", () => {
  test("Disabled status 2 blocks creation", () => {
    const result = myAdsAvailability({ status: 2 });
    expect(result.canCreate).toBe(false);
    expect(result.status).toBe(2);
  });
  test("Unsettled status 3 blocks creation", () => {
    const result = myAdsAvailability({ status: "3" });
    expect(result.canCreate).toBe(false);
    expect(result.status).toBe(3);
  });
  test("a failed status read cannot enable Create or imply Disabled", () => {
    const result = myAdsAvailability({ error: "(#200) Permission denied" });
    expect(result.canCreate).toBe(false);
    expect(result.status).toBeNull();
  });
  test("pending verification blocks creation", () => {
    expect(myAdsAvailability().canCreate).toBe(false);
  });
  test("verified Active status 1 enables creation", () => {
    expect(myAdsAvailability({ status: 1 }).canCreate).toBe(true);
  });
  test("closed and pending review states block creation", () => {
    for (const status of [7, 8, 9, 100, 101]) expect(myAdsAvailability({ status }).canCreate).toBe(false);
  });
  test("a request failure blocks creation", () => {
    expect(myAdsAvailability(null, "Network failed").canCreate).toBe(false);
  });
});