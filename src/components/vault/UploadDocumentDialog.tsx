import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload } from "lucide-react";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/jpg";
const MAX_MB = 20;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: string[];
  onUploaded: () => void;
}

export function UploadDocumentDialog({ open, onOpenChange, categories, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState(categories[0] ?? "Other");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setFile(null);
    setTitle("");
    setDescription("");
    setTags("");
    setCategory(categories[0] ?? "Other");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return toast.error("Choose a file");
    if (!title.trim()) return toast.error("Title required");
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`File must be ≤ ${MAX_MB}MB`);

    setBusy(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${category.replace(/\s+/g, "_")}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("company-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { data: userData } = await supabase.auth.getUser();
      const uploadedBy = userData.user?.id ?? null;

      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const { error: insErr } = await supabase.from("company_documents").insert({
        category,
        title: title.trim(),
        description: description.trim() || null,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || "application/octet-stream",
        tags: tagList,
        uploaded_by: uploadedBy,
      });
      if (insErr) {
        // try to clean up storage on metadata failure
        await supabase.storage.from("company-documents").remove([path]);
        throw insErr;
      }

      toast.success("Document uploaded");
      reset();
      onUploaded();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Upload Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. EIN Confirmation Letter 2024" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description (optional)</Label>
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma separated, optional)</Label>
            <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. 2024, LLC, federal" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="file">File (PDF, JPG, PNG — max {MAX_MB}MB)</Label>
            <Input id="file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
            {file && <p className="text-xs text-muted-foreground">{file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !file || !title.trim()}>{busy ? "Uploading..." : "Upload"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}