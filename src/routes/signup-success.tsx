import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Mail, Clock } from "lucide-react";

export const Route = createFileRoute("/signup-success")({
  component: SignupSuccess,
});

function SignupSuccess() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full text-center shadow-2xl rounded-3xl">
        <CardContent className="p-8 space-y-6">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <CheckCircle className="h-10 w-10 text-emerald-600" />
          </div>
          <h2 className="text-2xl font-bold">Account Created! 🎉</h2>
          <div className="flex items-start gap-3 rounded-xl bg-primary/5 border border-primary/20 p-4 text-left">
            <Mail className="h-6 w-6 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Confirm Your Email</p>
              <p className="text-sm text-muted-foreground mt-1">Check your inbox (and spam folder) and click the confirmation link.</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 p-4 text-left">
            <Clock className="h-6 w-6 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">Pending Admin Approval</p>
              <p className="text-sm text-muted-foreground mt-1">Your account is awaiting admin approval. You'll be able to log in once approved.</p>
            </div>
          </div>
          <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/auth" })}>Go to Login</Button>
        </CardContent>
      </Card>
    </div>
  );
}
