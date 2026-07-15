import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getVaultStatus, getVaultCategories } from "@/lib/documentsVault.functions";
import { VaultUnlock } from "@/components/vault/VaultUnlock";
import { UploadDocumentDialog } from "@/components/vault/UploadDocumentDialog";
import {
  FileText, Image as ImageIcon, Download, Trash2, Lock, Search, Plus, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const UNLOCK_KEY = "vault_unlocked_at";
const UNLOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface DocRow {
  id: string;
  category: string;
  title: string;
  description: string | null;
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  tags: string[] | null;
  created_at: string;
}

function isUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(UNLOCK_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < UNLOCK_TTL_MS;
  } catch {
    return false;
  }
}

export default function DocumentsVaultPage() {
  const getStatus = useServerFn(getVaultStatus);
  const getCats = useServerFn(getVaultCategories);

  const [unlocked, setUnlocked] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocRow | null>(null);

  useEffect(() => {
    setUnlocked(isUnlocked());
  }, []);

  const statusQ = useQuery({
    queryKey: ["vault-status"],
    queryFn: () => getStatus(),
  });

  const catsQ = useQuery({
    queryKey: ["vault-cats"],
    queryFn: () => getCats(),
    enabled: statusQ.data?.isOwner === true && unlocked,
  });

  const docsQ = useQuery({
    queryKey: ["vault-docs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_documents")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DocRow[];
    },
    enabled: statusQ.data?.isOwner === true && unlocked,
  });

  const filtered = useMemo(() => {
    const list = docsQ.data ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((d) => {
      if (categoryFilter !== "all" && d.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.file_name.toLowerCase().includes(q) ||
        (d.description ?? "").toLowerCase().includes(q) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [docsQ.data, search, categoryFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, DocRow[]>();
    for (const d of filtered) {
      if (!map.has(d.category)) map.set(d.category, []);
      map.get(d.category)!.push(d);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  async function handleDownload(doc: DocRow) {
    try {
      const { data, error } = await supabase.storage
        .from("company-documents")
        .createSignedUrl(doc.file_path, 300);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast.error(err?.message || "Download failed");
    }
  }

  async function handleDelete(doc: DocRow) {
    try {
      await supabase.storage.from("company-documents").remove([doc.file_path]);
      const { error } = await supabase.from("company_documents").delete().eq("id", doc.id);
      if (error) throw error;
      toast.success("Document deleted");
      docsQ.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    } finally {
      setDeleteTarget(null);
    }
  }

  function lockNow() {
    try { sessionStorage.removeItem(UNLOCK_KEY); } catch {}
    setUnlocked(false);
  }

  // -------- Render states --------
  if (statusQ.isLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  if (!statusQ.data?.isOwner) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[60vh] items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardContent className="p-8 text-center space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                <ShieldAlert className="h-7 w-7 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold">Access Denied</h2>
              <p className="text-sm text-muted-foreground">
                The Documents Vault is restricted to a single authorized owner.
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  if (!unlocked) {
    return (
      <DashboardLayout>
        <VaultUnlock
          hasPassword={statusQ.data.hasPassword}
          onUnlocked={() => {
            try { sessionStorage.setItem(UNLOCK_KEY, String(Date.now())); } catch {}
            setUnlocked(true);
            statusQ.refetch();
          }}
        />
      </DashboardLayout>
    );
  }

  const categories = catsQ.data ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Documents Vault</h1>
            <p className="text-sm text-muted-foreground">
              Private company documents — EIN, TIN, Trade License, Tax Returns, etc.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={lockNow}>
              <Lock className="mr-2 h-4 w-4" /> Lock
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Upload
            </Button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search title, filename, description, tags..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant={categoryFilter === "all" ? "default" : "outline"}
              onClick={() => setCategoryFilter("all")}
            >
              All
            </Button>
            {categories.map((c) => (
              <Button
                key={c}
                size="sm"
                variant={categoryFilter === c ? "default" : "outline"}
                onClick={() => setCategoryFilter(c)}
              >
                {c}
              </Button>
            ))}
          </div>
        </div>

        {docsQ.isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <FileText className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p>No documents yet. Click <b>Upload</b> to add your first document.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {grouped.map(([cat, docs]) => (
              <div key={cat} className="space-y-3">
                <h2 className="text-lg font-semibold">{cat} <span className="text-sm text-muted-foreground font-normal">({docs.length})</span></h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {docs.map((d) => <DocCard key={d.id} doc={d} onDownload={handleDownload} onDelete={setDeleteTarget} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        categories={categories}
        onUploaded={() => docsQ.refetch()}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be permanently deleted from the vault and storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function DocCard({
  doc, onDownload, onDelete,
}: {
  doc: DocRow;
  onDownload: (d: DocRow) => void;
  onDelete: (d: DocRow) => void;
}) {
  const isImage = doc.mime_type.startsWith("image/");
  const Icon = isImage ? ImageIcon : FileText;
  const sizeMb = (doc.file_size / 1024 / 1024).toFixed(2);
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate">{doc.title}</p>
            <p className="text-xs text-muted-foreground truncate">{doc.file_name}</p>
            <p className="text-xs text-muted-foreground">{sizeMb} MB · {new Date(doc.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        {doc.description && <p className="text-xs text-muted-foreground line-clamp-2">{doc.description}</p>}
        {doc.tags && doc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {doc.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => onDownload(doc)}>
            <Download className="mr-1 h-3.5 w-3.5" /> Open
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDelete(doc)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}