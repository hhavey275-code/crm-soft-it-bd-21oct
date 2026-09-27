import React, { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { askMark } from "@/lib/mark.functions";

type Mode = "off" | "listening" | "command" | "thinking" | "speaking";

const WAKE_WORDS = ["hey mark", "hey marc", "hay mark", "hi mark", "হে মার্ক", "হেই মার্ক", "হে মারক", "মার্ক", "mark"];
const STORAGE_KEY = "mark_always_on";
const COMMAND_WINDOW_MS = 10000;

function pickVoice(lang: "bn" | "en"): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (lang === "bn") {
    return voices.find((v) => v.lang.toLowerCase().startsWith("bn")) ?? null;
  }
  return (
    voices.find((v) => /male|david|daniel|alex|fred|guy|mark/i.test(v.name) && !/female|samantha|zira|susan/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

function speak(text: string, onDone: () => void) {
  const synth = window.speechSynthesis;
  if (!synth) { onDone(); return; }
  synth.cancel();
  const isBn = /[\u0980-\u09FF]/.test(text);
  // Chrome cuts long utterances — speak sentence by sentence.
  const parts = text.split(/(?<=[।.!?])\s+/).filter(Boolean);
  let i = 0;
  const next = () => {
    if (i >= parts.length) { onDone(); return; }
    const u = new SpeechSynthesisUtterance(parts[i++]);
    const v = pickVoice(isBn ? "bn" : "en");
    if (v) u.voice = v;
    u.lang = isBn ? (v?.lang ?? "bn-BD") : "en-US";
    u.pitch = 0.85;
    u.rate = 1.0;
    u.onend = next;
    u.onerror = next;
    synth.speak(u);
  };
  next();
}

export function MarkAssistant({ floating = false }: { floating?: boolean }) {
  const ask = useServerFn(askMark);
  const [mode, setMode] = useState<Mode>("off");
  const [alwaysOn, setAlwaysOn] = useState(false);
  const [lastAnswer, setLastAnswer] = useState("");
  const [supported, setSupported] = useState(false);
  const recRef = useRef<any>(null);
  const modeRef = useRef<Mode>("off");
  const alwaysOnRef = useRef(false);
  const pttRef = useRef(false);
  const commandTimer = useRef<any>(null);

  const setM = useCallback((m: Mode) => { modeRef.current = m; setMode(m); }, []);
  const idle = useCallback(() => setM(alwaysOnRef.current ? "listening" : "off"), [setM]);

  const openCommandWindow = useCallback(() => {
    setM("command");
    clearTimeout(commandTimer.current);
    commandTimer.current = setTimeout(() => {
      if (modeRef.current === "command") { pttRef.current = false; idle(); }
    }, COMMAND_WINDOW_MS);
  }, [idle, setM]);

  const answerQuestion = useCallback(async (question: string) => {
    clearTimeout(commandTimer.current);
    pttRef.current = false;
    setM("thinking");
    let answer: string;
    try {
      answer = (await ask({ data: { question } })).answer;
    } catch {
      answer = "Sorry sir, উত্তর আনতে সমস্যা হয়েছে। আবার বলুন।";
    }
    setLastAnswer(answer);
    setM("speaking");
    speak(answer, idle);
  }, [ask, idle, setM]);

  const stopRecognition = useCallback(() => {
    const r = recRef.current;
    recRef.current = null;
    try { r?.abort(); } catch { /* noop */ }
  }, []);

  const startRecognition = useCallback(() => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR || recRef.current) return;

    const rec = new SR();
    rec.lang = "bn-BD";
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (ev: any) => {
      // Ignore Mark's own voice while he's speaking/thinking.
      if (modeRef.current === "speaking" || modeRef.current === "thinking") return;
      let transcript = "";
      for (let k = ev.resultIndex; k < ev.results.length; k++) {
        if (ev.results[k].isFinal) transcript += " " + (ev.results[k][0]?.transcript ?? "");
      }
      transcript = transcript.toLowerCase().trim();
      if (!transcript || /^(yes,? ?sir\??|ইয়েস স্যার)$/.test(transcript)) return;

      if (modeRef.current === "listening") {
        const hit = WAKE_WORDS.find((word) => transcript.includes(word));
        if (!hit) return;
        const after = transcript.slice(transcript.indexOf(hit) + hit.length).replace(/^[,\s।]+/, "").trim();
        if (after.length > 3) { answerQuestion(after); return; }
        setM("speaking");
        speak("Yes, sir?", openCommandWindow);
        return;
      }

      if (modeRef.current === "command") answerQuestion(transcript);
    };

    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      if (alwaysOnRef.current || pttRef.current) setTimeout(startRecognition, 300);
    };
    rec.onerror = (e: any) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        alwaysOnRef.current = false;
        setAlwaysOn(false);
        localStorage.removeItem(STORAGE_KEY);
        toast.error("মাইকের অনুমতি দিন — তারপর আবার Hey Mark চালু করুন");
      }
    };

    recRef.current = rec;
    try { rec.start(); } catch { recRef.current = null; }
  }, [answerQuestion, openCommandWindow, setM]);

  const pushToTalk = useCallback(() => {
    if (modeRef.current === "thinking" || modeRef.current === "speaking") return;
    pttRef.current = true;
    startRecognition();
    setM("speaking");
    speak("Yes, sir?", openCommandWindow);
  }, [openCommandWindow, setM, startRecognition]);

  const enable = useCallback((notify: boolean) => {
    alwaysOnRef.current = true;
    setAlwaysOn(true);
    localStorage.setItem(STORAGE_KEY, "1");
    setM("listening");
    startRecognition();
    if (notify) toast.success("Mark এখন শুনছে — যেকোনো পেজে \"Hey Mark\" বলুন");
  }, [setM, startRecognition]);

  const toggleAlwaysOn = useCallback(() => {
    if (alwaysOnRef.current) {
      alwaysOnRef.current = false;
      setAlwaysOn(false);
      localStorage.removeItem(STORAGE_KEY);
      stopRecognition();
      window.speechSynthesis?.cancel();
      setM("off");
    } else enable(true);
  }, [enable, setM, stopRecognition]);

  useEffect(() => {
    const w = window as any;
    const ok = !!(w.SpeechRecognition || w.webkitSpeechRecognition);
    setSupported(ok);
    window.speechSynthesis?.getVoices();
    if (ok && localStorage.getItem(STORAGE_KEY) === "1") enable(false);
    return () => {
      alwaysOnRef.current = false;
      pttRef.current = false;
      clearTimeout(commandTimer.current);
      stopRecognition();
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supported) return null;

  const status =
    mode === "off" ? "বন্ধ" :
    mode === "listening" ? "\"Hey Mark\" বলুন" :
    mode === "command" ? "বলুন, শুনছি…" :
    mode === "thinking" ? "খুঁজছি…" : "বলছে…";

  return (
    <div
      className={cn(
        "flex max-w-sm flex-col gap-1 rounded-full border border-border bg-card px-3 py-1.5 shadow-lg",
        floating && "fixed bottom-4 left-4 z-50",
        lastAnswer && "rounded-2xl",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            mode === "off" ? "bg-muted-foreground/40" : mode === "command" ? "bg-destructive animate-pulse" : "bg-primary animate-pulse",
          )}
        />
        <span className="text-xs font-semibold text-foreground">Mark</span>
        <span className="text-[11px] text-muted-foreground">{status}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={pushToTalk} disabled={mode === "thinking" || mode === "speaking"} title="চেপে বলুন">
          {mode === "thinking" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
        </Button>
        <Button size="sm" variant={alwaysOn ? "default" : "outline"} className="h-7 px-2 text-[11px]" onClick={toggleAlwaysOn}>
          {alwaysOn ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
          <span className="ml-1">{alwaysOn ? "বন্ধ" : "Hey Mark চালু"}</span>
        </Button>
      </div>
      {lastAnswer && <p className="text-[11px] leading-snug text-muted-foreground line-clamp-3">{lastAnswer}</p>}
    </div>
  );
}
