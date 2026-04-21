import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Lightbulb, Heart, UserCircle2, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

type FeedbackType = "complaint" | "suggestion" | "appreciation";

const TAB_META: Record<FeedbackType, { label: string; icon: typeof AlertCircle }> = {
  complaint: { label: "Complaints", icon: AlertCircle },
  suggestion: { label: "Suggestions", icon: Lightbulb },
  appreciation: { label: "Appreciation", icon: Heart },
};

const statusColor = (s: string) =>
  s === "resolved" ? "default" : s === "reviewed" ? "secondary" : "outline";

function FeedbackList({ type }: { type: FeedbackType }) {
  const qc = useQueryClient();
  const isAnonymous = type === "complaint";
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Record<string, { status: string; admin_note: string }>>({});

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["admin-feedback", type],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("client_feedback")
        .select("*")
        .eq("feedback_type", type)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // For non-anonymous types, fetch user profiles
  const userIds = useMemo(
    () => (isAnonymous ? [] : Array.from(new Set(items.map((i: any) => i.user_id)))),
    [items, isAnonymous],
  );

  const { data: profilesMap = {} } = useQuery({
    queryKey: ["feedback-profiles", type, userIds.join(",")],
    queryFn: async () => {
      if (userIds.length === 0) return {};
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, company")
        .in("user_id", userIds as string[]);
      return (data ?? []).reduce((acc: any, p: any) => {
        acc[p.user_id] = p;
        return acc;
      }, {});
    },
    enabled: !isAnonymous && userIds.length > 0,
  });

  const update = useMutation({
    mutationFn: async ({ id, status, admin_note }: { id: string; status: string; admin_note: string }) => {
      const { error } = await (supabase as any)
        .from("client_feedback")
        .update({ status, admin_note: admin_note || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin-feedback", type] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = items.filter((i: any) => statusFilter === "all" || i.status === statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "item" : "items"}
        </p>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No feedback yet.
          </CardContent>
        </Card>
      ) : (
        filtered.map((item: any) => {
          const profile = profilesMap[item.user_id];
          const draft = editing[item.id] ?? { status: item.status, admin_note: item.admin_note ?? "" };
          const dirty =
            draft.status !== item.status || (draft.admin_note ?? "") !== (item.admin_note ?? "");
          return (
            <Card key={item.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    {isAnonymous ? (
                      <EyeOff className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    ) : (
                      <UserCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                    )}
                    <div>
                      {isAnonymous ? (
                        <p className="text-sm font-medium">Anonymous Client</p>
                      ) : (
                        <>
                          <p className="text-sm font-medium">
                            {profile?.full_name || profile?.email || "Unknown"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {profile?.email}
                            {profile?.company ? ` · ${profile.company}` : ""}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <Badge variant={statusColor(item.status)} className="capitalize">
                    {item.status}
                  </Badge>
                </div>
                {item.subject && (
                  <CardTitle className="pt-2 text-base">{item.subject}</CardTitle>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">
                  {item.message}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()}
                </p>

                <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto] sm:items-start">
                  <Select
                    value={draft.status}
                    onValueChange={(v) =>
                      setEditing((s) => ({ ...s, [item.id]: { ...draft, status: v } }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="reviewed">Reviewed</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea
                    placeholder="Admin note (optional, visible to user)"
                    value={draft.admin_note}
                    onChange={(e) =>
                      setEditing((s) => ({
                        ...s,
                        [item.id]: { ...draft, admin_note: e.target.value },
                      }))
                    }
                    rows={2}
                  />
                  <Button
                    disabled={!dirty || update.isPending}
                    onClick={() =>
                      update.mutate({
                        id: item.id,
                        status: draft.status,
                        admin_note: draft.admin_note,
                      })
                    }
                  >
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

export function AdminFeedback() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Client Feedback</h1>
        <p className="text-sm text-muted-foreground">
          Review complaints (anonymous), suggestions, and appreciation from clients.
        </p>
      </div>
      <Tabs defaultValue="complaint" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="complaint" className="gap-1">
            <AlertCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Complaints</span>
          </TabsTrigger>
          <TabsTrigger value="suggestion" className="gap-1">
            <Lightbulb className="h-4 w-4" />
            <span className="hidden sm:inline">Suggestions</span>
          </TabsTrigger>
          <TabsTrigger value="appreciation" className="gap-1">
            <Heart className="h-4 w-4" />
            <span className="hidden sm:inline">Appreciation</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="complaint" className="mt-4">
          <FeedbackList type="complaint" />
        </TabsContent>
        <TabsContent value="suggestion" className="mt-4">
          <FeedbackList type="suggestion" />
        </TabsContent>
        <TabsContent value="appreciation" className="mt-4">
          <FeedbackList type="appreciation" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
