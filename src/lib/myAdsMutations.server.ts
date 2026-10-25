type Graph = {
  get: (path: string, params?: Record<string, string>) => Promise<any>;
  post: (path: string, params: Record<string, unknown>) => Promise<any>;
};

/** Meta parent deletion also deletes its ad sets/ads; never delete reusable media or Page posts. */
export async function deleteMetaObject(g: Graph, id: string) {
  const result = await g.post(id, { status: "DELETED" });
  if (result?.success !== true) throw new Error("Facebook deletion was not confirmed. Refresh before retrying.");
  return { ok: true };
}

export async function setMetaObjectStatus(g: Graph, id: string, status: "ACTIVE" | "PAUSED") {
  const result = await g.post(id, { status });
  if (result?.success !== true) throw new Error("Facebook status update was not confirmed. Refresh before retrying.");
  const updated = await g.get(id, { fields: "id,status,effective_status" });
  if (updated.status !== status) throw new Error("Facebook has not confirmed the requested status. Refresh before retrying.");
  return { ok: true, object: updated };
}

/** Deep copy preserves every ad set/ad; the copy stays paused until explicitly enabled. */
export async function duplicateMetaCampaign(g: Graph, id: string, name: string) {
  const result = await g.post(`${id}/copies`, {
    deep_copy: true,
    status_option: "PAUSED",
    rename_options: { rename_strategy: "DEEP_RENAME", rename_suffix: " - Copy" },
  });
  const campaignId = String(result?.copied_campaign_id ?? "");
  if (!/^\d+$/.test(campaignId)) throw new Error("Facebook did not return the copied campaign. Refresh before retrying.");
  const renamed = await g.post(campaignId, { name });
  const campaign = await g.get(campaignId, { fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time" });
  if (campaign.status !== "PAUSED") throw new Error("The copied campaign's paused status could not be confirmed. Refresh before retrying.");
  return { ok: true, campaignId, campaign, warning: renamed?.success === true ? undefined : "Campaign copied; name update was not confirmed." };
}