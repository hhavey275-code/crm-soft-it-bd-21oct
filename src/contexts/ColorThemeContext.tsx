import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ColorTheme = "blue" | "orange" | "green";

const STORAGE_KEY = "color-theme";
const VALID: ColorTheme[] = ["blue", "orange", "green"];

interface ColorThemeContextValue {
  colorTheme: ColorTheme;
  setColorTheme: (t: ColorTheme) => void;
}

const ColorThemeContext = createContext<ColorThemeContextValue>({
  colorTheme: "blue",
  setColorTheme: () => {},
});

const readInitial = (): ColorTheme => {
  if (typeof window === "undefined") return "blue";
  try {
    const v = localStorage.getItem(STORAGE_KEY) as ColorTheme | null;
    if (v && VALID.includes(v)) return v;
  } catch {}
  return "blue";
};

const applyClass = (t: ColorTheme) => {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.remove("theme-blue", "theme-orange", "theme-green");
  if (t !== "blue") el.classList.add(`theme-${t}`);
};

export const ColorThemeProvider = ({ children }: { children: ReactNode }) => {
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(readInitial);

  useEffect(() => { applyClass(colorTheme); }, [colorTheme]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data } = await supabase.from("profiles").select("color_theme").eq("user_id", user.id).maybeSingle();
        const dbTheme = (data as any)?.color_theme as ColorTheme | undefined;
        if (dbTheme && VALID.includes(dbTheme) && !cancelled) {
          setColorThemeState(dbTheme);
          try { localStorage.setItem(STORAGE_KEY, dbTheme); } catch {}
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const setColorTheme = useCallback((t: ColorTheme) => {
    if (!VALID.includes(t)) return;
    setColorThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("profiles").update({ color_theme: t } as any).eq("user_id", user.id);
        }
      } catch {}
    })();
  }, []);

  return (
    <ColorThemeContext.Provider value={{ colorTheme, setColorTheme }}>
      {children}
    </ColorThemeContext.Provider>
  );
};

export const useColorTheme = () => useContext(ColorThemeContext);
