import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, PlusCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bm: { id: string; name: string } | null;
}

const TIMEZONES = [
  { id: 1, label: "America/Los_Angeles" },
  { id: 6, label: "America/New_York" },
  { id: 79, label: "Asia/Dhaka" },
  { id: 90, label: "Asia/Karachi" },
  { id: 75, label: "Asia/Kolkata" },
  { id: 68, label: "Asia/Dubai" },
  { id: 49, label: "Europe/London" },
];

const CURRENCIES = ["USD", "EUR", "GBP", "BDT", "INR", "AED"];

export function CreateAdAccountsDialog({ open, onOpenChange, bm }: Props) {
  const queryClient = useQueryClient();
  const [count, setCount] = useState("1");
  const [prefix, setPrefix] = useState("");
  const [startIndex, setStartIndex] = useState("1");
  const [currency, setCurrency] = useState("USD");
  const [timezoneId, setTimezoneId] = useState("1");
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<{ ownedCount: number | null; verificationStatus: string | null } | null>(null);

  const callAccountApi = async (payload: Record<string, unknown>) => {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Login session শেষ—আবার login করুন");
    const response = await fetch("/api/public/bm-ad-accounts", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`Server API-এর বদলে webpage দিয়েছে (HTTP ${response.status})`);
    }
    if (!response.ok || !result?.ok) throw new Error(result?.error || `Server error (HTTP ${response.status})`);
    return result;
  };

  useEffect(() => {
    if (open && bm) {
      setPrefix(bm.name);
      setCount("1");
      setStartIndex("1");
      setInfo(null);
    }
  }, [open, bm]);

  const checkBm = async () => {
    if (!bm) return;
    setChecking(true);
    try {
      const res = await callAccountApi({ action: "check", bmId: bm.id });
      setInfo({ ownedCount: res.ownedCount, verificationStatus: res.verificationStatus });
    } catch (e: any) {
      toast.error(e?.message ?? "Check failed");
    } finally {
      setChecking(false);
    }
  };

  const [progress, setProgress] = useState<string | null>(null);

  const create = async () => {
    if (!bm) return;
    setCreating(true);
    const total = Math.min(Math.max(Number(count) || 1, 1), 2500);
    const start = Number(startIndex) || 1;
    let done = 0;
    let createdCount = 0;
    let lastError: string | null = null;
    let stoppedByLimit = false;
    try {
      while (done < total) {
        const batch = Math.min(10, total - done);
        setProgress(`${done}/${total}`);
        const res: any = await callAccountApi({
          action: "create",
          bmId: bm.id,
          count: batch,
          namePrefix: total === 1 ? prefix : `${prefix}`,
          startIndex: start + done,
          currency,
          timezoneId: Number(timezoneId),
          ...(total > 1 ? { forceNumbered: true } : {}),
        });
        if (!res || !Array.isArray(res.failed)) {
          throw new Error(
            "Server থেকে সঠিক উত্তর আসেনি। লগইন আবার করে preview/published link থেকে চেষ্টা করুন।",
          );
        }
        createdCount += res.createdCount ?? 0;
        if (res.failed.length) lastError = res.failed[res.failed.length - 1].error;
        done += batch;
        if (res.stoppedByLimit) {
          stoppedByLimit = true;
          break;
        }
        if ((res.createdCount ?? 0) === 0) break; // every one failed — stop
      }
      if (createdCount > 0) toast.success(`${createdCount} ad account তৈরি হয়েছে`);
      if (lastError) {
        toast.error(stoppedByLimit ? `BM-এর creation limit শেষ: ${lastError}` : lastError, { duration: 9000 });
      }
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-business-managers"] });
      if (createdCount > 0 && !lastError) onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Create failed");
    } finally {
      setCreating(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Ad Accounts — {bm?.name}</DialogTitle>
          <DialogDescription>
            Meta Graph API দিয়ে এই BM-এ একসাথে নতুন ad account তৈরি হবে। BM-এর creation limit শেষ
            হলে সেখানেই থেমে যাবে।
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-2 text-xs">
            <div>
              {info ? (
                <span>
                  Owned: <b>{info.ownedCount ?? "—"}</b> · Verification:{" "}
                  <b>{info.verificationStatus ?? "—"}</b>
                </span>
              ) : (
                <span className="text-muted-foreground">BM status দেখতে Check চাপুন</span>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={checkBm} disabled={checking}>
              {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              <span className="ml-1">Check</span>
            </Button>
          </div>

          {info?.verificationStatus && !/verified/i.test(info.verificationStatus) && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              এই BM এখনো verified না — Meta সম্ভবত নতুন ad account তৈরি করতে দেবে না। আগে
              Business verification complete করুন।
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">কতগুলো (limit পর্যন্ত)</Label>
              <Input type="number" min={1} max={2500} value={count} onChange={(e) => setCount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Start number</Label>
              <Input type="number" min={1} value={startIndex} onChange={(e) => setStartIndex(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Name prefix</Label>
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Account name" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              নাম হবে: {prefix || "Prefix"} {startIndex || 1}, {prefix || "Prefix"}{" "}
              {(Number(startIndex) || 1) + 1} …
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Timezone</Label>
              <Select value={timezoneId} onValueChange={setTimezoneId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={creating || !prefix.trim()}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
            {progress ? `Creating ${progress}` : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
