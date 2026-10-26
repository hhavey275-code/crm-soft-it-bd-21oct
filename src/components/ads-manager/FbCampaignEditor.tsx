import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Folder, LayoutGrid, FileText, X, Loader2, CheckCircle2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { managedAds } from "@/lib/managedAdsApi";
import { supabase } from "@/integrations/supabase/client";
const CTAS = ["SHOP_NOW", "BUY_NOW", "ORDER_NOW", "LEARN_MORE", "SIGN_UP", "GET_OFFER", "CONTACT_US", "SEE_MORE", "BOOK_NOW", "SUBSCRIBE", "DOWNLOAD", "APPLY_NOW", "GET_QUOTE", "SEND_MESSAGE", "MESSAGE_PAGE", "WHATSAPP_MESSAGE", "CALL_NOW", "LIKE_PAGE"];

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
  const spec = o.creative?.object_story_spec?.link_data ?? o.creative?.object_story_spec?.video_data;
  return {
    name: o.name ?? "",
    budgetType: bt,
    amount: bt ? (Number(o[`${bt}_budget`]) / 100).toFixed(2) : "",
    startTime: toLocal(o.start_time), endTime: toLocal(o.end_time),
    countries: (o.targeting?.geo_locations?.countries ?? []).join(", "),
    ageMin: o.targeting?.age_min ? String(o.targeting.age_min) : "",
    ageMax: o.targeting?.age_max ? String(o.targeting.age_max) : "",
    message: spec?.message ?? o.creative?.body ?? "", headline: spec?.name ?? spec?.title ?? o.creative?.title ?? "", link: spec?.link ?? spec?.call_to_action?.value?.link ?? "",
    description: spec?.description ?? spec?.link_description ?? "", cta: spec?.call_to_action?.type ?? "",
    editableCreative: !!spec, level,
    preview: (o.creative?.image_url ?? o.creative?.thumbnail_url ?? o.thumbnail_url ?? spec?.picture ?? spec?.image_url ?? "") as string,
    postId: (o.creative?.effective_object_story_id ?? o.creative?.object_story_id ?? "") as string,
    image: null as null | { b64: string; url: string }, video: null as null | { path: string; name: string },
    newPostId: "", postMessage: spec ? "" : (o.creative?.body ?? ""),
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
  const [busy, setBusy] = useState(false);
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
        if (a.description !== b.description) body.description = a.description;
        if (a.cta !== b.cta && a.cta) body.cta = a.cta;
        if (a.image) body.imageBase64 = a.image.b64;
        if (a.video) body.videoPath = a.video.path;
        if (a.newPostId.trim()) body.newPostId = (a.newPostId.match(/(\d{5,}(?:_\d+)?)\/?$/)?.[1] ?? a.newPostId.match(/(?:posts|videos|story_fbid=|fbid=)\/?(\d{5,})/)?.[1] ?? a.newPostId.trim());
        if (a.postMessage.trim()) body.postMessage = a.postMessage;
      }
      if (Object.keys(body).length <= 4) continue;
      try {
        const r: any = await managedAds(body); ok++;
        if (r?.creativeId) toast.success(`নতুন creative: ${r.creativeId} — ad আবার review-তে যাবে`, { duration: 10000, action: r.previewUrl ? { label: "Preview", onClick: () => window.open(r.previewUrl, "_blank") } : undefined });
        if (r?.postUpdated) toast.success("Page post-এর লেখা বদলানো হয়েছে");
      }
      catch (e: any) { toast.error(`${a.name}: ${e.message}`); }
    }
    setSaving(false);
    if (ok) { toast.success(`${ok}টি পরিবর্তন publish হয়েছে`); onSaved(); onClose(); }
  };

  const Icon = (l: Level) => (l === "campaign" ? Folder : l === "adset" ? LayoutGrid : FileText);

  return (
    <div className="fb-font fixed inset-0 z-50 flex flex-col bg-fb-bg text-fb-text md:flex-row">
      <aside className="flex max-h-40 shrink-0 flex-col overflow-y-auto border-b border-fb-border bg-background md:max-h-none md:w-72 md:border-b-0 md:border-r">
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
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div><Lbl>Start date</Lbl><input type="datetime-local" className={inp} value={fm.startTime} onChange={(e) => set("startTime", e.target.value)} /></div>
                    <div><Lbl>End date (ঐচ্ছিক)</Lbl><input type="datetime-local" className={inp} value={fm.endTime} onChange={(e) => set("endTime", e.target.value)} /></div>
                  </div>
                </Section>
                <Section title="Audience">
                  <div><Lbl>Locations (যেমন: BD, IN)</Lbl><input className={inp} value={fm.countries} onChange={(e) => set("countries", e.target.value)} /></div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div><Lbl>Age min</Lbl><input type="number" min="18" max="65" className={inp} value={fm.ageMin} onChange={(e) => set("ageMin", e.target.value)} /></div>
                    <div><Lbl>Age max</Lbl><input type="number" min="18" max="65" className={inp} value={fm.ageMax} onChange={(e) => set("ageMax", e.target.value)} /></div>
                  </div>
                </Section>
              </>
            )}
            {node.level === "ad" && (
              <Section title="Ad creative">
                {(fm.preview || fm.postId) && (
                  <div className="flex items-center gap-3 rounded-md border border-fb-border p-2">
                    {fm.preview && <img src={fm.preview} alt="Ad media" className="h-20 w-20 rounded object-cover" />}
                    <div className="min-w-0 text-[12px]">
                      <p className="font-semibold">বর্তমান ad content</p>
                      {fm.postId && <a href={`https://facebook.com/${fm.postId}`} target="_blank" rel="noreferrer" className="text-fb-blue underline">Post দেখুন ({fm.postId})</a>}
                    </div>
                  </div>
                )}
                {!fm.editableCreative && <p className="rounded-md bg-fb-bg p-2 text-fb-muted">এই ad-টি page-এর post থেকে — post-এর লেখা নিচে বদলাতে বা অন্য post বেছে নিতে পারবেন।</p>}
                <div><Lbl>Primary text</Lbl><textarea rows={4} disabled={!fm.editableCreative} className={cn(inp, "h-auto py-2")} value={fm.message} onChange={(e) => set("message", e.target.value)} /></div>
                <div><Lbl>Headline</Lbl><input disabled={!fm.editableCreative} className={inp} value={fm.headline} onChange={(e) => set("headline", e.target.value)} /></div>
                <div><Lbl>Website URL</Lbl><input disabled={!fm.editableCreative} className={inp} value={fm.link} onChange={(e) => set("link", e.target.value)} /></div>
                <div><Lbl>Description</Lbl><input disabled={!fm.editableCreative} className={inp} value={fm.description} onChange={(e) => set("description", e.target.value)} /></div>
                {fm.editableCreative && fm.cta && (
                  <div><Lbl>Call to action</Lbl><select className={inp} value={fm.cta} onChange={(e) => set("cta", e.target.value)}>
                    {[...new Set([fm.cta, ...CTAS])].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ").toLowerCase().replace(/^./, (x: string) => x.toUpperCase())}</option>)}
                  </select></div>
                )}
                {fm.editableCreative && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-fb-border px-3 font-semibold">{fm.image ? "ছবি বদলানো হয়েছে ✓" : "নতুন ছবি"}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { const u = String(r.result); set("image", { b64: u.split(",")[1], url: u }); set("video", null); }; r.readAsDataURL(f); }} />
                    </label>
                    <label className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-fb-border px-3 font-semibold">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{fm.video ? `🎬 ${fm.video.name}` : "নতুন video"}
                      <input type="file" accept="video/*" className="hidden" disabled={busy} onChange={async (e) => {
                        const f = e.target.files?.[0]; if (!f) return; setBusy(true);
                        try {
                          const { data: u } = await supabase.auth.getUser(); if (!u.user) throw new Error("আবার লগইন করুন");
                          const path = `${u.user.id}/${crypto.randomUUID()}.${(f.name.split(".").pop() || "mp4").replace(/[^\w]/g, "").slice(0, 5) || "mp4"}`;
                          const { error } = await supabase.storage.from("ad-media").upload(path, f, { contentType: f.type || "video/mp4" });
                          if (error) throw error; set("video", { path, name: f.name }); set("image", null);
                        } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
                      }} />
                    </label>
                    {fm.image && <img src={fm.image.url} alt="" className="h-9 w-9 rounded object-cover" />}
                  </div>
                )}
                <div><Lbl>অন্য post দিয়ে ad চালান (Post ID বা link)</Lbl><input className={inp} value={fm.newPostId} onChange={(e) => set("newPostId", e.target.value)} placeholder="https://facebook.com/.../posts/123..." /></div>
                {!fm.editableCreative && (
                  <div><Lbl>Page post-এর লেখা বদলান</Lbl>
                    <textarea rows={3} className={cn(inp, "h-auto py-2")} value={fm.postMessage} onChange={(e) => set("postMessage", e.target.value)} placeholder="নতুন লেখা (খালি রাখলে বদলাবে না)" />
                    <p className="mt-1 text-[12px] text-fb-muted">Post-এর ছবি বদলানো যায় না, শুধু লেখা বদলাবে।</p>
                  </div>
                )}
                <p className="rounded-md bg-fb-blue-soft p-2 text-[12px]">লেখা, ছবি বা button বদলালে ad আবার Facebook review-তে যাবে (In Review)।</p>
              </Section>
            )}
          </div>
        </div>
        <div className="flex h-14 items-center justify-between gap-2 border-t border-fb-border bg-background px-3 pb-[env(safe-area-inset-bottom)] sm:px-6">
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
