import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Lightbulb, Heart, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

type FeedbackType = "complaint" | "suggestion" | "appreciation";

const feedbackSchema = z.object({
  subject: z.string().trim().max(150, "Subject must be ≤ 150 chars").optional(),
  message: z.string().trim().min(5, "Message too short").max(2000, "Message must be ≤ 2000 chars"),
});

const TAB_META: Record<FeedbackType, {
  label: string;
  icon: typeof AlertCircle;
  title: string;
  description: string;
  banner?: string;
  hints?: string[];
  placeholder: string;
}> = {
  complaint: {
    label: "Complaint",
    icon: AlertCircle,
    title: "অভিযোগ জানান",
    description: "আপনার যেকোনো সমস্যা বা অভিযোগ আমাদের জানান।",
    banner:
      "আপনি complaint জানালেও SoftIT BD শুধু আপনার complaint দেখতে পাবে — আপনার নাম বা পরিচয় কখনই দেখা যাবে না। তাই কিছু খারাপ লাগলে অবশ্যই জানান।",
    placeholder: "আপনার অভিযোগ বিস্তারিত লিখুন...",
  },
  suggestion: {
    label: "Suggestion",
    icon: Lightbulb,
    title: "পরামর্শ দিন",
    description: "আমরা কীভাবে আরও উন্নতি করতে পারি — আপনার পরামর্শ গুরুত্বপূর্ণ।",
    hints: [
      "কোন বিষয়ে আমরা improve করতে পারি?",
      "কীভাবে আমরা client base আরও বাড়াতে পারি?",
      "কোন নতুন service add করলে আপনি আরও value পাবেন?",
    ],
    placeholder: "আপনার পরামর্শ লিখুন...",
  },
  appreciation: {
    label: "Appreciation",
    icon: Heart,
    title: "প্রশংসা করুন",
    description: "আমাদের কী কী ভালো লাগে আপনার — জানান।",
    hints: [
      "কেন আমাদের সাথে কাজ করছেন?",
      "আমাদের service-এর কোন দিকগুলো ভালো লাগে?",
    ],
    placeholder: "আপনার ভালো লাগার কথা লিখুন...",
  },
};

const statusColor = (s: string) =>
  s === "resolved" ? "default" : s === "reviewed" ? "secondary" : "outline";

function FeedbackTab({ type }: { type: FeedbackType }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const meta = TAB_META[type];
  const Icon = meta.icon;

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const { data: myItems = [] } = useQuery({
    queryKey: ["my-feedback", type, user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("client_feedback")
        .select("*")
        .eq("user_id", user!.id)
        .eq("feedback_type", type)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const parsed = feedbackSchema.safeParse({ subject, message });
      if (!parsed.success) {
        throw new Error(parsed.error.errors[0].message);
      }
      const { error } = await (supabase as any).from("client_feedback").insert({
        user_id: user!.id,
        feedback_type: type,
        subject: parsed.data.subject || null,
        message: parsed.data.message,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Submitted successfully");
      setSubject("");
      setMessage("");
      qc.invalidateQueries({ queryKey: ["my-feedback", type, user?.id] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to submit"),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {meta.title}
          </CardTitle>
          <CardDescription>{meta.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {meta.banner && (
            <Alert className="border-primary/30 bg-primary/5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm">{meta.banner}</AlertDescription>
            </Alert>
          )}
          {meta.hints && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {meta.hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <Label htmlFor="subject">Subject (optional)</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short title"
              maxLength={150}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="message">Message *</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={meta.placeholder}
              rows={5}
              maxLength={2000}
            />
            <p className="text-right text-xs text-muted-foreground">{message.length}/2000</p>
          </div>
          <Button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || !message.trim()}
            className="w-full sm:w-auto"
          >
            {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit
          </Button>
        </CardContent>
      </Card>

      {myItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your past {meta.label.toLowerCase()}s</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {myItems.map((item: any) => (
              <div key={item.id} className="rounded-lg border bg-card p-3">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{item.subject || "(no subject)"}</p>
                  <Badge variant={statusColor(item.status)} className="capitalize">
                    {item.status}
                  </Badge>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.message}</p>
                {item.admin_note && (
                  <div className="mt-2 rounded border-l-2 border-primary bg-muted/50 p-2 text-xs">
                    <span className="font-medium">Admin reply: </span>
                    {item.admin_note}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ClientFeedback() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Feedback</h1>
        <p className="text-sm text-muted-foreground">
          Share your complaints, suggestions, or appreciation with us.
        </p>
      </div>
      <Tabs defaultValue="complaint" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="complaint" className="gap-1">
            <AlertCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Complaint</span>
          </TabsTrigger>
          <TabsTrigger value="suggestion" className="gap-1">
            <Lightbulb className="h-4 w-4" />
            <span className="hidden sm:inline">Suggestion</span>
          </TabsTrigger>
          <TabsTrigger value="appreciation" className="gap-1">
            <Heart className="h-4 w-4" />
            <span className="hidden sm:inline">Appreciation</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="complaint" className="mt-4">
          <FeedbackTab type="complaint" />
        </TabsContent>
        <TabsContent value="suggestion" className="mt-4">
          <FeedbackTab type="suggestion" />
        </TabsContent>
        <TabsContent value="appreciation" className="mt-4">
          <FeedbackTab type="appreciation" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
