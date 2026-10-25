import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { columnStorageKey, moveColumn, normalizeColumnKeys } from "./myAdsColumnLayout";

describe("My Ads client metric preferences", () => {
  test("a client can place cost per result before spend and budget", () => {
    assert.deepEqual(moveColumn(["budget", "spend", "cost"], "cost", 0), ["cost", "budget", "spend"]);
    assert.deepEqual(moveColumn(["cost", "budget", "spend"], "cost", 2), ["budget", "spend", "cost"]);
  });
  test("saved visible metrics keep their exact order after JSON reload", () => {
    const saved = JSON.parse(JSON.stringify(["spend", "cost", "results"]));
    assert.deepEqual(normalizeColumnKeys(saved, ["results", "cost", "budget", "spend"]), ["spend", "cost", "results"]);
  });
  test("different clients have separate preference keys", () => {
    assert.equal(columnStorageKey("client-a"), "myads-column-layout:v1:client-a");
    assert.notEqual(columnStorageKey("client-a"), columnStorageKey("client-b"));
  });
  test("hidden metrics stay hidden and duplicate or unknown metrics are removed", () => {
    assert.deepEqual(normalizeColumnKeys(["cost", "cost", "unknown"], ["cost", "budget"]), ["cost"]);
    assert.deepEqual(normalizeColumnKeys([], ["cost", "budget"]), []);
  });
});