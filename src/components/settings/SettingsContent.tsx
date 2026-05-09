import { useState, useRef } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Upload, Zap, Type, Megaphone, Volume2, Lock, Hand, Bot,
  Palette, ImageIcon, Settings, User, Shield, Bell, Download, Smartphone, Check,
  Building2, DollarSign, CreditCard, X, Key, Eye, EyeOff
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useColorTheme, type ColorTheme } from "@/contexts/ColorThemeContext";
import { OcrFallbackSection } from "@/components/settings/OcrFallbackSection";

const COLOR_THEMES: { id: ColorTheme; name: string; swatch: string; ring: string }[] = [
  { id: "blue",   name: "Ocean Blue",   swatch: "bg-[hsl(214,100%,44%)]", ring: "ring-[hsl(214,100%,44%)]" },
  { id: "orange", name: "Sunset Orange", swatch: "bg-[hsl(24,95%,53%)]",  ring: "ring-[hsl(24,95%,53%)]" },
  { id: "green",  name: "Emerald Green", swatch: "bg-[hsl(160,84%,35%)]", ring: "ring-[hsl(160,84%,35%)]" },
];

function AppearanceThemeSection() {
  const { colorTheme, setColorTheme } = useColorTheme();
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">Appearance</h2>
      </div>
      <Separator />
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Color Theme</CardTitle>
          <CardDescription>Choose your preferred accent color. Applies across the entire app.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {COLOR_THEMES.map((t) => {
              const active = colorTheme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setColorTheme(t.id);
                    toast.success(`${t.name} theme applied`);
                  }}
                  className={`relative flex flex-col items-center gap-2 rounded-xl border p-3 transition-all hover:border-primary/50 hover:bg-accent/40 ${
                    active ? `border-primary ring-2 ${t.ring} ring-offset-2 ring-offset-background` : "border-border"
                  }`}
                >
                  <div className={`h-12 w-12 rounded-full ${t.swatch} shadow-md`} />
                  <span className="text-xs font-medium">{t.name}</span>
                  {active && (
                    <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Light/Dark mode toggle is available in the top header — works with any color theme.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


const ANNOUNCEMENT_COLORS = [
  { label: "Primary Blue", value: "#2563eb" },
  { label: "Emerald Green", value: "#10b981" },
  { label: "Amber Orange", value: "#f59e0b" },
  { label: "Rose Red", value: "#f43f5e" },
  { label: "Violet Purple", value: "#8b5cf6" },
  { label: "Cyan", value: "#06b6d4" },
  { label: "White", value: "#ffffff" },
  { label: "Custom", value: "custom" },
];

const ANNOUNCEMENT_SIZES = [
  { label: "Small", value: "text-xs" },
  { label: "Medium", value: "text-sm" },
  { label: "Large", value: "text-base" },
  { label: "Extra Large", value: "text-lg" },
];

function TelegramForwardGroupSetting() {
  const { data: currentVal, refetch } = useQuery({
    queryKey: ["telegram-forward-group-id"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("value").eq("key", "telegram_forward_group_id").single();
      return data?.value ?? "";
    },
  });
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  if (currentVal && !input && !saving) setInput(currentVal);

  const handleSave = async () => {
    if (!input.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({ key: "telegram_forward_group_id", value: input.trim() }, { onConflict: "key" });
    setSaving(false);
    error ? toast.error("Failed to save") : (toast.success("Telegram forward group updated!"), refetch());
  };

  return (
    <div className="flex items-center gap-3">
      <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="-1001234567890" className="flex-1" />
      <Button onClick={handleSave} disabled={saving} size="sm">
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

const SECRET_KEYS = [
  { key: "tiktok_app_id", label: "TikTok App ID", description: "TikTok Marketing API App ID" },
  { key: "tiktok_app_secret", label: "TikTok App Secret", description: "TikTok Marketing API App Secret" },
  { key: "meta_proxy_url", label: "Meta Proxy URL", description: "Vercel Meta API proxy URL" },
  { key: "meta_proxy_secret", label: "Meta Proxy Secret", description: "Secret for Meta proxy authentication" },
];

function AdminSecretsSection() {
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const { data: storedSecrets, refetch } = useQuery({
    queryKey: ["admin-api-secrets"],
    queryFn: async () => {
      const keys = SECRET_KEYS.map(s => s.key);
      const { data } = await supabase.from("site_settings").select("key, value").in("key", keys);
      return data ?? [];
    },
  });

  // Sync stored secrets to local state
  if (storedSecrets && !loaded) {
    const map: Record<string, string> = {};
    for (const s of storedSecrets) {
      map[s.key] = s.value ?? "";
    }
    setSecrets(map);
    setLoaded(true);
  }

  const handleSave = async (key: string) => {
    const value = secrets[key];
    if (!value?.trim()) return;
    setSaving(key);
    const { error } = await supabase.from("site_settings").upsert({ key, value: value.trim() }, { onConflict: "key" });
    setSaving(null);
    if (error) {
      toast.error("Failed to save " + key);
    } else {
      toast.success("Saved successfully!");
      refetch();
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">API Secrets</h2>
      </div>
      <Separator />
      <p className="text-xs text-muted-foreground">
        এখানে API keys এবং secrets পরিবর্তন করতে পারবেন। Supabase Edge Function secrets (যেমন TIKTOK_APP_ID) পরিবর্তন করতে Supabase Dashboard → Edge Function Secrets এ যেতে হবে।
        নিচের settings গুলো site_settings টেবিলে সেভ হয়।
      </p>

      {SECRET_KEYS.map((sk) => (
        <Card key={sk.key}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4 text-amber-500" />
              {sk.label}
            </CardTitle>
            <CardDescription>{sk.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  type={visible[sk.key] ? "text" : "password"}
                  value={secrets[sk.key] ?? ""}
                  onChange={(e) => setSecrets(prev => ({ ...prev, [sk.key]: e.target.value }))}
                  placeholder={`Enter ${sk.label}`}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setVisible(prev => ({ ...prev, [sk.key]: !prev[sk.key] }))}
                >
                  {visible[sk.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={() => handleSave(sk.key)} disabled={saving === sk.key} size="sm">
                {saving === sk.key ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { profile, user, isAdmin } = useAuth();
  const {
    logoUrl, siteName: currentSiteName,
    headerAnnouncement: currentAnnouncement,
    welcomeTitle: currentWelcomeTitle,
    welcomeNote: currentWelcomeNote,
    announcementColor: currentAnnouncementColor,
    announcementSize: currentAnnouncementSize,
    refetch,
  } = useSiteSettings();

  // Profile
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [company, setCompany] = useState(profile?.company ?? "");
  const [saving, setSaving] = useState(false);

  // Logo
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Site Name
  const [siteNameInput, setSiteNameInput] = useState("");
  const [savingSiteName, setSavingSiteName] = useState(false);

  // Announcement
  const [announcementInput, setAnnouncementInput] = useState("");
  const [announcementColor, setAnnouncementColor] = useState("");
  const [customColor, setCustomColor] = useState("");
  const [announcementSize, setAnnouncementSize] = useState("");
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);

  // Welcome
  const [welcomeTitleInput, setWelcomeTitleInput] = useState("");
  const [welcomeNoteInput, setWelcomeNoteInput] = useState("");
  const [savingWelcome, setSavingWelcome] = useState(false);

  // Password
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // Notification sound
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("notification_sound") !== "false");
  const [uploadingSound, setUploadingSound] = useState(false);
  const soundFileRef = useRef<HTMLInputElement>(null);
  const customSoundUrl = localStorage.getItem("notification_sound_url");

  // Telegram Bot Token
  const { data: currentBotToken, refetch: refetchBotToken } = useQuery({
    queryKey: ["telegram-bot-token-setting"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("value").eq("key", "telegram_bot_token").single();
      return data?.value ?? "";
    },
    enabled: isAdmin,
  });
  const [botTokenInput, setBotTokenInput] = useState("");
  const [savingBotToken, setSavingBotToken] = useState(false);

  // Sync inputs
  if (currentSiteName && !siteNameInput && !savingSiteName) setSiteNameInput(currentSiteName);
  if (currentAnnouncement && !announcementInput && !savingAnnouncement) setAnnouncementInput(currentAnnouncement);
  if (currentAnnouncementColor && !announcementColor && !savingAnnouncement) {
    const isPreset = ANNOUNCEMENT_COLORS.some(c => c.value === currentAnnouncementColor);
    if (isPreset) {
      setAnnouncementColor(currentAnnouncementColor);
    } else {
      setAnnouncementColor("custom");
      setCustomColor(currentAnnouncementColor);
    }
  }
  if (currentAnnouncementSize && !announcementSize && !savingAnnouncement) setAnnouncementSize(currentAnnouncementSize);
  if (currentWelcomeTitle && !welcomeTitleInput && !savingWelcome) setWelcomeTitleInput(currentWelcomeTitle);
  if (currentWelcomeNote && !welcomeNoteInput && !savingWelcome) setWelcomeNoteInput(currentWelcomeNote);
  if (currentBotToken && !botTokenInput && !savingBotToken) setBotTokenInput(currentBotToken);

  // Handlers
  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ full_name: fullName, company }).eq("user_id", user.id);
    setSaving(false);
    error ? toast.error("Failed to update profile") : toast.success("Profile updated");
  };

  const handleSaveSiteName = async () => {
    if (!siteNameInput.trim()) return;
    setSavingSiteName(true);
    const { error } = await supabase.from("site_settings").upsert({ key: "site_name", value: siteNameInput.trim() }, { onConflict: "key" });
    setSavingSiteName(false);
    error ? toast.error("Failed to save site name") : (toast.success("Site name updated!"), refetch());
  };

  const handleSaveAnnouncement = async () => {
    setSavingAnnouncement(true);
    const finalColor = announcementColor === "custom" ? customColor : announcementColor;
    const promises = [
      supabase.from("site_settings").upsert({ key: "header_announcement", value: announcementInput.trim() }, { onConflict: "key" }),
      supabase.from("site_settings").upsert({ key: "announcement_color", value: finalColor || "#2563eb" }, { onConflict: "key" }),
      supabase.from("site_settings").upsert({ key: "announcement_size", value: announcementSize || "text-sm" }, { onConflict: "key" }),
    ];
    const results = await Promise.all(promises);
    setSavingAnnouncement(false);
    const hasError = results.some(r => r.error);
    hasError ? toast.error("Failed to save announcement") : (toast.success("Announcement updated!"), refetch());
  };

  const handleSaveWelcome = async () => {
    setSavingWelcome(true);
    const { error: e1 } = await supabase.from("site_settings").upsert({ key: "welcome_title", value: welcomeTitleInput.trim() }, { onConflict: "key" });
    const { error: e2 } = await supabase.from("site_settings").upsert({ key: "welcome_note", value: welcomeNoteInput.trim() }, { onConflict: "key" });
    setSavingWelcome(false);
    (e1 || e2) ? toast.error("Failed to save welcome settings") : (toast.success("Welcome settings updated!"), refetch());
  };

  const handleSaveBotToken = async () => {
    if (!botTokenInput.trim()) return;
    setSavingBotToken(true);
    const { error } = await supabase.from("site_settings").upsert({ key: "telegram_bot_token", value: botTokenInput.trim() }, { onConflict: "key" });
    setSavingBotToken(false);
    error ? toast.error("Failed to save bot token") : (toast.success("Telegram bot token updated!"), refetchBotToken());
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const filePath = `brand-logo.${ext}`;
    const { error: uploadError } = await supabase.storage.from("logos").upload(filePath, file, { upsert: true });
    if (uploadError) { toast.error("Failed to upload logo"); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("logos").getPublicUrl(filePath);
    const publicUrl = urlData.publicUrl + "?t=" + Date.now();
    const { error: settingsError } = await supabase.from("site_settings").upsert({ key: "logo_url", value: publicUrl }, { onConflict: "key" });
    setUploading(false);
    settingsError ? toast.error("Failed to save logo setting") : (toast.success("Logo updated!"), refetch());
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match"); return; }
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) { toast.error(error.message); } else { toast.success("Password changed!"); setNewPassword(""); setConfirmPassword(""); }
  };

  const handleSoundToggle = (checked: boolean) => {
    setSoundEnabled(checked);
    localStorage.setItem("notification_sound", checked ? "true" : "false");
    toast.success(checked ? "Notification sound enabled" : "Notification sound disabled");
  };

  const handleSoundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) { toast.error("Please upload an audio file"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("File must be under 2MB"); return; }

    setUploadingSound(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      localStorage.setItem("notification_sound_url", dataUrl);
      toast.success("Notification sound uploaded!");
    } catch {
      toast.error("Failed to save custom sound");
    } finally {
      setUploadingSound(false);
    }
  };

  const handleTestSound = () => {
    const url = localStorage.getItem("notification_sound_url");
    if (url) {
      const audio = new Audio(url);
      audio.volume = 0.5;
      audio.play().catch(() => toast.error("Could not play sound"));
    } else {
      // Default beep
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 800; osc.type = "sine"; gain.gain.value = 0.3;
        osc.start(); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.stop(ctx.currentTime + 0.3);
      } catch { toast.error("Audio not available"); }
    }
  };

  const resolvedColor = announcementColor === "custom" ? customColor : announcementColor;

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-3xl">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6 text-primary" />
            Settings
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your account and platform preferences</p>
        </div>

        {/* ─── Appearance / Color Theme (all users) ─── */}
        <AppearanceThemeSection />

        {/* ─── ADMIN: Branding Section ─── */}
        {isAdmin && (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">Branding & Appearance</h2>
            </div>
            <Separator />

            {/* Brand Logo */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-violet-500" />
                  Brand Logo
                </CardTitle>
                <CardDescription>Upload your brand logo for sidebar, header & login page</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="h-16 w-16 rounded-xl border object-contain p-1 bg-muted" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl border bg-muted">
                      <Zap className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      <Upload className="mr-2 h-4 w-4" />
                      {uploading ? "Uploading..." : "Upload Logo"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Site Name */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Type className="h-4 w-4 text-blue-500" />
                  Site Name
                </CardTitle>
                <CardDescription>Displayed in the sidebar and across the platform</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Input value={siteNameInput} onChange={(e) => setSiteNameInput(e.target.value)} placeholder="Meta Ad Top-Up" className="flex-1" />
                  <Button onClick={handleSaveSiteName} disabled={savingSiteName} size="sm">
                    {savingSiteName ? "Saving..." : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Announcement */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-amber-500" />
                  Header Announcement
                </CardTitle>
                <CardDescription>Scrolling ticker shown in the header bar for all users</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={announcementInput}
                  onChange={(e) => setAnnouncementInput(e.target.value)}
                  placeholder="🎉 Welcome to our platform! New features coming soon..."
                  rows={2}
                />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Text Color</Label>
                    <div className="flex items-center gap-2">
                      <Select value={announcementColor || "#2563eb"} onValueChange={(v) => { setAnnouncementColor(v); if (v !== "custom") setCustomColor(""); }}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select color" />
                        </SelectTrigger>
                        <SelectContent>
                          {ANNOUNCEMENT_COLORS.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              <div className="flex items-center gap-2">
                                {c.value !== "custom" && <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: c.value }} />}
                                {c.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {announcementColor === "custom" && (
                      <div className="flex items-center gap-2">
                        <input type="color" value={customColor || "#2563eb"} onChange={(e) => setCustomColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                        <Input value={customColor} onChange={(e) => setCustomColor(e.target.value)} placeholder="#ff5733" className="flex-1 h-8 text-xs" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Text Size</Label>
                    <Select value={announcementSize || "text-sm"} onValueChange={setAnnouncementSize}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select size" />
                      </SelectTrigger>
                      <SelectContent>
                        {ANNOUNCEMENT_SIZES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Preview */}
                {announcementInput && (
                  <div className="rounded-lg border bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground mb-1">Preview:</p>
                    <span className={`font-medium ${announcementSize || "text-sm"}`} style={{ color: resolvedColor || "#2563eb" }}>
                      {announcementInput}
                    </span>
                  </div>
                )}

                <Button onClick={handleSaveAnnouncement} disabled={savingAnnouncement} size="sm">
                  {savingAnnouncement ? "Saving..." : "Save Announcement"}
                </Button>
              </CardContent>
            </Card>

            {/* Welcome Settings */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Hand className="h-4 w-4 text-violet-500" />
                  Auth Page Welcome
                </CardTitle>
                <CardDescription>Customize the welcome message on the login/signup page</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Welcome Title</Label>
                  <Input value={welcomeTitleInput} onChange={(e) => setWelcomeTitleInput(e.target.value)} placeholder="Welcome" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Welcome Note</Label>
                  <Textarea value={welcomeNoteInput} onChange={(e) => setWelcomeNoteInput(e.target.value)} placeholder="Sign in to manage your ad campaigns" rows={2} />
                </div>
                <Button onClick={handleSaveWelcome} disabled={savingWelcome} size="sm">
                  {savingWelcome ? "Saving..." : "Save Welcome Settings"}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ─── ADMIN: Integrations Section ─── */}
        {isAdmin && (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">Integrations</h2>
            </div>
            <Separator />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Bot className="h-4 w-4 text-sky-500" />
                  Telegram Bot Token
                </CardTitle>
                <CardDescription>Used for receiving bank notification messages via Telegram</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Input type="password" value={botTokenInput} onChange={(e) => setBotTokenInput(e.target.value)} placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" className="flex-1" />
                  <Button onClick={handleSaveBotToken} disabled={savingBotToken} size="sm">
                    {savingBotToken ? "Saving..." : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Telegram Forward Group ID */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Bot className="h-4 w-4 text-green-500" />
                  Telegram Forward Group
                </CardTitle>
                <CardDescription>Top-up proof images will be forwarded to this Telegram group/channel on approval</CardDescription>
              </CardHeader>
              <CardContent>
                <TelegramForwardGroupSetting />
              </CardContent>
            </Card>
          </div>
        )}

        {/* ─── ADMIN: API Secrets Section ─── */}
        {isAdmin && <AdminSecretsSection />}

        {/* ─── ADMIN: OCR Fallback Providers ─── */}
        {isAdmin && <OcrFallbackSection />}

        {/* ─── Notification Section (All users) ─── */}
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">Notifications</h2>
          </div>
          <Separator />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-blue-500" />
                Notification Sound
              </CardTitle>
              <CardDescription>Configure alert sounds for new notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable notification sound</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Play a sound when you receive a new notification</p>
                </div>
                <Switch checked={soundEnabled} onCheckedChange={handleSoundToggle} />
              </div>

              {soundEnabled && (
                <div className="space-y-3 pt-2 border-t">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium">Custom Sound</p>
                      <p className="text-xs text-muted-foreground">Upload an audio file (MP3, WAV — max 2MB)</p>
                    </div>
                    <input ref={soundFileRef} type="file" accept="audio/*" className="hidden" onChange={handleSoundUpload} />
                    <Button variant="outline" size="sm" disabled={uploadingSound} onClick={() => soundFileRef.current?.click()}>
                      <Upload className="mr-2 h-3.5 w-3.5" />
                      {uploadingSound ? "Uploading..." : "Upload"}
                    </Button>
                  </div>
                  {customSoundUrl && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Volume2 className="h-3 w-3" />
                      <span>Custom sound uploaded</span>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { localStorage.removeItem("notification_sound_url"); toast.success("Reset to default beep"); window.location.reload(); }}>
                        Reset to default
                      </Button>
                    </div>
                  )}
                  <Button variant="secondary" size="sm" onClick={handleTestSound}>
                    <Volume2 className="mr-2 h-3.5 w-3.5" />
                    Test Sound
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ─── Account Section (All users) ─── */}
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">Account</h2>
          </div>
          <Separator />

          {/* Profile */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Profile</CardTitle>
              <CardDescription>Your personal information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Email</Label>
                <Input value={user?.email ?? ""} disabled className="bg-muted" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Full Name</Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Company</Label>
                  <Input value={company} onChange={(e) => setCompany(e.target.value)} />
                </div>
              </div>
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </CardContent>
          </Card>

          {/* Password */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="h-4 w-4 text-orange-500" />
                Change Password
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs font-medium">New Password</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" minLength={6} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Confirm Password</Label>
                  <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" minLength={6} />
                </div>
              </div>
              <Button onClick={handleChangePassword} disabled={changingPassword || !newPassword || !confirmPassword} size="sm">
                {changingPassword ? "Changing..." : "Change Password"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ─── Card Billing / Google Sheet Config (Admin only) ─── */}
        {isAdmin && <CardBillingConfigSection />}

        {/* ─── Install App Section (All users) ─── */}
        <InstallAppSection />

        {/* ─── Chrome Extension: Card Remover ─── */}
        <CardRemoverExtensionSection />

        {/* ─── Chrome Extension: DSL & Cards Sync (admin) ─── */}
        {isAdmin && <DslSyncExtensionSection />}
      </div>
    </DashboardLayout>
  );
}

function LicenseConfigSection() {
  const [masterUrl, setMasterUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentType, setPaymentType] = useState("subscription");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [limitAmount, setLimitAmount] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const proofRef = useRef<HTMLInputElement>(null);
  const [testMode, setTestMode] = useState(false);

  const { data: licenseData, refetch } = useQuery({
    queryKey: ["license-config"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("key, value").in("key", [
        "master_url", "tenant_api_key", "license_status", "license_system_limit",
        "license_total_used", "license_subscription_type", "license_subscription_paid_until",
      ]);
      const map: Record<string, string> = {};
      if (data) for (const r of data) map[r.key] = r.value || "";
      return map;
    },
  });

  const realConfigured = !!licenseData?.master_url && !!licenseData?.tenant_api_key;
  const isConfigured = realConfigured || testMode;

  const mockLicense = testMode && !realConfigured ? {
    license_status: "active",
    license_subscription_type: "subscription_with_limit",
    license_system_limit: "5000",
    license_total_used: "1250",
    license_subscription_paid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    master_url: "https://test-master.supabase.co",
    tenant_api_key: "test-api-key",
  } : null;

  const effectiveLicense = mockLicense || licenseData;

  const mockBanks = testMode && !realConfigured ? [
    { id: "1", bank_name: "Brac Bank", account_name: "SoftIT BD", account_number: "1234567890123", branch: "Dhaka" },
    { id: "2", bank_name: "Dutch Bangla Bank", account_name: "SoftIT BD", account_number: "9876543210456", branch: "Chittagong" },
  ] : null;

  // Fetch assigned banks from master
  const { data: fetchedBanks = [] } = useQuery({
    queryKey: ["license-banks", licenseData?.master_url, licenseData?.tenant_api_key],
    queryFn: async () => {
      if (!licenseData?.master_url || !licenseData?.tenant_api_key) return [];
      const res = await fetch(`${licenseData.master_url}/functions/v1/tenant-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Key": licenseData.tenant_api_key },
        body: JSON.stringify({ action: "get-banks" }),
      });
      const data = await res.json();
      return data.banks || [];
    },
    enabled: realConfigured,
    staleTime: 5 * 60 * 1000,
  });

  const assignedBanks = mockBanks || fetchedBanks;

  // Fetch payment history from master
  const { data: paymentHistory = [], refetch: refetchPayments } = useQuery({
    queryKey: ["license-payments", licenseData?.master_url, licenseData?.tenant_api_key],
    queryFn: async () => {
      if (!licenseData?.master_url || !licenseData?.tenant_api_key) return [];
      const res = await fetch(`${licenseData.master_url}/functions/v1/tenant-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Key": licenseData.tenant_api_key },
        body: JSON.stringify({ action: "get-payments" }),
      });
      const data = await res.json();
      return data.payments || [];
    },
    enabled: realConfigured,
    staleTime: 60 * 1000,
  });

  // Sync inputs
  if (licenseData?.master_url && !masterUrl && !saving) setMasterUrl(licenseData.master_url);
  if (licenseData?.tenant_api_key && !apiKey && !saving) setApiKey(licenseData.tenant_api_key);

  const saveLicenseConfig = async () => {
    if (!masterUrl || !apiKey) { toast.error("Both fields required"); return; }
    setSaving(true);
    const keys = [
      { key: "master_url", value: masterUrl.replace(/\/+$/, "") },
      { key: "tenant_api_key", value: apiKey },
      { key: "is_tenant", value: "true" },
    ];
    for (const k of keys) {
      const { data: existing } = await supabase.from("site_settings").select("id").eq("key", k.key).single();
      if (existing) {
        await supabase.from("site_settings").update({ value: k.value }).eq("key", k.key);
      } else {
        await supabase.from("site_settings").insert({ key: k.key, value: k.value });
      }
    }
    setSaving(false);
    refetch();
    toast.success("License config saved");
  };

  const checkLicense = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("license-check", {
        body: { action: "heartbeat" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      refetch();
      toast.success(`License status: ${data.status || "checked"}`);
    } catch (e: any) {
      toast.error(e.message || "License check failed");
    }
    setChecking(false);
  };

  const submitPayment = async () => {
    if (!paymentAmount || Number(paymentAmount) <= 0) { toast.error("Enter a valid amount"); return; }
    if (testMode && !realConfigured) { toast.success("(Test Mode) Payment submitted! In real mode this goes to master."); setPaymentAmount(""); setLimitAmount(""); setProofFile(null); return; }
    if (!licenseData?.master_url || !licenseData?.tenant_api_key) { toast.error("Configure master connection first"); return; }

    setSubmittingPayment(true);
    try {
      let proofUrl = null;
      if (proofFile) {
        const ext = proofFile.name.split(".").pop();
        const filePath = `tenant-proof-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("payment-proofs").upload(filePath, proofFile, { upsert: true });
        if (upErr) throw new Error("Failed to upload proof");
        const { data: urlData } = supabase.storage.from("payment-proofs").getPublicUrl(filePath);
        proofUrl = urlData.publicUrl;
      }

      const res = await fetch(`${licenseData.master_url}/functions/v1/tenant-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Key": licenseData.tenant_api_key },
        body: JSON.stringify({
          action: "submit-payment",
          amount: Number(paymentAmount),
          proof_url: proofUrl,
          payment_type: paymentType,
          limit_amount: paymentType === "limit_purchase" ? Number(limitAmount) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment failed");
      toast.success("Payment submitted! Waiting for approval.");
      setPaymentAmount("");
      setLimitAmount("");
      setProofFile(null);
      refetchPayments();
    } catch (e: any) {
      toast.error(e.message);
    }
    setSubmittingPayment(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">License Configuration</h2>
        </div>
        <Button
          variant={testMode ? "default" : "outline"}
          size="sm"
          onClick={() => setTestMode(!testMode)}
          className="text-xs gap-1.5"
        >
          <Shield className="h-3 w-3" />
          {testMode ? "Test Mode ✓" : "Enable Test Mode"}
        </Button>
      </div>
      <Separator />

      {isConfigured && effectiveLicense && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              License Status
              {mockLicense && <Badge variant="outline" className="text-xs">Test Mode</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Status:</span> <span className="font-medium">{effectiveLicense.license_status || "Unknown"}</span></div>
              <div><span className="text-muted-foreground">Type:</span> <span className="font-medium">{effectiveLicense.license_subscription_type === "subscription_with_limit" ? "Sub + Limit" : "Sub Only"}</span></div>
              {effectiveLicense.license_subscription_type === "subscription_with_limit" && (
                <>
                  <div><span className="text-muted-foreground">Limit:</span> <span className="font-medium">${Number(effectiveLicense.license_system_limit || 0).toLocaleString()}</span></div>
                  <div><span className="text-muted-foreground">Used:</span> <span className="font-medium">${Number(effectiveLicense.license_total_used || 0).toLocaleString()}</span></div>
                </>
              )}
              {effectiveLicense.license_subscription_paid_until && (
                <div className="col-span-2"><span className="text-muted-foreground">Paid Until:</span> <span className="font-medium">{new Date(effectiveLicense.license_subscription_paid_until).toLocaleDateString()}</span></div>
              )}
            </div>
            {!mockLicense && (
              <Button size="sm" onClick={checkLicense} disabled={checking} className="mt-2">
                {checking ? "Checking..." : "Refresh License"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Master Connection</CardTitle>
          <CardDescription>Connect to the master CRM for licensing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Master URL</Label>
            <Input value={masterUrl || licenseData?.master_url || ""} onChange={e => setMasterUrl(e.target.value)} placeholder="https://master-crm.supabase.co" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Tenant API Key</Label>
            <Input value={apiKey || licenseData?.tenant_api_key || ""} onChange={e => setApiKey(e.target.value)} placeholder="UUID API key from master" />
          </div>
          <div className="flex gap-2">
            <Button onClick={saveLicenseConfig} disabled={saving} size="sm">
              {saving ? "Saving..." : "Save Config"}
            </Button>
            {isConfigured && (
              <Button variant="outline" onClick={checkLicense} disabled={checking} size="sm">
                {checking ? "Checking..." : "Test Connection"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Assigned Banks */}
      {isConfigured && assignedBanks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Payment Bank Accounts
            </CardTitle>
            <CardDescription>এই bank গুলোতে payment করুন</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {assignedBanks.map((bank: any) => (
                <div key={bank.id} className="border rounded-lg p-3 space-y-1">
                  <div className="font-medium text-sm">{bank.bank_name}</div>
                  <div className="text-sm text-muted-foreground">Account: {bank.account_name}</div>
                  <div className="text-sm font-mono">{bank.account_number}</div>
                  {bank.branch && <div className="text-xs text-muted-foreground">Branch: {bank.branch}</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submit Payment */}
      {isConfigured && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Submit Payment
            </CardTitle>
            <CardDescription>Subscription বা System Limit এর জন্য payment submit করুন</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Payment Type</Label>
              <Select value={paymentType} onValueChange={setPaymentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="subscription">Subscription Fee</SelectItem>
                  <SelectItem value="limit_purchase">System Limit Purchase</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Amount ($)</Label>
              <Input type="number" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="Enter amount" />
            </div>
            {paymentType === "limit_purchase" && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">Limit Amount ($)</Label>
                <Input type="number" value={limitAmount} onChange={e => setLimitAmount(e.target.value)} placeholder="How much limit to add" />
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Payment Proof</Label>
              <input ref={proofRef} type="file" accept="image/*" className="hidden" onChange={e => setProofFile(e.target.files?.[0] || null)} />
              <Button variant="outline" size="sm" onClick={() => proofRef.current?.click()}>
                <Upload className="mr-2 h-3 w-3" />
                {proofFile ? proofFile.name : "Upload Screenshot"}
              </Button>
            </div>
            <Button className="w-full" onClick={submitPayment} disabled={submittingPayment || !paymentAmount}>
              {submittingPayment ? "Submitting..." : "Submit Payment"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Payment History */}
      {isConfigured && paymentHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payment History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {paymentHistory.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <div className="text-sm font-medium">${Number(p.amount).toLocaleString()} — {p.payment_type}</div>
                    <div className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</div>
                  </div>
                  <Badge variant={p.status === "approved" ? "default" : p.status === "rejected" ? "destructive" : "secondary"}>
                    {p.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InstallAppSection() {
  const { canInstall, isInstalled, isIOS, promptInstall } = useInstallPrompt();
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    setInstalling(true);
    const accepted = await promptInstall();
    setInstalling(false);
    if (accepted) {
      toast.success("App installing! Check your home screen.");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">Install App</h2>
      </div>
      <Separator />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            Download & Install
          </CardTitle>
          <CardDescription>
            আপনার ফোনে অ্যাপ হিসেবে ইনস্টল করুন — ব্রাউজার ছাড়াই চলবে
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isInstalled ? (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 p-3 rounded-lg">
              <Check className="h-4 w-4" />
              <span>অ্যাপ ইতিমধ্যে ইনস্টল করা আছে!</span>
            </div>
          ) : canInstall ? (
            <Button onClick={handleInstall} disabled={installing} className="w-full gap-2">
              <Download className="h-4 w-4" />
              {installing ? "Installing..." : "Install App Now"}
            </Button>
          ) : isIOS ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                iPhone / iPad এ ইনস্টল করতে:
              </p>
              <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
                <li>Safari ব্রাউজারে এই পেজ ওপেন করুন</li>
                <li>নিচে <strong>Share</strong> (↑) বাটনে ট্যাপ করুন</li>
                <li><strong>"Add to Home Screen"</strong> সিলেক্ট করুন</li>
                <li><strong>"Add"</strong> ট্যাপ করুন</li>
              </ol>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Android এ ইনস্টল করতে:
              </p>
              <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
                <li>Chrome ব্রাউজারে এই পেজ ওপেন করুন</li>
                <li>উপরে ডানদিকে <strong>⋮</strong> মেনু ট্যাপ করুন</li>
                <li><strong>"Install app"</strong> বা <strong>"Add to Home Screen"</strong> সিলেক্ট করুন</li>
                <li><strong>"Install"</strong> ট্যাপ করুন</li>
              </ol>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CardBillingConfigSection() {
  const { data: saJson, refetch: refetchSa } = useQuery({
    queryKey: ["google-sa-json"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("value").eq("key", "google_service_account_json").single();
      return data?.value ?? "";
    },
  });
  const [saInput, setSaInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const { data: configs, refetch: refetchConfigs } = useQuery({
    queryKey: ["card-billing-configs"],
    queryFn: async () => {
      const { data } = await supabase.from("card_billing_config").select("*");
      return data || [];
    },
  });

  const { data: clients } = useQuery({
    queryKey: ["all-clients-for-card"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email, company").order("full_name");
      return data || [];
    },
  });

  const [newConfig, setNewConfig] = useState({ user_id: "", client_label: "", sheet_id: "", due_cell: "AC2", payment_cell_column: "X", payment_date_column: "W", next_payment_row: 2 });

  const handleSaveSa = async () => {
    if (!saInput.trim()) return;
    setSaving(true);
    await supabase.from("site_settings").upsert({ key: "google_service_account_json", value: saInput.trim() }, { onConflict: "key" });
    setSaving(false);
    toast.success("Google Service Account saved!");
    refetchSa();
  };

  const handleAddConfig = async () => {
    if (!newConfig.user_id || !newConfig.sheet_id) { toast.error("Client and Sheet ID required"); return; }
    const { error } = await supabase.from("card_billing_config").insert(newConfig as any);
    if (error) { toast.error(error.message); return; }
    toast.success("Config added!");
    setNewConfig({ user_id: "", client_label: "", sheet_id: "", due_cell: "AC2", payment_cell_column: "X", payment_date_column: "W", next_payment_row: 2 });
    refetchConfigs();
  };

  const handleDeleteConfig = async (id: string) => {
    await supabase.from("card_billing_config").delete().eq("id", id);
    toast.success("Config deleted");
    refetchConfigs();
  };

  const handleSyncDues = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-card-bills", { body: { action: "sync_dues" } });
      if (error) throw error;
      toast.success(`Synced ${data?.synced || 0} clients from Google Sheets`);
    } catch (e: any) {
      toast.error(e.message || "Sync failed");
    }
    setSyncing(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">Card Billing — Google Sheet Sync</h2>
      </div>
      <Separator />

      {/* Service Account JSON */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Google Service Account</CardTitle>
          <CardDescription>Google Sheets API তে access করতে Service Account JSON paste করুন</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
            value={saInput || (saJson ? "••••• (configured)" : "")}
            onChange={e => setSaInput(e.target.value)}
            rows={3}
            className="font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveSa} disabled={saving || !saInput.trim()}>
              {saving ? "Saving..." : "Save Credentials"}
            </Button>
            {saJson && (
              <Button size="sm" variant="outline" onClick={handleSyncDues} disabled={syncing}>
                {syncing ? "Syncing..." : "Sync Dues Now"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Client Configs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Client Sheet Mapping</CardTitle>
          <CardDescription>প্রতিটি client এর Google Sheet config সেট করুন — Due cell, Payment column</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Existing configs */}
          {configs && configs.length > 0 && (
            <div className="space-y-2">
              {configs.map((c: any) => {
                const client = clients?.find((cl: any) => cl.user_id === c.user_id);
                return (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                    <div>
                      <p className="text-sm font-medium">{c.client_label || client?.full_name || client?.email || c.user_id.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">Sheet: {c.sheet_id.slice(0, 20)}... | Due: {c.due_cell} | Pay: {c.payment_cell_column}{c.next_payment_row}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleDeleteConfig(c.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add new config */}
          <div className="grid grid-cols-2 gap-3 p-3 border rounded-lg">
            <div>
              <Label className="text-xs">Client</Label>
              <Select value={newConfig.user_id} onValueChange={v => setNewConfig(p => ({ ...p, user_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients?.map((c: any) => (
                    <SelectItem key={c.user_id} value={c.user_id}>{c.full_name || c.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Client Label</Label>
              <Input value={newConfig.client_label} onChange={e => setNewConfig(p => ({ ...p, client_label: e.target.value }))} placeholder="e.g. Sabbir bhai" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Google Sheet ID</Label>
              <Input value={newConfig.sheet_id} onChange={e => setNewConfig(p => ({ ...p, sheet_id: e.target.value }))} placeholder="Sheet URL থেকে /d/ এর পরের ID" />
            </div>
            <div>
              <Label className="text-xs">Due Cell</Label>
              <Input value={newConfig.due_cell} onChange={e => setNewConfig(p => ({ ...p, due_cell: e.target.value }))} placeholder="AC2" />
            </div>
            <div>
              <Label className="text-xs">Payment Column</Label>
              <Input value={newConfig.payment_cell_column} onChange={e => setNewConfig(p => ({ ...p, payment_cell_column: e.target.value }))} placeholder="X" />
            </div>
            <div>
              <Label className="text-xs">Date Column</Label>
              <Input value={newConfig.payment_date_column} onChange={e => setNewConfig(p => ({ ...p, payment_date_column: e.target.value }))} placeholder="W" />
            </div>
            <div>
              <Label className="text-xs">Next Row</Label>
              <Input type="number" value={newConfig.next_payment_row} onChange={e => setNewConfig(p => ({ ...p, next_payment_row: Number(e.target.value) }))} />
            </div>
            <div className="col-span-2">
              <Button size="sm" onClick={handleAddConfig} className="w-full">Add Client Config</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CardRemoverExtensionSection() {
  const handleDownload = () => {
    fetch("/card-remover-extension.zip")
      .then((res) => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "card-remover-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => alert(err.message));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">Chrome Extension — Card Remover</h2>
      </div>
      <Separator />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meta Ad Account থেকে Card Remove করুন</CardTitle>
          <CardDescription>
            আপনার logged-in Facebook session ব্যবহার করে ad account থেকে payment method remove করার জন্য একটি Chrome extension।
            smit.vn-এর মতোই কাজ করে — Meta-তে direct না গিয়েও card remove করতে পারবেন।
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={handleDownload} className="w-full gap-2">
            <Download className="h-4 w-4" />
            Download Extension (.zip)
          </Button>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-semibold mb-1">Install করার নিয়ম:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
              <li>ZIP file unzip করুন</li>
              <li>Chrome এ <code className="bg-background px-1 rounded">chrome://extensions</code> open করুন</li>
              <li>উপরে ডানদিকে <strong>Developer mode</strong> ON করুন</li>
              <li><strong>Load unpacked</strong> click করে unzip করা folder select করুন</li>
              <li>Extension icon click করে Ad Account ID দিন → Load Cards → Remove</li>
            </ol>
          </div>
          <p className="text-xs text-muted-foreground">
            ⚠️ Same browser-এ facebook.com login থাকা আবশ্যক। Brave/Edge/Opera-তেও কাজ করবে।
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function DslSyncExtensionSection() {
  const handleDownload = () => {
    fetch("/dsl-sync-extension.zip")
      .then((res) => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "dsl-sync-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => alert(err.message));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">Chrome Extension — DSL &amp; Cards Sync (v2.5.0)</h2>
      </div>
      <Separator />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default + Backup card auto-sync to CRM</CardTitle>
          <CardDescription>
            Admin Meta Ads Billing page open korlei extension passively default + backup card-er last-4 + brand
            CRM-e push kore. Account access hariye gele card identify korar jonno useful (account-recovery only)।
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={handleDownload} className="w-full gap-2">
            <Download className="h-4 w-4" />
            Download Extension (.zip)
          </Button>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-semibold mb-1">Install করার নিয়ম:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
              <li>ZIP file unzip করুন</li>
              <li>Chrome এ <code className="bg-background px-1 rounded">chrome://extensions</code> open করুন</li>
              <li>উপরে ডানদিকে <strong>Developer mode</strong> ON করুন</li>
              <li><strong>Load unpacked</strong> click করে unzip করা folder select করুন</li>
              <li>Same browser-এ CRM + Facebook দুটোতেই login থাকতে হবে</li>
              <li>Meta Ads Manager → Billing page open করলেই auto-sync হবে</li>
            </ol>
          </div>
          <p className="text-xs text-muted-foreground">
            🔒 শুধু brand + last-4 + expiry store হয় — full card number / CVV কখনো store হয় না।
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
