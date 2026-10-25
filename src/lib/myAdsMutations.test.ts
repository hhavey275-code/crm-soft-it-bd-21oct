import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { deleteMetaObject, setMetaObjectStatus, duplicateMetaCampaign } from "./myAdsMutations.server";

describe("confirmed Meta campaign mutations", () => {
  test("delete sends DELETED to the whole campaign and rejects unconfirmed deletion", async () => {
    const calls: any[] = [];
    const g = { get: async () => ({}), post: async (...args: any[]) => { calls.push(args); return { success: true }; } };
    assert.deepEqual(await deleteMetaObject(g, "123"), { ok: true });
    assert.deepEqual(calls, [["123", { status: "DELETED" }]]);
    await assert.rejects(deleteMetaObject({ ...g, post: async () => ({ success: false }) }, "123"));
  });
  test("pause is read back from Meta before success", async () => {
    const calls: any[] = [];
    const g = { post: async (...args: any[]) => { calls.push(args); return { success: true }; }, get: async () => ({ id: "123", status: "PAUSED", effective_status: "PAUSED" }) };
    const result = await setMetaObjectStatus(g, "123", "PAUSED");
    assert.equal(result.object.status, "PAUSED");
    assert.deepEqual(calls[0], ["123", { status: "PAUSED" }]);
    await assert.rejects(setMetaObjectStatus({ ...g, get: async () => ({ status: "ACTIVE" }) }, "123", "PAUSED"));
  });
  test("duplicate deep copies every child and always starts paused", async () => {
    const calls: any[] = [];
    const g = { post: async (path: string, body: any) => { calls.push([path, body]); return path.endsWith("/copies") ? { copied_campaign_id: "456" } : { success: true }; }, get: async () => ({ id: "456", name: "Copy", status: "PAUSED" }) };
    const result = await duplicateMetaCampaign(g, "123", "Copy");
    assert.equal(result.campaignId, "456");
    assert.equal(calls[0][0], "123/copies");
    assert.equal(calls[0][1].deep_copy, true);
    assert.equal(calls[0][1].status_option, "PAUSED");
    assert.deepEqual(calls[1], ["456", { name: "Copy" }]);
    await assert.rejects(duplicateMetaCampaign({ ...g, post: async () => ({}) }, "123", "Copy"));
  });
});