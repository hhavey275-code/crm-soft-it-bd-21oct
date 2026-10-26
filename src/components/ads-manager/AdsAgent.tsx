import { useEffect, useRef, useState } from "react";
import { Bot, CalendarClock, CheckCircle2, Loader2, Mic, MicOff, Send, Sparkles, Volume2, VolumeX, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: any };
type Plan = { summary: string; run_at: string | null; repeat: "none" | "daily"; actions: any[] };
type Task = { id: string; title: string; run_at: string; repeat: string; status: string; steps: any[]; last_error?: string | null; last_run_at?: string | null };

async function agentApi<T = any>(body: Record<string, unknown>): Promise<T> {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session || (session.expires_at ?? 0) * 1000 < Date.now() + 60_000) {
    const r = await supabase.auth.refreshSession();
    if (r.data.session) session = r.data.session;
  }
  const res = await fetch("/api/ads-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({ error: "সার্ভার থেকে উত্তর পাওয়া যায়নি" }));
  if (!res.ok || j?.error) throw new Error(j?.error || "Request failed");
  return j as T;
}

const textOf = (m: Msg) => (typeof m.content === "string" ? m.content : (m.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n"));
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" }) : "");
const STATUS: Record<string, string> = { scheduled: "অপেক্ষায়", running: "চলছে", done: "শেষ", failed: "হয়নি", cancelled: "বাতিল" };
const EXAMPLES = [
  "আমার ad account গুলোর আজকের খরচ কত?",
  "Video library-র সব video দিয়ে $5 করে একটা করে Messages campaign চালাও",
  "আজ রাত ১২টায় সব campaign বন্ধ করে দিও",
];

/** Floating AI Ads Agent: chat or speak in Bangla to run campaigns; every change needs Confirm. */
export function AdsAgent({ account, userId, asUserId, onChanged }: { account: { id: string; name: string } | undefined; userId?: string; asUserId?: string; onChanged?: () => void }) {
  const storeKey = `myads-agent:${userId ?? "anon"}`;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "tasks">("chat");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const recRef = useRef<any>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const s = sessionStorage.getItem(storeKey); if (s) { const v = JSON.parse(s); setMessages(v.messages ?? []); setPlan(v.plan ?? null); } } catch { /* ignore */ }
  }, [storeKey]);
  useEffect(() => { try { sessionStorage.setItem(storeKey, JSON.stringify({ messages: messages.slice(-60), plan })); } catch { /* ignore */ } }, [messages, plan, storeKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, plan, busy, open, tab]);

  // My Ads keeps its campaign list cached; when a task has run since we last looked (now, or by the
  // scheduler while the page was closed), ask the page to reload so the new campaigns show up.
  const seenKey = `myads-agent-seen:${userId ?? "anon"}`;
  const noteRuns = (list: Task[]) => {
    const latest = list.reduce((m, t: any) => Math.max(m, t.last_run_at ? Date.parse(t.last_run_at) : 0), 0);
    if (!latest) return;
    let seen = 0;
    try { seen = Number(localStorage.getItem(seenKey) || 0); } catch { /* ignore */ }
    if (latest > seen) {
      try { localStorage.setItem(seenKey, String(latest)); } catch { /* ignore */ }
      if (seen) onChanged?.();
    }
  };
  const loadTasks = async (quiet = false) => {
    try { const { tasks: list } = await agentApi<{ tasks: Task[] }>({ action: "tasks" }); setTasks(list); noteRuns(list); }
    catch (e: any) { if (!quiet) toast.error(e.message); }
  };
  useEffect(() => { if (open && tab === "tasks") loadTasks(); }, [open, tab]);
  useEffect(() => { if (userId) loadTasks(true); }, [userId]);

  const say = (text: string) => {
    if (!speak || !text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text.slice(0, 600));
    const bn = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("bn"));
    if (bn) u.voice = bn;
    u.lang = bn?.lang ?? "bn-BD";
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  };

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: t }];
    setMessages(next); setInput(""); setBusy(true); setPlan(null);
    try {
      const r = await agentApi<{ messages: Msg[]; reply: string; plan: Plan | null }>({ action: "chat", asUserId, messages: next, selectedAccount: account ? `${account.name} (id ${account.id})` : undefined });
      setMessages(r.messages?.length ? r.messages : [...next, { role: "assistant", content: r.reply }]);
      setPlan(r.plan ?? null);
      say(r.reply);
    } catch (e: any) {
      setMessages([...next, { role: "assistant", content: `সমস্যা: ${e.message}` }]);
    } finally { setBusy(false); }
  };

  const runUntilDone = async (task: Task) => {
    let cur = task;
    for (let i = 0; i < 40 && (cur.status === "scheduled" || cur.status === "running") && Date.parse(cur.run_at) <= Date.now() + 5_000; i++) {
      cur = (await agentApi<{ task: Task }>({ action: "run", id: cur.id })).task;
      setTasks((ts) => [cur, ...ts.filter((x) => x.id !== cur.id)]);
    }
    return cur;
  };

  const confirm = async () => {
    if (!plan) return;
    setConfirming(true);
    try {
      const { task } = await agentApi<{ task: Task }>({ action: "confirm", asUserId, plan });
      setPlan(null);
      setTasks((ts) => [task, ...ts.filter((x) => x.id !== task.id)]);
      if (Date.parse(task.run_at) > Date.now() + 60_000) {
        const msg = `ঠিক আছে — ${when(task.run_at)}-এ কাজটি নিজে থেকে চলবে${task.repeat === "daily" ? " (প্রতিদিন)" : ""}। "কাজের তালিকা" থেকে দেখতে বা বাতিল করতে পারবেন।`;
        setMessages((m) => [...m, { role: "assistant", content: msg }]); say(msg);
        return;
      }
      setTab("tasks");
      const done = await runUntilDone(task);
      const ok = done.steps.filter((s: any) => s.status === "done").length, bad = done.steps.filter((s: any) => s.status === "failed").length;
      if (ok) { onChanged?.(); try { localStorage.setItem(seenKey, String(Date.now())); } catch { /* ignore */ } }
      const msg = done.status === "running" || done.status === "scheduled"
        ? `${ok}টি হয়ে গেছে, বাকিগুলো সার্ভারে চলছে — পেজ বন্ধ করলেও শেষ হবে।`
        : `শেষ: ${ok}টি সফল${bad ? `, ${bad}টি হয়নি (কারণ কাজের তালিকায় দেখুন)` : ""}।`;
      setMessages((m) => [...m, { role: "assistant", content: msg }]); say(msg);
      toast.success(msg);
    } catch (e: any) { toast.error(e.message); } finally { setConfirming(false); }
  };

  const cancelTask = async (id: string) => {
    if (!window.confirm("এই কাজটি বাতিল করবেন?")) return;
    try { const { task } = await agentApi<{ task: Task }>({ action: "cancel", id }); setTasks((ts) => ts.map((x) => (x.id === id ? task : x))); }
    catch (e: any) { toast.error(e.message); }
  };

  const toggleMic = () => {
    const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
    if (!SR) return toast.error("এই browser-এ voice নেই — Chrome ব্যবহার করুন");
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    rec.lang = "bn-BD"; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      setInput((finalText + interim).trim());
    };
    rec.onerror = (e: any) => { if (e.error !== "aborted" && e.error !== "no-speech") toast.error(e.error === "not-allowed" ? "Microphone-এর অনুমতি দিন" : `Voice সমস্যা: ${e.error}`); };
    rec.onend = () => { setListening(false); if (finalText.trim()) send(finalText); };
    recRef.current = rec; setListening(true); rec.start();
  };

  const visible = messages.filter((m) => typeof m.content === "string" || (Array.isArray(m.content) && m.content.some((b: any) => b.type === "text" && b.text?.trim())));

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="AI Ads Agent খুলুন"
        className={cn("fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg", open && "hidden")}>
        <Sparkles className="h-4 w-4" />AI Agent
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="flex h-full w-full max-w-[460px] flex-col bg-background shadow-2xl">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Bot className="h-5 w-5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight">AI Ads Agent</p>
                <p className="truncate text-[12px] text-muted-foreground">{account ? account.name : "উপরে ad account বাছুন"} · লিখুন বা বলুন</p>
              </div>
              <button onClick={() => { setSpeak((v) => !v); if (speak) window.speechSynthesis?.cancel(); }} title={speak ? "উত্তর শোনা বন্ধ" : "উত্তর শুনুন"} aria-label={speak ? "উত্তর শোনা বন্ধ" : "উত্তর শুনুন"} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
                {speak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              <button onClick={() => setOpen(false)} aria-label="বন্ধ করুন" className="rounded-md p-2 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex gap-1 border-b px-3 pt-2 text-[13px]">
              {([["chat", "চ্যাট"], ["tasks", "কাজের তালিকা"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={cn("rounded-t-md px-3 py-2 font-medium", tab === k ? "border-b-2 border-primary text-primary" : "text-muted-foreground")}>{l}</button>
              ))}
              {tab === "chat" && messages.length > 0 && <button onClick={() => { setMessages([]); setPlan(null); }} className="ml-auto px-2 text-[12px] text-muted-foreground hover:text-foreground">নতুন চ্যাট</button>}
            </div>

            {tab === "chat" ? (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[14px]">
                {!visible.length && (
                  <div className="space-y-2 text-muted-foreground">
                    <p>বাংলায় লিখুন, বা নিচের মাইক বাটন চেপে বলুন। যেমন:</p>
                    {EXAMPLES.map((x) => <button key={x} onClick={() => send(x)} className="block w-full rounded-lg border px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted">{x}</button>)}
                    <p className="pt-2 text-[12px]">Campaign চালু, budget বদল বা নতুন campaign — সবকিছু আগে আপনাকে দেখানো হবে, আপনি "Confirm" চাপলে তবেই হবে।</p>
                  </div>
                )}
                {visible.map((m, i) => (
                  <div key={i} className={cn("max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2", m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")}>{textOf(m)}</div>
                ))}
                {busy && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />ভাবছে ও তথ্য দেখছে…</p>}
                {plan && (
                  <div className="space-y-2 rounded-xl border-2 border-primary/40 bg-card p-3 text-[13px]">
                    <p className="font-semibold">Confirm করার আগে দেখে নিন</p>
                    <p>{plan.summary}</p>
                    <p className="flex items-center gap-1 text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />{plan.run_at ? `${when(plan.run_at)}-এ চলবে` : "Confirm করলেই চলবে"}{plan.repeat === "daily" ? " · প্রতিদিন" : ""}</p>
                    <ol className="max-h-56 list-decimal space-y-1 overflow-y-auto rounded-md bg-muted/50 py-2 pl-7 pr-2">
                      {plan.actions.map((a, i) => <li key={i}>{a.label || a.campaign_name || a.type}{a.daily_budget ? ` · $${a.daily_budget}/দিন` : ""}{a.type === "create_campaign" && a.publish === false ? " · বন্ধ অবস্থায়" : ""}</li>)}
                    </ol>
                    <div className="flex gap-2 pt-1">
                      <Button onClick={confirm} disabled={confirming} className="flex-1">{confirming ? <><Loader2 className="h-4 w-4 animate-spin" />চলছে…</> : `Confirm (${plan.actions.length}টি কাজ)`}</Button>
                      <Button variant="outline" disabled={confirming} onClick={() => setPlan(null)}>বাতিল</Button>
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4 text-[13px]">
                <div className="flex justify-end"><button onClick={loadTasks} className="text-[12px] text-primary">Refresh</button></div>
                {!tasks.length && <p className="text-muted-foreground">এখনো কোনো কাজ নেই।</p>}
                {tasks.map((t) => {
                  const total = t.steps?.length ?? 0, ok = (t.steps ?? []).filter((s: any) => s.status === "done").length, bad = (t.steps ?? []).filter((s: any) => s.status === "failed");
                  return (
                    <div key={t.id} className="space-y-1.5 rounded-lg border p-3">
                      <div className="flex items-start gap-2">
                        {t.status === "done" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" /> : t.status === "failed" || t.status === "cancelled" ? <XCircle className="mt-0.5 h-4 w-4 text-destructive" /> : t.status === "running" ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-primary" /> : <CalendarClock className="mt-0.5 h-4 w-4 text-primary" />}
                        <p className="flex-1 font-medium">{t.title}</p>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{STATUS[t.status] ?? t.status}</span>
                      </div>
                      <p className="text-muted-foreground">{t.status === "scheduled" ? `চলবে: ${when(t.run_at)}` : t.last_run_at ? `শেষ চলেছে: ${when(t.last_run_at)}` : `তৈরি: ${when(t.run_at)}`}{t.repeat === "daily" ? " · প্রতিদিন" : ""} · {ok}/{total} সফল</p>
                      {total > 0 && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.round(((ok + bad.length) / total) * 100)}%` }} /></div>}
                      {bad.slice(0, 3).map((s: any, i: number) => <p key={i} className="text-[12px] text-destructive">{s.label}: {s.error}</p>)}
                      {(t.status === "scheduled" || t.status === "running") && <button onClick={() => cancelTask(t.id)} className="text-[12px] text-destructive">বাতিল করুন</button>}
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "chat" && (
              <div className="border-t p-3">
                <div className="flex items-end gap-2">
                  <button onClick={toggleMic} disabled={busy} aria-label={listening ? "শোনা বন্ধ" : "বলুন"}
                    className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full border", listening ? "animate-pulse border-destructive bg-destructive text-white" : "hover:bg-muted")}>
                    {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </button>
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder={listening ? "শুনছি… বলুন" : "যেমন: এই video গুলো দিয়ে $5 করে ২০টা campaign চালাও"}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border bg-background px-3 py-2.5 text-[14px] outline-none focus:ring-2 focus:ring-primary/30" />
                  <Button size="icon" className="h-11 w-11 shrink-0 rounded-full" disabled={busy || !input.trim()} onClick={() => send(input)} aria-label="পাঠান"><Send className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
