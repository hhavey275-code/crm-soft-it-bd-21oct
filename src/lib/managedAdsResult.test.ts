import { describe, it, expect } from "vitest";
import { resultOf } from "./managedAdsApi";

const ins = { spend: "0.11", actions: [{ action_type: "link_click", value: "3" }] };

describe("resultOf by objective", () => {
  it("Sales campaign does not count link clicks", () => {
    expect(resultOf(ins, { objective: "OUTCOME_SALES" })).toEqual({ count: 0, cost: null });
  });
  it("Sales campaign counts purchases", () => {
    const r = resultOf({ spend: "10", actions: [{ action_type: "link_click", value: "50" }, { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" }] }, { objective: "OUTCOME_SALES" });
    expect(r).toEqual({ count: 2, cost: 5 });
  });
  it("Message ad set counts conversations", () => {
    const r = resultOf({ spend: "4", actions: [{ action_type: "link_click", value: "9" }, { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "4" }] }, { objective: "OUTCOME_ENGAGEMENT", goal: "CONVERSATIONS" });
    expect(r.count).toBe(4);
  });
});
