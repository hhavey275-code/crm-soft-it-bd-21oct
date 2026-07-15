import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Lock, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { setVaultPassword, verifyVaultPassword } from "@/lib/documentsVault.functions";

interface Props {
  hasPassword: boolean;
  onUnlocked: () => void;
}

export function VaultUnlock({ hasPassword, onUnlocked }: Props) {
  const setPw = useServerFn(setVaultPassword);
  const verifyPw = useServerFn(verifyVaultPassword);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    if (password !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      await setPw({ data: { newPassword: password } });
      toast.success("Vault password set");
      onUnlocked();
    } catch (err: any) {
      toast.error(err?.message || "Failed to set password");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    try {
      const res = await verifyPw({ data: { password } });
      if (res.ok) {
        onUnlocked();
      } else {
        toast.error("Incorrect password");
        setPassword("");
      }
    } catch (err: any) {
      toast.error(err?.message || "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            {hasPassword ? <Lock className="h-7 w-7 text-primary" /> : <KeyRound className="h-7 w-7 text-primary" />}
          </div>
          <CardTitle>{hasPassword ? "Vault Locked" : "Set Vault Password"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {hasPassword
              ? "Enter your vault password to view documents."
              : "Create a password to protect your company documents. Store it safely — it cannot be recovered."}
          </p>
        </CardHeader>
        <CardContent>
          {hasPassword ? (
            <form onSubmit={handleUnlock} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw">Vault password</Label>
                <Input
                  id="pw"
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy || !password}>
                {busy ? "Verifying..." : "Unlock"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSetup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw1">New password (min 6 chars)</Label>
                <Input id="pw1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />
              </div>
              <Button type="submit" className="w-full" disabled={busy || !password || !confirm}>
                {busy ? "Setting..." : "Create Vault"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}