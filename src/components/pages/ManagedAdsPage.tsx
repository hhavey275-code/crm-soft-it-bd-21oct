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
        ? await db.from("profiles").select("user_id, full_name, email, business_name").in("user_id", userIds)
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
    return [p.page_name, p.page_id, pr?.full_name, pr?.email, pr?.business_name].some((v) => v?.toLowerCase?.().includes(q));
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
          <p className="text-sm text-muted-foreground">Client-দের Facebook page shared ad account-এ assign ও অনুমোদন করুন।</p>
        </div>

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
                    <p className="text-xs text-muted-foreground truncate">{pr?.business_name} {pr?.email ? `· ${pr.email}` : ""}</p>
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
