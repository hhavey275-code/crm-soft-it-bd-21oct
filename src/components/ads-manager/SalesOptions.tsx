import { useEffect, useState, type ReactNode } from "react";
import { ImagePlus, Plus, Sparkles, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { managedAds } from "@/lib/managedAdsApi";

export interface SalesOpts {
  performanceGoal: "CONVERSIONS" | "VALUE";
  attribution: "7C1V" | "7C" | "1C" | "1C1V";
  customConversionId: string;
  advantageSales: boolean;
  advantageAudience: boolean;
  customAudiences: string[];
  excludedAudiences: string[];
  locales: number[];
  placementMode: "auto" | "manual";
  positions: Record<string, string[]>;
  dayparting: boolean;
  schedule: { days: number[]; start: string; end: string };
  useCatalog: boolean;
  catalogId: string;
  productSetId: string;
  format: "single" | "carousel" | "catalog";
  cards: { b64: string; url: string; headline: string; description: string; link: string }[];
  extraMessages: string[];
  extraHeadlines: string[];
  description: string;
  displayLink: string;
  urlTags: string;
  advantageCreative: boolean;
}

export const defaultSalesOpts: SalesOpts = {
  performanceGoal: "CONVERSIONS", attribution: "7C1V", customConversionId: "", advantageSales: false, advantageAudience: false,
  customAudiences: [], excludedAudiences: [], locales: [], placementMode: "auto",
  positions: {
    facebook: ["feed", "story", "facebook_reels", "instream_video", "search", "marketplace", "right_hand_column", "profile_feed", "notification"],
    instagram: ["stream", "story", "reels", "explore", "explore_home", "profile_feed", "ig_search"],
    messenger: ["messenger_home", "story"],
    audience_network: ["classic", "rewarded_video"],
  },
  dayparting: false, schedule: { days: [0, 1, 2, 3, 4, 5, 6], start: "09:00", end: "23:00" },
  useCatalog: false, catalogId: "", productSetId: "", format: "single", cards: [],
  extraMessages: [], extraHeadlines: [], description: "", displayLink: "", urlTags: "", advantageCreative: false,
};

const POS: Record<string, [string, string][]> = {
  facebook: [["feed", "Feed"], ["profile_feed", "Profile feed"], ["marketplace", "Marketplace"], ["right_hand_column", "Right column"], ["story", "Stories"], ["facebook_reels", "Reels"], ["instream_video", "In-stream videos"], ["search", "Search results"], ["notification", "Notifications"]],
  instagram: [["stream", "Feed"], ["profile_feed", "Profile feed"], ["explore", "Explore"], ["explore_home", "Explore home"], ["story", "Stories"], ["reels", "Reels"], ["ig_search", "Search results"]],
  messenger: [["messenger_home", "Inbox"], ["story", "Stories"]],
  audience_network: [["classic", "Native, banner & interstitial"], ["rewarded_video", "Rewarded videos"]],
};
const PLAT: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger", audience_network: "Audience Network" };
const LANGS: [number, string][] = [[6, "English (US)"], [24, "English (UK)"], [45, "Bengali"], [46, "Hindi"], [28, "Arabic"], [23, "Spanish"], [9, "French"], [5, "German"], [1001, "English (All)"]];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const sel = "h-9 w-full rounded-md border border-fb-border bg-background px-3 text-[13px] text-fb-text focus:outline-none focus:ring-2 focus:ring-fb-blue/40";
const box = "rounded-lg border border-fb-border bg-background p-4 shadow-sm space-y-3 text-[13px]";
const L = ({ t, h, children }: { t: string; h?: string; children: ReactNode }) => (
  <div><p className="font-semibold">{t}</p>{h && <p className="mb-1 text-[12px] text-fb-muted">{h}</p>}<div className="mt-1">{children}</div></div>
);
const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function salesPayload(o: SalesOpts, budgetType: string) {
  const plats = Object.keys(o.positions).filter((k) => o.positions[k].length);
  return {
    performanceGoal: o.performanceGoal, attribution: o.attribution,
    customConversionId: o.customConversionId || undefined,
    advantageSales: o.advantageSales, advantageAudience: o.advantageAudience,
    customAudiences: o.customAudiences, excludedAudiences: o.excludedAudiences, locales: o.locales,
    placements: o.placementMode === "manual" && !o.advantageSales ? {
      publisher_platforms: plats,
      ...(o.positions.facebook.length ? { facebook_positions: o.positions.facebook } : {}),
      ...(o.positions.instagram.length ? { instagram_positions: o.positions.instagram } : {}),
      ...(o.positions.messenger.length ? { messenger_positions: o.positions.messenger } : {}),
      ...(o.positions.audience_network.length ? { audience_network_positions: o.positions.audience_network } : {}),
    } : undefined,
    adSchedule: o.dayparting && budgetType === "lifetime" ? [{ days: o.schedule.days, start_minute: toMin(o.schedule.start), end_minute: toMin(o.schedule.end) }] : undefined,
    catalogId: o.useCatalog ? o.catalogId || undefined : undefined,
    productSetId: o.useCatalog ? o.productSetId || undefined : undefined,
    format: o.useCatalog ? "catalog" : o.format === "catalog" ? "single" : o.format,
    cards: o.format === "carousel" && !o.useCatalog ? o.cards.map((c) => ({ imageBase64: c.b64, headline: c.headline || undefined, description: c.description || undefined, link: c.link || undefined })) : undefined,
    description: o.description || undefined, displayLink: o.displayLink || undefined, urlTags: o.urlTags || undefined,
    advantageCreative: o.advantageCreative,
  };
}
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return Math.min(1440, (h || 0) * 60 + (m || 0)); };

export function SalesAdsetOptions({ o, set, pageDbId, accId, pixelId, budgetType }: { o: SalesOpts; set: (p: Partial<SalesOpts>) => void; pageDbId: string; accId: string; pixelId: string; budgetType: string }) {
  const [a, setA] = useState<any>(null);
  useEffect(() => {
    if (!pageDbId || !accId) return;
    managedAds<any>({ action: "sales_assets", pageDbId, adAccountDbId: accId, pixelId: pixelId || undefined, catalogId: o.catalogId || undefined })
      .then(setA).catch(() => setA({ customConversions: [], customAudiences: [], savedAudiences: [], catalogs: [], productSets: [], pixelEvents: [] }));
  }, [pageDbId, accId, pixelId, o.catalogId]);
  const ccs = (a?.customConversions ?? []).filter((c: any) => !c.pixelId || c.pixelId === pixelId);
  const auds = a?.customAudiences ?? [];

  return (
    <>
      <div className={box}>
        <div className="flex items-center justify-between">
          <div><p className="text-[15px] font-semibold flex items-center gap-1"><Sparkles className="h-4 w-4 text-fb-green" />Advantage+ sales campaign</p>
            <p className="text-[12px] text-fb-muted">Meta নিজে audience ও placement ঠিক করবে, campaign budget চালু থাকবে।</p></div>
          <Switch checked={o.advantageSales} onCheckedChange={(v) => set({ advantageSales: v, ...(v ? { advantageAudience: true, placementMode: "auto" } : {}) })} />
        </div>
        {a?.pixelEvents?.length > 0 && <p className="text-[12px] text-fb-muted">এই Pixel-এ যে event এসেছে: {a.pixelEvents.join(", ")}</p>}
        {ccs.length > 0 && (
          <L t="Custom conversion" h="চাইলে Pixel event-এর বদলে একটি custom conversion বাছুন।">
            <select className={sel} value={o.customConversionId} onChange={(e) => set({ customConversionId: e.target.value })}>
              <option value="">ব্যবহার করবেন না</option>
              {ccs.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </L>
        )}
        <L t="Performance goal">
          <select className={sel} value={o.performanceGoal} onChange={(e) => set({ performanceGoal: e.target.value as any })}>
            <option value="CONVERSIONS">Maximize number of conversions</option>
            <option value="VALUE">Maximize value of conversions</option>
          </select>
        </L>
        <L t="Attribution setting">
          <select className={sel} value={o.attribution} onChange={(e) => set({ attribution: e.target.value as any })}>
            <option value="7C1V">7-day click or 1-day view</option>
            <option value="7C">7-day click</option>
            <option value="1C">1-day click</option>
            <option value="1C1V">1-day click or 1-day view</option>
          </select>
        </L>
        <div className="border-t border-fb-border pt-3">
          <div className="flex items-center justify-between"><p className="font-semibold">Catalog (product ads)</p>
            <Switch checked={o.useCatalog} onCheckedChange={(v) => set({ useCatalog: v })} /></div>
          {o.useCatalog && (
            <div className="mt-2 space-y-2">
              {a && !a.catalogs.length ? <p className="text-[12px] text-destructive">এই ad account-এ কোনো catalog নেই — admin-কে catalog যুক্ত করতে বলুন।</p> : (
                <>
                  <select className={sel} value={o.catalogId} onChange={(e) => set({ catalogId: e.target.value, productSetId: "" })}>
                    <option value="">Catalog বাছুন</option>
                    {(a?.catalogs ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.count != null ? ` (${c.count})` : ""}</option>)}
                  </select>
                  {o.catalogId && (
                    <select className={sel} value={o.productSetId} onChange={(e) => set({ productSetId: e.target.value })}>
                      <option value="">Product set বাছুন</option>
                      {(a?.productSets ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.count != null ? ` (${c.count})` : ""}</option>)}
                    </select>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {o.dayparting !== undefined && budgetType === "lifetime" && (
        <div className={box}>
          <div className="flex items-center justify-between"><p className="text-[15px] font-semibold">Ad scheduling</p>
            <Switch checked={o.dayparting} onCheckedChange={(v) => set({ dayparting: v })} /></div>
          {o.dayparting && (
            <>
              <div className="flex flex-wrap gap-1">{DAYS.map((d, i) => (
                <button key={d} type="button" onClick={() => set({ schedule: { ...o.schedule, days: o.schedule.days.includes(i) ? o.schedule.days.filter((x) => x !== i) : [...o.schedule.days, i] } })}
                  className={`rounded-md border px-2 py-1 text-[12px] ${o.schedule.days.includes(i) ? "border-fb-blue bg-fb-blue-soft font-semibold" : "border-fb-border"}`}>{d}</button>
              ))}</div>
              <div className="grid grid-cols-2 gap-2">
                <input type="time" className={sel} value={o.schedule.start} onChange={(e) => set({ schedule: { ...o.schedule, start: e.target.value } })} />
                <input type="time" className={sel} value={o.schedule.end} onChange={(e) => set({ schedule: { ...o.schedule, end: e.target.value } })} />
              </div>
            </>
          )}
        </div>
      )}

      {!o.advantageSales && (
        <div className={box}>
          <p className="text-[15px] font-semibold">Audience controls</p>
          <div className="flex items-center justify-between"><div><p className="font-semibold">Advantage+ audience</p><p className="text-[12px] text-fb-muted">Meta আপনার দেওয়া audience-এর বাইরেও ভালো ক্রেতা খুঁজবে।</p></div>
            <Switch checked={o.advantageAudience} onCheckedChange={(v) => set({ advantageAudience: v })} /></div>
          <L t="Custom audiences (include)">
            <AudPick list={auds} value={o.customAudiences} onChange={(v) => set({ customAudiences: v })} />
          </L>
          <L t="Exclude audiences">
            <AudPick list={auds} value={o.excludedAudiences} onChange={(v) => set({ excludedAudiences: v })} />
          </L>
          <L t="Languages">
            <div className="flex flex-wrap gap-1">{LANGS.map(([id, n]) => (
              <button key={id} type="button" onClick={() => set({ locales: o.locales.includes(id) ? o.locales.filter((x) => x !== id) : [...o.locales, id] })}
                className={`rounded-full border px-2 py-0.5 text-[12px] ${o.locales.includes(id) ? "border-fb-blue bg-fb-blue-soft" : "border-fb-border"}`}>{n}</button>
            ))}</div>
          </L>
        </div>
      )}

      {!o.advantageSales && (
        <div className={box}>
          <p className="text-[15px] font-semibold">Placements</p>
          <label className="flex items-center gap-2"><input type="radio" checked={o.placementMode === "auto"} onChange={() => set({ placementMode: "auto" })} />Advantage+ placements (Recommended)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={o.placementMode === "manual"} onChange={() => set({ placementMode: "manual" })} />Manual placements</label>
          {o.placementMode === "manual" && Object.keys(POS).map((p) => (
            <div key={p} className="rounded-md border border-fb-border p-2">
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={o.positions[p].length > 0} onChange={(e) => set({ positions: { ...o.positions, [p]: e.target.checked ? POS[p].map((x) => x[0]) : [] } })} />{PLAT[p]}
              </label>
              <div className="mt-1 grid grid-cols-2 gap-1 pl-5">{POS[p].map(([v, n]) => (
                <label key={v} className="flex items-center gap-2 text-[12px]">
                  <input type="checkbox" checked={o.positions[p].includes(v)} onChange={() => set({ positions: { ...o.positions, [p]: toggle(o.positions[p], v) } })} />{n}
                </label>
              ))}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AudPick({ list, value, onChange }: { list: any[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!list.length) return <p className="text-[12px] text-fb-muted">এই ad account-এ কোনো custom/lookalike audience নেই।</p>;
  return (
    <div className="max-h-36 space-y-1 overflow-auto rounded-md border border-fb-border p-2">
      {list.map((x) => (
        <label key={x.id} className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={value.includes(x.id)} onChange={() => onChange(toggle(value, x.id))} />
          {x.name} <span className="text-fb-muted">{x.subtype === "LOOKALIKE" ? "· Lookalike" : ""}{x.size ? ` · ${Number(x.size).toLocaleString()}+` : ""}</span>
        </label>
      ))}
    </div>
  );
}

export function SalesAdOptions({ o, set }: { o: SalesOpts; set: (p: Partial<SalesOpts>) => void }) {
  const readImg = (f: File | undefined, cb: (b64: string, url: string) => void) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); cb(s.split(",")[1], s); };
    r.readAsDataURL(f);
  };
  const upd = (i: number, p: any) => set({ cards: o.cards.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const list = (k: "extraMessages" | "extraHeadlines", label: string, area?: boolean) => (
    <L t={`More ${label} options`} h="সর্বোচ্চ ৫টা — Meta প্রত্যেক মানুষকে সবচেয়ে ভালোটা দেখাবে।">
      <div className="space-y-1">
        {o[k].map((v, i) => (
          <div key={i} className="flex gap-1">
            {area ? <textarea rows={2} className="w-full rounded-md border border-fb-border bg-background p-2 text-[13px]" value={v} onChange={(e) => set({ [k]: o[k].map((x, j) => (j === i ? e.target.value : x)) } as any)} />
              : <input className={sel} value={v} onChange={(e) => set({ [k]: o[k].map((x, j) => (j === i ? e.target.value : x)) } as any)} />}
            <button type="button" onClick={() => set({ [k]: o[k].filter((_, j) => j !== i) } as any)}><Trash2 className="h-4 w-4 text-fb-muted" /></button>
          </div>
        ))}
        {o[k].length < 4 && <button type="button" className="flex items-center gap-1 text-fb-blue" onClick={() => set({ [k]: [...o[k], ""] } as any)}><Plus className="h-3 w-3" />Add {label}</button>}
      </div>
    </L>
  );

  return (
    <div className={box}>
      <p className="text-[15px] font-semibold">Sales ad options</p>
      {o.useCatalog ? (
        <p className="rounded-md bg-fb-blue-soft p-2 text-[12px]">Catalog ad: প্রত্যেক মানুষকে product set থেকে মানানসই product-এর ছবি, নাম ও দাম দেখানো হবে। Headline-এ {"{{product.name}}"} লিখলে product-এর নাম বসবে।</p>
      ) : (
        <L t="Format">
          <select className={sel} value={o.format} onChange={(e) => set({ format: e.target.value as any })}>
            <option value="single">Single image or video</option>
            <option value="carousel">Carousel (2–10 cards)</option>
          </select>
        </L>
      )}
      {o.format === "carousel" && !o.useCatalog && (
        <div className="space-y-2">
          {o.cards.map((c, i) => (
            <div key={i} className="space-y-1 rounded-md border border-fb-border p-2">
              <div className="flex items-center gap-2">
                <img src={c.url} alt="" className="h-12 w-12 rounded object-cover" />
                <p className="font-semibold">Card {i + 1}</p>
                <button type="button" className="ml-auto" onClick={() => set({ cards: o.cards.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4 text-fb-muted" /></button>
              </div>
              <input className={sel} placeholder="Headline" value={c.headline} onChange={(e) => upd(i, { headline: e.target.value })} />
              <input className={sel} placeholder="Description" value={c.description} onChange={(e) => upd(i, { description: e.target.value })} />
              <input className={sel} placeholder="Website URL (খালি রাখলে মূল link)" value={c.link} onChange={(e) => upd(i, { link: e.target.value })} />
            </div>
          ))}
          {o.cards.length < 10 && (
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-fb-border px-3 font-semibold">
              <ImagePlus className="h-4 w-4" />Add card
              <input type="file" accept="image/*" className="hidden" onChange={(e) => readImg(e.target.files?.[0], (b64, url) => set({ cards: [...o.cards, { b64, url, headline: "", description: "", link: "" }] }))} />
            </label>
          )}
          {o.cards.length < 2 && <p className="text-[12px] text-destructive">কমপক্ষে ২টা card দিন</p>}
        </div>
      )}
      {o.format === "single" && !o.useCatalog && list("extraMessages", "primary text", true)}
      {o.format === "single" && !o.useCatalog && list("extraHeadlines", "headline")}
      <L t="Description"><input className={sel} value={o.description} onChange={(e) => set({ description: e.target.value })} placeholder="Include additional details" /></L>
      <L t="Display link" h="URL-এর বদলে ad-এ যে link দেখাবে"><input className={sel} value={o.displayLink} onChange={(e) => set({ displayLink: e.target.value })} placeholder="yourshop.com" /></L>
      <L t="URL parameters" h="যেমন utm_source=facebook&utm_medium=paid"><input className={sel} value={o.urlTags} onChange={(e) => set({ urlTags: e.target.value })} /></L>
      <div className="flex items-center justify-between"><div><p className="font-semibold">Advantage+ creative</p><p className="text-[12px] text-fb-muted">Meta ছবি/লেখা মানুষ অনুযায়ী একটু সাজিয়ে দেখাবে।</p></div>
        <Switch checked={o.advantageCreative} onCheckedChange={(v) => set({ advantageCreative: v })} /></div>
    </div>
  );
}
