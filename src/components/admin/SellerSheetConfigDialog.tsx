import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, FileSpreadsheet, ExternalLink } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sellerId: string;
  sellerName: string;
}

const MAPPING_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "col_datetime", label: "Date & Time", hint: "e.g. B" },
  { key: "col_payment_bdt", label: "Payment (BDT in)", hint: "e.g. C" },
  { key: "col_withdraw", label: "Withdraw (BDT out)", hint: "alada column thakle" },
  { key: "col_payo_usd", label: "Dollar (Payo / USDT given)", hint: "e.g. D" },
  { key: "col_payo_rate", label: "Rate (Payo)", hint: "e.g. E" },
  { key: "col_payo_bdt", label: "Converted BDT (Payo)", hint: "e.g. F" },
  { key: "col_wise_usd", label: "Dollar (Wise / ACH) — optional" },
  { key: "col_wise_rate", label: "Rate (Wise) — optional" },
  { key: "col_wise_bdt", label: "Converted BDT (Wise) — optional" },
  { key: "col_total", label: "Total — optional (formula thakle blank)" },
  { key: "col_due_adv", label: "Due/Adv — optional" },
  { key: "col_description", label: "Description / Ref — optional" },
  { key: "col_proof_url", label: "Proof URL — optional" },
  { key: "col_txn_id", label: "Hidden Txn ID (dedupe) — optional" },
];


function extractSpreadsheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : input.trim();
}

export function SellerSheetConfigDialog({ open, onOpenChange, sellerId, sellerName }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>({
    spreadsheet_url: "",
    tab_pattern: "{MMMM-YYYY}",
    template_tab: "",
    header_row: 1,
    data_start_row: 7,
    enabled: true,
  });
  const [testing, setTesting] = useState(false);

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["seller-sheet-config", sellerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("seller_sheet_config")
        .select("*")
        .eq("seller_id", sellerId)
        .maybeSingle();
      return data;
    },
    enabled: open,
  });

  useEffect(() => {
    if (cfg) setForm({ ...cfg, spreadsheet_url: cfg.spreadsheet_url || "" });
  }, [cfg]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const spreadsheet_id = extractSpreadsheetId(form.spreadsheet_url || "");
      if (!spreadsheet_id) throw new Error("Spreadsheet URL or ID dorkar");
      const payload = {
        seller_id: sellerId,
        spreadsheet_id,
        spreadsheet_url: form.spreadsheet_url,
        tab_pattern: form.tab_pattern || "{MMMM-YYYY}",
        template_tab: form.template_tab || null,
        header_row: Number(form.header_row) || 1,
        data_start_row: Number(form.data_start_row) || 7,
        opening_balance_cell: form.opening_balance_cell || null,
        enabled: !!form.enabled,
        col_datetime: form.col_datetime || null,
        col_payment_bdt: form.col_payment_bdt || null,
        col_withdraw: form.col_withdraw || null,
        col_payo_usd: form.col_payo_usd || null,
        col_payo_rate: form.col_payo_rate || null,
        col_payo_bdt: form.col_payo_bdt || null,
        col_wise_usd: form.col_wise_usd || null,
        col_wise_rate: form.col_wise_rate || null,
        col_wise_bdt: form.col_wise_bdt || null,
        col_total: form.col_total || null,
        col_due_adv: form.col_due_adv || null,
        col_description: form.col_description || null,
        col_proof_url: form.col_proof_url || null,
        col_txn_id: form.col_txn_id || null,
      };
      const { error } = await supabase
        .from("seller_sheet_config")
        .upsert(payload, { onConflict: "seller_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sheet config saved");
      qc.invalidateQueries({ queryKey: ["seller-sheet-config", sellerId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || "Save failed"),
  });

  const testSync = async () => {
    setTesting(true);
    try {
      // Find latest approved seller_transaction for this seller
      const { data: txn } = await supabase
        .from("seller_transactions")
        .select("id")
        .eq("seller_id", sellerId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!txn) {
        toast.error("Test korar moto kono approved transaction nai");
        return;
      }
      const { data, error } = await supabase.functions.invoke("sync-seller-to-sheet", {
        body: { seller_transaction_id: txn.id, dry_run: true },
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error || "Test failed");
      toast.success(
        `Test OK — Tab: ${(data as any).targetTab}, Row: ${(data as any).rowNumber}, Cells: ${(data as any).cells?.length || 0}`,
      );
    } catch (e: any) {
      toast.error(e?.message || "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const [backfilling, setBackfilling] = useState(false);
  const [recreateTabs, setRecreateTabs] = useState(false);
  const [backfillMonths, setBackfillMonths] = useState(() => {
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevS = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    return `${prevS},${cur}`;
  });

  const runBackfill = async () => {
    if (!sellerId) return;
    const months = backfillMonths
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}$/.test(s));
    if (months.length === 0) {
      toast.error("Months format: YYYY-MM (comma separated). E.g. 2026-04,2026-05");
      return;
    }
    setBackfilling(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-seller-to-sheet", {
        body: { backfill: true, seller_id: sellerId, months, recreate: recreateTabs },
      });
      if (error) throw error;
      const d = data as any;
      if (!d?.ok) throw new Error(d?.error || "Backfill failed");
      const tabSummary = (d.tabs || [])
        .map((t: any) => `${t.tab}: +${t.rows_written}`)
        .join(", ");
      toast.success(
        `Backfill done — total ${d.total_in_months}, already ${d.already_synced}, written ${d.processed}. ${tabSummary}`,
      );
    } catch (e: any) {
      toast.error(e?.message || "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  };

  const [obSetting, setObSetting] = useState(false);
  const [obMonth, setObMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [obValue, setObValue] = useState("");

  const setOpeningBalance = async (auto = false) => {
    if (!sellerId) return;
    if (!/^\d{4}-\d{2}$/.test(obMonth)) {
      toast.error("Month format: YYYY-MM");
      return;
    }
    if (!auto && (obValue === "" || isNaN(Number(obValue)))) {
      toast.error("Opening balance number diye den (or use Auto)");
      return;
    }
    if (!form.opening_balance_cell) {
      toast.error("Age 'Opening balance cell' (e.g. I6) set kore Save korun");
      return;
    }
    setObSetting(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-seller-to-sheet", {
        body: {
          seller_id: sellerId,
          set_opening_balance: { month: obMonth, value: auto ? undefined : Number(obValue) },
        },
      });
      if (error) throw error;
      const d = data as any;
      if (!d?.ok) throw new Error(d?.error || "Set failed");
      toast.success(`Opening balance set — ${d.tab} ${d.cell} = ${d.value}${d.auto ? " (auto)" : ""}`);
    } catch (e: any) {
      toast.error(e?.message || "Set failed");
    } finally {
      setObSetting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Google Sheet Sync — {sellerName}
          </DialogTitle>
          <DialogDescription>
            Per-seller sheet config. Apni column letter (A, B, C…) bolben — kon field kon column e jabe.
            Notun month e tab auto create hobe (template tab thakle clone, nahole blank).
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label>Spreadsheet URL or ID</Label>
                <Input
                  value={form.spreadsheet_url || ""}
                  onChange={(e) => setForm({ ...form, spreadsheet_url: e.target.value })}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
                {form.spreadsheet_url && (
                  <a
                    href={form.spreadsheet_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary inline-flex items-center gap-1 mt-1"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label>Tab name pattern</Label>
                  <Input
                    value={form.tab_pattern || ""}
                    onChange={(e) => setForm({ ...form, tab_pattern: e.target.value })}
                    placeholder="{MMMM-YYYY}"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {`{MMMM} {MMM} {MM} {YYYY} {YY}`}
                  </p>
                </div>
                <div>
                  <Label>Template tab (clone source)</Label>
                  <Input
                    value={form.template_tab || ""}
                    onChange={(e) => setForm({ ...form, template_tab: e.target.value })}
                    placeholder="e.g. April-2026"
                  />
                </div>
                <div>
                  <Label>Header row</Label>
                  <Input
                    type="number"
                    value={form.header_row || 1}
                    onChange={(e) => setForm({ ...form, header_row: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Data start row</Label>
                  <Input
                    type="number"
                    value={form.data_start_row || 7}
                    onChange={(e) => setForm({ ...form, data_start_row: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Opening balance cell</Label>
                  <Input
                    value={form.opening_balance_cell || ""}
                    onChange={(e) =>
                      setForm({ ...form, opening_balance_cell: e.target.value.toUpperCase() })
                    }
                    placeholder="e.g. I6"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Template e opening balance jaiga (cell ref)
                  </p>
                </div>
              </div>


              <div className="flex items-center gap-3 pt-2">
                <Switch
                  checked={!!form.enabled}
                  onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                />
                <Label className="cursor-pointer">Enable sync</Label>
              </div>
            </div>

            <div className="border-t pt-3">
              <h4 className="font-semibold mb-2">Column mapping</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Column letter dao (A, B, C, … AA). Khali rakhle oi field sync hobe na.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {MAPPING_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <Label className="flex-1 text-sm">{f.label}</Label>
                    <Input
                      className="w-24 uppercase"
                      value={form[f.key] || ""}
                      onChange={(e) =>
                        setForm({ ...form, [f.key]: e.target.value.toUpperCase() })
                      }
                      placeholder={f.hint || "—"}
                      maxLength={3}
                    />
                  </div>
                ))}
                <div className="flex items-center gap-2 md:col-span-2 bg-muted/40 p-2 rounded">
                  <Label className="flex-1 text-sm font-medium">
                    Opening balance cell
                    <span className="block text-[10px] text-muted-foreground font-normal">
                      Cell ref (e.g. I6) — month er shurute opening balance ekhane boshbe
                    </span>
                  </Label>
                  <Input
                    className="w-28 uppercase"
                    value={form.opening_balance_cell || ""}
                    onChange={(e) =>
                      setForm({ ...form, opening_balance_cell: e.target.value.toUpperCase() })
                    }
                    placeholder="I6"
                    maxLength={6}
                  />
                </div>
              </div>
            </div>


            {cfg?.last_synced_at && (
              <div className="text-xs text-muted-foreground border-t pt-2">
                Last synced: {new Date(cfg.last_synced_at).toLocaleString()}
                {cfg.last_error && (
                  <div className="text-destructive mt-1">Last error: {cfg.last_error}</div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="border-t pt-4 mt-2 space-y-2">
          <Label className="text-sm">Backfill months (YYYY-MM, comma separated)</Label>
          <div className="flex gap-2">
            <Input
              value={backfillMonths}
              onChange={(e) => setBackfillMonths(e.target.value)}
              placeholder="2026-04,2026-05"
              className="flex-1"
            />
            <Button
              variant="secondary"
              onClick={runBackfill}
              disabled={backfilling || !cfg?.id}
              title={!cfg?.id ? "Save config first" : ""}
            >
              {backfilling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Backfill now
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={recreateTabs}
              onCheckedChange={setRecreateTabs}
              id="recreate-tabs"
            />
            <Label htmlFor="recreate-tabs" className="text-xs cursor-pointer">
              Recreate tabs from template (existing month tab delete kore template theke abar clone hobe)
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Already-synced txns skip hobe. Tab missing thakle auto create hobe (template clone kore).
          </p>
        </div>

        <div className="border-t pt-4 mt-2 space-y-2">
          <Label className="text-sm">Opening balance (month er shurute boshbe)</Label>
          <div className="flex gap-2">
            <Input
              value={obMonth}
              onChange={(e) => setObMonth(e.target.value)}
              placeholder="2026-05"
              className="w-32"
            />
            <Input
              type="number"
              value={obValue}
              onChange={(e) => setObValue(e.target.value)}
              placeholder="manual amount (optional)"
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={() => setOpeningBalance(true)}
              disabled={obSetting || !cfg?.id || !form.opening_balance_cell}
              title="Auto = previous month closing balance theke calculate kore boshabe"
            >
              {obSetting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Auto
            </Button>
            <Button
              variant="secondary"
              onClick={() => setOpeningBalance(false)}
              disabled={obSetting || !cfg?.id || !form.opening_balance_cell}
              title={!form.opening_balance_cell ? "Opening balance cell set kore Save korun" : ""}
            >
              {obSetting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Set manual
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Opening balance cell ({form.opening_balance_cell || "set korun"}) e value boshbe.
            Backfill chalalei prottek month er jonno auto opening balance system theke boshe jabe.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={testSync} disabled={testing || !form.spreadsheet_url}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Test sync (dry run)
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
