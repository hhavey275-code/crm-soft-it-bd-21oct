import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Bot, ArrowUp, ArrowDown, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type Provider = "lovable" | "gemini" | "openai";

const PROVIDER_LABELS: Record<Provider, string> = {
  lovable: "Lovable AI (default)",
  gemini: "Google Gemini (your key)",
  openai: "OpenAI ChatGPT (your key)",
};

export function OcrFallbackSection() {
  const [priority, setPriority] = useState<Provider[]>(["lovable", "gemini", "openai"]);
  const [savingPriority, setSavingPriority] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const { data: settings, refetch } = useQuery({
    queryKey: ["ocr-fallback-settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", ["ocr_fallback_priority", "ocr_openai_configured", "ocr_gemini_configured"]);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!settings) return;
    const pr = settings.find((s) => s.key === "ocr_fallback_priority")?.value;
    if (pr) {
      try {
        const arr = JSON.parse(pr);
        if (Array.isArray(arr)) setPriority(arr.filter((p: string) => ["lovable", "gemini", "openai"].includes(p)) as Provider[]);
      } catch (_) {}
    }
  }, [settings]);

  const openaiConfigured = settings?.find((s) => s.key === "ocr_openai_configured")?.value === "true";
  const geminiConfigured = settings?.find((s) => s.key === "ocr_gemini_configured")?.value === "true";

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...priority];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setPriority(next);
  };

  const savePriority = async () => {
    setSavingPriority(true);
    const { data, error } = await supabase.functions.invoke("set-ocr-secret", {
      body: { action: "save_priority", priority },
    });
    setSavingPriority(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Failed to save priority");
    } else {
      toast.success("Priority saved");
      refetch();
    }
  };

  const saveKey = async (provider: "openai" | "gemini") => {
    const key = provider === "openai" ? openaiKey : geminiKey;
    if (!key.trim() || key.trim().length < 10) {
      toast.error("Please enter a valid API key");
      return;
    }
    setSavingKey(provider);
    const { data, error } = await supabase.functions.invoke("set-ocr-secret", {
      body: { provider, api_key: key.trim() },
    });
    setSavingKey(null);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Failed to save key");
    } else {
      toast.success(`${provider === "openai" ? "OpenAI" : "Gemini"} key saved. May take ~30s to propagate.`);
      if (provider === "openai") setOpenaiKey("");
      else setGeminiKey("");
      refetch();
    }
  };

  const testFallback = async () => {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("test-ocr-fallback", { body: {} });
    setTesting(false);
    if (error || (data as any)?.ok === false) {
      toast.error("Test failed: " + ((data as any)?.error || error?.message || "unknown"));
      return;
    }
    const d: any = data;
    toast.success(`Working via ${d.provider}. Attempts: ${d.attempts.map((a: any) => `${a.provider}=${a.ok ? "ok" : "fail"}`).join(", ")}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">OCR Fallback Providers</h2>
      </div>
      <Separator />
      <p className="text-xs text-muted-foreground">
        Lovable AI credit শেষ হলে আপনার নিজের Gemini / OpenAI key দিয়ে OCR fallback হবে। নিচের priority order অনুযায়ী চেষ্টা করবে।
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Fallback Priority</CardTitle>
          <CardDescription>উপরের provider আগে চেষ্টা করবে। Fail হলে নিচেরটায় যাবে।</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {priority.map((p, idx) => (
            <div key={p} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground w-6">{idx + 1}.</span>
                <span className="text-sm font-medium">{PROVIDER_LABELS[p]}</span>
                {p === "openai" && (
                  <Badge variant={openaiConfigured ? "default" : "outline"} className="text-xs">
                    {openaiConfigured ? "Configured" : "No key"}
                  </Badge>
                )}
                {p === "gemini" && (
                  <Badge variant={geminiConfigured ? "default" : "outline"} className="text-xs">
                    {geminiConfigured ? "Configured" : "No key"}
                  </Badge>
                )}
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => move(idx, 1)} disabled={idx === priority.length - 1}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={savePriority} disabled={savingPriority}>
              {savingPriority ? "Saving..." : "Save Priority"}
            </Button>
            <Button size="sm" variant="outline" onClick={testFallback} disabled={testing}>
              {testing ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Testing...</> : "Test Fallback"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Google Gemini API Key
            {geminiConfigured ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-muted-foreground" />}
          </CardTitle>
          <CardDescription>aistudio.google.com থেকে free Gemini API key নিন।</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              placeholder={geminiConfigured ? "●●●●●●●●●● (already configured — paste new to update)" : "AIza..."}
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
            />
            <Button size="sm" onClick={() => saveKey("gemini")} disabled={savingKey === "gemini"}>
              {savingKey === "gemini" ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            OpenAI API Key
            {openaiConfigured ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-muted-foreground" />}
          </CardTitle>
          <CardDescription>platform.openai.com → API keys থেকে নিন। gpt-4o-mini ব্যবহার হবে।</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              placeholder={openaiConfigured ? "●●●●●●●●●● (already configured — paste new to update)" : "sk-..."}
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
            />
            <Button size="sm" onClick={() => saveKey("openai")} disabled={savingKey === "openai"}>
              {savingKey === "openai" ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}