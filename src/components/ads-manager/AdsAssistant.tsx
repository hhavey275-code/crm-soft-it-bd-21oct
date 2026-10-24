import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { managedAds } from "@/lib/managedAdsApi";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "assistant"; text: string };
type Draft = {
  pageDbId: string;
  objective: "MESSAGES" | "TRAFFIC" | "ENGAGEMENT" | "AWARENESS";
  campaignName: string;
  dailyBudget: number;
  durationDays: number | null;
  countries: string[];
  ageMin: number;
  ageMax: number;
  genders: "all" | "men" | "women";
  link: string | null;
};

interface Props {
  account: { id: string; name: string; kind: string } | undefined;
  pages: { id: string; page_name?: string; name?: string }[];
  onCreated: () => void;
}

const OBJ_LABEL: Record<Draft["objective"], string> = {
  MESSAGES: "Messages (Messenger)", TRAFFIC: "Traffic (website)", ENGAGEMENT: "Post engagement", AWARENESS: "Awareness (reach)",
};

async function askAssistant(body: unknown): Promise<{ reply: string; draft: Draft | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/ads-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({ error: "No response from server." }));
  if (!res.ok || j?.error) throw new Error(j?.error || "Request failed");
  return j;
}

// Builds the existing My Ads "create" payload from an assistant draft.
export function buildCreatePayload(d: Draft, accountId: string, postId: string, publish: boolean) {
  const genders = d.genders === "men" ? [1] : d.genders === "women" ? [2] : [];
  const isMsg = d.objective === "MESSAGES";
  const objective = isMsg ? "ENGAGEMENT" : d.objective;
  const end = d.durationDays ? new Date(Date.now() + d.durationDays * 86400000).toISOString() : undefined;
  const adsetName = `${d.campaignName} - Ad set`;
  const adName = `${d.campaignName} - Ad`;
  return {
    action: "create", pageDbId: d.pageDbId, adAccountDbId: accountId, objective,
    campaignName: d.campaignName, budgetLevel: "adset", specialCategories: [],
    budgetType: "daily", amount: d.dailyBudget, bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    adsetName, adName, countries: d.countries, ageMin: d.ageMin, ageMax: d.ageMax, genders, interests: [],
    publish,
    adsets: [{
      adsetName, conversionLocation: "WEBSITE", endTime: end,
      budgetType: "daily", amount: d.dailyBudget, bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      countries: d.countries, ageMin: d.ageMin, ageMax: d.ageMax, genders, interests: [], connections: "all",
      ...(objective === "ENGAGEMENT" ? { engagementLocation: isMsg ? "MESSAGING" : "ON_AD", msgDestinations: isMsg ? ["MESSENGER"] : undefined } : {}),
      ads: [{ adName, existingPostId: postId, link: d.objective === "TRAFFIC" ? d.link || undefined : undefined, cta: d.objective === "TRAFFIC" ? "LEARN_MORE" : undefined }],
    }],
  };
}

function DraftCard({ draft, account, pages, onDone }: { draft: Draft; account: Props["account"]; pages: Props["pages"]; onDone: (msg: string) => void }) {
  const [posts, setPosts] = useState<any[] | null>(null);
  const [postId, setPostId] = useState("");
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const page = pages.find((p) => p.id === draft.pageDbId);

  useEffect(() => {
    if (!account) return;
    managedAds<{ posts: any[] }>({ action: "posts", pageDbId: draft.pageDbId, adAccountDbId: account.id })
      .then((r) => { setPosts(r.posts ?? []); if (r.posts?.[0]) setPostId(String(r.posts[0].id)); })
      .catch((e) => { setPosts([]); toast.error(e.message); });
  }, [account?.id, draft.pageDbId]);

  const confirm = async () => {
    if (!account) return toast.error("Select an ad account first.");
    if (!postId) return toast.error("Pick a post for the ad.");
    if (draft.objective === "TRAFFIC" && !draft.link) return toast.error("Traffic campaigns need a website link. Tell the assistant your link.");
    setBusy(true);
    try {
      await managedAds(buildCreatePayload(draft, account.id, postId, publish));
      onDone(publish ? `Campaign "${draft.campaignName}" was created and is now live.` : `Campaign "${draft.campaignName}" was created paused. Turn it on from the list when ready.`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const row = (k: string, v: string) => <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v}</span></div>;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3 text-[13px]">
      <p className="font-semibold">Campaign draft</p>
      {row("Account", account?.name ?? "-")}
      {row("Page", page?.page_name ?? page?.name ?? "-")}
      {row("Goal", OBJ_LABEL[draft.objective])}
      {row("Name", draft.campaignName)}
      {row("Daily budget", `$${draft.dailyBudget.toFixed(2)}`)}
      {row("Duration", draft.durationDays ? `${draft.durationDays} days` : "Until paused")}
      {row("Location", draft.countries.join(", "))}
      {row("Age", `${draft.ageMin}-${draft.ageMax}`)}
      {row("Gender", draft.genders === "all" ? "All" : draft.genders === "men" ? "Men" : "Women")}
      {draft.objective === "TRAFFIC" && row("Link", draft.link ?? "Missing")}
      <label className="block pt-1 text-muted-foreground">Post for the ad</label>
      {posts === null ? <p className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading posts…</p>
        : posts.length === 0 ? <p className="text-destructive">No posts found on this Page.</p>
        : <select value={postId} onChange={(e) => setPostId(e.target.value)} className="w-full rounded-md border bg-background p-2">
            {posts.map((p) => <option key={p.id} value={p.id}>{(p.message || p.story || "Post").slice(0, 70)}</option>)}
          </select>}
      <label className="flex items-center gap-2 pt-1"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />Launch live now (otherwise created paused)</label>
      <Button onClick={confirm} disabled={busy || !postId} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & create"}</Button>
    </div>
  );
}

export function AdsAssistant({ account, pages, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([{ role: "assistant", text: "Hi! Tell me what ad you want to run. Example: \"Run a $10/day Messages campaign for my page in Bangladesh, age 20-45.\"" }]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...turns, { role: "user" as const, text }];
    setTurns(next); setInput(""); setBusy(true);
    try {
      const r = await askAssistant({
        turns: next.slice(1).slice(-20),
        pages: pages.map((p) => ({ id: p.id, name: p.page_name ?? p.name ?? "Page" })),
        account: account ? { name: account.name, kind: account.kind } : null,
      });
      setTurns((t) => { const n = [...t, { role: "assistant" as const, text: r.reply }]; if (r.draft) setDrafts((d) => ({ ...d, [n.length - 1]: r.draft! })); return n; });
    } catch (e: any) {
      setTurns((t) => [...t, { role: "assistant", text: e.message }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Open AI Ads Assistant"
        className={cn("fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg", open && "hidden")}>
        <Sparkles className="h-4 w-4" />AI Assistant
      </button>
      {open && (
        <div className="fixed inset-x-2 bottom-2 z-50 flex h-[75dvh] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[400px]">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="flex items-center gap-2 font-semibold"><Bot className="h-5 w-5 text-primary" />AI Ads Assistant</span>
            <button onClick={() => setOpen(false)} aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {turns.map((t, i) => (
              <div key={i} className="space-y-2">
                <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm", t.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")}>{t.text}</div>
                {drafts[i] && <DraftCard draft={drafts[i]} account={account} pages={pages}
                  onDone={(msg) => { setDrafts((d) => { const n = { ...d }; delete n[i]; return n; }); setTurns((x) => [...x, { role: "assistant", text: msg }]); onCreated(); }} />}
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Thinking…</div>}
            <div ref={endRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 border-t p-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Describe the ad you want…" className="flex-1 rounded-md border bg-background px-3 text-sm" />
            <Button type="submit" size="icon" disabled={busy || !input.trim()}><Send className="h-4 w-4" /></Button>
          </form>
        </div>
      )}
    </>
  );
}
