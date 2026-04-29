import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Mail, ShieldCheck, UserPlus, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bmId: string | null;
  bmName?: string;
}

type Task = "MANAGE" | "ADVERTISE" | "ANALYZE";

const TASK_OPTIONS: { value: Task; label: string; description: string }[] = [
  { value: "ANALYZE", label: "View Performance", description: "View campaigns, ads, and reporting only" },
  { value: "ADVERTISE", label: "Manage Campaigns", description: "Create, edit, and publish campaigns" },
  { value: "MANAGE", label: "Manage Ad Account", description: "Full control: campaigns, billing, permissions" },
];

interface AdAccount {
  id: string;
  account_id: string;
  account_name: string;
  status: string;
}

export function InviteToBmDialog({ open, onOpenChange, bmId, bmName }: Props) {
  const [email, setEmail] = useState("");
  const [bmRole, setBmRole] = useState<"ADMIN" | "EMPLOYEE">("EMPLOYEE");
  const [perms, setPerms] = useState<Record<string, Set<Task>>>({});
  const [submitting, setSubmitting] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setEmail("");
      setBmRole("EMPLOYEE");
      setPerms({});
    }
  }, [open]);

  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ["bm-ad-accounts-for-invite", bmId],
    enabled: !!bmId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("id, account_id, account_name, status")
        .eq("business_manager_id", bmId!)
        .order("account_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AdAccount[];
    },
  });

  const toggleTask = (accountId: string, task: Task) => {
    setPerms((prev) => {
      const next = { ...prev };
      const set = new Set(next[accountId] ?? []);
      if (set.has(task)) {
        set.delete(task);
        // MANAGE implies ADVERTISE+ANALYZE — if user removes MANAGE, keep others alone
      } else {
        set.add(task);
        // If MANAGE selected, auto-add ADVERTISE+ANALYZE (Meta requires these together)
        if (task === "MANAGE") {
          set.add("ADVERTISE");
          set.add("ANALYZE");
        }
        // ADVERTISE requires ANALYZE per Meta
        if (task === "ADVERTISE") {
          set.add("ANALYZE");
        }
      }
      next[accountId] = set;
      return next;
    });
  };

  const accountPermsCount = useMemo(
    () => Object.values(perms).filter((s) => s.size > 0).length,
    [perms],
  );

  const handleSubmit = async () => {
    if (!bmId) return;
    if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    const ad_account_permissions = Object.entries(perms)
      .filter(([, set]) => set.size > 0)
      .map(([ad_account_id, set]) => ({
        ad_account_id,
        tasks: Array.from(set),
      }));

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("bm-invite-user", {
        body: {
          bm_id: bmId,
          email: email.trim().toLowerCase(),
          bm_role: bmRole,
          ad_account_permissions,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(data?.message ?? "Invite sent successfully");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to send invite");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Invite User to BM
          </DialogTitle>
          <DialogDescription>
            {bmName ? (
              <>
                Send an email invitation to join{" "}
                <span className="font-mono font-semibold">{bmName}</span>. The
                user will receive an email from Meta. After they accept,
                ad-account permissions you select below will be applied
                automatically on the next BM sync.
              </>
            ) : (
              "Send an email invitation to join this Business Manager."
            )}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3 -mr-3">
          <div className="space-y-5 py-2">
            {/* Email */}
            <div>
              <Label htmlFor="invite-email" className="flex items-center gap-1.5 mb-2">
                <Mail className="h-3.5 w-3.5" /> Email address
              </Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </div>

            {/* BM-level role */}
            <div>
              <Label className="flex items-center gap-1.5 mb-2">
                <ShieldCheck className="h-3.5 w-3.5" /> BM-level role
              </Label>
              <Select value={bmRole} onValueChange={(v) => setBmRole(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">Admin (Full control)</span>
                      <span className="text-xs text-muted-foreground">
                        Can manage everything in this BM including users & assets
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="EMPLOYEE">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">Employee (Partial)</span>
                      <span className="text-xs text-muted-foreground">
                        Limited to assets explicitly assigned (set below)
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Ad account permissions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Ad account permissions {bmRole === "EMPLOYEE" && <span className="text-destructive">*</span>}</Label>
                <span className="text-xs text-muted-foreground">
                  {accountPermsCount} account(s) selected
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-3 flex items-start gap-1.5">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                Select the ad accounts and what the user can do on each.
                Permissions are applied <strong>after</strong> the user accepts
                the invitation email.
              </p>

              {accountsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !accounts || accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground italic py-4 text-center border rounded-md">
                  No ad accounts in this BM.
                </p>
              ) : (
                <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
                  {accounts.map((acc) => {
                    const set = perms[acc.id] ?? new Set<Task>();
                    return (
                      <div key={acc.id} className="p-3 hover:bg-muted/30">
                        <div className="flex items-center justify-between mb-2 gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {acc.account_name}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono truncate">
                              {acc.account_id}
                            </p>
                          </div>
                          {set.size > 0 && (
                            <Badge variant="secondary" className="text-[10px]">
                              {set.size} task{set.size > 1 ? "s" : ""}
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {TASK_OPTIONS.map((opt) => (
                            <label
                              key={opt.value}
                              className="flex items-start gap-2 p-2 rounded border bg-background hover:border-primary/50 cursor-pointer transition-colors"
                            >
                              <Checkbox
                                checked={set.has(opt.value)}
                                onCheckedChange={() => toggleTask(acc.id, opt.value)}
                                className="mt-0.5"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-medium leading-tight">
                                  {opt.label}
                                </p>
                                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                                  {opt.description}
                                </p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-md bg-muted/50 border p-3 text-xs space-y-1">
              <p className="font-semibold">How this works:</p>
              <ol className="list-decimal ml-4 space-y-0.5 text-muted-foreground">
                <li>Meta sends an invitation email to the address above.</li>
                <li>The user clicks the link and signs in to accept.</li>
                <li>They are added to the BM with the selected role.</li>
                <li>
                  On the next BM sync, the ad-account permissions you selected
                  will be applied automatically.
                </li>
              </ol>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !email}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Mail className="h-4 w-4 mr-1" />
            )}
            Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
