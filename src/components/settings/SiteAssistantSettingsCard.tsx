import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function SiteAssistantSettingsCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["site-assistant-settings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("site_assistant_settings").select("enabled, assistant_name, knowledge").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data as { enabled: boolean; assistant_name: string; knowledge: string } | null;
    },
  });
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setName(data.assistant_name);
    setKnowledge(data.knowledge);
  }, [data]);

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase as any).from("site_assistant_settings").upsert({
      id: 1, enabled, assistant_name: name.trim() || "Assistant", knowledge, updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Website voice assistant saved");
    qc.invalidateQueries({ queryKey: ["site-assistant-settings"] });
    qc.invalidateQueries({ queryKey: ["site-assistant-info"] });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Website Voice Assistant</CardTitle>
        <CardDescription>
          Visitors can talk to this assistant by voice. It answers only from the information you write below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>Show on website</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="space-y-1.5">
          <Label>Assistant name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Softa" />
        </div>
        <div className="space-y-1.5">
          <Label>Company information (the assistant's knowledge)</Label>
          <Textarea
            rows={12}
            value={knowledge}
            onChange={(e) => setKnowledge(e.target.value)}
            placeholder={"কাদের ad account দেই: ...\nMinimum spending: ...\nDollar rate কিসের উপর নির্ভর করে: ...\nকিভাবে sign up করবে: ...\nযোগাযোগ: ..."}
          />
          <p className="text-xs text-muted-foreground">
            The assistant won't appear until this box has some information.
          </p>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </CardContent>
    </Card>
  );
}
