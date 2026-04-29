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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Mail,
  ShieldCheck,
  UserPlus,
  Info,
  Search,
  ChevronLeft,
  Check,
} from "lucide-react";
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

type Step = "list" | "permissions";

export function InviteToBmDialog({ open, onOpenChange, bmId, bmName }: Props) {
  const [email, setEmail] = useState("");
  const [bmRole, setBmRole] = useState<"ADMIN" | "EMPLOYEE">("EMPLOYEE");
  const [perms, setPerms] = useState<Record<string, Set<Task>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<Step>("list");
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setEmail("");
      setBmRole("EMPLOYEE");
      setPerms({});
      setSearch("");
      setStep("list");
      setActiveAccountId(null);
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

  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.account_name.toLowerCase().includes(q) ||
        a.account_id.toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const activeAccount = useMemo(
    () => accounts?.find((a) => a.id === activeAccountId) ?? null,
    [accounts, activeAccountId],
  );

  const toggleTask = (accountId: string, task: Task, on: boolean) => {
    setPerms((prev) => {
      const next = { ...prev };
      const set = new Set(next[accountId] ?? []);
      if (on) {
        set.add(task);
        if (task === "MANAGE") {
          set.add("ADVERTISE");
          set.add("ANALYZE");
        }
        if (task === "ADVERTISE") {
          set.add("ANALYZE");
        }
      } else {
        set.delete(task);
      }
      if (set.size === 0) delete next[accountId];
      else next[accountId] = set;
      return next;
    });
  };

  const accountPermsCount = useMemo(
    () => Object.values(perms).filter((s) => s.size > 0).length,
    [perms],
  );

  const handleSubmit = async () => {
    if (!bmId) return;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
            {step === "permissions" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 -ml-1"
                onClick={() => {
                  setStep("list");
                  setActiveAccountId(null);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <UserPlus className="h-5 w-5 text-primary" />
            {step === "list" ? "Invite User to BM" : "Set Permissions"}
          </DialogTitle>
          <DialogDescription>
            {step === "list" ? (
              bmName ? (
                <>
                  Invite a user to{" "}
                  <span className="font-mono font-semibold">{bmName}</span>.
                  Optionally pick ad accounts to grant permissions on after they
                  accept.
                </>
              ) : (
                "Send an email invitation to join this Business Manager."
              )
            ) : activeAccount ? (
              <>
                Choose what the user can do on{" "}
                <span className="font-semibold">{activeAccount.account_name}</span>.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3 -mr-3">
          {step === "list" ? (
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
                          Limited to assets explicitly assigned (optional below)
                        </span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Ad account list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Ad accounts (optional)</Label>
                  <span className="text-xs text-muted-foreground">
                    {accountPermsCount} configured
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-2 flex items-start gap-1.5">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  Skip to invite without ad-account access. Click an account to
                  set permissions.
                </p>

                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name or ID…"
                    className="pl-8"
                  />
                </div>

                {accountsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !accounts || accounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-4 text-center border rounded-md">
                    No ad accounts in this BM.
                  </p>
                ) : filteredAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-4 text-center border rounded-md">
                    No matches for "{search}"
                  </p>
                ) : (
                  <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
                    {filteredAccounts.map((acc) => {
                      const set = perms[acc.id];
                      const configured = set && set.size > 0;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            setActiveAccountId(acc.id);
                            setStep("permissions");
                          }}
                          className="w-full text-left p-3 hover:bg-muted/50 transition-colors flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {acc.account_name}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono truncate">
                              {acc.account_id}
                            </p>
                          </div>
                          {configured ? (
                            <Badge variant="default" className="text-[10px] gap-1">
                              <Check className="h-3 w-3" />
                              {set!.size} task{set!.size > 1 ? "s" : ""}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              Set permissions
                            </Badge>
                          )}
                        </button>
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
                    On the next BM sync, ad-account permissions you configured
                    are applied automatically.
                  </li>
                </ol>
              </div>
            </div>
          ) : (
            // Permissions step
            <div className="space-y-3 py-2">
              {activeAccount && (
                <div className="rounded-md border p-3 bg-muted/30">
                  <p className="text-sm font-semibold">{activeAccount.account_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {activeAccount.account_id}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {TASK_OPTIONS.map((opt) => {
                  const set = activeAccountId ? perms[activeAccountId] ?? new Set<Task>() : new Set<Task>();
                  const checked = set.has(opt.value);
                  return (
                    <div
                      key={opt.value}
                      className="flex items-start justify-between gap-3 p-3 rounded-md border hover:border-primary/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{opt.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {opt.description}
                        </p>
                      </div>
                      <Switch
                        checked={checked}
                        onCheckedChange={(on) =>
                          activeAccountId && toggleTask(activeAccountId, opt.value, on)
                        }
                      />
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-muted-foreground italic px-1">
                Tip: enabling "Manage Campaigns" auto-includes "View Performance".
                "Manage Ad Account" auto-includes both.
              </p>
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          {step === "list" ? (
            <>
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
            </>
          ) : (
            <Button
              onClick={() => {
                setStep("list");
                setActiveAccountId(null);
              }}
            >
              <Check className="h-4 w-4 mr-1" />
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
