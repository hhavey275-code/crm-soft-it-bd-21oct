import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { UserCheck } from "lucide-react";

const SPEND_RANGES = [
  "$0 - $500",
  "$500 - $2,000",
  "$2,000 - $5,000",
  "$5,000 - $10,000",
  "$10,000+",
];

function isBlank(value: string | null | undefined) {
  return !value || value.trim().length === 0;
}

/**
 * Google sign-up skips the signup form, so phone / monthly spend can be empty.
 * Clients must fill them before using the CRM (needed for follow-up messaging).
 */
export function CompleteProfileGate({ children }: { children: React.ReactNode }) {
  const { user, profile, role } = useAuth();
  const [phone, setPhone] = useState("");
  const [monthlySpend, setMonthlySpend] = useState("");
  const [saving, setSaving] = useState(false);

  const needsInfo =
    !!user &&
    !!profile &&
    role === "client" &&
    (isBlank(profile.phone) || isBlank(profile.monthly_spend));

  if (!needsInfo) return <>{children}</>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedPhone = phone.trim();
    if (cleanedPhone.replace(/\D/g, "").length < 10) {
      toast.error("সঠিক phone number দিন (কমপক্ষে ১০ ডিজিট)");
      return;
    }
    if (!monthlySpend) {
      toast.error("Monthly spend select করুন");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ phone: cleanedPhone, monthly_spend: monthlySpend })
        .eq("user_id", user!.id);
      if (error) throw error;
      toast.success("ধন্যবাদ! তথ্য সংরক্ষণ হয়েছে।");
      window.location.reload();
    } catch (err: any) {
      toast.error(err?.message || "Save করা যায়নি, আবার চেষ্টা করুন");
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-5 p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <UserCheck className="h-7 w-7 text-primary" />
          </div>
          <div className="space-y-1 text-center">
            <h2 className="text-xl font-bold">Complete your profile</h2>
            <p className="text-sm text-muted-foreground">
              আপনার phone number এবং monthly spend দিলেই dashboard ব্যবহার করতে পারবেন।
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cp-phone">Phone Number</Label>
              <Input
                id="cp-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+880 1XXXXXXXXX"
                required
                className="h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cp-spend">Monthly Spend (USD)</Label>
              <Select value={monthlySpend} onValueChange={setMonthlySpend}>
                <SelectTrigger id="cp-spend" className="h-11">
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent>
                  {SPEND_RANGES.map((range) => (
                    <SelectItem key={range} value={range}>
                      {range}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" disabled={saving} className="h-11 w-full font-semibold">
              {saving ? "Saving..." : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
