import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { managedAds } from "@/lib/managedAdsApi";

type Level = "campaign" | "adset" | "ad";

export function EditObjectDialog({ level, obj, adAccountDbId, onClose, onSaved }: {
  level: Level; obj: any | null; adAccountDbId?: string; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [countries, setCountries] = useState("");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [message, setMessage] = useState("");
  const [headline, setHeadline] = useState("");
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);

  const budgetType: "daily" | "lifetime" | null = obj?.lifetime_budget ? "lifetime" : obj?.daily_budget ? "daily" : null;

  useEffect(() => {
    if (!obj) return;
    setName(obj.name ?? "");
    setAmount(budgetType ? (Number(obj[`${budgetType}_budget`]) / 100).toFixed(2) : "");
    setCountries((obj.targeting?.geo_locations?.countries ?? []).join(", "));
    setAgeMin(obj.targeting?.age_min ? String(obj.targeting.age_min) : "");
    setAgeMax(obj.targeting?.age_max ? String(obj.targeting.age_max) : "");
    setMessage(""); setHeadline(""); setLink("");
  }, [obj, budgetType]);

  const save = async () => {
    const body: Record<string, unknown> = { action: "update", level, objectId: String(obj.id), adAccountDbId };
    if (name.trim() && name !== obj.name) body.name = name.trim();
    if (budgetType && amount && Number(amount) > 0) { body.budgetType = budgetType; body.amount = Number(amount); }
    if (level === "adset") {
      const cs = countries.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter((c) => c.length === 2);
      if (cs.length) body.countries = cs;
      if (ageMin) body.ageMin = Number(ageMin);
      if (ageMax) body.ageMax = Number(ageMax);
    }
    if (level === "ad") {
      if (message) body.message = message;
      if (headline) body.headline = headline;
      if (link) body.link = link;
    }
    setSaving(true);
    try { await managedAds(body); toast.success("আপডেট হয়েছে"); onSaved(); onClose(); }
    catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const title = level === "campaign" ? "Edit campaign" : level === "adset" ? "Edit ad set" : "Edit ad";
  return (
    <Dialog open={!!obj} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          {level !== "ad" && budgetType && (
            <div><Label>{budgetType === "daily" ? "Daily" : "Lifetime"} budget ($)</Label>
              <Input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          )}
          {level !== "ad" && !budgetType && <p className="text-xs text-muted-foreground">এর budget {level === "campaign" ? "ad set-এ" : "campaign-এ"} সেট করা আছে।</p>}
          {level === "adset" && (
            <>
              <div><Label>Countries (যেমন: BD, IN)</Label><Input value={countries} onChange={(e) => setCountries(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Age min</Label><Input type="number" min="18" max="65" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} /></div>
                <div><Label>Age max</Label><Input type="number" min="18" max="65" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} /></div>
              </div>
            </>
          )}
          {level === "ad" && (
            <>
              <p className="text-xs text-muted-foreground">যেটা বদলাতে চান শুধু সেটা লিখুন, বাকিগুলো খালি রাখুন।</p>
              <div><Label>Primary text</Label><Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
              <div><Label>Headline</Label><Input value={headline} onChange={(e) => setHeadline(e.target.value)} /></div>
              <div><Label>Website URL</Label><Input placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} /></div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Publish changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
