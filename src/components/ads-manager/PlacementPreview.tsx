import { useState } from "react";
import { ImagePlus, MoreHorizontal, X, Monitor, Tablet, Smartphone, Heart, MessageCircle, Send, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type PreviewData = {
  pageName: string;
  avatar?: string | null;
  text?: string | null;
  img?: string | null;
  video?: { src?: string | null; picture?: string | null; name: string } | null;
  domain: string;
  headline: string;
  cta: string;
  showCta: boolean;
};

type Device = "mobile" | "tablet" | "desktop";
const WIDTH: Record<Device, string> = { mobile: "max-w-[260px]", tablet: "max-w-[340px]", desktop: "max-w-full" };

function Avatar({ d, size = "h-8 w-8" }: { d: PreviewData; size?: string }) {
  return d.avatar ? <img src={d.avatar} alt="" className={cn(size, "shrink-0 rounded-full object-cover")} />
    : <div className={cn(size, "flex shrink-0 items-center justify-center rounded-full bg-fb-blue-soft text-[12px] font-bold text-fb-blue")}>{(d.pageName || "P")[0]}</div>;
}

function Media({ d, cls }: { d: PreviewData; cls: string }) {
  if (d.video?.src) return <video key={d.video.src} src={d.video.src} poster={d.video.picture ?? undefined} muted playsInline controls className={cn(cls, "bg-foreground object-contain")} />;
  const src = d.video?.picture || d.img;
  return src ? <img src={src} alt="" className={cn(cls, "object-cover")} /> : <div className={cn(cls, "flex items-center justify-center bg-fb-bg text-fb-muted")}><ImagePlus className="h-8 w-8" /></div>;
}

function Feed({ d }: { d: PreviewData }) {
  return (
    <div className="overflow-hidden rounded-lg border border-fb-border bg-background">
      <div className="flex items-center gap-2 p-3">
        <Avatar d={d} />
        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{d.pageName}</p><p className="text-[11px] text-fb-muted">Sponsored · 🌐</p></div>
        <MoreHorizontal className="h-4 w-4 text-fb-muted" /><X className="h-4 w-4 text-fb-muted" />
      </div>
      {d.text ? <p className="whitespace-pre-line px-3 pb-2 text-[13px] line-clamp-4">{d.text}</p> : <p className="px-3 pb-2 text-[13px] text-fb-muted">Primary text</p>}
      <Media d={d} cls="aspect-square w-full" />
      {d.showCta && (
        <div className="flex items-center justify-between gap-2 bg-fb-bg p-3">
          <div className="min-w-0"><p className="truncate text-[11px] uppercase text-fb-muted">{d.domain}</p><p className="truncate text-[13px] font-semibold">{d.headline}</p></div>
          <span className="shrink-0 rounded-md bg-fb-border px-3 py-1.5 text-[12px] font-semibold text-foreground">{d.cta}</span>
        </div>
      )}
      <div className="flex justify-around border-t border-fb-border py-2 text-[12px] font-semibold text-fb-muted"><span>👍 Like</span><span>💬 Comment</span><span>↗ Share</span></div>
    </div>
  );
}

function Story({ d }: { d: PreviewData }) {
  return (
    <div className="relative mx-auto flex aspect-[9/16] w-full flex-col overflow-hidden rounded-lg bg-foreground text-background">
      <div className="absolute inset-x-2 top-2 z-10 h-0.5 rounded bg-background/40"><div className="h-full w-1/3 rounded bg-background" /></div>
      <div className="absolute inset-x-0 top-4 z-10 flex items-center gap-2 px-3">
        <Avatar d={d} size="h-7 w-7" />
        <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold">{d.pageName}</p><p className="text-[10px] opacity-80">Sponsored</p></div>
        <MoreHorizontal className="h-4 w-4" /><X className="h-4 w-4" />
      </div>
      <div className="flex flex-1 items-center"><Media d={d} cls="w-full max-h-full" /></div>
      <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-1">
        <ChevronUp className="h-4 w-4" />
        <span className="rounded-full bg-background px-4 py-1.5 text-[12px] font-semibold text-foreground">{d.cta}</span>
      </div>
    </div>
  );
}

function Reels({ d }: { d: PreviewData }) {
  return (
    <div className="relative mx-auto aspect-[9/16] w-full overflow-hidden rounded-lg bg-foreground text-background">
      <Media d={d} cls="absolute inset-0 h-full w-full" />
      <div className="absolute right-2 bottom-24 flex flex-col items-center gap-3 text-[10px]">
        <Heart className="h-5 w-5" /><MessageCircle className="h-5 w-5" /><Send className="h-5 w-5" />
      </div>
      <div className="absolute inset-x-0 bottom-0 space-y-1.5 bg-gradient-to-t from-foreground/90 to-transparent p-3 pt-10">
        <div className="flex items-center gap-2"><Avatar d={d} size="h-6 w-6" /><p className="truncate text-[12px] font-semibold">{d.pageName}</p><span className="text-[10px] opacity-80">· Sponsored</span></div>
        {d.text && <p className="line-clamp-2 text-[11px] opacity-90">{d.text}</p>}
        <span className="block rounded-md bg-fb-blue py-1.5 text-center text-[12px] font-semibold text-primary-foreground">{d.cta}</span>
      </div>
    </div>
  );
}

export function PlacementPreview({ d }: { d: PreviewData }) {
  const [device, setDevice] = useState<Device>("mobile");
  const devices: [Device, typeof Monitor, string][] = [["mobile", Smartphone, "Mobile"], ["tablet", Tablet, "Tablet"], ["desktop", Monitor, "Desktop"]];
  return (
    <div className="rounded-lg border border-fb-border bg-background">
      <div className="flex items-center justify-center gap-1 border-b border-fb-border p-1.5">
        {devices.map(([k, I, l]) => (
          <button key={k} type="button" title={l} aria-label={l} onClick={() => setDevice(k)}
            className={cn("flex h-8 w-9 items-center justify-center rounded-md", device === k ? "bg-fb-blue-soft text-fb-blue" : "text-fb-muted hover:bg-fb-bg")}>
            <I className="h-4 w-4" />
          </button>
        ))}
      </div>
      <div className="max-h-[calc(100vh-260px)] space-y-4 overflow-y-auto overscroll-contain p-3">
        {([["Feed", Feed], ["Stories", Story], ["Reels", Reels]] as const).map(([l, C]) => (
          <div key={l} className={cn("mx-auto w-full", WIDTH[device])}>
            <p className="mb-1.5 text-center"><span className="rounded-full bg-fb-bg px-2.5 py-0.5 text-[11px] font-semibold">{l}</span></p>
            <C d={d} />
          </div>
        ))}
      </div>
    </div>
  );
}
