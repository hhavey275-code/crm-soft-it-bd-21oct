import { format } from "date-fns";
import { chunkedMetaSync } from "@/lib/chunkedMetaSync";

const round2 = (v: number) => Math.round(v * 100) / 100;

export async function fetchPeriodSpendFromMeta(adAccountIds: string[], from: Date, to: Date): Promise<number> {
  if (!adAccountIds.length) return 0;

  const { insights } = await chunkedMetaSync(adAccountIds, {
    date_from: format(from, "yyyy-MM-dd"),
    date_to: format(to, "yyyy-MM-dd"),
  });

  let total = 0;
  Object.values(insights ?? {}).forEach((ins: any) => {
    if (typeof ins?.date_spend === "number") {
      total += Number(ins.date_spend) || 0;
      return;
    }

    if (Array.isArray(ins?.daily_breakdown)) {
      total += ins.daily_breakdown.reduce((sum: number, d: any) => sum + (Number(d?.spend) || 0), 0);
      return;
    }

    total += Number(ins?.today_spend) || 0;
  });

  return round2(total);
}