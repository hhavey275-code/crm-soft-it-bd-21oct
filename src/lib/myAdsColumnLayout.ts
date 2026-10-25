export const BASE_METRIC_COLUMNS = [
  { key: "attribution", label: "Attribution setting" },
  { key: "results", label: "Results" },
  { key: "cost", label: "Cost per result" },
  { key: "budget", label: "Budget" },
  { key: "spend", label: "Amount spent" },
  { key: "impressions", label: "Impressions" },
  { key: "reach", label: "Reach" },
  { key: "ctr", label: "CTR" },
  { key: "purchases", label: "Purchases" },
  { key: "cost_purchase", label: "Cost per purchase" },
  { key: "purchase_value", label: "Purchase value" },
  { key: "roas", label: "Purchase ROAS" },
];

export const DEFAULT_METRIC_KEYS = [...BASE_METRIC_COLUMNS.map(c => c.key), "frequency", "cpm", "msg"];

export const columnStorageKey = (userId: string) => `myads-column-layout:v1:${userId}`;

export function normalizeColumnKeys(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_METRIC_KEYS];
  return [...new Set(value.filter((key): key is string => typeof key === "string" && allowed.includes(key)))];
}

export function moveColumn(keys: readonly string[], key: string, targetIndex: number): string[] {
  if (!keys.includes(key)) return [...keys];
  const result = keys.filter(k => k !== key);
  result.splice(Math.max(0, Math.min(targetIndex, result.length)), 0, key);
  return result;
}