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
import { checkBmAdAccountCapacity, createBmAdAccounts } from "@/lib/bmAdAccounts.functions";

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
      const res = await checkBmAdAccountCapacity({ data: { bmId: bm.id } });
      setInfo({ ownedCount: res.ownedCount, verificationStatus: res.verificationStatus });
    } catch (e: any) {
      toast.error(e?.message ?? "Check failed");
    } finally {
      setChecking(false);
    }
  };

  const create = async () => {
    if (!bm) return;
    setCreating(true);
    try {
      const res = await createBmAdAccounts({
        data: {
          bmId: bm.id,
          count: Number(count) || 1,
          namePrefix: prefix,
          startIndex: Number(startIndex) || 1,
          currency,
          timezoneId: Number(timezoneId),
        },
      });

      if (res.createdCount > 0) toast.success(`${res.createdCount} ad account তৈরি হয়েছে`);
      if (res.failed.length) {
        const last = res.failed[res.failed.length - 1];
        toast.error(res.stoppedByLimit ? `BM-এর creation limit শেষ: ${last.error}` : last.error, {
          duration: 9000,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-business-managers"] });
      if (res.createdCount > 0 && !res.failed.length) onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Create failed");
    } finally {
      setCreating(false);
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">কতগুলো (max 20)</Label>
              <Input type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} />
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
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
