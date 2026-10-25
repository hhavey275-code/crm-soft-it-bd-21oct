export type AdsLevel = "campaign" | "adset" | "ad";
export type AdsFilter = "all" | "active" | "delivery";
type AdsRow = { id: string; name?: string; status?: string; effective_status?: string; campaign_id?: string; adset_id?: string; insights?: { impressions?: string; spend?: string } };

export function matchesAdsFilter(row: AdsRow, filter: AdsFilter): boolean {
  const status = String(row.effective_status || row.status || "").toUpperCase();
  if (status === "DELETED" || status === "ARCHIVED") return false;
  if (filter === "active") return status === "ACTIVE";
  if (filter === "delivery") return Number(row.insights?.impressions || 0) > 0 || Number(row.insights?.spend || 0) > 0;
  return true;
}

export function removeAdsObject<T extends { campaigns: AdsRow[]; adsets: AdsRow[]; ads: AdsRow[] }>(data: T, level: AdsLevel, id: string): T {
  const removedSets = new Set(data.adsets.filter(row => level === "campaign" && String(row.campaign_id) === id).map(row => String(row.id)));
  return {
    ...data,
    campaigns: data.campaigns.filter(row => level !== "campaign" || String(row.id) !== id),
    adsets: data.adsets.filter(row => level === "campaign" ? String(row.campaign_id) !== id : level !== "adset" || String(row.id) !== id),
    ads: data.ads.filter(row => level === "campaign" ? String(row.campaign_id) !== id && !removedSets.has(String(row.adset_id)) : level === "adset" ? String(row.adset_id) !== id : String(row.id) !== id),
  };
}

export function updateAdsStatus<T extends { campaigns: AdsRow[]; adsets: AdsRow[]; ads: AdsRow[] }>(data: T, level: AdsLevel, id: string, updated: Pick<AdsRow, "status" | "effective_status">): T {
  const key = level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : "ads";
  const next = { ...data, [key]: data[key].map(row => String(row.id) === id ? { ...row, ...updated } : row) };
  const campaignOf = (row: AdsRow) => next.campaigns.find(c => String(c.id) === String(row.campaign_id));
  const inherited = (row: AdsRow, ad: boolean): AdsRow => {
    if (["DELETED", "ARCHIVED"].includes(row.effective_status ?? "")) return row;
    const campaign = campaignOf(row);
    const adset = ad ? next.adsets.find(s => String(s.id) === String(row.adset_id)) : undefined;
    const effective = row.status === "PAUSED" ? "PAUSED" : campaign?.status === "PAUSED" ? "CAMPAIGN_PAUSED" : adset?.status === "PAUSED" ? "ADSET_PAUSED" : ["CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(row.effective_status ?? "") ? row.status : row.effective_status;
    return { ...row, effective_status: effective };
  };
  return { ...next, adsets: next.adsets.map(row => inherited(row, false)), ads: next.ads.map(row => inherited(row, true)) };
}