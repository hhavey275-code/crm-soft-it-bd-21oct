import React, { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, Volume2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { askMark } from "@/lib/mark.functions";

type Mode = "off" | "listening" | "command" | "thinking" | "speaking";

const WAKE_WORDS = ["hey mark", "hey marc", "hay mark", "মার্ক", "হে মার্ক", "হে মারক"];

function pickMaleVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const male =
    voices.find((v) => /male|david|daniel|alex|fred|google us english/i.test(v.name) && !/female|samantha|zira|susan/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    voices[0];
  return male ?? null;
}

function speak(text: string, onDone: () => void) {
  if (!window.speechSynthesis) { onDone(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = pickMaleVoice();
  u.pitch = 0.85; // deeper, male-sounding
  u.rate = 1.0;
  u.onend = onDone;
  u.onerror = onDone;
  window.speechSynthesis.speak(u);
}

export function MarkAssistant() {
  const [mode, setMode] = useState<Mode>("off");
  const [alwaysOn, setAlwaysOn] = useState(false);
  const [lastAnswer, setLastAnswer] = useState("");
  const [supported, setSupported] = useState(false);
  const recRef = useRef<any>(null);
  const modeRef = useRef<Mode>("off");
  const alwaysOnRef = useRef(false);
  modeRef.current = mode;
  alwaysOnRef.current = alwaysOn;

  const stopRecognition = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    recRef.current = null;
  }, []);

  const answerQuestion = useCallback(async (question: string) => {
    setMode("thinking");
    try {
      const { answer } = await askMark({ data: { question } });
      setLastAnswer(answer);
      setMode("speaking");
      speak(answer, () => setMode(alwaysOnRef.current ? "listening" : "off"));
    } catch (e: any) {
      const msg = "Sorry sir, উত্তর আনতে সমস্যা হয়েছে।";
      setLastAnswer(msg);
      setMode("speaking");
      speak(msg, () => setMode(alwaysOnRef.current ? "listening" : "off"));
    }
  }, []);

  const startRecognition = useCallback((expectCommand: boolean) => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    stopRecognition();

    const rec = new SR();
    rec.lang = "bn-BD"; // understands Bangla + English mixed
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (ev: any) => {
      const transcript = Array.from(ev.results)
        .slice(ev.resultIndex)
        .map((r: any) => r[0]?.transcript ?? "")
        .join(" ")
        .toLowerCase()
        .trim();
      if (!transcript) return;

      if (modeRef.current === "listening") {
        const hit = WAKE_WORDS.find((word) => transcript.includes(word));
        if (!hit) return;
        const after = transcript.slice(transcript.indexOf(hit) + hit.length).trim();
        setMode("command");
        speak("Yes, sir?", () => {
          if (modeRef.current === "command") setMode("listening");
        });
        if (after.length > 3) answerQuestion(after);
        return;
      }

      if (modeRef.current === "command" || expectCommand) {
        answerQuestion(transcript);
      }
    };

    rec.onend = () => {
      // Auto-restart while always-on is enabled and we're in a listening state
      if (alwaysOnRef.current && (modeRef.current === "listening" || modeRef.current === "command")) {
        setTimeout(() => {
          if (alwaysOnRef.current) startRecognition(false);
        }, 400);
      }
    };
    rec.onerror = () => { /* onend handles restart */ };

    recRef.current = rec;
    try { rec.start(); } catch { /* already started */ }
  }, [answerQuestion, stopRecognition]);

  // Push-to-talk: one-shot command
  const pushToTalk = useCallback(() => {
    if (mode === "thinking" || mode === "speaking") return;
    setMode("command");
    speak("Yes, sir?", () => {
      if (modeRef.current === "command") startRecognition(true);
    });
  }, [mode, startRecognition]);

  // Toggle always-on "Hey Mark" listening
  const toggleAlwaysOn = useCallback(() => {
    if (alwaysOn) {
      setAlwaysOn(false);
      stopRecognition();
      window.speechSynthesis?.cancel();
      setMode("off");
    } else {
      setAlwaysOn(true);
      setMode("listening");
      startRecognition(false);
      toast.success("Mark এখন শুনছে — \"Hey Mark\" বলুন");
    }
  }, [alwaysOn, startRecognition, stopRecognition]);

  useEffect(() => {
    // Preload voices
    window.speechSynthesis?.getVoices();
    return () => {
      stopRecognition();
      window.speechSynthesis?.cancel();
    };
  }, [stopRecognition]);

  if (!supported) {
    return (
      <div className="border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        আপনার browser-এ voice support নেই — Chrome ব্যবহার করুন।
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <Volume2 className={cn("h-4 w-4", mode === "speaking" ? "text-primary animate-pulse" : "text-muted-foreground")} />
        <span className="text-xs font-semibold text-foreground">Mark</span>
        <span className="text-[11px] text-muted-foreground">
          {mode === "off" && "বন্ধ আছে"}
          {mode === "listening" && (alwaysOn ? "শুনছে… \"Hey Mark\" বলুন" : "শুনছে…")}
          {mode === "command" && "কমান্ডের জন্য অপেক্ষা করছে…"}
          {mode === "thinking" && "উত্তর খুঁজছে…"}
          {mode === "speaking" && "বলছে…"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant={mode === "command" && !alwaysOn ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={pushToTalk}
            disabled={mode === "thinking" || mode === "speaking"}
          >
            {mode === "thinking" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mic className="h-3 w-3" />}
            <span className="ml-1">বলুন</span>
          </Button>
          <Button
            size="sm"
            variant={alwaysOn ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={toggleAlwaysOn}
          >
            {alwaysOn ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
            <span className="ml-1">{alwaysOn ? "Hey Mark বন্ধ" : "Hey Mark চালু"}</span>
          </Button>
        </div>
      </div>
      {lastAnswer && (
        <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-2">{lastAnswer}</p>
      )}
    </div>
  );
}
