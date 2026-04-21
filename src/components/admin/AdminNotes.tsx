import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmActionDialog } from "@/components/admin/ConfirmActionDialog";
import { toast } from "sonner";
import { Pencil, Trash2, Check, X, StickyNote, Plus } from "lucide-react";

interface AdminNotesProps {
  adAccountId: string;
}

interface Note {
  id: string;
  ad_account_id: string;
  note: string;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

function formatDhakaTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "Asia/Dhaka",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export function AdminNotes({ adAccountId }: AdminNotesProps) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["ad-account-notes", adAccountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_account_notes")
        .select("*")
        .eq("ad_account_id", adAccountId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Note[];
    },
    enabled: !!adAccountId,
  });

  const addMutation = useMutation({
    mutationFn: async (note: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("ad_account_notes").insert({
        ad_account_id: adAccountId,
        note: note.trim(),
        created_by: user.id,
        created_by_name: profile?.full_name || profile?.email || user.email || "Admin",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewNote("");
      queryClient.invalidateQueries({ queryKey: ["ad-account-notes", adAccountId] });
      toast.success("Note added");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to add note"),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase
        .from("ad_account_notes")
        .update({ note: note.trim() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingId(null);
      setEditText("");
      queryClient.invalidateQueries({ queryKey: ["ad-account-notes", adAccountId] });
      toast.success("Note updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update note"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ad_account_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad-account-notes", adAccountId] });
      toast.success("Note deleted");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete note"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <StickyNote className="h-5 w-5" />
          Admin Notes
          {notes.length > 0 && (
            <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {notes.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Textarea
            placeholder="Add a note... (e.g. Refund $45 done on 20/04/2026)"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="min-h-[60px] flex-1"
          />
          <Button
            onClick={() => addMutation.mutate(newNote)}
            disabled={!newNote.trim() || addMutation.isPending}
            className="sm:self-stretch"
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        <div className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading notes...</p>
          ) : notes.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No notes yet. Add one to track actions on this account.
            </p>
          ) : (
            notes.map((n) => {
              const isEditing = editingId === n.id;
              const isOwn = n.created_by === user?.id;
              return (
                <div
                  key={n.id}
                  className="rounded-md border border-border bg-muted/30 p-3"
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="min-h-[60px]"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            updateMutation.mutate({ id: n.id, note: editText })
                          }
                          disabled={!editText.trim() || updateMutation.isPending}
                        >
                          <Check className="h-4 w-4" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(null);
                            setEditText("");
                          }}
                        >
                          <X className="h-4 w-4" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap text-sm text-foreground">
                        {n.note}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          by <span className="font-medium text-foreground">{n.created_by_name || "Admin"}</span> · {formatDhakaTime(n.created_at)}
                          {n.updated_at !== n.created_at && " (edited)"}
                        </span>
                        {isOwn && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={() => {
                                setEditingId(n.id);
                                setEditText(n.note);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-destructive hover:text-destructive"
                              onClick={() => setDeleteId(n.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </CardContent>

      <ConfirmActionDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete this note?"
        description="This note will be permanently deleted. Type 'delete' to confirm."
        confirmWord="delete"
        actionLabel="Delete Note"
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
      />
    </Card>
  );
}
