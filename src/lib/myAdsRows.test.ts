import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { matchesAdsFilter, removeAdsObject, updateAdsStatus } from "./myAdsRows";

describe("My Ads filters and deletion", () => {
  test("Active ads includes active delivery but excludes ads paused by their campaign", () => {
    assert.equal(matchesAdsFilter({ id: "1", status: "ACTIVE", effective_status: "ACTIVE" }, "active"), true);
    assert.equal(matchesAdsFilter({ id: "2", status: "ACTIVE", effective_status: "CAMPAIGN_PAUSED" }, "active"), false);
    assert.equal(matchesAdsFilter({ id: "3", status: "PAUSED" }, "active"), false);
  });
  test("Had delivery accepts spend even when impressions is zero", () => {
    assert.equal(matchesAdsFilter({ id: "1", insights: { impressions: "0", spend: "1.20" } }, "delivery"), true);
    assert.equal(matchesAdsFilter({ id: "2", insights: { impressions: "0", spend: "0" } }, "delivery"), false);
  });
  test("deleted and archived ads never return to current lists", () => {
    for (const status of ["DELETED", "ARCHIVED"]) assert.equal(matchesAdsFilter({ id: "1", status }, "all"), false);
  });
  const data = { campaigns: [{ id: "1" }, { id: "2" }], adsets: [{ id: "11", campaign_id: "1" }, { id: "22", campaign_id: "2" }], ads: [{ id: "111", campaign_id: "1", adset_id: "11" }, { id: "222", campaign_id: "2", adset_id: "22" }] };
  test("deleting a campaign removes its children without affecting another campaign", () => {
    const result = removeAdsObject(data, "campaign", "1");
    assert.deepEqual(result.campaigns.map(r => r.id), ["2"]);
    assert.deepEqual(result.adsets.map(r => r.id), ["22"]);
    assert.deepEqual(result.ads.map(r => r.id), ["222"]);
    assert.equal(data.ads.length, 2);
  });
  test("deleting an ad set removes only that set and its ads", () => {
    const result = removeAdsObject(data, "adset", "11");
    assert.equal(result.campaigns.length, 2);
    assert.deepEqual(result.adsets.map(r => r.id), ["22"]);
    assert.deepEqual(result.ads.map(r => r.id), ["222"]);
  });
  test("deleting an ad preserves its parents and other ads", () => {
    const result = removeAdsObject(data, "ad", "111");
    assert.equal(result.campaigns.length, 2);
    assert.equal(result.adsets.length, 2);
    assert.deepEqual(result.ads.map(r => r.id), ["222"]);
  });
  test("full campaign deletion removes children even if an ad lacks campaign_id", () => {
    const result = removeAdsObject({ ...data, ads: [{ id: "111", adset_id: "11" }, { id: "222", adset_id: "22" }] }, "campaign", "1");
    assert.deepEqual(result.ads.map(row => row.id), ["222"]);
  });
  test("campaign pause stops descendant delivery without changing their individual switches", () => {
    const input = { campaigns: [{ id: "1", status: "ACTIVE" }], adsets: [{ id: "11", campaign_id: "1", status: "ACTIVE", effective_status: "ACTIVE" }], ads: [{ id: "111", campaign_id: "1", adset_id: "11", status: "ACTIVE", effective_status: "ACTIVE" }, { id: "112", campaign_id: "1", adset_id: "11", status: "PAUSED", effective_status: "PAUSED" }] };
    const paused = updateAdsStatus(input, "campaign", "1", { status: "PAUSED", effective_status: "PAUSED" });
    assert.equal(paused.adsets[0].effective_status, "CAMPAIGN_PAUSED");
    assert.equal(paused.ads[0].effective_status, "CAMPAIGN_PAUSED");
    assert.equal(paused.ads[0].status, "ACTIVE");
    assert.equal(paused.ads[1].status, "PAUSED");
    const resumed = updateAdsStatus(paused, "campaign", "1", { status: "ACTIVE", effective_status: "ACTIVE" });
    assert.equal(resumed.ads[0].effective_status, "ACTIVE");
    assert.equal(resumed.ads[1].effective_status, "PAUSED");
  });
});