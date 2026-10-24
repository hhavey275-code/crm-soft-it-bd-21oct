import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const USER_DATA_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error("User data request timed out")), timeoutMs);
    }),
  ]);
}

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
  const [profile, setProfile] = useState<Database["public"]["Tables"]["profiles"]["Row"] | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const currentUserId = useRef<string | null>(null);
  const retryCount = useRef(0);

  const fetchUserData = useCallback(async (userId: string) => {
    try {
      const [{ data: roles, error: rolesError }, { data: prof, error: profileError }] =
        await withTimeout(
          Promise.all([
            supabase.from("user_roles").select("role").eq("user_id", userId),
            supabase.from("profiles").select("*").eq("user_id", userId).single(),
          ]),
          USER_DATA_TIMEOUT_MS,
        );
      // Guard: if user changed mid-flight (logout/login), discard stale result
      if (currentUserId.current !== userId) return;
      if (rolesError) console.error("Failed to fetch user roles:", rolesError);
      if (profileError) console.error("Failed to fetch profile:", profileError);

      if (rolesError) {
        // Roles unknown → do NOT downgrade to "client" (would show the wrong
        // dashboard to admins). Keep role null and retry.
        retryCount.current += 1;
        const delay = Math.min(1000 * 2 ** (retryCount.current - 1), 15_000);
        window.setTimeout(() => {
          if (currentUserId.current === userId) void fetchUserData(userId);
        }, delay);
        setProfile(prof ?? null);
        return;
      }

      retryCount.current = 0;
      const rolePriority: AppRole[] = ["superadmin", "admin", "agency", "seller", "client"];
      const resolvedRole =
        rolePriority.find((candidate) => roles?.some((row) => row.role === candidate)) ?? "client";
      setRole(resolvedRole);
      setProfile(prof ?? null);
    } catch (err) {
      console.error("Failed to fetch user data:", err);
      if (currentUserId.current === userId) {
        // Never guess the role here: defaulting to "client" showed admins the
        // wrong dashboard. Leave role null and keep retrying with backoff.
        retryCount.current += 1;
        const delay = Math.min(1000 * 2 ** (retryCount.current - 1), 15_000);
        window.setTimeout(() => {
          if (currentUserId.current === userId) void fetchUserData(userId);
        }, delay);
      }
    } finally {
      if (currentUserId.current === userId) {
        setLoading(false);
      }
    }
  }, []);

  const applySession = useCallback(
    (newSession: Session | null) => {
      const newUserId = newSession?.user?.id ?? null;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      const changed = newUserId !== currentUserId.current;
      if (changed) {
        // User changed → clear stale role/profile immediately to avoid wrong UI
        currentUserId.current = newUserId;
        retryCount.current = 0;
        setRole(null);
        setProfile(null);
      }
      if (newUserId) {
        // Same user (token refresh when returning to the tab): keep the page mounted,
        // otherwise open forms like the campaign wizard lose what was typed.
        if (!changed) return;
        setLoading(true);
        void fetchUserData(newUserId);
        return;
      }
      setLoading(false);
    },
    [fetchUserData],
  );

  useEffect(() => {
    let mounted = true;
    let initialized = false;

    // Subscribe FIRST (synchronously), then restore session
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      // Ignore null sessions before initial getSession() resolves, otherwise
      // an early INITIAL_SESSION(null) flips loading=false → ProtectedGuard
      // redirects to /auth before the persisted session is restored.
      if (!initialized && !newSession) return;
      initialized = true;
      applySession(newSession);
    });

    supabase.auth
      .getSession()
      .then(({ data: { session: initial } }) => {
        if (!mounted) return;
        initialized = true;
        applySession(initial);
      })
      .catch(() => {
        initialized = true;
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
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
    } catch (err) {
      console.warn("local auth cleanup failed (ignored):", err);
    }
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
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        profile,
        loading,
        signOut,
        isAdmin,
        isSuperAdmin,
        isSeller,
        isAgency,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
