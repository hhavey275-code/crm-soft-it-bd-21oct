import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Link2 } from "lucide-react";

/** One click: every external-CRM ad account → name "SIBD" + one shared link (main, secondary, credit line). */
export function SibdUnifyButton() {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const link = url.trim();
    if (!/^https?:\/\//i.test(link)) return toast.error("সঠিক link দিন (https://...)");
    if (!window.confirm("সব external CRM account-এর নাম SIBD এবং link এই একটাই করে দেব?")) return;
    setBusy(true);
    const { data, error } = await (supabase as any)
      .from("ad_accounts")
      .update({
        external_crm_name: "SIBD",
        external_topup_url: link,
        external_topup_url_secondary: link,
        external_topup_url_credit_line: link,
      })
      .eq("external_topup_required", true)
      .select("id");
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${data?.length ?? 0}টা account SIBD-তে সেট হয়েছে`);
    void qc.invalidateQueries({ queryKey: ["external-crm-names"] });
    void qc.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 font-semibold whitespace-nowrap">
          <Link2 className="h-4 w-4" /> সব CRM → SIBD
        </div>
        <Input className="flex-1" placeholder="SIBD CRM link (https://...)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button onClick={run} disabled={busy}>{busy ? "Saving..." : "সব SIBD করো"}</Button>
      </CardContent>
    </Card>
  );
}
