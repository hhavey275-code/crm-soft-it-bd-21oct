import { useEffect, useState } from "react";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

export type FbRange = { preset: string; from: string; to: string };

const PRESETS: [string, string][] = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["today_yesterday", "Today and yesterday"],
  ["7d", "Last 7 days"], ["14d", "Last 14 days"], ["28d", "Last 28 days"], ["30d", "Last 30 days"],
  ["this_week", "This week"], ["last_week", "Last week"], ["this_month", "This month"], ["last_month", "Last month"],
  ["max", "Maximum"],
];

const f = (d: Date) => format(d, "yyyy-MM-dd");
export function presetRange(p: string): { from: Date; to: Date } {
  const t = new Date();
  switch (p) {
    case "today": return { from: t, to: t };
    case "yesterday": return { from: subDays(t, 1), to: subDays(t, 1) };
    case "today_yesterday": return { from: subDays(t, 1), to: t };
    case "7d": return { from: subDays(t, 7), to: subDays(t, 1) };
    case "14d": return { from: subDays(t, 14), to: subDays(t, 1) };
    case "28d": return { from: subDays(t, 28), to: subDays(t, 1) };
    case "30d": return { from: subDays(t, 30), to: subDays(t, 1) };
    case "this_week": return { from: startOfWeek(t), to: t };
    case "last_week": { const l = subWeeks(t, 1); return { from: startOfWeek(l), to: endOfWeek(l) }; }
    case "this_month": return { from: startOfMonth(t), to: t };
    case "last_month": { const l = subMonths(t, 1); return { from: startOfMonth(l), to: endOfMonth(l) }; }
    case "max": return { from: subMonths(t, 37), to: t };
    default: return { from: subDays(t, 7), to: subDays(t, 1) };
  }
}
export function makeRange(p: string): FbRange { const r = presetRange(p); return { preset: p, from: f(r.from), to: f(r.to) }; }

const nice = (s: string) => format(new Date(s + "T00:00:00"), "MMM d, yyyy");

export function FbDateRangePicker({ value, onChange }: { value: FbRange; onChange: (v: FbRange) => void }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(value.preset);
  const [range, setRange] = useState<DateRange | undefined>();
  useEffect(() => {
    if (open) { setPreset(value.preset); setRange({ from: new Date(value.from + "T00:00:00"), to: new Date(value.to + "T00:00:00") }); }
  }, [open, value]);

  const label = PRESETS.find(([k]) => k === value.preset)?.[1] ?? "Custom";
  const pickPreset = (k: string) => { setPreset(k); setRange(presetRange(k)); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex h-9 items-center gap-2 rounded-md border border-fb-border bg-background px-3 text-[13px] text-fb-text hover:bg-fb-bg">
          <CalendarDays className="h-4 w-4" />
          {label}: {nice(value.from)} – {nice(value.to)}
          <ChevronDown className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="fb-font w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] p-0 text-fb-text sm:w-auto sm:max-w-none">
        <div className="flex max-h-[75dvh] flex-col overflow-y-auto sm:max-h-none sm:flex-row sm:overflow-visible">
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-fb-border p-2 sm:block sm:w-48 sm:max-h-[460px] sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-0 sm:py-3">
            <p className="hidden px-4 pb-1 text-[13px] font-semibold sm:block">Recently used</p>
            {PRESETS.map(([k, l]) => (
              <button key={k} onClick={() => pickPreset(k)} className={cn("flex shrink-0 items-center gap-3 whitespace-nowrap rounded-full border px-3 py-1 text-left text-[12px] sm:w-full sm:rounded-none sm:border-0 sm:px-4 sm:py-1.5 sm:text-[13px] hover:bg-fb-bg", preset === k ? "border-fb-blue text-fb-blue" : "border-fb-border")}>
                <span className={cn("hidden h-5 w-5 items-center sm:flex justify-center rounded-full border", preset === k ? "border-fb-blue" : "border-fb-muted")}>
                  {preset === k && <span className="h-2.5 w-2.5 rounded-full bg-fb-blue" />}
                </span>{l}
              </button>
            ))}
          </div>
          <div className="flex flex-col p-2 sm:p-3">
            <Calendar mode="range" numberOfMonths={isMobile ? 1 : 2} selected={range} defaultMonth={range?.from ? subMonths(range.from, 0) : undefined}
              onSelect={(r) => { setRange(r); setPreset("custom"); }} disabled={{ after: new Date() }} />
            <div className="mt-2 hidden items-center gap-2 text-[13px] sm:flex">
              <span className="h-3 w-3 rounded-sm bg-fb-blue-soft" />
              <span className="rounded-md border border-fb-border px-3 py-1.5">{PRESETS.find(([k]) => k === preset)?.[1] ?? "Custom"}</span>
              <span className="rounded-md border border-fb-border px-3 py-1.5">{range?.from ? format(range.from, "MMM d, yyyy") : "—"}</span>
              <span>-</span>
              <span className="rounded-md border border-fb-border px-3 py-1.5">{range?.to ? format(range.to, "MMM d, yyyy") : "—"}</span>
            </div>
            <div className="mt-2 flex items-center justify-between sm:mt-4">
              <span className="hidden text-[11px] sm:inline text-fb-muted">Dates are shown in Dhaka Time</span>
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} className="h-9 rounded-md border border-fb-border px-4 text-[13px] font-semibold hover:bg-fb-bg">Cancel</button>
                <button disabled={!range?.from}
                  onClick={() => { const from = range!.from!; const to = range!.to ?? from; onChange({ preset, from: f(from), to: f(to) }); setOpen(false); }}
                  className="h-9 rounded-md bg-fb-blue px-4 text-[13px] font-semibold text-background disabled:opacity-50">Update</button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
