import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, MousePointer2 } from "lucide-react";
import { clientTutorialSteps, type TutorialStep } from "@/lib/tutorial/steps";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;

function getRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

async function waitForSelector(selector: string, timeoutMs = 3000): Promise<Element | null> {
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
  // shadcn sidebar mobile: trigger has data-sidebar="trigger" or aria-label
  if (window.innerWidth >= 768) return;
  const sidebar = document.querySelector('[data-sidebar="sidebar"][data-state="open"]');
  if (sidebar) return;
  const trigger = document.querySelector('[data-sidebar="trigger"]') as HTMLElement | null;
  trigger?.click();
}

export function Tutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [clicking, setClicking] = useState(false);
  const lastSelectorRef = useRef<string>("");

  const steps = clientTutorialSteps;
  const step: TutorialStep | undefined = steps[stepIdx];

  // Resolve target for current step
  const resolveTarget = useCallback(async (s: TutorialStep) => {
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
    // animate cursor to center of target
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

  // Run resolve when step changes
  useEffect(() => {
    if (!open || !step) return;
    lastSelectorRef.current = step.selector;
    resolveTarget(step);
  }, [open, stepIdx, step, resolveTarget]);

  // Re-measure on resize/scroll
  useEffect(() => {
    if (!open) return;
    const reMeasure = () => {
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
  }, [open]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStepIdx(0);
      setRect(null);
      setCursorPos(null);
    }
  }, [open]);

  if (!open || !step) return null;

  const next = () => {
    if (stepIdx < steps.length - 1) setStepIdx(stepIdx + 1);
    else onClose();
  };
  const prev = () => {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  };

  // Compute popover position
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  let popTop = vh - 240;
  let popLeft = 12;
  let popWidth = Math.min(380, vw - 24);
  if (rect) {
    const spaceBelow = vh - (rect.top + rect.height);
    const spaceAbove = rect.top;
    if (spaceBelow > 240 || spaceBelow > spaceAbove) {
      popTop = Math.min(rect.top + rect.height + 16, vh - 240);
    } else {
      popTop = Math.max(16, rect.top - 240);
    }
    popLeft = Math.max(12, Math.min(vw - popWidth - 12, rect.left + rect.width / 2 - popWidth / 2));
  } else {
    popTop = vh / 2 - 120;
    popLeft = vw / 2 - popWidth / 2;
  }

  // Spotlight: full overlay with rectangular cutout via clip-path
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

  return createPortal(
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {/* Dim overlay with spotlight cutout */}
      <div
        className="absolute inset-0 bg-black/65 transition-all duration-300 pointer-events-auto"
        style={spotlightStyle}
        onClick={onClose}
      />

      {/* Highlight ring */}
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

      {/* Animated cursor */}
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

      {/* Popover */}
      <div
        className="absolute pointer-events-auto bg-background border border-border rounded-xl shadow-2xl p-4 animate-in fade-in slide-in-from-bottom-2"
        style={{ top: popTop, left: popLeft, width: popWidth }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1">
            <div className="text-xs text-muted-foreground mb-1">
              ধাপ {stepIdx + 1} / {steps.length}
            </div>
            <h3 className="font-bold text-base leading-tight">{step.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 -mt-1 -mr-1"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
          {step.description}
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Skip
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={prev} disabled={stepIdx === 0}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              পিছনে
            </Button>
            <Button size="sm" onClick={next}>
              {stepIdx === steps.length - 1 ? "শেষ করুন" : "পরের"}
              {stepIdx < steps.length - 1 && <ChevronRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function TutorialButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <MousePointer2 className="h-4 w-4" />
        কীভাবে কাজ করে — Tutorial দেখুন
      </Button>
      <Tutorial open={open} onClose={() => setOpen(false)} />
    </>
  );
}
