import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const db = supabase as any;

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pending: { label: "অপেক্ষমাণ", variant: "secondary" },
  approved: { label: "চালু", variant: "default" },
  rejected: { label: "বাতিল", variant: "destructive" },
};

export default function MyPagesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [pageUrl, setPageUrl] = useState("");
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: pages = [] } = useQuery({
    queryKey: ["my-fb-pages", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db.from("client_facebook_pages").select("*").eq("user_id", user!.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const submit = async () => {
    const id = pageId.trim();
    if (!/^\d{5,25}$/.test(id)) return toast.error("সঠিক Page ID দিন (শুধু সংখ্যা)");
    if (!pageName.trim()) return toast.error("Page-এর নাম দিন");
    setSaving(true);
    const { error } = await db.from("client_facebook_pages").insert({
      user_id: user!.id, page_id: id, page_name: pageName.trim(), page_url: pageUrl.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.code === "23505" ? "এই page আগেই যুক্ত আছে" : error.message);
    toast.success("Page জমা হয়েছে — admin অনুমোদন দিলে চালু হবে");
    setPageId(""); setPageName(""); setPageUrl("");
    qc.invalidateQueries({ queryKey: ["my-fb-pages"] });
  };

  const remove = async (id: string) => {
    const { error } = await db.from("client_facebook_pages").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["my-fb-pages"] });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold">আমার Facebook Page</h1>
          <p className="text-sm text-muted-foreground">যে page-এ ad চালাতে চান সেটি যুক্ত করুন। অনুমোদনের পর আমাদের app থেকেই ad চালাতে পারবেন।</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">নতুন Page যুক্ত করুন</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <p className="font-medium">আগে যা করবেন:</p>
              <p>১. Facebook page → Settings → Page access / Business access-এ যান।</p>
              <p>২. আমাদের Business Manager-কে <b>Advertiser</b> access দিন।</p>
              <p>৩. নিচে page-এর তথ্য দিয়ে জমা দিন।</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Page-এর নাম</Label><Input value={pageName} onChange={(e) => setPageName(e.target.value)} placeholder="যেমন: Fashion BD" /></div>
              <div><Label>Page ID</Label><Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="যেমন: 1029384756" inputMode="numeric" /></div>
            </div>
            <div><Label>Page link (ঐচ্ছিক)</Label><Input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://facebook.com/..." /></div>
            <Button onClick={submit} disabled={saving}>{saving ? "জমা হচ্ছে..." : "জমা দিন"}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">যুক্ত Page সমূহ</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {pages.length === 0 && <p className="text-sm text-muted-foreground">এখনো কোনো page যুক্ত করা হয়নি।</p>}
            {pages.map((p) => {
              const s = STATUS[p.status] ?? STATUS.pending;
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.page_name}</p>
                    <p className="text-xs text-muted-foreground">ID: {p.page_id}</p>
                    {p.admin_note && <p className="text-xs text-muted-foreground mt-1">নোট: {p.admin_note}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={s.variant}>{s.label}</Badge>
                    {p.status === "pending" && <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>মুছুন</Button>}
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
