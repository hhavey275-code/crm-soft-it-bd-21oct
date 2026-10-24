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
  return {
    ...data,
    campaigns: data.campaigns.filter(row => level !== "campaign" || String(row.id) !== id),
    adsets: data.adsets.filter(row => level === "campaign" ? String(row.campaign_id) !== id : level !== "adset" || String(row.id) !== id),
    ads: data.ads.filter(row => level === "campaign" ? String(row.campaign_id) !== id : level === "adset" ? String(row.adset_id) !== id : String(row.id) !== id),
  };
}