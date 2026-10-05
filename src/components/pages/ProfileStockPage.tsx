import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Profile = {
  id: string;
  uid: string;
  password: string | null;
  email: string | null;
  email_password: string | null;
  email_link: string | null;
  two_fa_key: string | null;
  note: string | null;
  status: string;
  purchased_by: string | null;
  purchased_at: string | null;
  price_paid: number | null;
  created_at: string;
};

const empty = { uid: "", password: "", email: "", email_password: "", email_link: "", two_fa_key: "", note: "" };
const db = supabase as any;

export default function ProfileStockPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | "available" | "used" | "purchased">("all");
  const [search, setSearch] = useState("");
  const [priceInput, setPriceInput] = useState<string | null>(null);

  const { data: profiles = [] } = useQuery({
    queryKey: ["fb-profiles-admin"],
    queryFn: async () => {
      const { data, error } = await db.from("facebook_profiles").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Profile[];
    },
  });

  const buyerIds = useMemo(() => [...new Set(profiles.map((p) => p.purchased_by).filter(Boolean))] as string[], [profiles]);
  const { data: buyers = {} } = useQuery({
    queryKey: ["fb-profiles-buyers", buyerIds],
    enabled: buyerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", buyerIds);
      return Object.fromEntries((data ?? []).map((r) => [r.user_id, r.full_name || r.email || r.user_id])) as Record<string, string>;
    },
  });

  const { data: price = 0 } = useQuery({
    queryKey: ["profile-price"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("value").eq("key", "profile_price_usd").maybeSingle();
      return Number(data?.value ?? 0) || 0;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["fb-profiles-admin"] });

  const savePrice = async () => {
    const v = Number(priceInput);
    if (!(v > 0)) return toast.error("সঠিক দাম দিন");
    const { data: existing } = await supabase.from("site_settings").select("id").eq("key", "profile_price_usd").maybeSingle();
    const res = existing
      ? await supabase.from("site_settings").update({ value: String(v) }).eq("key", "profile_price_usd")
      : await supabase.from("site_settings").insert({ key: "profile_price_usd", value: String(v) } as any);
    if (res.error) return toast.error(res.error.message);
    toast.success("দাম সেভ হয়েছে");
    setPriceInput(null);
    qc.invalidateQueries({ queryKey: ["profile-price"] });
  };

  const add = async () => {
    if (!form.uid.trim()) return toast.error("User ID / Username দিন");
    setSaving(true);
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));
    const { error } = await db.from("facebook_profiles").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Profile যোগ হয়েছে");
    setForm(empty);
    refresh();
  };

  const setStatus = async (id: string, status: "used" | "available") => {
    const { error } = await db.from("facebook_profiles").update({ status }).eq("id", id).neq("status", "purchased");
    if (error) return toast.error(error.message);
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("এই profile মুছে ফেলবেন?")) return;
    const { error } = await db.from("facebook_profiles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const counts = {
    available: profiles.filter((p) => p.status === "available").length,
    used: profiles.filter((p) => p.status === "used").length,
    purchased: profiles.filter((p) => p.status === "purchased").length,
  };
  const q = search.toLowerCase();
  const shown = profiles.filter(
    (p) =>
      (filter === "all" || p.status === filter) &&
      (!q || [p.uid, p.email, p.note, p.purchased_by ? buyers[p.purchased_by] : ""].some((s) => (s ?? "").toLowerCase().includes(q))),
  );

  const fields: [keyof typeof empty, string][] = [
    ["uid", "User ID / Username *"],
    ["password", "Password"],
    ["email", "Email"],
    ["email_password", "Email password"],
    ["email_link", "Email login link"],
    ["two_fa_key", "2FA key"],
    ["note", "নোট"],
  ];

  return (
    <DashboardLayout>
      <div className="space-y-4 p-1">
        <h1 className="text-2xl font-bold">Profile Stock</h1>

        <div className="grid grid-cols-3 gap-3">
          {(["available", "used", "purchased"] as const).map((k) => (
            <Card key={k}><CardContent className="p-4"><p className="text-sm capitalize text-muted-foreground">{k}</p><p className="text-2xl font-bold">{counts[k]}</p></CardContent></Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">দাম (প্রতি profile, USD)</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            <Input type="number" step="0.01" min="0" className="max-w-[160px]" value={priceInput ?? String(price || "")} onChange={(e) => setPriceInput(e.target.value)} />
            <Button onClick={savePrice} disabled={priceInput === null}>Save</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">নতুন profile যোগ করুন</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {fields.map(([k, label]) => (
              <div key={k} className="space-y-1">
                <Label>{label}</Label>
                <Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
            <div className="sm:col-span-2"><Button onClick={add} disabled={saving}>{saving ? "Saving…" : "Add profile"}</Button></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <CardTitle className="text-base">সব profile</CardTitle>
            <div className="flex flex-wrap gap-2">
              {(["all", "available", "used", "purchased"] as const).map((f) => (
                <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} className="capitalize">{f}</Button>
              ))}
              <Input placeholder="Search…" className="max-w-[220px]" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {shown.length === 0 && <p className="text-sm text-muted-foreground">কোনো profile নেই।</p>}
            {shown.map((p) => (
              <div key={p.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold break-all">{p.uid}</span>
                    <Badge variant={p.status === "available" ? "default" : p.status === "used" ? "secondary" : "outline"} className="capitalize">{p.status}</Badge>
                  </div>
                  <div className="flex gap-2">
                    {p.status === "available" && <Button size="sm" variant="outline" onClick={() => setStatus(p.id, "used")}>Used</Button>}
                    {p.status === "used" && <Button size="sm" variant="outline" onClick={() => setStatus(p.id, "available")}>Available করুন</Button>}
                    {p.status !== "purchased" && <Button size="sm" variant="destructive" onClick={() => remove(p.id)}>Delete</Button>}
                  </div>
                </div>
                <div className="mt-2 grid gap-1 font-mono text-xs text-muted-foreground sm:grid-cols-2 break-all">
                  <span>Pass: {p.password || "-"}</span>
                  <span>Email: {p.email || "-"}</span>
                  <span>Email pass: {p.email_password || "-"}</span>
                  <span>Link: {p.email_link || "-"}</span>
                  <span>2FA: {p.two_fa_key || "-"}</span>
                  {p.note && <span>Note: {p.note}</span>}
                </div>
                {p.status === "purchased" && (
                  <p className="mt-2 text-xs">
                    Purchased by <b>{(p.purchased_by && buyers[p.purchased_by]) || p.purchased_by}</b>
                    {p.purchased_at && ` · ${new Date(p.purchased_at).toLocaleString()}`}
                    {p.price_paid != null && ` · $${Number(p.price_paid).toFixed(2)}`}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
