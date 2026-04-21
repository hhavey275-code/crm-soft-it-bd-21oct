import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Loader2, ShieldCheck, AlertTriangle, Mail, UserMinus, Info, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Either ad_account_id or bm_id must be provided */
  adAccountId?: string;
  bmId?: string;
}

interface BmUser {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  first_seen_at?: string | null;
}

export function SilentRecoveryDialog({ open, onOpenChange, adAccountId, bmId }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [users, setUsers] = useState<BmUser[]>([]);
  const [removedRecent, setRemovedRecent] = useState<any[]>([]);
  const [bmInfo, setBmInfo] = useState<{ id: string; name: string; bm_id: string; recovery_ready?: boolean } | null>(null);
  const [lastAction, setLastAction] = useState<any>(null);
  const [permError, setPermError] = useState<string | null>(null);
  const [selectedRemove, setSelectedRemove] = useState<Set<string>>(new Set());
  const [inviteEmail, setInviteEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedRemove(new Set());
    setInviteEmail(user?.email ?? "");
    setPermError(null);
    setUsers([]);
    setRemovedRecent([]);
    setBmInfo(null);
    setLastAction(null);
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("bm-list-users", {
        body: { bm_id: bmId, ad_account_id: adAccountId },
      });
      if (error) throw error;
      if (!data?.success) {
        setPermError(data?.error || "Failed to fetch BM users — token may not have admin permission.");
        if (data?.bm) setBmInfo(data.bm);
      } else {
        setUsers(data.users ?? []);
        setRemovedRecent(data.removed_recent ?? []);
        setBmInfo(data.bm);
        setLastAction(data.last_action ?? null);
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedRemove);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedRemove(next);
  };

  const isRecentlyAdded = (firstSeen: string | null | undefined) => {
    if (!firstSeen) return false;
    return Date.now() - new Date(firstSeen).getTime() < 7 * 24 * 60 * 60 * 1000;
  };

  const handleExecuteClick = () => {
    if (!bmInfo) return;
    if (!inviteEmail && selectedRemove.size === 0) {
      toast.error("Select at least one action: invite yourself or remove a user");
      return;
    }
    // If removing users, show confirmation. Pure invites can proceed directly.
    if (selectedRemove.size > 0) {
      setConfirmOpen(true);
    } else {
      void execute();
    }
  };

  const execute = async () => {
    if (!bmInfo) return;
    setExecuting(true);
    try {
      const { data, error } = await supabase.functions.invoke("bm-counter-hack", {
        body: {
          bm_id: bmInfo.id,
          invite_email: inviteEmail || undefined,
          invite_role: "ADMIN",
          remove_user_ids: Array.from(selectedRemove),
        },
      });
      if (error) throw error;
      const actions = data?.actions ?? [];
      const ok = actions.filter((a: any) => a.success).length;
      const fail = actions.filter((a: any) => !a.success);
      if (ok > 0) toast.success(`${ok} action(s) succeeded silently`);
      if (fail.length > 0) toast.error(`${fail.length} failed: ${fail[0]?.error ?? "unknown"}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Counter-hack failed");
    } finally {
      setExecuting(false);
    }
  };

  const selectedUserDetails = users.filter((u) => selectedRemove.has(u.id));

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-destructive" />
              Silent BM Recovery
            </DialogTitle>
            <DialogDescription>
              Counter-hack a compromised Business Manager — silently invite yourself as admin and remove suspected users. No spend cap or campaign changes (so the hacker won't notice).
              {bmInfo && <> Target: <span className="font-mono font-semibold">{bmInfo.name}</span></>}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : permError ? (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-destructive">Token does not have admin permission</p>
                  <p className="text-muted-foreground mt-1">{permError}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Go to Meta Business Settings → System Users → set this token's role to <strong>Admin</strong>, then try again.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {removedRecent.length > 0 && (
                <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="font-semibold text-amber-600 mb-1 flex items-center gap-1.5">
                        Detected: users present in earlier sync but missing in Meta now
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            This app <strong>never auto-removes</strong> anyone. Removals shown here happened on Facebook/Meta directly — by another admin or by the user themself.
                          </TooltipContent>
                        </Tooltip>
                      </p>
                      <p className="text-xs text-muted-foreground mb-2">
                        These users were removed from Meta directly (not by this app). Could be normal cleanup — or a hack signal if unexpected.
                      </p>
                      <ul className="text-xs text-muted-foreground space-y-0.5 ml-4 list-disc">
                        {removedRecent.map((r) => (
                          <li key={r.id}>
                            {r.name || r.email || r.meta_user_id} ({r.role}) — detected missing {formatDistanceToNow(new Date(r.removed_at), { addSuffix: true })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 1: Users list */}
              <div>
                <Label className="text-sm font-semibold mb-2 block">Step 1 — Select suspected users to remove silently</Label>
                {users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No users found.</p>
                ) : (
                  <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                    {users.map((u) => {
                      const recent = isRecentlyAdded(u.first_seen_at);
                      const isMe = u.email && user?.email && u.email.toLowerCase() === user.email.toLowerCase();
                      return (
                        <div key={u.id} className="flex items-center gap-3 p-2.5 hover:bg-muted/30">
                          <Checkbox
                            checked={selectedRemove.has(u.id)}
                            onCheckedChange={() => toggleSelect(u.id)}
                            disabled={!!isMe}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate">{u.name || "(no name)"}</span>
                              {u.role && <Badge variant="outline" className="text-[10px]">{u.role}</Badge>}
                              {recent && <Badge variant="destructive" className="text-[10px]">recent</Badge>}
                              {isMe && <Badge variant="secondary" className="text-[10px]">you</Badge>}
                            </div>
                            {u.email && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
                            {u.first_seen_at && (
                              <p className="text-[10px] text-muted-foreground">
                                First seen {formatDistanceToNow(new Date(u.first_seen_at), { addSuffix: true })}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedRemove.size} selected for removal · Nothing is removed automatically — you must tick the box.
                </p>
              </div>

              {/* Step 2: Invite */}
              <div>
                <Label htmlFor="invite-email" className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Step 2 — Invite yourself as Admin (silent)
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="your@email.com"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Meta will send an invitation email. Accept it and you'll be in the BM as Admin within 1-2 minutes.
                </p>
              </div>

              {/* Audit trail */}
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <p className="font-semibold mb-1.5 flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" /> Last action on this BM by this app
                </p>
                {lastAction ? (
                  <div className="text-muted-foreground space-y-0.5">
                    <p>
                      <span className="font-mono">{format(new Date(lastAction.created_at), "dd MMM HH:mm")}</span>
                      {" — "}
                      <span>{lastAction.details}</span>
                    </p>
                    <p className="text-[10px] italic">By: {lastAction.user_name ?? "—"}</p>
                  </div>
                ) : (
                  <p className="text-muted-foreground italic">No previous counter-hack actions recorded for this BM.</p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={executing}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleExecuteClick}
              disabled={executing || loading || !!permError || (!inviteEmail && selectedRemove.size === 0)}
            >
              {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
              Execute Silent Recovery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation guard for user removals */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Confirm silent removal
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  You are about to silently remove <strong>{selectedRemove.size}</strong> user(s) from BM{" "}
                  <span className="font-mono font-semibold">{bmInfo?.name}</span>:
                </p>
                <ul className="list-disc ml-5 text-sm">
                  {selectedUserDetails.map((u) => (
                    <li key={u.id}>
                      <span className="font-medium">{u.name || "(no name)"}</span>
                      {u.email && <span className="text-muted-foreground"> — {u.email}</span>}
                      {u.role && <span className="text-muted-foreground"> ({u.role})</span>}
                    </li>
                  ))}
                </ul>
                {inviteEmail && (
                  <p className="text-sm">
                    Plus an invitation will be sent to <span className="font-mono">{inviteEmail}</span>.
                  </p>
                )}
                <p className="text-sm text-destructive font-medium">
                  This cannot be undone via this app. Continue?
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={executing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmOpen(false); void execute(); }}
            >
              Yes, remove them
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
