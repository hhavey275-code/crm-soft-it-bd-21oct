import { useEffect, useState } from "react";
import { Columns3, ChevronDown, ArrowLeft, ArrowRight, GripVertical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BASE_METRIC_COLUMNS, DEFAULT_METRIC_KEYS, columnStorageKey, normalizeColumnKeys, moveColumn } from "@/lib/myAdsColumnLayout";
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

export const METRIC_COLUMNS = [
  ...BASE_METRIC_COLUMNS,
  ...EXTRA_COLUMNS.filter(c => !BASE_METRIC_COLUMNS.some(base => base.key === c.key)),
];
const allowedKeys = METRIC_COLUMNS.map(c => c.key);

export function useMetricColumns(userId?: string) {
  const [state, setState] = useState<{ userId?: string; keys: string[] }>({ keys: [...DEFAULT_METRIC_KEYS] });
  const keys = state.userId === userId ? state.keys : DEFAULT_METRIC_KEYS;
  useEffect(() => {
    let saved: unknown;
    try { if (userId) saved = JSON.parse(localStorage.getItem(columnStorageKey(userId)) ?? "null"); } catch {}
    setState({ userId, keys: normalizeColumnKeys(saved, allowedKeys) });
  }, [userId]);
  const update = (next: string[]) => {
    setState({ userId, keys: next });
    try { if (userId) localStorage.setItem(columnStorageKey(userId), JSON.stringify(next)); } catch {}
  };
  return {
    keys,
    toggle: (key: string) => update(keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]),
    move: (key: string, index: number) => update(moveColumn(keys, key, index)),
    reset: () => update([...DEFAULT_METRIC_KEYS]),
  };
}

export function ColumnsPicker({ keys, toggle, move, reset, className }: {
  keys: string[]; toggle: (key: string) => void; move: (key: string, index: number) => void; reset: () => void; className: string;
}) {
  const [search, setSearch] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={className}><Columns3 className="h-4 w-4" />Columns<ChevronDown className="h-4 w-4" /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="fb-font w-[min(620px,calc(100vw-24px))] p-0 text-fb-text">
        <div className="flex items-center justify-between border-b border-fb-border px-3 py-2">
          <p className="text-[13px] font-bold">Customize columns</p>
          <Button variant="ghost" size="sm" onClick={reset}><RotateCcw />Reset</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <div className="border-b border-fb-border p-3 sm:border-b-0 sm:border-r">
            <Input aria-label="Search metrics" placeholder="Search metrics" value={search} onChange={e => setSearch(e.target.value)} className="mb-2" />
            <div className="max-h-48 overflow-y-auto sm:max-h-80">
              {METRIC_COLUMNS.filter(c => c.label.toLowerCase().includes(search.toLowerCase())).map(c => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 py-2 text-[13px] hover:bg-fb-bg">
                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-fb-blue" checked={keys.includes(c.key)} onChange={() => toggle(c.key)} />{c.label}
                </label>
              ))}
            </div>
          </div>
          <div className="p-3">
            <p className="mb-2 text-[13px] font-bold">Selected columns ({keys.length})</p>
            <ol className="max-h-64 overflow-y-auto sm:max-h-80">
              {keys.map((key, index) => (
                <li key={key} draggable onDragStart={e => { setDragged(key); e.dataTransfer.setData("text/plain", key); }} onDragEnd={() => setDragged(null)}
                  onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const source = dragged ?? e.dataTransfer.getData("text/plain"); if (keys.includes(source)) move(source, index); setDragged(null); }}
                  className="flex min-h-10 items-center gap-1 border-b border-fb-border text-[13px]">
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-fb-muted" />
                  <span className="min-w-0 flex-1 break-words">{METRIC_COLUMNS.find(c => c.key === key)?.label}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={index === 0} title="Move left" aria-label={`Move ${METRIC_COLUMNS.find(c => c.key === key)?.label} left`} onClick={() => move(key, index - 1)}><ArrowLeft /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={index === keys.length - 1} title="Move right" aria-label={`Move ${METRIC_COLUMNS.find(c => c.key === key)?.label} right`} onClick={() => move(key, index + 1)}><ArrowRight /></Button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
