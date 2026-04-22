import { useState, useEffect, useLayoutEffect } from "react";
import { useTheme } from "next-themes";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAgencyBranding } from "@/contexts/AgencyBrandingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogIn, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useSiteSettings } from "@/hooks/useSiteSettings";

export function AuthForm() {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(location.pathname !== "/signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [monthlySpend, setMonthlySpend] = useState("");
  const [loading, setLoading] = useState(false);
  const { logoUrl, siteName, welcomeTitle, welcomeNote } = useSiteSettings();
  const agencyBranding = useAgencyBranding();
  const { setTheme, theme: currentTheme } = useTheme();

  useLayoutEffect(() => {
    const prev = currentTheme;
    setTheme("light");
    return () => { if (prev && prev !== "light") setTheme(prev); };
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!authLoading && user) {
      navigate({ to: "/dashboard" });
    }
  }, [user, authLoading, navigate]);

  const displayLogo = agencyBranding.logoUrl || logoUrl;
  const displayName = agencyBranding.name || siteName;

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/dashboard` },
      });
      if (error) throw error;
    } catch (err: any) {
      toast.error(err?.message || "Google sign-in failed");
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back!");
        navigate({ to: "/dashboard" });
      } else {
        const signUpPayload = {
          email, password,
          options: {
            data: {
              full_name: fullName,
              company: businessName || undefined,
              phone: phone || undefined,
              business_address: businessAddress || undefined,
              monthly_spend: monthlySpend || undefined,
              ...(agencyBranding.slug ? { agency_slug: agencyBranding.slug } : {}),
            },
            emailRedirectTo: window.location.origin,
          },
        };
        const { error } = await supabase.auth.signUp(signUpPayload);
        if (error) throw error;
        navigate({ to: "/signup-success" });
      }
    } catch (err: any) {
      toast.error(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="light relative flex min-h-screen flex-col overflow-hidden"
      style={{ background: "linear-gradient(180deg, hsl(200 80% 90%) 0%, hsl(200 50% 93%) 35%, hsl(200 30% 96%) 65%, hsl(200 20% 97%) 100%)" }}>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[800px] w-[800px] rounded-full border border-white/30" />
        <div className="absolute h-[1100px] w-[1100px] rounded-full border border-white/15" />
      </div>

      <header className="relative z-10 h-14 flex items-center gap-3 px-6">
        {displayLogo ? (
          <img src={displayLogo} alt="Logo" className="h-8 w-8 rounded object-contain" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/10 backdrop-blur-sm">
            <LogIn className="h-4 w-4 text-foreground" />
          </div>
        )}
        {displayName && <span className="font-semibold text-foreground">{displayName}</span>}
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-[0_8px_60px_-12px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="px-8 pt-8 pb-6"
            style={{ background: "linear-gradient(180deg, hsl(195 60% 90% / 0.6) 0%, transparent 100%)" }}>
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-white/80 shadow-sm backdrop-blur-sm">
              <LogIn className="h-6 w-6 text-foreground" />
            </div>
            <h1 className="text-center text-xl font-bold text-foreground mb-1">
              {isLogin ? (welcomeTitle || "Sign in with email") : "Create your account"}
            </h1>
            <p className="text-center text-sm text-muted-foreground">
              {welcomeNote || (isLogin ? "Welcome back! Enter your credentials." : "Fill in the details to get started.")}
            </p>
          </div>

          <div className="px-8 pb-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="fullName" className="text-xs text-muted-foreground">Full Name</Label>
                    <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Doe" required className="h-11 rounded-xl bg-muted/50" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="businessName" className="text-xs text-muted-foreground">Business Name</Label>
                    <Input id="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Your Company Ltd." required className="h-11 rounded-xl bg-muted/50" />
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                {!isLogin && <Label htmlFor="email" className="text-xs text-muted-foreground">Email</Label>}
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required className="h-11 pl-10 rounded-xl bg-muted/50" />
                </div>
              </div>

              {!isLogin && (
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-xs text-muted-foreground">Phone Number</Label>
                  <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+880 1XXXXXXXXX" required className="h-11 rounded-xl bg-muted/50" />
                </div>
              )}

              <div className="space-y-1.5">
                {!isLogin && <Label htmlFor="password" className="text-xs text-muted-foreground">Password</Label>}
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                  <Input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required minLength={6} className="h-11 pl-10 pr-10 rounded-xl bg-muted/50" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {!isLogin && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="businessAddress" className="text-xs text-muted-foreground">Business Address</Label>
                    <Input id="businessAddress" value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)} placeholder="123 Main St, City" required className="h-11 rounded-xl bg-muted/50" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="monthlySpend" className="text-xs text-muted-foreground">Monthly Spend (USD)</Label>
                    <Select value={monthlySpend} onValueChange={setMonthlySpend}>
                      <SelectTrigger className="h-11 rounded-xl bg-muted/50"><SelectValue placeholder="Select range" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="$0 - $500">$0 - $500</SelectItem>
                        <SelectItem value="$500 - $2,000">$500 - $2,000</SelectItem>
                        <SelectItem value="$2,000 - $5,000">$2,000 - $5,000</SelectItem>
                        <SelectItem value="$5,000 - $10,000">$5,000 - $10,000</SelectItem>
                        <SelectItem value="$10,000+">$10,000+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {isLogin && (
                <div className="flex justify-end">
                  <button type="button" onClick={async () => {
                    if (!email) { toast.error("Enter email first"); return; }
                    try {
                      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
                      if (error) throw error;
                      toast.success("Reset link sent!");
                    } catch (err: any) { toast.error(err?.message || "Failed"); }
                  }} className="text-xs font-medium text-primary hover:underline">Forgot password?</button>
                </div>
              )}

              <Button type="submit" disabled={loading} className="w-full h-11 rounded-xl bg-foreground text-background hover:bg-foreground/90 font-semibold">
                {loading ? "Please wait..." : isLogin ? "Get Started" : "Sign Up"}
              </Button>

              <p className="text-center text-sm text-muted-foreground pt-2">
                {isLogin ? "Don't have an account? " : "Already have an account? "}
                <button type="button" onClick={() => setIsLogin(!isLogin)} className="font-medium text-primary hover:underline">
                  {isLogin ? "Sign up" : "Sign in"}
                </button>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
