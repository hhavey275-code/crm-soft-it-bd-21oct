import { createContext, useContext, useState, ReactNode } from "react";
import { Tutorial } from "./Tutorial";

type Ctx = { open: boolean; start: () => void; close: () => void };
const TutorialCtx = createContext<Ctx | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <TutorialCtx.Provider value={{ open, start: () => setOpen(true), close: () => setOpen(false) }}>
      {children}
      <Tutorial open={open} onClose={() => setOpen(false)} />
    </TutorialCtx.Provider>
  );
}

export function useTutorial() {
  const ctx = useContext(TutorialCtx);
  if (!ctx) throw new Error("useTutorial must be used inside TutorialProvider");
  return ctx;
}
