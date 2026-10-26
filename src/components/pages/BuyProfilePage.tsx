import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useWallets, WALLET_LABELS, type WalletKind } from "@/hooks/useWallets";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const db = supabase as any;
const ERRORS: Record<string, string> = {
  insufficient_balance: "Balance ও due limit মিলিয়েও যথেষ্ট টাকা নেই।",
  not_enough_stock: "এত profile stock-এ নেই।",
  price_not_set: "এখন কেনা যাচ্ছে না — দাম সেট করা হয়নি।",
  invalid_quantity: "সঠিক সংখ্যা দিন।",
};

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-muted px-2 py-1">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="font-mono text-xs break-all text-right">{value}</span>
      <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied"); }}>
        <Copy className="h-3 w-3" />
      </Button>
    </div>
  );
}

export default function BuyProfilePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const w = useWallets(user?.id);
  const [qty, setQty] = useState(1);
  const [buying, setBuying] = useState(false);

  const options: { kind: WalletKind; balance: number }[] = [
    ...(w.mainEnabled ? [{ kind: "primary" as const, balance: w.mainBalance }] : []),
    ...(w.secondaryEnabled ? [{ kind: "secondary" as const, balance: w.secondaryBalance }] : []),
    ...(w.creditLineEnabled ? [{ kind: "credit_line" as const, balance: w.creditLineBalance }] : []),
  ];
  const [kind, setKind] = useState<WalletKind>("primary");
  useEffect(() => {
    if (options.length && !options.some((o) => o.kind === kind)) setKind(options[0].kind);
  }, [options.map((o) => o.kind).join(","), kind]);

  const { data: stock } = useQuery({
    queryKey: ["profile-stock"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_profile_stock");
      if (error) throw error;
      return data as { available: number; price: number };
    },
  });

  const { data: mine = [] } = useQuery({
    queryKey: ["my-fb-profiles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db.from("facebook_profiles").select("*").eq("purchased_by", user!.id).order("purchased_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const price = Number(stock?.price ?? 0);
  const available = Number(stock?.available ?? 0);
  const total = price * qty;

  const buy = async () => {
    setBuying(true);
    const { data, error } = await db.rpc("purchase_profiles", { p_qty: qty, p_wallet_kind: kind });
    setBuying(false);
    if (error) return toast.error(error.message);
    if (!data?.ok) return toast.error(ERRORS[data?.error] ?? data?.error ?? "কেনা যায়নি");
    toast.success(`${data.count}টি profile কেনা হয়েছে`);
    setQty(1);
    qc.invalidateQueries({ queryKey: ["profile-stock"] });
    qc.invalidateQueries({ queryKey: ["my-fb-profiles"] });
    qc.invalidateQueries({ queryKey: ["dual-wallets"] });
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-1">
        <h1 className="text-2xl font-bold">Buy Profile</h1>
        <Card>
          <CardHeader><CardTitle className="text-base">Two-line Facebook profile</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-6 text-sm">
              <div><p className="text-muted-foreground">Stock</p><p className="text-2xl font-bold">{available}</p></div>
              <div><p className="text-muted-foreground">দাম (প্রতিটি)</p><p className="text-2xl font-bold">${price.toFixed(2)}</p></div>
            </div>
            {options.length > 1 && (
              <div className="space-y-1">
                <Label>কোন wallet থেকে</Label>
                <div className="flex flex-wrap gap-2">
                  {options.map((o) => (
                    <Button key={o.kind} size="sm" variant={kind === o.kind ? "default" : "outline"} onClick={() => setKind(o.kind)}>
                      {WALLET_LABELS[o.kind]} (${o.balance.toFixed(2)})
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {options.length === 1 && <p className="text-sm text-muted-foreground">{WALLET_LABELS[options[0].kind]} balance: ${options[0].balance.toFixed(2)}</p>}
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label>কয়টা</Label>
                <Input type="number" min={1} max={Math.max(1, available)} className="w-24" value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
              </div>
              <Button onClick={buy} disabled={buying || available < qty || price <= 0 || options.length === 0}>
                {buying ? "Buying…" : `Buy · $${total.toFixed(2)}`}
              </Button>
            </div>
            {available < qty && <p className="text-sm text-destructive">Stock-এ মাত্র {available}টি আছে।</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">My Profiles ({mine.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {mine.length === 0 && <p className="text-sm text-muted-foreground">এখনও কোনো profile কেনা হয়নি।</p>}
            {mine.map((p) => (
              <div key={p.id} className="space-y-1 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{p.purchased_at && new Date(p.purchased_at).toLocaleString()}</p>
                <Field label="User ID" value={p.uid} />
                <Field label="Password" value={p.password} />
                <Field label="Email" value={p.email} />
                <Field label="Email pass" value={p.email_password} />
                <Field label="Email link" value={p.email_link} />
                <Field label="2FA key" value={p.two_fa_key} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
