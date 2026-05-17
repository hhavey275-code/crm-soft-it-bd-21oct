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
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error("Google login link পাওয়া যায়নি");
      window.location.assign(data.url);
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
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.session) throw new Error("Login session তৈরি হয়নি। আবার চেষ্টা করুন।");
        toast.success("Welcome back!");
        window.location.replace("/dashboard");
        return;
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

              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white/80 px-2 text-muted-foreground">or continue with</span>
                </div>
              </div>

              <Button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                variant="outline"
                className="w-full h-11 rounded-xl bg-white hover:bg-muted/40 font-medium gap-2"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
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
