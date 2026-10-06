import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const db = supabase as any;

export default function ManagedAdsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [search, setSearch] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});

  const { data } = useQuery({
    queryKey: ["managed-ads-pages"],
    queryFn: async () => {
      const [{ data: pages, error }, { data: accounts }] = await Promise.all([
        db.from("client_facebook_pages").select("*").order("created_at", { ascending: false }),
        db.from("ad_accounts").select("id, account_id, account_name").order("account_name"),
      ]);
      if (error) throw error;
      const userIds = [...new Set((pages ?? []).map((p: any) => p.user_id))];
      const { data: profiles } = userIds.length
        ? await db.from("profiles").select("user_id, full_name, email").in("user_id", userIds)
        : { data: [] };
      return { pages: pages ?? [], accounts: accounts ?? [], profiles: profiles ?? [] };
    },
  });

  const profileMap = useMemo(() => new Map((data?.profiles ?? []).map((p: any) => [p.user_id, p])), [data]);
  const accountMap = useMemo(() => new Map((data?.accounts ?? []).map((a: any) => [a.id, a])), [data]);

  const rows = (data?.pages ?? []).filter((p: any) => {
    if (p.status !== tab) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const pr: any = profileMap.get(p.user_id);
    return [p.page_name, p.page_id, pr?.full_name, pr?.email].some((v) => v?.toLowerCase?.().includes(q));
  });

  const counts = (data?.pages ?? []).reduce((acc: Record<string, number>, p: any) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {});

  const update = async (p: any, patch: Record<string, unknown>, okMsg: string) => {
    const { error } = await db.from("client_facebook_pages").update(patch).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(okMsg);
    qc.invalidateQueries({ queryKey: ["managed-ads-pages"] });
  };

  const approve = async (p: any) => {
    const acc = picks[p.id] ?? p.ad_account_id;
    if (!acc) return toast.error("আগে একটি ad account বাছুন");
    await update(p, { ad_account_id: acc, status: "approved", approved_at: new Date().toISOString(), approved_by: user?.id }, "Page অনুমোদিত হয়েছে");
    await db.from("profiles").update({ managed_ads_enabled: true }).eq("user_id", p.user_id);
  };

  const reject = (p: any) => {
    const note = window.prompt("বাতিলের কারণ (client দেখতে পাবে):") ?? "";
    update(p, { status: "rejected", admin_note: note || null }, "বাতিল করা হয়েছে");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Managed Ads Control</h1>
          <p className="text-sm text-muted-foreground">Client-কে একটি shared ad account দিন — তারপর client নিজের যেকোনো page বেছে ad চালাতে পারবে। নিচের page তালিকা শুধু দেখার ও দরকারে বাতিল করার জন্য।</p>
        </div>

        <ThresholdCard />

        <SharedAccountAssign accounts={data?.accounts ?? []} />

        <div className="flex flex-wrap items-center gap-2">
          {(["pending", "approved", "rejected"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
              {t === "pending" ? "অপেক্ষমাণ" : t === "approved" ? "চালু" : "বাতিল"} ({counts[t] ?? 0})
            </Button>
          ))}
          <Input className="max-w-xs ml-auto" placeholder="Client / page খুঁজুন" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Page তালিকা</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {rows.length === 0 && <p className="text-sm text-muted-foreground">কিছু নেই।</p>}
            {rows.map((p: any) => {
              const pr: any = profileMap.get(p.user_id);
              const acc: any = p.ad_account_id ? accountMap.get(p.ad_account_id) : null;
              return (
                <div key={p.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{pr?.full_name || pr?.email || "Client"}</p>
                    <p className="text-xs text-muted-foreground truncate">{pr?.email}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {p.page_url ? <a href={p.page_url} target="_blank" rel="noreferrer" className="underline">{p.page_name}</a> : p.page_name}
                    </p>
                    <p className="text-xs text-muted-foreground">Page ID: {p.page_id}</p>
                    {acc && <p className="text-xs text-muted-foreground truncate">Account: {acc.account_name} ({acc.account_id})</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {tab !== "approved" ? (
                      <>
                        <Select value={picks[p.id] ?? p.ad_account_id ?? ""} onValueChange={(v) => setPicks((s) => ({ ...s, [p.id]: v }))}>
                          <SelectTrigger className="w-56"><SelectValue placeholder="Shared ad account বাছুন" /></SelectTrigger>
                          <SelectContent>
                            {(data?.accounts ?? []).map((a: any) => (
                              <SelectItem key={a.id} value={a.id}>{a.account_name} ({a.account_id})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" onClick={() => approve(p)}>অনুমোদন</Button>
                        {tab === "pending" && <Button size="sm" variant="outline" onClick={() => reject(p)}>বাতিল</Button>}
                      </>
                    ) : (
                      <>
                        <Badge>চালু</Badge>
                        <Button size="sm" variant="outline" onClick={() => update(p, { status: "pending" }, "আবার অপেক্ষমাণে পাঠানো হয়েছে")}>সরিয়ে নিন</Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function ThresholdCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["managed-ads-settings"],
    queryFn: async () => (await db.from("managed_ads_settings").select("*").eq("id", 1).maybeSingle()).data,
  });
  const [pause, setPause] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const save = async () => {
    const p = Number(pause ?? data?.pause_threshold), a = Number(alert ?? data?.low_balance_alert);
    if (!(p >= 0) || !(a >= p)) return toast.error("সতর্কবার্তার পরিমাণ বন্ধের পরিমাণের সমান বা বেশি হতে হবে");
    const { error } = await db.from("managed_ads_settings").update({ pause_threshold: p, low_balance_alert: a, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("সেভ হয়েছে");
    qc.invalidateQueries({ queryKey: ["managed-ads-settings"] });
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Wallet সুরক্ষা</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3 text-sm">
        <div><p className="text-xs text-muted-foreground mb-1">এই ব্যালেন্সে ad বন্ধ হবে ($)</p>
          <Input className="w-32" type="number" value={pause ?? data?.pause_threshold ?? ""} onChange={(e) => setPause(e.target.value)} /></div>
        <div><p className="text-xs text-muted-foreground mb-1">সতর্কবার্তা দেখাবে ($)</p>
          <Input className="w-32" type="number" value={alert ?? data?.low_balance_alert ?? ""} onChange={(e) => setAlert(e.target.value)} /></div>
        <Button size="sm" onClick={save}>সেভ</Button>
        <p className="w-full text-xs text-muted-foreground">প্রতি ১৫ মিনিটে Meta-র খরচ client wallet থেকে কাটা হয়; ব্যালেন্স এই সীমায় নামলে সেই client-এর সব campaign বন্ধ হয়।</p>
      </CardContent>
    </Card>
  );
}


function SharedAccountAssign({ accounts }: { accounts: any[] }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [client, setClient] = useState("");
  const [acc, setAcc] = useState("");
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["managed-assignments"],
    queryFn: async () => {
      const [{ data: rows }, { data: clients }] = await Promise.all([
        db.from("managed_account_assignments").select("*").order("assigned_at", { ascending: false }),
        db.from("profiles").select("user_id, full_name, email").order("full_name").limit(2000),
      ]);
      return { rows: rows ?? [], clients: clients ?? [] };
    },
  });
  const cMap = new Map((data?.clients ?? []).map((c: any) => [c.user_id, c]));
  const aMap = new Map(accounts.map((a: any) => [a.id, a]));
  const filtered = (data?.clients ?? []).filter((c: any) => !q.trim() || [c.full_name, c.email].some((v: string) => v?.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 50);

  const assign = async () => {
    if (!client || !acc) return toast.error("Client ও ad account দুটোই বাছুন");
    const { error } = await db.from("managed_account_assignments").insert({ user_id: client, ad_account_id: acc, assigned_by: user?.id });
    if (error) return toast.error(error.code === "23505" ? "এই account আগেই এই client-কে দেওয়া আছে" : error.message);
    await db.from("profiles").update({ managed_ads_enabled: true }).eq("user_id", client);
    toast.success("Shared ad account দেওয়া হয়েছে — client এখন My Ads থেকে চালাতে পারবে");
    setAcc("");
    qc.invalidateQueries({ queryKey: ["managed-assignments"] });
  };
  const remove = async (id: string) => {
    if (!window.confirm("এই client-এর কাছ থেকে account সরিয়ে নেবেন?")) return;
    const { error } = await db.from("managed_account_assignments").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["managed-assignments"] });
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Client-কে shared ad account দিন</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <Input placeholder="Client খুঁজুন (নাম/ইমেইল)" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger><SelectValue placeholder="Client বাছুন" /></SelectTrigger>
              <SelectContent>{filtered.map((c: any) => <SelectItem key={c.user_id} value={c.user_id}>{c.full_name || c.email} — {c.email}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Select value={acc} onValueChange={setAcc}>
            <SelectTrigger className="md:mt-[42px]"><SelectValue placeholder="Shared ad account বাছুন" /></SelectTrigger>
            <SelectContent>{accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.account_name} ({a.account_id})</SelectItem>)}</SelectContent>
          </Select>
          <Button className="md:mt-[42px]" onClick={assign}>দিন</Button>
        </div>
        <div className="space-y-2">
          {(data?.rows ?? []).length === 0 && <p className="text-sm text-muted-foreground">এখনো কাউকে shared account দেওয়া হয়নি।</p>}
          {(data?.rows ?? []).map((r: any) => {
            const c: any = cMap.get(r.user_id); const a: any = aMap.get(r.ad_account_id);
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div className="min-w-0"><p className="font-medium truncate">{c?.full_name || c?.email || r.user_id}</p><p className="text-xs text-muted-foreground truncate">{a ? `${a.account_name} (${a.account_id})` : r.ad_account_id}</p></div>
                <Button size="sm" variant="outline" onClick={() => remove(r.id)}>সরিয়ে নিন</Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
