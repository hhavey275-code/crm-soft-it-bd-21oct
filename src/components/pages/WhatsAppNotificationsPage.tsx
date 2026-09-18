import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MessageCircle, RefreshCw, Send, Loader2 } from "lucide-react";

type SettingRow = { key: string; enabled: boolean; template: string; num_value: number | null };
type MessageRow = {
  id: string;
  user_id: string | null;
  phone: string;
  body: string;
  status: string;
  attempts: number;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
};

const statusStyles: Record<string, string> = {
  sent: "bg-success/15 text-success border-success/30",
  pending: "bg-warning/15 text-warning border-warning/30",
  sending: "bg-primary/15 text-primary border-primary/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};

export default function WhatsAppNotificationsPage() {
  const qc = useQueryClient();
  const [template, setTemplate] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [gap, setGap] = useState("45");
  const [limit, setLimit] = useState("150");
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["wa-settings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("wa_notify_settings")
        .select("key, enabled, template, num_value");
      if (error) throw error;
      return (data ?? []) as SettingRow[];
    },
  });

  const { data: messages, isFetching } = useQuery({
    queryKey: ["wa-messages"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("wa_messages")
        .select("id, user_id, phone, body, status, attempts, sent_at, last_error, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as MessageRow[];
    },
    refetchInterval: 20_000,
  });

  const { data: names } = useQuery({
    queryKey: ["wa-message-names", (messages ?? []).length],
    enabled: !!messages && messages.length > 0,
    queryFn: async () => {
      const ids = Array.from(new Set((messages ?? []).map((m) => m.user_id).filter(Boolean))) as string[];
      if (ids.length === 0) return {} as Record<string, string>;
      const { data } = await (supabase as any)
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", ids);
      const map: Record<string, string> = {};
      for (const p of data ?? []) map[p.user_id] = p.full_name || p.email || "Client";
      return map;
    },
  });

  useEffect(() => {
    if (!settings) return;
    const topup = settings.find((s) => s.key === "topup_approved");
    const g = settings.find((s) => s.key === "gap_seconds");
    const l = settings.find((s) => s.key === "daily_limit");
    setTemplate(topup?.template ?? "");
    setEnabled(!!topup?.enabled);
    setGap(String(g?.num_value ?? 45));
    setLimit(String(l?.num_value ?? 150));
  }, [settings]);

  const preview = useMemo(
    () =>
      template
        .replace(/\{\{name\}\}/g, "Rahim Uddin")
        .replace(/\{\{amount\}\}/g, "$250.00")
        .replace(/\{\{balance\}\}/g, "$412.50"),
    [template]
  );

  const stats = useMemo(() => {
    const list = messages ?? [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      pending: list.filter((m) => m.status === "pending" || m.status === "sending").length,
      sentToday: list.filter((m) => m.sent_at && new Date(m.sent_at) >= today).length,
      failed: list.filter((m) => m.status === "failed").length,
    };
  }, [messages]);

  async function save() {
    setSaving(true);
    try {
      const rows = [
        { key: "topup_approved", enabled, template, num_value: null },
        { key: "gap_seconds", enabled: true, template: "", num_value: Number(gap) || 45 },
        { key: "daily_limit", enabled: true, template: "", num_value: Number(limit) || 150 },
      ];
      const { error } = await (supabase as any).from("wa_notify_settings").upsert(rows, { onConflict: "key" });
      if (error) throw error;
      toast.success("সেটিংস সেভ হয়েছে");
      qc.invalidateQueries({ queryKey: ["wa-settings"] });
    } catch (e: any) {
      toast.error(e?.message ?? "সেভ করা যায়নি");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    const phone = testPhone.trim();
    if (!phone) {
      toast.error("নম্বর দিন");
      return;
    }
    setTesting(true);
    try {
      const { error } = await (supabase as any).from("wa_messages").insert({
        kind: "test",
        phone,
        body: preview || "Test message from the dashboard.",
        dedupe_key: `test:${Date.now()}`,
      });
      if (error) throw error;
      toast.success("টেস্ট বার্তা সারিতে যোগ হয়েছে — Helper পাঠাবে");
      qc.invalidateQueries({ queryKey: ["wa-messages"] });
    } catch (e: any) {
      toast.error(e?.message ?? "যোগ করা যায়নি");
    } finally {
      setTesting(false);
    }
  }

  async function retry(id: string) {
    const { error } = await (supabase as any)
      .from("wa_messages")
      .update({ status: "pending", attempts: 0, last_error: null, claimed_at: null, claimed_by: null })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("আবার পাঠানোর জন্য সারিতে রাখা হয়েছে");
      qc.invalidateQueries({ queryKey: ["wa-messages"] });
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-success/10 p-2">
          <MessageCircle className="h-5 w-5 text-success" />
        </div>
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">WhatsApp Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Wallet top-up approve হলে ক্লায়েন্টের WhatsApp-এ বার্তা যাবে (Helper extension দিয়ে)।
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">অপেক্ষমাণ</p>
            <p className="text-2xl font-semibold">{stats.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">আজ পাঠানো</p>
            <p className="text-2xl font-semibold text-success">{stats.sentToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">ব্যর্থ</p>
            <p className="text-2xl font-semibold text-destructive">{stats.failed}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top-up approved message</CardTitle>
          <CardDescription>
            ব্যবহারযোগ্য চিহ্ন: <code>{"{{name}}"}</code>, <code>{"{{amount}}"}</code>, <code>{"{{balance}}"}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="font-medium">বার্তা পাঠানো চালু</p>
              <p className="text-xs text-muted-foreground">বন্ধ থাকলে কোনো বার্তা তৈরি হবে না।</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-2">
            <Label>বার্তার লেখা</Label>
            <Textarea rows={6} value={template} onChange={(e) => setTemplate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>প্রিভিউ</Label>
            <div className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm">{preview}</div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>বার্তার মধ্যে বিরতি (সেকেন্ড)</Label>
              <Input type="number" min={10} value={gap} onChange={(e) => setGap(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>দৈনিক সর্বোচ্চ বার্তা</Label>
              <Input type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
            </div>
          </div>

          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            সেভ করুন
          </Button>

          <Separator />

          <div className="space-y-2">
            <Label>টেস্ট বার্তা পাঠান</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="01XXXXXXXXX বা 8801XXXXXXXXX"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
              <Button variant="outline" onClick={sendTest} disabled={testing}>
                <Send className="mr-2 h-4 w-4" />
                সারিতে দিন
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Helper চালু থাকা PC-তে WhatsApp Web লগইন থাকলে বার্তাটি এক মিনিটের মধ্যে চলে যাবে।
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">History</CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => qc.invalidateQueries({ queryKey: ["wa-messages"] })}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {(messages ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">এখনো কোনো বার্তা নেই।</p>
          )}
          {(messages ?? []).map((m) => (
            <div key={m.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {(m.user_id && names?.[m.user_id]) || "Test"} · {m.phone}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(m.created_at).toLocaleString()}
                    {m.attempts > 0 ? ` · চেষ্টা ${m.attempts}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={statusStyles[m.status] ?? ""}>
                    {m.status}
                  </Badge>
                  {(m.status === "failed" || m.status === "pending") && (
                    <Button size="sm" variant="outline" onClick={() => retry(m.id)}>
                      আবার পাঠান
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{m.body}</p>
              {m.last_error && <p className="mt-1 text-xs text-destructive">{m.last_error}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
