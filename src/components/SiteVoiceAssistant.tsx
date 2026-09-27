import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mic, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSiteAssistantInfo, askSiteAssistant } from "@/lib/siteAssistant.functions";

type Turn = { role: "user" | "assistant"; text: string };
type Phase = "idle" | "listening" | "thinking" | "speaking";
type Lang = "bn-BD" | "en-US";

function speak(text: string, onDone: () => void) {
  const synth = window.speechSynthesis;
  if (!synth) { onDone(); return; }
  synth.cancel();
  const isBn = /[\u0980-\u09FF]/.test(text);
  const voices = synth.getVoices();
  const voice = isBn
    ? voices.find((v) => v.lang.toLowerCase().startsWith("bn"))
    : voices.find((v) => v.lang.startsWith("en"));
  const parts = text.split(/(?<=[।.!?])\s+/).filter(Boolean);
  let i = 0;
  const next = () => {
    if (i >= parts.length) { onDone(); return; }
    const u = new SpeechSynthesisUtterance(parts[i++]);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? (isBn ? "bn-BD" : "en-US");
    u.onend = next;
    u.onerror = next;
    synth.speak(u);
  };
  next();
}

export function SiteVoiceAssistant() {
  const getInfo = useServerFn(getSiteAssistantInfo);
  const ask = useServerFn(askSiteAssistant);
  const { data: info } = useQuery({ queryKey: ["site-assistant-info"], queryFn: () => getInfo(), staleTime: 5 * 60_000 });

  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lang, setLang] = useState<Lang>("bn-BD");
  const [caption, setCaption] = useState("");
  const turnsRef = useRef<Turn[]>([]);
  const recRef = useRef<any>(null);
  const openRef = useRef(false);

  useEffect(() => {
    const w = window as any;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition) && !!window.speechSynthesis);
    window.speechSynthesis?.getVoices();
    return () => { recRef.current?.abort?.(); window.speechSynthesis?.cancel(); };
  }, []);

  const listen = useCallback(() => {
    if (!openRef.current) return;
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = lang;
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
        reply = r.ok ? r.answer : r.error ?? "Sorry, please try again.";
        if (r.ok) turnsRef.current = [...turnsRef.current, { role: "assistant" as const, text: r.answer }];
      } catch {
        reply = lang === "bn-BD" ? "দুঃখিত, একটু সমস্যা হচ্ছে। আবার চেষ্টা করুন।" : "Sorry, something went wrong. Please try again.";
      }
      if (!openRef.current) return;
      setCaption(reply);
      setPhase("speaking");
      speak(reply, () => { if (openRef.current) listen(); });
    };
    rec.onerror = (e: any) => {
      if (e?.error === "not-allowed") { setCaption("Please allow microphone access."); stop(); }
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
  }, [ask, lang]);

  const stop = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    setPhase("idle");
    const r = recRef.current; recRef.current = null; r?.abort?.();
    window.speechSynthesis?.cancel();
  }, []);

  const start = useCallback(() => {
    openRef.current = true;
    setOpen(true);
    turnsRef.current = [];
    const hello = lang === "bn-BD"
      ? `আসসালামু আলাইকুম! আমি ${info?.name ?? "Assistant"}। কী জানতে চান, বলুন।`
      : `Hi! I'm ${info?.name ?? "the assistant"}. How can I help you?`;
    setCaption(hello);
    setPhase("speaking");
    speak(hello, () => { if (openRef.current) listen(); });
  }, [info?.name, lang, listen]);

  if (!supported || !info?.enabled) return null;

  const status =
    phase === "listening" ? (lang === "bn-BD" ? "শুনছি… বলুন" : "Listening…")
    : phase === "thinking" ? (lang === "bn-BD" ? "ভাবছি…" : "Thinking…")
    : phase === "speaking" ? (lang === "bn-BD" ? "বলছি…" : "Speaking…") : "";

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-72 rounded-2xl border border-border bg-card p-4 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">{info.name}</span>
            <button onClick={stop} aria-label="End conversation" className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-primary">
            {phase === "thinking" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />}
            {status}
          </div>
          {caption && <p className="mt-2 text-xs leading-relaxed text-muted-foreground line-clamp-4">{caption}</p>}
        </div>
      )}
      {!open && (
        <div className="flex overflow-hidden rounded-full border border-border bg-card text-[11px] shadow">
          {(["bn-BD", "en-US"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={cn("px-2.5 py-1", lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              {l === "bn-BD" ? "বাংলা" : "English"}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={open ? stop : start}
        aria-label={open ? "End voice conversation" : "Talk to our assistant"}
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105",
          phase === "listening" && "ring-4 ring-primary/30 animate-pulse",
        )}
      >
        {open ? <X className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
      </button>
    </div>
  );
}
