import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, MousePointer2, Monitor, Smartphone, ArrowLeft } from "lucide-react";
import { tutorialFlows, type TutorialStep, type TutorialFlow } from "@/lib/tutorial/steps";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;

function getRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

async function waitForSelector(selector: string, timeoutMs = 4000): Promise<Element | null> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - start > timeoutMs) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function openMobileSidebarIfNeeded() {
  if (window.innerWidth >= 768) return;
  const sidebar = document.querySelector('[data-sidebar="sidebar"][data-state="open"]');
  if (sidebar) return;
  const trigger = document.querySelector('[data-sidebar="trigger"]') as HTMLElement | null;
  trigger?.click();
}

export function Tutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeFlow, setActiveFlow] = useState<TutorialFlow | null>(null);
  const [device, setDevice] = useState<"pc" | "mobile">(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "mobile" : "pc"
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [clicking, setClicking] = useState(false);
  const lastSelectorRef = useRef<string>("");

  const steps = activeFlow?.steps ?? [];
  const step: TutorialStep | undefined = steps[stepIdx];

  const resolveTarget = useCallback(async (s: TutorialStep) => {
    if (s.info || !s.selector) {
      setRect(null);
      setCursorPos(null);
      return;
    }
    if (s.route && location.pathname !== s.route) {
      navigate({ to: s.route });
    }
    if (s.openSidebar) {
      openMobileSidebarIfNeeded();
      await new Promise((r) => setTimeout(r, 250));
    }
    if (s.waitMs) await new Promise((r) => setTimeout(r, s.waitMs));
    const el = await waitForSelector(s.selector, 4000);
    if (!el) {
      setRect(null);
      setCursorPos(null);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    await new Promise((r) => setTimeout(r, 350));
    const r = getRect(el);
    setRect(r);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    setCursorPos({ x: cx, y: cy });
    if (s.click) {
      setTimeout(() => {
        setClicking(true);
        setTimeout(() => setClicking(false), 600);
      }, 600);
    }
  }, [navigate, location.pathname]);

  useEffect(() => {
    if (!open || !step) return;
    lastSelectorRef.current = step.selector ?? "";
    resolveTarget(step);
  }, [open, stepIdx, step, resolveTarget]);

  useEffect(() => {
    if (!open || !activeFlow) return;
    const reMeasure = () => {
      if (!lastSelectorRef.current) return;
      const el = document.querySelector(lastSelectorRef.current);
      if (el) {
        const r = getRect(el);
        setRect(r);
        setCursorPos({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
    };
    window.addEventListener("resize", reMeasure);
    window.addEventListener("scroll", reMeasure, true);
    return () => {
      window.removeEventListener("resize", reMeasure);
      window.removeEventListener("scroll", reMeasure, true);
    };
  }, [open, activeFlow]);

  useEffect(() => {
    if (!open) {
      setActiveFlow(null);
      setStepIdx(0);
      setRect(null);
      setCursorPos(null);
    }
  }, [open]);

  if (!open) return null;

  // ───── Flow Selector Menu ─────
  if (!activeFlow) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto" onClick={onClose}>
        <div
          className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 bg-background border-b border-border p-4 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-lg">📺 Tutorial</h2>
              <p className="text-xs text-muted-foreground mt-0.5">যেটা শিখতে চান সেটায় ক্লিক করুন</p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Device toggle */}
          <div className="px-4 pt-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">View:</span>
            <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30">
              <button
                onClick={() => setDevice("pc")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition ${device === "pc" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                <Monitor className="h-3.5 w-3.5" /> PC
              </button>
              <button
                onClick={() => setDevice("mobile")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition ${device === "mobile" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                <Smartphone className="h-3.5 w-3.5" /> Mobile
              </button>
            </div>
          </div>

          <div className="p-4 grid gap-2">
            {tutorialFlows.map((f) => (
              <button
                key={f.id}
                onClick={() => { setActiveFlow(f); setStepIdx(0); }}
                className="text-left bg-card border border-border rounded-xl p-3 hover:bg-muted/40 hover:border-primary/40 transition flex items-center gap-3"
              >
                <div className="text-2xl flex-shrink-0">{f.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{f.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{f.description}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ───── Step Runner ─────
  if (!step) return null;

  const next = () => {
    if (stepIdx < steps.length - 1) setStepIdx(stepIdx + 1);
    else { setActiveFlow(null); setStepIdx(0); }
  };
  const prev = () => { if (stepIdx > 0) setStepIdx(stepIdx - 1); };
  const backToMenu = () => { setActiveFlow(null); setStepIdx(0); setRect(null); setCursorPos(null); };

  const vh = window.innerHeight;
  const vw = window.innerWidth;
  let popTop = vh - 260;
  let popLeft = 12;
  const popWidth = Math.min(380, vw - 24);

  if (rect) {
    const spaceBelow = vh - (rect.top + rect.height);
    const spaceAbove = rect.top;
    if (spaceBelow > 260 || spaceBelow > spaceAbove) {
      popTop = Math.min(rect.top + rect.height + 16, vh - 260);
    } else {
      popTop = Math.max(16, rect.top - 260);
    }
    popLeft = Math.max(12, Math.min(vw - popWidth - 12, rect.left + rect.width / 2 - popWidth / 2));
  } else {
    popTop = vh / 2 - 130;
    popLeft = vw / 2 - popWidth / 2;
  }

  const spotlightStyle: React.CSSProperties = rect
    ? {
        clipPath: `polygon(
          0 0, 100% 0, 100% 100%, 0 100%, 0 0,
          ${rect.left - PAD}px ${rect.top - PAD}px,
          ${rect.left - PAD}px ${rect.top + rect.height + PAD}px,
          ${rect.left + rect.width + PAD}px ${rect.top + rect.height + PAD}px,
          ${rect.left + rect.width + PAD}px ${rect.top - PAD}px,
          ${rect.left - PAD}px ${rect.top - PAD}px
        )`,
      }
    : {};

  const desc = device === "mobile" && step.mobileDescription ? step.mobileDescription : step.description;

  return createPortal(
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      <div
        className="absolute inset-0 bg-black/65 transition-all duration-300 pointer-events-auto"
        style={spotlightStyle}
        onClick={onClose}
      />

      {rect && (
        <div
          className="absolute rounded-lg ring-2 ring-primary shadow-[0_0_0_4px_rgba(59,130,246,0.35)] transition-all duration-300"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      )}

      {cursorPos && (
        <div
          className="absolute transition-all duration-700 ease-out"
          style={{
            top: cursorPos.y - 8,
            left: cursorPos.x - 8,
            transform: clicking ? "scale(0.85)" : "scale(1)",
          }}
        >
          <div className="relative">
            <MousePointer2 className="h-7 w-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] fill-primary" />
            {clicking && (
              <span className="absolute -top-2 -left-2 h-10 w-10 rounded-full border-2 border-primary animate-ping" />
            )}
          </div>
        </div>
      )}

      <div
        className="absolute pointer-events-auto bg-background border border-border rounded-xl shadow-2xl p-4 animate-in fade-in slide-in-from-bottom-2"
        style={{ top: popTop, left: popLeft, width: popWidth }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
              <button onClick={backToMenu} className="inline-flex items-center gap-0.5 hover:text-foreground">
                <ArrowLeft className="h-3 w-3" /> Menu
              </button>
              <span>•</span>
              <span className="truncate">{activeFlow.icon} {activeFlow.title}</span>
              <span>•</span>
              <span>{stepIdx + 1}/{steps.length}</span>
            </div>
            <h3 className="font-bold text-base leading-tight">{step.title}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 -mt-1 -mr-1" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{desc}</p>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={prev} disabled={stepIdx === 0}>
              <ChevronLeft className="h-4 w-4 mr-1" /> পিছনে
            </Button>
            <Button size="sm" onClick={next}>
              {stepIdx === steps.length - 1 ? "শেষ" : "পরের"}
              {stepIdx < steps.length - 1 && <ChevronRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
