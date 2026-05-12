import { createContext, useContext, useState, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MousePointer2 } from "lucide-react";
import { TutorialDemo } from "./TutorialDemo";

type Ctx = { open: boolean; start: () => void; close: () => void };
const TutorialCtx = createContext<Ctx | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <TutorialCtx.Provider value={{ open, start: () => setOpen(true), close: () => setOpen(false) }}>
      {children}
      <TutorialDemo open={open} onClose={() => setOpen(false)} />
    </TutorialCtx.Provider>
  );
}

export function useTutorial() {
  const ctx = useContext(TutorialCtx);
  if (!ctx) return { open: false, start: () => {}, close: () => {} };
  return ctx;
}

export function TutorialButton() {
  const { start } = useTutorial();
  return (
    <Button variant="outline" size="sm" onClick={start} className="gap-2">
      <MousePointer2 className="h-4 w-4" />
      কীভাবে কাজ করে — Tutorial দেখুন
    </Button>
  );
}
