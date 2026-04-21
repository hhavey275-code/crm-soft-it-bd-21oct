import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  profile: Database["public"]["Tables"]["profiles"]["Row"] | null;
  loading: boolean;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isSeller: boolean;
  isAgency: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  isAdmin: false,
  isSuperAdmin: false,
  isSeller: false,
  isAgency: false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const getCachedRole = (): AppRole | null => {
    if (typeof window === "undefined") return null;
    try { return localStorage.getItem("cached_role") as AppRole | null; } catch { return null; }
  };
  const cachedRole = useRef<AppRole | null>(getCachedRole());
  const [role, setRole] = useState<AppRole | null>(cachedRole.current);
  const [profile, setProfile] = useState<Database["public"]["Tables"]["profiles"]["Row"] | null>(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  const fetchUserData = async (userId: string) => {
    try {
      const [{ data: roles }, { data: prof }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId).limit(1),
        supabase.from("profiles").select("*").eq("user_id", userId).single(),
      ]);
      const newRole = roles?.[0]?.role ?? null;
      setRole(newRole);
      try {
        if (newRole) localStorage.setItem("cached_role", newRole);
        else localStorage.removeItem("cached_role");
      } catch {}
      setProfile((prof as any) ?? null);
    } catch (err) {
      console.error("Failed to fetch user data:", err);
      setRole(null);
      setProfile(null);
    }
  };

  useEffect(() => {
    const safetyTimeout = setTimeout(() => {
      setLoading((prev) => prev ? false : prev);
    }, 5000);

    const initializeAuth = async (currentSession: Session | null) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession?.user) {
        await fetchUserData(currentSession.user.id);
      } else {
        setRole(null);
        setProfile(null);
        try { localStorage.removeItem("cached_role"); } catch {}
      }
      initialized.current = true;
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!initialized.current && event === "INITIAL_SESSION") {
        void initializeAuth(newSession);
        return;
      }
      if (!initialized.current) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        void fetchUserData(newSession.user.id);
      } else {
        setRole(null);
        setProfile(null);
        try { localStorage.removeItem("cached_role"); } catch {}
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      if (initialized.current) return;
      await initializeAuth(initialSession);
    }).catch(() => {
      if (initialized.current) return;
      initialized.current = true;
      setLoading(false);
    });

    return () => {
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRole(null);
    setProfile(null);
    try { localStorage.removeItem("cached_role"); } catch {}
  };

  const isSuperAdmin = role === "superadmin";
  const isAdmin = role === "admin" || role === "superadmin";
  const isSeller = role === "seller";
  const isAgency = role === "agency";

  return (
    <AuthContext.Provider value={{ user, session, role, profile, loading, signOut, isAdmin, isSuperAdmin, isSeller, isAgency }}>
      {children}
    </AuthContext.Provider>
  );
};
