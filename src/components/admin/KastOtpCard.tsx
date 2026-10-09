import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Mail, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  subject: string | null;
  body: string | null;
  otp: string | null;
  card_last4: string | null;
  kind: string;
  received_at: string;
  used_at: string | null;
  used_by_name: string | null;
  used_device: string | null;
};

// WhatsApp-style short double "pop" notification tone (synthesized).
function playNotify() {
  try {
    const ctx = new AudioContext();
    const tone = (freq: number, start: number, dur: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, ctx.currentTime + start);
      o.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + start + dur * 0.6);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur + 0.02);
    };
    tone(880, 0, 0.12);
    tone(1320, 0.14, 0.16);
    setTimeout(() => ctx.close(), 600);
  } catch { /* ignore */ }
}

function deviceName() {
  const ua = navigator.userAgent;
  let os = "Unknown";
  if (/iPhone/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows PC";
  else if (/Mac OS/i.test(ua)) os = "Mac";
  else if (/Linux/i.test(ua)) os = "Linux";
  let br = "";
  if (/Edg\//.test(ua)) br = "Edge";
  else if (/Chrome\//.test(ua)) br = "Chrome";
  else if (/Firefox\//.test(ua)) br = "Firefox";
  else if (/Safari\//.test(ua)) br = "Safari";
  return br ? `${os} · ${br}` : os;
}

const COLS = "id,subject,body,otp,card_last4,kind,received_at,used_at,used_by_name,used_device";

export function KastOtpCard() {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("kast_emails" as any)
      .select(COLS)
      .order("received_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setRows((data as any) ?? []));
    const ch = supabase
      .channel("kast-emails")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "kast_emails" }, (p) => {
        setRows((r) => [p.new as Row, ...r].slice(0, 10));
        playNotify();
        toast.success((p.new as Row).otp ? `KAST OTP: ${(p.new as Row).otp}` : "নতুন KAST মেইল");
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "kast_emails" }, (p) => {
        const n = p.new as Row;
        setRows((r) => r.map((x) => (x.id === n.id ? { ...x, ...n } : x)));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const copyOtp = async (r: Row) => {
    await navigator.clipboard.writeText(r.otp!);
    toast.success("কপি হয়েছে");
    if (r.used_at) return;
    const name = profile?.full_name || user?.email?.split("@")[0] || "Admin";
    const patch = {
      used_at: new Date().toISOString(),
      used_by: user?.id ?? null,
      used_by_name: name,
      used_device: deviceName(),
    };
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
    await supabase.from("kast_emails" as any).update(patch).eq("id", r.id).is("used_at", null);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> Live KAST OTP ও Alerts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">এখনো কোনো KAST মেইল আসেনি।</p>}
        {rows.map((r) => (
          <div key={r.id} className={`rounded-md border p-2 text-sm ${r.used_at ? "opacity-70" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <Badge variant={r.kind === "declined" ? "destructive" : "secondary"}>{r.kind}</Badge>
                {r.card_last4 && <span className="text-muted-foreground">Card {r.card_last4}</span>}
                <span className="text-xs text-muted-foreground">
                  {new Date(r.received_at).toLocaleString()}
                </span>
              </div>
              {r.otp && (
                <Button size="sm" variant="outline" onClick={() => copyOtp(r)}>
                  <span className={`font-mono font-bold mr-1 ${r.used_at ? "line-through" : ""}`}>{r.otp}</span>
                  <Copy className="h-3 w-3" />
                </Button>
              )}
            </div>
            {r.used_at && (
              <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                <CheckCircle2 className="h-3 w-3" />
                Used by <b>{r.used_by_name}</b> · {r.used_device} · {new Date(r.used_at).toLocaleTimeString()}
              </div>
            )}
            <button className="mt-1 text-left w-full truncate" onClick={() => setOpen(open === r.id ? null : r.id)}>
              {r.subject}
            </button>
            {open === r.id && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{r.body}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
