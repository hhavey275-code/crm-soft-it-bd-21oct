import { useEffect, useState } from "react";
import { Columns3, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const act = (ins: any, keys: string[]) => {
  const a = (ins?.actions ?? []).find((x: any) => keys.includes(x.action_type));
  return a ? Number(a.value) || 0 : null;
};
const cpa = (ins: any, keys: string[]) => {
  const a = (ins?.cost_per_action_type ?? []).find((x: any) => keys.includes(x.action_type));
  return a ? Number(a.value) || 0 : null;
};
const MSG = ["onsite_conversion.messaging_conversation_started_7d"];
const NEWMSG = ["onsite_conversion.messaging_first_reply"];
const PUR = ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"];
const LEAD = ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"];

type Kind = "money" | "num" | "pct" | "dec";
export type ExtraCol = { key: string; label: string; kind: Kind; get: (ins: any) => number | null; total: "sum" | "avg" | "spendPer"; sub: string };

export const EXTRA_COLUMNS: ExtraCol[] = [
  { key: "frequency", label: "Frequency", kind: "dec", get: (i) => (i?.frequency ? Number(i.frequency) : null), total: "avg", sub: "Per Meta Account" },
  { key: "cpm", label: "CPM (cost per 1,000 impressions)", kind: "money", get: (i) => (i?.cpm ? Number(i.cpm) : null), total: "avg", sub: "Per 1,000 Impressions" },
  { key: "clicks", label: "Clicks (all)", kind: "num", get: (i) => (i?.clicks ? Number(i.clicks) : null), total: "sum", sub: "Total" },
  { key: "cpc", label: "CPC (all)", kind: "money", get: (i) => (i?.cpc ? Number(i.cpc) : null), total: "avg", sub: "Per Click" },
  { key: "link_clicks", label: "Link clicks", kind: "num", get: (i) => (i?.inline_link_clicks ? Number(i.inline_link_clicks) : null), total: "sum", sub: "Total" },
  { key: "cplc", label: "CPC (cost per link click)", kind: "money", get: (i) => (i?.cost_per_inline_link_click ? Number(i.cost_per_inline_link_click) : null), total: "avg", sub: "Per Action" },
  { key: "msg", label: "Messaging conversations started", kind: "num", get: (i) => act(i, MSG), total: "sum", sub: "Total" },
  { key: "cost_msg", label: "Cost per messaging conversation", kind: "money", get: (i) => cpa(i, MSG), total: "avg", sub: "Per Action" },
  { key: "new_msg", label: "New messaging contacts", kind: "num", get: (i) => act(i, NEWMSG), total: "sum", sub: "Total" },
  { key: "purchases", label: "Purchases", kind: "num", get: (i) => act(i, PUR), total: "sum", sub: "Total" },
  { key: "cost_purchase", label: "Cost per purchase", kind: "money", get: (i) => cpa(i, PUR), total: "avg", sub: "Per Action" },
  { key: "roas", label: "Purchase ROAS", kind: "dec", get: (i) => { const r = (i?.purchase_roas ?? [])[0]; return r ? Number(r.value) : null; }, total: "avg", sub: "Average" },
  { key: "leads", label: "Leads", kind: "num", get: (i) => act(i, LEAD), total: "sum", sub: "Total" },
  { key: "cost_lead", label: "Cost per lead", kind: "money", get: (i) => cpa(i, LEAD), total: "avg", sub: "Per Action" },
  { key: "engagement", label: "Post engagements", kind: "num", get: (i) => act(i, ["post_engagement"]), total: "sum", sub: "Total" },
  { key: "reactions", label: "Post reactions", kind: "num", get: (i) => act(i, ["post_reaction"]), total: "sum", sub: "Total" },
  { key: "comments", label: "Post comments", kind: "num", get: (i) => act(i, ["comment"]), total: "sum", sub: "Total" },
  { key: "shares", label: "Post shares", kind: "num", get: (i) => act(i, ["post"]), total: "sum", sub: "Total" },
  { key: "page_likes", label: "Page likes", kind: "num", get: (i) => act(i, ["like"]), total: "sum", sub: "Total" },
  { key: "video_views", label: "3-second video plays", kind: "num", get: (i) => act(i, ["video_view"]), total: "sum", sub: "Total" },
  { key: "lpv", label: "Landing page views", kind: "num", get: (i) => act(i, ["landing_page_view"]), total: "sum", sub: "Total" },
  { key: "atc", label: "Adds to cart", kind: "num", get: (i) => act(i, ["offsite_conversion.fb_pixel_add_to_cart", "add_to_cart"]), total: "sum", sub: "Total" },
  { key: "checkout", label: "Checkouts initiated", kind: "num", get: (i) => act(i, ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout"]), total: "sum", sub: "Total" },
];

export const fmtCol = (c: ExtraCol, v: number | null) => {
  if (v == null || !isFinite(v)) return "—";
  if (c.kind === "money") return `$${v.toFixed(2)}`;
  if (c.kind === "dec") return v.toFixed(2);
  if (c.kind === "pct") return `${v.toFixed(2)}%`;
  return Math.round(v).toLocaleString();
};

export function totalCol(c: ExtraCol, rows: any[]) {
  const vals = rows.map((r) => c.get(r.insights)).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return c.total === "sum" ? sum : sum / vals.length;
}

const LS = "myads-columns";
export function useExtraColumns() {
  const [keys, setKeys] = useState<string[]>(["frequency", "cpm", "msg", "purchases", "cost_purchase", "roas"]);
  useEffect(() => { try { const v = localStorage.getItem(LS); if (v) setKeys(JSON.parse(v)); } catch {} }, []);
  const toggle = (k: string) => setKeys((p) => { const n = p.includes(k) ? p.filter((x) => x !== k) : [...p, k]; localStorage.setItem(LS, JSON.stringify(n)); return n; });
  return { cols: EXTRA_COLUMNS.filter((c) => keys.includes(c.key)), keys, toggle };
}

export function ColumnsPicker({ keys, toggle, className }: { keys: string[]; toggle: (k: string) => void; className: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={className}><Columns3 className="h-4 w-4" />Columns<ChevronDown className="h-4 w-4" /></button>
      </PopoverTrigger>
      <PopoverContent align="end" className="fb-font w-72 p-0 text-fb-text">
        <p className="border-b border-fb-border px-3 py-2 text-[13px] font-bold">Customize columns</p>
        <div className="max-h-[420px] overflow-y-auto py-1">
          {EXTRA_COLUMNS.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-fb-bg">
              <input type="checkbox" className="h-4 w-4 accent-fb-blue" checked={keys.includes(c.key)} onChange={() => toggle(c.key)} />{c.label}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
