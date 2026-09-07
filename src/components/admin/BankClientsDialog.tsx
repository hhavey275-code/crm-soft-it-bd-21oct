import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Users, Loader2, Trash2, Search } from "lucide-react";

interface Props {
  bankId: string;
  bankName: string;
  open: boolean;
  onClose: () => void;
}

export function BankClientsDialog({ bankId, bankName, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());

  // Clients assigned to this bank
  const { data: assigned, isLoading } = useQuery({
    queryKey: ["bank-clients", bankId],
    enabled: open && !!bankId,
    queryFn: async () => {
      const { data: rows } = await (supabase as any)
        .from("client_banks")
        .select("id, user_id")
        .eq("bank_account_id", bankId);
      const list = ((rows as any[]) ?? []);
      if (!list.length) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, phone")
        .in("user_id", list.map((r) => r.user_id));
      const pMap = new Map(((profs as any[]) ?? []).map((p) => [p.user_id, p]));
      return list.map((r) => ({ ...r, profile: pMap.get(r.user_id) }));
    },
  });

  // All clients (for assigning)
  const { data: clients } = useQuery({
    queryKey: ["all-client-profiles"],
    enabled: open,
    queryFn: async () => {
      const { data: roles } = await (supabase as any).from("user_roles").select("user_id").eq("role", "client");
      const ids = ((roles as any[]) ?? []).map((r) => r.user_id);
      if (!ids.length) return [];
      const { data: profs } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids);
      return ((profs as any[]) ?? []).sort((a, b) =>
        (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""),
      );
    },
  });

  const assignedIds = useMemo(() => new Set((assigned ?? []).map((a: any) => a.user_id)), [assigned]);

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clients ?? []).filter((c: any) => {
      if (assignedIds.has(c.user_id)) return false;
      if (!q) return true;
      return `${c.full_name || ""} ${c.email || ""}`.toLowerCase().includes(q);
    });
  }, [clients, assignedIds, search]);

  const assignMutation = useMutation({
    mutationFn: async () => {
      const rows = Array.from(toAdd).map((uid) => ({ user_id: uid, bank_account_id: bankId }));
      if (!rows.length) throw new Error("Select at least one client");
      const { error } = await (supabase as any)
        .from("client_banks")
        .upsert(rows, { onConflict: "user_id,bank_account_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Client(s) assigned!");
      setToAdd(new Set());
      setSearch("");
      queryClient.invalidateQueries({ queryKey: ["bank-clients", bankId] });
      queryClient.invalidateQueries({ queryKey: ["admin-client-banks"] });
      queryClient.invalidateQueries({ queryKey: ["bank-client-counts"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unassignMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("client_banks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Assignment removed");
      queryClient.invalidateQueries({ queryKey: ["bank-clients", bankId] });
      queryClient.invalidateQueries({ queryKey: ["admin-client-banks"] });
      queryClient.invalidateQueries({ queryKey: ["bank-client-counts"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (id: string) =>
    setToAdd((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {bankName} — Clients
            <Badge variant="secondary">{assigned?.length ?? 0}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Assigned clients */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Assigned Clients</p>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-3 text-center animate-pulse">Loading...</p>
          ) : !assigned?.length ? (
            <p className="text-sm text-muted-foreground py-3 text-center">এই bank-এ কোনো client assign করা নেই।</p>
          ) : (
            <div className="space-y-1.5">
              {assigned.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 p-2.5 rounded-md border">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {a.profile?.full_name || a.profile?.email || a.user_id.slice(0, 8)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{a.profile?.email}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 hover:text-destructive"
                    disabled={unassignMutation.isPending}
                    onClick={() => unassignMutation.mutate(a.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assign new */}
        <div className="space-y-2 pt-2 border-t">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Assign More Clients</p>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search client..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="space-y-1 max-h-[220px] overflow-y-auto pr-1">
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center">No clients found</p>
            ) : (
              available.map((c: any) => (
                <label key={c.user_id} className="flex items-center gap-3 p-2 rounded-md border hover:bg-muted/40 cursor-pointer transition-colors">
                  <Checkbox checked={toAdd.has(c.user_id)} onCheckedChange={() => toggle(c.user_id)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.full_name || c.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                  </div>
                </label>
              ))
            )}
          </div>
          <Button
            className="w-full"
            disabled={toAdd.size === 0 || assignMutation.isPending}
            onClick={() => assignMutation.mutate()}
          >
            {assignMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Assign {toAdd.size > 0 ? `(${toAdd.size})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
