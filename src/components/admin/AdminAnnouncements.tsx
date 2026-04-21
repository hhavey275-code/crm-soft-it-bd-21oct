import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Megaphone, Plus, Trash2, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type Announcement = {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  target_type: "all" | "specific";
  target_user_ids: string[] | null;
  active: boolean;
  expires_at: string | null;
  created_at: string;
};

export function AdminAnnouncements() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetType, setTargetType] = useState<"all" | "specific">("all");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clientSearch, setClientSearch] = useState("");

  const { data: announcements, isLoading } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Announcement[];
    },
  });

  const { data: clients } = useQuery({
    queryKey: ["admin-announcements-clients"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "client");
      const ids = (roles ?? []).map((r: any) => r.user_id);
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, company")
        .in("user_id", ids);
      return (data ?? []) as Array<{
        user_id: string;
        full_name: string | null;
        email: string | null;
        company: string | null;
      }>;
    },
    enabled: open,
  });

  const filteredClients = (clients ?? []).filter((c) => {
    if (!clientSearch.trim()) return true;
    const q = clientSearch.toLowerCase();
    return (
      (c.full_name ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q)
    );
  });

  const resetForm = () => {
    setTitle("");
    setBody("");
    setTargetType("all");
    setSelectedUserIds([]);
    setExpiresAt("");
    setImageFile(null);
    setClientSearch("");
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (targetType === "specific" && selectedUserIds.length === 0) {
      toast.error("Select at least one client");
      return;
    }
    setSubmitting(true);
    try {
      let image_url: string | null = null;
      if (imageFile) {
        const ext = imageFile.name.split(".").pop();
        const path = `${user!.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("announcement-images")
          .upload(path, imageFile, { upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage
          .from("announcement-images")
          .getPublicUrl(path);
        image_url = pub.publicUrl;
      }

      const { error } = await (supabase as any).from("announcements").insert({
        title: title.trim(),
        body: body.trim(),
        image_url,
        target_type: targetType,
        target_user_ids: targetType === "specific" ? selectedUserIds : null,
        created_by: user!.id,
        active: true,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      if (error) throw error;
      toast.success("Announcement sent");
      resetForm();
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create announcement");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await (supabase as any)
        .from("announcements")
        .update({ active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-announcements"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const deleteAnn = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("announcements")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleClient = (id: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Announcements</h1>
            <p className="text-sm text-muted-foreground">
              Send popup notifications to all users or specific clients
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> New Announcement
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Announcement</DialogTitle>
              <DialogDescription>
                This will appear as a popup when targeted users next log in.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ann-title">Title</Label>
                <Input
                  id="ann-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. New Feature Released 🎉"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ann-body">Message</Label>
                <Textarea
                  id="ann-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your announcement here..."
                  rows={5}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ann-image">
                  <ImageIcon className="mr-1 inline h-3.5 w-3.5" /> Image (optional)
                </Label>
                <Input
                  id="ann-image"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                />
                {imageFile && (
                  <p className="text-xs text-muted-foreground">
                    {imageFile.name} ({(imageFile.size / 1024).toFixed(0)} KB)
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Target audience</Label>
                <RadioGroup
                  value={targetType}
                  onValueChange={(v) => setTargetType(v as "all" | "specific")}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="all" id="t-all" />
                    <Label htmlFor="t-all" className="cursor-pointer font-normal">
                      All users
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="specific" id="t-spec" />
                    <Label htmlFor="t-spec" className="cursor-pointer font-normal">
                      Specific clients
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {targetType === "specific" && (
                <div className="space-y-2">
                  <Label>Select clients ({selectedUserIds.length} selected)</Label>
                  <Input
                    placeholder="Search by name, email or company..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                  />
                  <div className="max-h-56 overflow-y-auto rounded-md border">
                    {filteredClients.length === 0 && (
                      <p className="p-3 text-sm text-muted-foreground">
                        No clients found
                      </p>
                    )}
                    {filteredClients.map((c) => (
                      <label
                        key={c.user_id}
                        className="flex cursor-pointer items-center gap-3 border-b p-2 last:border-b-0 hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedUserIds.includes(c.user_id)}
                          onCheckedChange={() => toggleClient(c.user_id)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {c.full_name || c.email || c.user_id}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {c.email}
                            {c.company ? ` • ${c.company}` : ""}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="ann-expires">Expires at (optional)</Label>
                <Input
                  id="ann-expires"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Announcements</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !announcements || announcements.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No announcements yet. Create one to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {announcements.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {a.image_url && (
                            <img
                              src={a.image_url}
                              alt=""
                              className="h-8 w-8 rounded object-cover"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">{a.title}</p>
                            <p className="line-clamp-1 text-xs text-muted-foreground">
                              {a.body}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {a.target_type === "all" ? (
                          <Badge variant="secondary">All users</Badge>
                        ) : (
                          <Badge variant="outline">
                            {a.target_user_ids?.length ?? 0} clients
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(a.created_at), "PP")}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.expires_at ? format(new Date(a.expires_at), "PP") : "—"}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={a.active}
                          onCheckedChange={(v) =>
                            toggleActive.mutate({ id: a.id, active: v })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Delete this announcement?")) {
                              deleteAnn.mutate(a.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
