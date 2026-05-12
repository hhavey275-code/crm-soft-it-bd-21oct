import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
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
  const [role, setRole] = useState<AppRole | null>(null);
  const [profile, setProfile] = useState<Database["public"]["Tables"]["profiles"]["Row"] | null>(null);
  const [loading, setLoading] = useState(true);
  const currentUserId = useRef<string | null>(null);

  const fetchUserData = useCallback(async (userId: string) => {
    try {
      const [{ data: roles, error: rolesError }, { data: prof, error: profileError }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId).limit(1),
        supabase.from("profiles").select("*").eq("user_id", userId).single(),
      ]);
      // Guard: if user changed mid-flight (logout/login), discard stale result
      if (currentUserId.current !== userId) return;
      if (rolesError) console.error("Failed to fetch user roles:", rolesError);
      if (profileError) console.error("Failed to fetch profile:", profileError);

      const rolePriority: AppRole[] = ["superadmin", "admin", "agency", "seller", "client"];
      const resolvedRole = rolePriority.find((candidate) =>
        roles?.some((row) => row.role === candidate)
      ) ?? null;
      setRole(resolvedRole);
      setProfile((prof as any) ?? null);
    } catch (err) {
      console.error("Failed to fetch user data:", err);
      if (currentUserId.current === userId) {
        setRole(null);
        setProfile(null);
      }
    } finally {
      if (currentUserId.current === userId) {
        setLoading(false);
      }
    }
  }, []);

  const applySession = useCallback((newSession: Session | null) => {
    const newUserId = newSession?.user?.id ?? null;
    setSession(newSession);
    setUser(newSession?.user ?? null);
    if (newUserId !== currentUserId.current) {
      // User changed → clear stale role/profile immediately to avoid wrong UI
      currentUserId.current = newUserId;
      setRole(null);
      setProfile(null);
    }
    if (newUserId) {
      setLoading(true);
      void fetchUserData(newUserId);
      return;
    }
    setLoading(false);
  }, [fetchUserData]);

  useEffect(() => {
    let mounted = true;

    const safety = setTimeout(() => {
      if (mounted) setLoading((p) => (p ? false : p));
    }, 4000);

    // Subscribe FIRST (synchronously), then restore session
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      // Never await DB inside this callback (Supabase auth lock deadlock)
      applySession(newSession);
    });

    supabase.auth.getSession().then(({ data: { session: initial } }) => {
      if (!mounted) return;
      applySession(initial);
    }).catch(() => {
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(safety);
      subscription.unsubscribe();
    };
  }, [applySession]);

  const signOut = useCallback(async () => {
    // Reset state immediately so UI flips even if Supabase is slow
    currentUserId.current = null;
    setUser(null);
    setSession(null);
    setRole(null);
    setProfile(null);
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("signOut error (ignored):", err);
    }
    // Hard-clean any leftover Supabase auth keys (legacy/cached tokens)
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("sb-") || k.includes("supabase.auth") || k === "cached_role")) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {}
    // Force navigate to /auth
    if (typeof window !== "undefined") {
      window.location.replace("/auth");
    }
  }, []);

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
