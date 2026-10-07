import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Folder, LayoutGrid, FileText, X, Loader2, CheckCircle2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { managedAds } from "@/lib/managedAdsApi";

type Level = "campaign" | "adset" | "ad";
type Node = { level: Level; obj: any };

const toLocal = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const inp = "h-9 w-full rounded-md border border-fb-border bg-background px-3 text-[13px] text-fb-text focus:outline-none focus:ring-2 focus:ring-fb-blue/40";

function initForm(level: Level, o: any) {
  const bt = o.lifetime_budget ? "lifetime" : o.daily_budget ? "daily" : null;
  const spec = o.creative?.object_story_spec?.link_data;
  return {
    name: o.name ?? "",
    budgetType: bt,
    amount: bt ? (Number(o[`${bt}_budget`]) / 100).toFixed(2) : "",
    startTime: toLocal(o.start_time), endTime: toLocal(o.end_time),
    countries: (o.targeting?.geo_locations?.countries ?? []).join(", "),
    ageMin: o.targeting?.age_min ? String(o.targeting.age_min) : "",
    ageMax: o.targeting?.age_max ? String(o.targeting.age_max) : "",
    message: spec?.message ?? "", headline: spec?.name ?? "", link: spec?.link ?? "",
    editableCreative: !!spec, level,
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-fb-border bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-fb-green" /><h3 className="text-[15px] font-semibold">{title}</h3></div>
      <div className="space-y-3 text-[13px]">{children}</div>
    </div>
  );
}
const Lbl = ({ children }: { children: ReactNode }) => <p className="mb-1 text-[13px] font-semibold">{children}</p>;

export function FbCampaignEditor({ campaign, adsets, ads, onClose, onSaved }: {
  campaign: any; adsets: any[]; ads: any[]; onClose: () => void; onSaved: () => void;
}) {
  const mySets = adsets.filter((s) => String(s.campaign_id) === String(campaign.id));
  const myAds = ads.filter((a) => String(a.campaign_id) === String(campaign.id));
  const nodes: Node[] = useMemo(() => [
    { level: "campaign", obj: campaign },
    ...mySets.flatMap((s) => [{ level: "adset" as Level, obj: s }, ...myAds.filter((a) => String(a.adset_id) === String(s.id)).map((a) => ({ level: "ad" as Level, obj: a }))]),
  ], [campaign, mySets, myAds]);

  const [forms, setForms] = useState<Record<string, ReturnType<typeof initForm>>>(() =>
    Object.fromEntries(nodes.map((n) => [String(n.obj.id), initForm(n.level, n.obj)])));
  const [cur, setCur] = useState(String(campaign.id));
  const [saving, setSaving] = useState(false);
  const node = nodes.find((n) => String(n.obj.id) === cur)!;
  const fm = forms[cur];
  const set = (k: string, v: any) => setForms((p) => ({ ...p, [cur]: { ...p[cur], [k]: v } }));

  const dirtyIds = nodes.filter((n) => JSON.stringify(forms[String(n.obj.id)]) !== JSON.stringify(initForm(n.level, n.obj))).map((n) => String(n.obj.id));

  const publish = async () => {
    if (!dirtyIds.length) return toast.info("কিছু বদলানো হয়নি");
    setSaving(true);
    let ok = 0;
    for (const id of dirtyIds) {
      const n = nodes.find((x) => String(x.obj.id) === id)!;
      const a = forms[id], b = initForm(n.level, n.obj);
      const body: Record<string, unknown> = { action: "update", level: n.level, objectId: id, adAccountDbId: n.obj.ad_account_db_id };
      if (a.name.trim() && a.name !== b.name) body.name = a.name.trim();
      if (a.budgetType && a.amount !== b.amount && Number(a.amount) > 0) { body.budgetType = a.budgetType; body.amount = Number(a.amount); }
      if (n.level === "adset") {
        if (a.startTime !== b.startTime && a.startTime) body.startTime = new Date(a.startTime).toISOString();
        if (a.endTime !== b.endTime) body.endTime = a.endTime ? new Date(a.endTime).toISOString() : "";
        if (a.countries !== b.countries) { const cs = a.countries.split(/[,\s]+/).map((c: string) => c.trim().toUpperCase()).filter((c: string) => c.length === 2); if (cs.length) body.countries = cs; }
        if (a.ageMin !== b.ageMin && a.ageMin) body.ageMin = Number(a.ageMin);
        if (a.ageMax !== b.ageMax && a.ageMax) body.ageMax = Number(a.ageMax);
      }
      if (n.level === "ad") {
        if (a.message !== b.message) body.message = a.message;
        if (a.headline !== b.headline) body.headline = a.headline;
        if (a.link !== b.link) body.link = a.link;
      }
      if (Object.keys(body).length <= 4) continue;
      try { await managedAds(body); ok++; }
      catch (e: any) { toast.error(`${a.name}: ${e.message}`); }
    }
    setSaving(false);
    if (ok) { toast.success(`${ok}টি পরিবর্তন publish হয়েছে`); onSaved(); onClose(); }
  };

  const Icon = (l: Level) => (l === "campaign" ? Folder : l === "adset" ? LayoutGrid : FileText);

  return (
    <div className="fb-font fixed inset-0 z-50 flex bg-fb-bg text-fb-text">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-fb-border bg-background">
        {nodes.map((n) => {
          const I = Icon(n.level); const id = String(n.obj.id);
          return (
            <button key={id} onClick={() => setCur(id)}
              className={cn("flex w-full items-center gap-2 py-2.5 pr-3 text-left text-[13px] hover:bg-fb-bg",
                n.level === "campaign" ? "pl-3" : n.level === "adset" ? "pl-7" : "pl-11", cur === id && "bg-fb-blue-soft")}>
              <I className={cn("h-4 w-4 shrink-0", n.level === "campaign" ? "text-fb-blue" : "text-fb-muted")} />
              <span className="truncate">{forms[id].name}</span>
              {dirtyIds.includes(id) && <Pencil className="ml-auto h-3 w-3 text-fb-blue" />}
            </button>
          );
        })}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center gap-2 border-b border-fb-border bg-background px-4 text-[13px]">
          <span className="rounded bg-fb-blue-soft px-2 py-1 font-semibold text-fb-blue">{forms[String(campaign.id)].name}</span>
          <span className="text-fb-muted">› {mySets.length} Ad set › {myAds.length} Ad</span>
          {dirtyIds.length > 0 && <span className="ml-3 text-fb-blue">{dirtyIds.length}টি পরিবর্তন বাকি</span>}
          <button onClick={onClose} className="ml-auto rounded p-1 hover:bg-fb-bg"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-[620px] space-y-3">
            <Section title={node.level === "campaign" ? "Campaign name" : node.level === "adset" ? "Ad set name" : "Ad name"}>
              <input className={inp} value={fm.name} onChange={(e) => set("name", e.target.value)} />
            </Section>
            {node.level === "campaign" && (
              <Section title="Campaign details">
                <div><Lbl>Campaign objective</Lbl><p>{String(campaign.objective ?? "").replace("OUTCOME_", "").toLowerCase()}</p></div>
              </Section>
            )}
            {node.level !== "ad" && (
              <Section title="Budget">
                {fm.budgetType ? (
                  <div className="flex gap-2">
                    <div className={cn(inp, "flex w-48 items-center")}>{fm.budgetType === "daily" ? "Daily budget" : "Lifetime budget"}</div>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-2 text-fb-muted">$</span>
                      <input type="number" min="1" step="0.01" className={cn(inp, "pl-6")} value={fm.amount} onChange={(e) => set("amount", e.target.value)} />
                      <span className="absolute right-3 top-2 text-fb-muted">USD</span>
                    </div>
                  </div>
                ) : <p className="text-fb-muted">এর budget {node.level === "campaign" ? "ad set-এ" : "campaign-এ"} সেট করা আছে।</p>}
              </Section>
            )}
            {node.level === "adset" && (
              <>
                <Section title="Schedule">
                  <div className="grid grid-cols-2 gap-2">
                    <div><Lbl>Start date</Lbl><input type="datetime-local" className={inp} value={fm.startTime} onChange={(e) => set("startTime", e.target.value)} /></div>
                    <div><Lbl>End date (ঐচ্ছিক)</Lbl><input type="datetime-local" className={inp} value={fm.endTime} onChange={(e) => set("endTime", e.target.value)} /></div>
                  </div>
                </Section>
                <Section title="Audience">
                  <div><Lbl>Locations (যেমন: BD, IN)</Lbl><input className={inp} value={fm.countries} onChange={(e) => set("countries", e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Lbl>Age min</Lbl><input type="number" min="18" max="65" className={inp} value={fm.ageMin} onChange={(e) => set("ageMin", e.target.value)} /></div>
                    <div><Lbl>Age max</Lbl><input type="number" min="18" max="65" className={inp} value={fm.ageMax} onChange={(e) => set("ageMax", e.target.value)} /></div>
                  </div>
                </Section>
              </>
            )}
            {node.level === "ad" && (
              <Section title="Ad creative">
                {!fm.editableCreative && <p className="rounded-md bg-fb-bg p-2 text-fb-muted">এই ad-টি page-এর পুরনো post থেকে — শুধু নাম বদলানো যাবে।</p>}
                <div><Lbl>Primary text</Lbl><textarea rows={4} disabled={!fm.editableCreative} className={cn(inp, "h-auto py-2")} value={fm.message} onChange={(e) => set("message", e.target.value)} /></div>
                <div><Lbl>Headline</Lbl><input disabled={!fm.editableCreative} className={inp} value={fm.headline} onChange={(e) => set("headline", e.target.value)} /></div>
                <div><Lbl>Website URL</Lbl><input disabled={!fm.editableCreative} className={inp} value={fm.link} onChange={(e) => set("link", e.target.value)} /></div>
              </Section>
            )}
          </div>
        </div>
        <div className="flex h-14 items-center justify-between border-t border-fb-border bg-background px-6">
          <button onClick={onClose} className="h-9 rounded-md border border-fb-border px-4 text-[13px] font-semibold hover:bg-fb-bg">Close</button>
          <button onClick={publish} disabled={saving || !dirtyIds.length}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-fb-blue px-5 text-[13px] font-semibold text-background disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}Publish
          </button>
        </div>
      </div>
    </div>
  );
}
