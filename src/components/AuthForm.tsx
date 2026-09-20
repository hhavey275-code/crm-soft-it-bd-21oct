import { useState, useEffect, useLayoutEffect } from "react";
import { useTheme } from "next-themes";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { captureReferralCodeFromUrl } from "@/lib/referral";
import { useAuth } from "@/contexts/AuthContext";
import { useAgencyBranding } from "@/contexts/AgencyBrandingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogIn, Mail, Lock, Eye, EyeOff, Phone, Facebook, ArrowUpRight, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import softitbdLogo from "@/assets/softitbd-logo.png";
import softitbdBanner from "@/assets/softitbd-banner.png";
import softitbdLogoClear from "@/assets/softitbd-logo-clear.png";

const LOGIN_TIMEOUT_MS = 20_000;

const HELPLINE_DISPLAY = "01629344993";
const HELPLINE_TEL = "tel:+8801629344993";
const FACEBOOK_PAGE_URL = "https://www.facebook.com/SoftitBDDigitalMarket";
const FACEBOOK_PAGE_LABEL = "SoftITBD Digital Market";

function isTransientNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|network|load failed|timed out|timeout|connection/i.test(message);
}

async function signInWithNetworkRecovery(email: string, password: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("Login request timed out")), LOGIN_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt === 1) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
  }

  throw lastError;
}

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

  // Remember ?ref=CODE so the referrer can be attached after signup/OAuth.
  const [refCode, setRefCode] = useState<string | null>(null);
  useEffect(() => {
    setRefCode(captureReferralCodeFromUrl());
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      navigate({ to: "/dashboard" });
    }
  }, [user, authLoading, navigate]);

  const logoMark = agencyBranding.logoUrl || logoUrl || softitbdLogoClear;
  const displayLogo = agencyBranding.logoUrl || logoUrl || softitbdLogo;
  const displayName = agencyBranding.name || siteName || "SOFT IT BD";

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
      if (!data.url) throw new Error("Google login link পাওয়া যায়নি");
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
        if (!navigator.onLine) {
          throw new Error("ইন্টারনেট সংযোগ নেই। Mobile data চালু করে আবার চেষ্টা করুন।");
        }
        const { data, error } = await signInWithNetworkRecovery(email.trim(), password);
        if (error) throw error;
        if (!data.session) throw new Error("Login session তৈরি হয়নি। আবার চেষ্টা করুন।");
        toast.success("Welcome back!");
        navigate({ to: "/dashboard", replace: true });
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
      const message = err?.message || "Something went wrong";
      toast.error(
        isTransientNetworkError(err)
          ? "Network দুর্বল বা সংযোগ বিচ্ছিন্ন হয়েছে। একটু পরে আবার চেষ্টা করুন।"
          : message,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="light relative flex min-h-screen flex-col overflow-hidden"
      style={{ background: "linear-gradient(180deg, hsl(220 25% 97%) 0%, hsl(220 18% 95%) 40%, hsl(220 14% 96%) 100%)" }}>
      {/* Soft ambient tints */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[560px] w-[880px] -translate-x-1/2 rounded-full opacity-[0.07] blur-[120px]"
          style={{ background: "radial-gradient(closest-side, hsl(var(--primary)), transparent)" }} />
        <div className="absolute -bottom-48 -left-32 h-[480px] w-[480px] rounded-full opacity-[0.05] blur-[110px]"
          style={{ background: "radial-gradient(closest-side, hsl(var(--primary)), transparent)" }} />

        {/* Logo watermark */}
        {displayLogo ? (
          <>
            <img src={displayLogo} alt="" aria-hidden
              className="absolute -left-16 bottom-4 w-[320px] opacity-[0.05] sm:w-[440px]" />
            <img src={displayLogo} alt="" aria-hidden
              className="absolute -right-20 top-10 w-[280px] rotate-12 opacity-[0.04] sm:w-[380px]" />
          </>
        ) : null}

        {/* Floating rounded boxes — rising bottom → top across the page */}
        <div className="auth-rise-bg auth-bg-rise-1" />
        <div className="auth-rise-bg auth-bg-rise-2" />
        <div className="auth-rise-bg auth-bg-rise-3" />
        <div className="auth-rise-bg auth-bg-rise-4" />
        <div className="auth-rise-bg auth-bg-rise-5" />
        <div className="auth-rise-bg auth-bg-rise-6" />
        <div className="auth-rise-bg auth-bg-rise-7" />
        <div className="auth-rise-bg auth-bg-rise-8" />
        <div className="auth-rise-bg auth-bg-rise-9" />
        <div className="auth-rise-bg auth-bg-rise-10" />
      </div>

      <header className="relative z-10 flex items-center gap-3 px-5 py-3 sm:px-10 sm:py-5">
        {displayLogo ? (
          <img src={displayLogo} alt="Logo" className="h-9 w-9 rounded-xl object-contain ring-1 ring-foreground/10 sm:h-10 sm:w-10" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.06] ring-1 ring-foreground/10">
            <LogIn className="h-4 w-4 text-foreground" />
          </div>
        )}
        {displayName && (
          <span className="text-sm font-semibold tracking-wide text-foreground/90">{displayName}</span>
        )}
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-4 pt-1 sm:pb-6 sm:pt-2">
        <div className="auth-fade-up grid w-full max-w-4xl overflow-hidden rounded-[24px] border border-white/80 bg-white/85 shadow-[0_32px_90px_-24px_rgba(15,23,42,0.18),0_2px_8px_rgba(15,23,42,0.04)] backdrop-blur-xl sm:rounded-[28px] lg:grid-cols-[1.02fr_1fr] lg:items-stretch">
          {/* ===== Left brand panel ===== */}
          <div className="relative flex h-full min-h-0 flex-col justify-between overflow-hidden p-4 text-background sm:p-6 lg:min-h-[520px] lg:p-8"
            style={{ background: "linear-gradient(165deg, #0e2c55 0%, #14427c 55%, #0a1f42 100%)" }}>
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/25 blur-[110px]" />
            <div className="pointer-events-none absolute -left-20 bottom-1/3 h-64 w-64 rounded-full bg-sky-400/15 blur-[100px]" />

            {/* Rising rounded boxes — bottom to top, endless, mixed sizes */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <div className="auth-rise auth-rise-1" />
              <div className="auth-rise auth-rise-2" />
              <div className="auth-rise auth-rise-3" />
              <div className="auth-rise auth-rise-4" />
              <div className="auth-rise auth-rise-5" />
              <div className="auth-rise auth-rise-6" />
              <div className="auth-rise auth-rise-7" />
              <div className="auth-rise auth-rise-8" />
            </div>

            <div className="relative">
              <div className="inline-flex items-center gap-2.5 sm:gap-3">
                <img src={logoMark} alt="Logo" className="h-9 w-9 object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.5)] sm:h-12 sm:w-12" />
                <span className="auth-serif text-base font-semibold tracking-wide text-white sm:text-xl">Unlimited spend without hassle</span>
              </div>

              {/* Cover photo — full width of the panel, compact height (desktop only) */}
              <div className="-mx-6 mt-4 hidden sm:-mx-8 lg:block">
                <img
                  src={softitbdBanner}
                  alt={`${displayName} — We handle the ads, you scale the business`}
                  className="block h-32 w-full object-cover sm:h-40"
                />
              </div>

              <div className="hidden lg:block">
                <h2 className="auth-serif mt-4 whitespace-nowrap text-[20px] font-semibold leading-tight text-white sm:text-2xl">
                  {welcomeTitle || "Welcome to"}{" "}
                  <span className="font-bold">{displayName}</span>
                </h2>
                <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-background/70">
                  {welcomeNote || "Your digital success, our expertise. Sign in to manage your ad accounts and wallets."}
                </p>
                <div className="mt-4 h-px w-20 bg-gradient-to-r from-background/30 to-transparent" />
              </div>
            </div>

            <div className="relative mt-6 hidden space-y-2.5 text-sm lg:block">
              <a
                href={HELPLINE_TEL}
                className="flex items-center gap-3.5 rounded-2xl border border-background/10 bg-background/[0.06] px-4 py-2.5 transition-colors hover:bg-background/[0.12]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/10">
                  <Phone className="h-4 w-4" />
                </span>
                <span className="flex flex-col">
                  <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-background/50">Helpline</span>
                  <span className="font-mono text-[14px] font-semibold tracking-wide">{HELPLINE_DISPLAY}</span>
                </span>
              </a>
              <a
                href={FACEBOOK_PAGE_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3.5 rounded-2xl border border-background/10 bg-background/[0.06] px-4 py-2.5 transition-colors hover:bg-background/[0.12]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/10">
                  <Facebook className="h-4 w-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-background/50">Facebook Page</span>
                  <span className="truncate font-semibold">{FACEBOOK_PAGE_LABEL}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-background/50" />
              </a>
            </div>
          </div>

          {/* ===== Right sign-in panel ===== */}
          <div className="px-5 py-4 sm:px-9 sm:py-8">
            <div className="flex flex-col items-center text-center">
              <h1 className="auth-serif text-[22px] font-semibold leading-tight text-foreground sm:text-[26px]">
                {isLogin ? "Sign in" : "Create your account"}
              </h1>
              <p className="mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-muted-foreground sm:mt-2 sm:text-sm">
                {isLogin ? (welcomeTitle || "Welcome back") + " — enter your credentials to continue." : "Fill in the details to get started."}
              </p>
              <div className="mt-3 h-px w-16 bg-gradient-to-r from-transparent via-foreground/20 to-transparent sm:mt-4" />
            </div>

            <div className="mt-3 sm:mt-5">
              {refCode && !isLogin ? (
                <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                  Referral code <span className="font-mono font-semibold text-foreground">{refCode}</span> applied
                </div>
              ) : null}
              <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                {!isLogin && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="fullName" className="text-xs font-medium text-muted-foreground">Full Name</Label>
                      <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Doe" required className="h-11 rounded-2xl border-border/70 sm:h-12 bg-background/60 focus-visible:ring-primary/20" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="businessName" className="text-xs font-medium text-muted-foreground">Business Name</Label>
                      <Input id="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Your Company Ltd." required className="h-11 rounded-2xl border-border/70 sm:h-12 bg-background/60 focus-visible:ring-primary/20" />
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  {!isLogin && <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">Email</Label>}
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required className="h-11 rounded-2xl border-border/70 sm:h-12 bg-background/60 pl-11 focus-visible:ring-primary/20" />
                  </div>
                </div>

                {!isLogin && (
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="text-xs font-medium text-muted-foreground">Phone Number</Label>
                    <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+880 1XXXXXXXXX" required className="h-11 rounded-2xl border-border/70 sm:h-12 bg-background/60 focus-visible:ring-primary/20" />
                  </div>
                )}

                <div className="space-y-1.5">
                  {!isLogin && <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">Password</Label>}
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                    <Input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required minLength={6} className="h-11 rounded-2xl border-border/70 sm:h-12 bg-background/60 pl-11 pr-11 focus-visible:ring-primary/20" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors hover:text-foreground">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {!isLogin && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="businessAddress" className="text-xs font-medium text-muted-foreground">Business Address</Label>
                      <Input id="businessAddress" value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)} placeholder="123 Main St, City" required className="h-11 rounded-2xl border-border/70 sm:h-12 bg-background/60 focus-visible:ring-primary/20" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="monthlySpend" className="text-xs font-medium text-muted-foreground">Monthly Spend (USD)</Label>
                      <Select value={monthlySpend} onValueChange={setMonthlySpend}>
                        <SelectTrigger className="h-11 rounded-2xl border-border/70 sm:h-12 bg-background/60 focus-visible:ring-primary/20"><SelectValue placeholder="Select range" /></SelectTrigger>
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
                    }} className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline underline-offset-4">Forgot password?</button>
                  </div>
                )}

                <Button type="submit" disabled={loading} className="h-11 w-full rounded-2xl bg-foreground sm:h-12 text-base font-medium tracking-wide text-background shadow-[0_12px_28px_-10px_rgba(15,23,42,0.45)] transition-all hover:bg-foreground/90 active:scale-[0.99]">
                  {loading ? "Please wait..." : isLogin ? "Get Started" : "Sign Up"}
                </Button>

                <div className="relative my-1 sm:my-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border/70" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white/85 px-4 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">or continue with</span>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  variant="outline"
                  className="h-11 w-full gap-2.5 rounded-2xl sm:h-12 border-border/70 bg-white/70 font-medium text-foreground/90 transition-all hover:bg-white active:scale-[0.99]"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </Button>

                <p className="pt-1 text-center text-[13px] text-muted-foreground sm:pt-2 sm:text-sm">
                  {isLogin ? "Don't have an account? " : "Already have an account? "}
                  <button type="button" onClick={() => setIsLogin(!isLogin)} className="font-semibold text-foreground underline decoration-foreground/20 underline-offset-4 transition-colors hover:decoration-foreground/60">
                    {isLogin ? "Sign up" : "Sign in"}
                  </button>
                </p>
              </form>

              <div className="mt-2.5 hidden items-center justify-center gap-2 text-[11px] tracking-wide text-muted-foreground/70 sm:mt-4 sm:flex">
                <ShieldCheck className="h-3.5 w-3.5" />
                Secure sign-in · Your credentials are encrypted
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 pb-3 text-center text-[11px] tracking-wide text-muted-foreground/70 sm:pb-6 sm:text-xs">
        © {new Date().getFullYear()} || {displayName} || All Rights Reserved.
      </footer>
    </div>
  );
}
