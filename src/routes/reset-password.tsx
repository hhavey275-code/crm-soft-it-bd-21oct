import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Eye, EyeOff, LogIn } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
});

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        if (session) setIsValid(true);
        setChecking(false);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setIsValid(true);
      setTimeout(() => setChecking(false), 1500);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { toast.error("Passwords do not match"); return; }
    if (password.length < 6) { toast.error("Min 6 characters"); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated!");
      navigate({ to: "/dashboard" });
    } catch (err: any) { toast.error(err?.message || "Failed"); }
    finally { setLoading(false); }
  };

  if (checking) return <div className="flex min-h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  if (!isValid) return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="text-center space-y-4">
        <h1 className="text-xl font-bold">Invalid or Expired Link</h1>
        <p className="text-muted-foreground text-sm">This password reset link is invalid.</p>
        <Button onClick={() => navigate({ to: "/auth" })} variant="outline">Back to Login</Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4" style={{ background: "linear-gradient(180deg, hsl(200 80% 90%) 0%, hsl(200 20% 97%) 100%)" }}>
      <div className="w-full max-w-md rounded-2xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-xl overflow-hidden">
        <div className="px-8 pt-8 pb-6">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-white/80 shadow-sm">
            <LogIn className="h-6 w-6 text-foreground" />
          </div>
          <h1 className="text-center text-xl font-bold mb-1">Set New Password</h1>
          <p className="text-center text-sm text-muted-foreground">Enter your new password.</p>
        </div>
        <div className="px-8 pb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
              <Input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" required minLength={6} className="h-11 pl-10 pr-10 rounded-xl bg-muted/50" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
              <Input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" required minLength={6} className="h-11 pl-10 rounded-xl bg-muted/50" />
            </div>
            <Button type="submit" disabled={loading} className="w-full h-11 rounded-xl bg-foreground text-background hover:bg-foreground/90 font-semibold">
              {loading ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
