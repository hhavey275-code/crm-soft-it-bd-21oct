import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Link2 } from "lucide-react";

/** One click: rename every external-CRM ad account to "SIBD". Links stay exactly as they are. */
export function SibdUnifyButton() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!window.confirm("সব external CRM account-এর নাম SIBD করে দেব? লিংকগুলো অপরিবর্তিত থাকবে।")) return;
    setBusy(true);
    const { data, error } = await (supabase as any)
      .from("ad_accounts")
      .update({ external_crm_name: "SIBD" })
      .eq("external_topup_required", true)
      .select("id");
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${data?.length ?? 0}টা account-এর নাম SIBD হয়েছে`);
    void qc.invalidateQueries({ queryKey: ["external-crm-names"] });
    void qc.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 font-semibold whitespace-nowrap">
          <Link2 className="h-4 w-4" /> সব CRM → SIBD
        </div>
        <p className="flex-1 text-xs text-muted-foreground">
          সব external CRM account-এর নাম SIBD হবে — লিংক যেখানে ছিল সেখানেই থাকবে।
        </p>
        <Button onClick={run} disabled={busy}>{busy ? "Saving..." : "সব SIBD করো"}</Button>
      </CardContent>
    </Card>
  );
}
