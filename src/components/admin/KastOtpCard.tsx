import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Mail } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  subject: string | null;
  body: string | null;
  otp: string | null;
  card_last4: string | null;
  kind: string;
  received_at: string;
};

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 880;
    o.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 250);
  } catch { /* ignore */ }
}

export function KastOtpCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("kast_emails" as any)
      .select("id,subject,body,otp,card_last4,kind,received_at")
      .order("received_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setRows((data as any) ?? []));
    const ch = supabase
      .channel("kast-emails")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "kast_emails" }, (p) => {
        setRows((r) => [p.new as Row, ...r].slice(0, 10));
        beep();
        toast.success((p.new as Row).otp ? `KAST OTP: ${(p.new as Row).otp}` : "নতুন KAST মেইল");
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

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
          <div key={r.id} className="rounded-md border p-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={r.kind === "declined" ? "destructive" : "secondary"}>{r.kind}</Badge>
                {r.card_last4 && <span className="text-muted-foreground">Card {r.card_last4}</span>}
                <span className="text-xs text-muted-foreground">
                  {new Date(r.received_at).toLocaleString()}
                </span>
              </div>
              {r.otp && (
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(r.otp!); toast.success("কপি হয়েছে"); }}>
                  <span className="font-mono font-bold mr-1">{r.otp}</span><Copy className="h-3 w-3" />
                </Button>
              )}
            </div>
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
