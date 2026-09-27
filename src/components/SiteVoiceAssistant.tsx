import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mic, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getSiteAssistantInfo, askSiteAssistant } from "@/lib/siteAssistant.functions";
import { streamSpeech } from "@/lib/streamSpeech";

type Turn = { role: "user" | "assistant"; text: string };
type Phase = "idle" | "listening" | "thinking" | "speaking";

let currentAbort: AbortController | null = null;

function browserSpeak(text: string, onDone: () => void) {
  const synth = window.speechSynthesis;
  if (!synth) { onDone(); return; }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "bn-BD";
  u.onend = onDone; u.onerror = onDone;
  synth.speak(u);
}

/** Natural AI voice (good Bangla accent); falls back to the browser voice if it fails. */
function speak(text: string, onDone: () => void) {
  currentAbort?.abort();
  const ctrl = new AbortController();
  currentAbort = ctrl;
  streamSpeech("/api/public/site-tts", text, ctrl.signal)
    .then(() => { if (!ctrl.signal.aborted) onDone(); })
    .catch(() => { if (!ctrl.signal.aborted) browserSpeak(text, onDone); });
}

function stopSpeaking() {
  currentAbort?.abort();
  currentAbort = null;
  window.speechSynthesis?.cancel();
}

export function SiteVoiceAssistant({ showInvitation = false }: { showInvitation?: boolean }) {
  const getInfo = useServerFn(getSiteAssistantInfo);
  const ask = useServerFn(askSiteAssistant);
  const { data: info } = useQuery({ queryKey: ["site-assistant-info"], queryFn: () => getInfo(), staleTime: 5 * 60_000 });

  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [dismissedInvitation, setDismissedInvitation] = useState(false);
  const [caption, setCaption] = useState("");
  const turnsRef = useRef<Turn[]>([]);
  const recRef = useRef<any>(null);
  const openRef = useRef(false);

  useEffect(() => {
    const w = window as any;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    window.speechSynthesis?.getVoices();
    return () => { recRef.current?.abort?.(); stopSpeaking(); };
  }, []);

  const listen = useCallback(() => {
    if (!openRef.current) return;
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "bn-BD";
    rec.continuous = false;
    rec.interimResults = false;
    let heard = false;
    rec.onresult = async (ev: any) => {
      const text = (ev.results[0]?.[0]?.transcript ?? "").trim();
      if (!text) return;
      heard = true;
      turnsRef.current = [...turnsRef.current, { role: "user" as const, text }].slice(-10);
      setCaption(text);
      setPhase("thinking");
      let reply: string;
      try {
        const r = await ask({ data: { turns: turnsRef.current } });
         reply = r.ok ? r.answer : "দুঃখিত, এখন উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।";
        if (r.ok) turnsRef.current = [...turnsRef.current, { role: "assistant" as const, text: r.answer }];
      } catch {
         reply = "দুঃখিত, একটু সমস্যা হচ্ছে। আবার চেষ্টা করুন।";
      }
      if (!openRef.current) return;
      setCaption(reply);
      setPhase("speaking");
      speak(reply, () => { if (openRef.current) listen(); });
    };
    rec.onerror = (e: any) => {
       if (e?.error === "not-allowed") { stop(); setCaption("মাইক্রোফোন ব্যবহারের অনুমতি দিন।"); setOpen(true); }
    };
    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      // Nothing heard — keep listening while the conversation is open.
      if (!heard && openRef.current) setTimeout(listen, 250);
    };
    recRef.current = rec;
    setPhase("listening");
    try { rec.start(); } catch { /* already running */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  const stop = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    setPhase("idle");
    const r = recRef.current; recRef.current = null; r?.abort?.();
    stopSpeaking();
  }, []);

  const start = useCallback(() => {
    setDismissedInvitation(true);
    if (!supported) {
      setOpen(true);
      setCaption("এই ব্রাউজারে কথা বলার সুবিধা নেই। Chrome দিয়ে আবার চেষ্টা করুন।");
      return;
    }
    openRef.current = true;
    setOpen(true);
    turnsRef.current = [];
    const hello = `আসসালামু আলাইকুম! আমি ${info?.name ?? "আপনার সহকারী"}। কী জানতে চান, বলুন।`;
    setCaption(hello);
    setPhase("speaking");
    speak(hello, () => { if (openRef.current) listen(); });
  }, [info?.name, listen, supported]);

  if (!info?.enabled) return null;

  const status =
    phase === "listening" ? "শুনছি… বলুন"
    : phase === "thinking" ? "ভাবছি…"
    : phase === "speaking" ? "বলছি…" : "";

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-[100] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:bottom-5 sm:right-5">
      {open && (
        <div className="w-72 max-w-full rounded-md border border-border bg-card p-4 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">{info.name}</span>
            <Button variant="ghost" size="icon" onClick={stop} aria-label="কথা বন্ধ করুন" className="h-8 w-8 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-primary">
            {phase === "thinking" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />}
            {status}
          </div>
          {caption && <p className="mt-2 text-xs leading-relaxed text-muted-foreground line-clamp-4">{caption}</p>}
        </div>
      )}
      <div className="flex max-w-full items-center gap-2">
      {showInvitation && !open && !dismissedInvitation && (
        <div className="max-w-[calc(100vw-6.5rem)] rounded-md border border-border bg-card px-3 py-2 text-sm font-medium leading-snug text-card-foreground shadow-lg sm:max-w-none" role="status">
          আপনার কোনো জিজ্ঞাসা থাকলে আমাকে জানান।
        </div>
      )}
      <Button
        type="button"
        onClick={open ? stop : start}
        aria-label={open ? "কথা বন্ধ করুন" : "ভয়েসে প্রশ্ন করুন"}
        title={open ? "কথা বন্ধ করুন" : "ভয়েসে প্রশ্ন করুন"}
        className={cn(
          "h-14 w-14 shrink-0 rounded-full bg-primary p-0 text-primary-foreground shadow-lg transition-transform hover:scale-105 [&_svg]:size-6",
          phase === "listening" && "ring-4 ring-primary/30 animate-pulse",
        )}
      >
        {open ? <X className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
      </Button>
      </div>
    </div>
  );
}
