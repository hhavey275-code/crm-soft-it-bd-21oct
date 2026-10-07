// Facebook-style "Delivery" column: a campaign/ad set's own status says ACTIVE even while its
// ads are still in review or learning, so we derive the real state from the children.

export type Delivery = { label: string; tone: "green" | "red" | "grey" | "blue" | "amber" };

const D = (label: string, tone: Delivery["tone"]): Delivery => ({ label, tone });

export function adDelivery(ad: any): Delivery {
  const e = String(ad?.effective_status || ad?.status || "").toUpperCase();
  if (e === "ACTIVE") return D("Active", "green");
  if (e === "PENDING_REVIEW" || e === "IN_PROCESS" || e === "PREAPPROVED") return D("In review", "blue");
  if (e === "DISAPPROVED") return D("Rejected", "red");
  if (e === "WITH_ISSUES") return D("Error", "red");
  if (e === "PENDING_BILLING_INFO") return D("Billing issue", "red");
  if (e === "ADSET_PAUSED") return D("Ad set off", "grey");
  if (e === "CAMPAIGN_PAUSED") return D("Campaign off", "grey");
  if (e.includes("PAUSED")) return D("Off", "grey");
  if (e === "ARCHIVED" || e === "DELETED") return D("Deleted", "grey");
  return D(e ? e.toLowerCase().replace(/_/g, " ") : "—", "grey");
}

function fromChildren(own: string, start: string | undefined, end: string | undefined, ads: any[], learning?: string): Delivery {
  const e = own.toUpperCase();
  if (e.includes("PAUSED")) return D(e === "CAMPAIGN_PAUSED" ? "Campaign off" : "Off", "grey");
  if (e === "ARCHIVED" || e === "DELETED") return D("Deleted", "grey");
  if (e === "WITH_ISSUES") return D("Error", "red");
  if (e === "PENDING_BILLING_INFO") return D("Billing issue", "red");
  if (end && new Date(end).getTime() < Date.now()) return D("Completed", "grey");
  if (!ads.length) return D("No ads", "grey");
  const ds = ads.map(adDelivery);
  const has = (l: string) => ds.some((d) => d.label === l);
  if (has("Active")) {
    if (start && new Date(start).getTime() > Date.now()) return D("Scheduled", "blue");
    if (learning === "LEARNING") return D("Learning", "green");
    if (learning === "FAIL") return D("Learning limited", "amber");
    return D("Active", "green");
  }
  if (has("In review")) return D("In review", "blue");
  if (has("Error") || has("Billing issue")) return D("Error", "red");
  if (has("Rejected")) return D("Rejected", "red");
  return D("Ads off", "grey");
}

export function adsetDelivery(s: any, allAds: any[]): Delivery {
  const ads = allAds.filter((a) => String(a.adset_id) === String(s.id));
  return fromChildren(String(s.effective_status || s.status || ""), s.start_time, s.end_time, ads, s.learning_stage_info?.status);
}

export function campaignDelivery(c: any, allAdsets: any[], allAds: any[]): Delivery {
  const sets = allAdsets.filter((s) => String(s.campaign_id) === String(c.id));
  const ads = allAds.filter((a) => String(a.campaign_id) === String(c.id));
  const e = String(c.effective_status || c.status || "");
  if (sets.length && ads.some((a) => adDelivery(a).label === "Active")) {
    const live = sets.map((s) => adsetDelivery(s, allAds));
    if (live.some((d) => d.label === "Active")) return D("Active", "green");
    if (live.some((d) => d.label === "Learning")) return D("Learning", "green");
    if (live.some((d) => d.label === "Learning limited")) return D("Learning limited", "amber");
    if (live.some((d) => d.label === "Scheduled")) return D("Scheduled", "blue");
  }
  return fromChildren(e, c.start_time, c.stop_time, ads);
}
