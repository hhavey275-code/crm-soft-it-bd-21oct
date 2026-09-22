import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function GlobalRateControl() {
  const qc = useQueryClient();
  const [adjust, setAdjust] = useState<string>("1");
  const [absolute, setAbsolute] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [newClientRate, setNewClientRate] = useState<string>("");

  const { data: defaultRate = 0, refetch: refetchDefaultRate } = useQuery({
    queryKey: ["default-client-usd-rate"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "usd_rate")
        .maybeSingle();
      if (error) throw error;
      return Number(data?.value ?? 0) || 0;
    },
  });

  const saveDefaultRate = async () => {
    const v = Number(newClientRate);
    if (!v || v <= 0) {
      toast.error("সঠিক rate দিন");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "usd_rate", value: String(v) }, { onConflict: "key" });
      if (error) throw error;
      toast.success(`নতুন client-দের default rate এখন ${v} ৳`);
      setNewClientRate("");
      await refetchDefaultRate();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save rate");
    } finally {
      setBusy(false);
    }
  };

  const { data: delta = 0, isLoading, refetch } = useQuery({
    queryKey: ["global-rate-delta"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "global_rate_delta")
        .maybeSingle();
      if (error) throw error;
      return Number(data?.value ?? 0) || 0;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["global-rate-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("default_usd_rate")
        .not("default_usd_rate", "is", null);
      if (error) throw error;
      const rates = (data || []).map((r: any) => Number(r.default_usd_rate)).filter((n) => !isNaN(n));
      if (!rates.length) return { count: 0, min: 0, max: 0 };
      return { count: rates.length, min: Math.min(...rates), max: Math.max(...rates) };
    },
  });

  const apply = async (newDelta: number) => {
    const clamped = Math.max(0, newDelta);
    if (clamped === delta) {
      toast.info("Delta unchanged");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("apply_global_rate_delta", {
        p_new_delta: clamped,
      });
      if (error) throw error;
      const result = data as any;
      toast.success(
        `Rate delta: ${result.old_delta} → ${result.new_delta} taka · ${result.updated_rows} clients updated`
      );
      await refetch();
      qc.invalidateQueries({ queryKey: ["admin-clients"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to update rate");
    } finally {
      setBusy(false);
    }
  };

  const step = Number(adjust) || 0;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Global USD Rate Adjustment</span>
            <Badge variant="outline" className="text-xs">
              Current delta: +{isLoading ? "…" : delta} ৳
            </Badge>
            {stats && stats.count > 0 && (
              <Badge variant="secondary" className="text-xs">
                {stats.count} clients · default {stats.min}–{stats.max} ৳
              </Badge>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={busy}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Every client's rate = <b>their default</b> + delta. Delta cannot go below 0
          (no client ever drops below their onboarding rate).
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.1"
              value={adjust}
              onChange={(e) => setAdjust(e.target.value)}
              className="w-24 h-9"
              placeholder="Amount"
            />
            <Button
              size="sm"
              onClick={() => apply(delta + step)}
              disabled={busy || !step}
              className="gap-1"
            >
              <TrendingUp className="h-3 w-3" /> +{step} ৳
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => apply(delta - step)}
              disabled={busy || !step || delta <= 0}
              className="gap-1"
            >
              <TrendingDown className="h-3 w-3" /> −{step} ৳
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.1"
              min="0"
              value={absolute}
              onChange={(e) => setAbsolute(e.target.value)}
              className="w-28 h-9"
              placeholder="Set delta"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const v = Number(absolute);
                if (isNaN(v)) return toast.error("Invalid number");
                apply(v);
              }}
              disabled={busy || absolute === ""}
            >
              Set
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => apply(0)}
              disabled={busy || delta === 0}
            >
              Reset to 0
            </Button>
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">New Client Default Rate</span>
            <Badge variant="outline" className="text-xs">
              Current: {defaultRate || "—"} ৳
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            নতুন কোনো client onboard হলে (signup বা Google sign-in) এই rate-ই তার dashboard-এ দেখাবে।
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.1"
              min="0"
              value={newClientRate}
              onChange={(e) => setNewClientRate(e.target.value)}
              className="w-28 h-9"
              placeholder={String(defaultRate || 140)}
            />
            <Button size="sm" onClick={saveDefaultRate} disabled={busy || newClientRate === ""}>
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}