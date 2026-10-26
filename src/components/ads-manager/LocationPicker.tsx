import { useEffect, useState } from "react";
import { MapPin, X, Loader2 } from "lucide-react";
import { managedAds } from "@/lib/managedAdsApi";

/** Locations are stored as "BD" (country), "r:<key>:<name>" (region/division) or "c:<key>:<name>" (city). */
export function locationLabel(v: string): { name: string; kind: string } {
  if (/^[A-Z]{2}$/.test(v)) {
    let name = v;
    try { name = new Intl.DisplayNames(["en"], { type: "region" }).of(v) ?? v; } catch { /* keep code */ }
    return { name, kind: "Country" };
  }
  const [t, , ...rest] = v.split(":");
  return { name: rest.join(":") || v, kind: t === "r" ? "Region" : "City" };
}

type Hit = { key: string; name: string; type: string; country_code?: string; country_name?: string; region?: string };

export function LocationPicker({ value, onChange, pageDbId, accId }: { value: string[]; onChange: (v: string[]) => void; pageDbId: string; accId: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2 || !pageDbId || !accId) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await managedAds<{ locations: Hit[] }>({ action: "geo_search", pageDbId, adAccountDbId: accId, q: q.trim() });
        if (live) setHits(r.locations);
      } catch { if (live) setHits([]); } finally { if (live) setBusy(false); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [q, pageDbId, accId]);

  const add = (h: Hit) => {
    const code = h.type === "country" ? (h.country_code || h.key) : `${h.type === "region" ? "r" : "c"}:${h.key}:${h.name}${h.region && h.type === "city" ? `, ${h.region}` : ""}`;
    if (!value.includes(code)) onChange([...value, code]);
    setQ(""); setHits([]);
  };

  const mapQ = value.map((v) => locationLabel(v).name).join(" ") || "Bangladesh";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 rounded-md border border-fb-border p-2">
        {value.map((c) => {
          const l = locationLabel(c);
          return (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-fb-blue-soft px-2.5 py-0.5 text-[12px] text-fb-blue">
              <MapPin className="h-3 w-3" />{l.name} <span className="text-fb-muted">· {l.kind}</span>
              <X className="h-3 w-3 cursor-pointer" onClick={() => onChange(value.filter((x) => x !== c))} />
            </span>
          );
        })}
      </div>
      <div className="relative">
        <input className="h-9 w-full rounded-md border border-fb-border bg-background px-3 text-[13px] outline-none" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="দেশ, বিভাগ বা শহরের নাম লিখুন (যেমন Bangladesh, Dhaka, Chattogram)" />
        {busy && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-fb-muted" />}
        {hits.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-fb-border bg-background shadow-lg">
            {hits.map((h) => (
              <button key={`${h.type}-${h.key}`} type="button" onClick={() => add(h)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-fb-bg">
                <span><span className="font-semibold">{h.name}</span>{h.type !== "country" && <span className="text-fb-muted"> — {[h.region, h.country_name].filter(Boolean).join(", ")}</span>}</span>
                <span className="shrink-0 rounded-full bg-fb-bg px-2 text-[11px] capitalize text-fb-muted">{h.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <iframe title="Location map" className="h-48 w-full rounded-md border border-fb-border" loading="lazy"
        src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQ)}&z=${value.length === 1 && /^[A-Z]{2}$/.test(value[0]) ? 6 : 7}&output=embed`} />
    </div>
  );
}
