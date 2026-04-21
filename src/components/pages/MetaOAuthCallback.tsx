import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function MetaOAuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const stateRaw = params.get("state");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (error) {
      setStatus("error");
      setErrorMsg(errorDescription || error);
      toast.error("Facebook OAuth failed: " + (errorDescription || error));
      setTimeout(() => navigate("/business-managers", { replace: true }), 3000);
      return;
    }

    if (!code) {
      setStatus("error");
      setErrorMsg("No authorization code received");
      setTimeout(() => navigate("/business-managers", { replace: true }), 3000);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        let bmDbId = "";
        let returnTo = "";
        let adsManagerAccount = "";
        try {
          const parsed = JSON.parse(stateRaw || "{}");
          bmDbId = parsed.bm_db_id || "";
          returnTo = parsed.return_to || "";
          adsManagerAccount = parsed.ads_manager_account || "";
        } catch {}

        const redirectUri = `${window.location.origin}/meta-oauth-callback`;

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");

        // Ads-manager profile-token flow removed — BM-only.

        // Default BM token exchange flow
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-oauth`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              action: "exchange_token",
              code,
              redirect_uri: redirectUri,
              bm_db_id: bmDbId,
            }),
          }
        );

        const result = await res.json();
        if (!res.ok || result.error) throw new Error(result.error || "Token exchange failed");

        if (!cancelled) {
          setStatus("success");
          toast.success("Meta token refreshed successfully! Token expires: " + 
            new Date(result.token_expires_at).toLocaleDateString());
          setTimeout(() => navigate("/business-managers", { replace: true }), 2000);
        }
      } catch (err: any) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(err.message);
          toast.error("Token exchange failed: " + err.message);
          setTimeout(() => navigate("/business-managers", { replace: true }), 3000);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [location.search, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8">
        {status === "processing" && (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
            <p className="text-lg font-medium text-foreground">Exchanging Meta token...</p>
            <p className="text-sm text-muted-foreground">Please wait, this may take a moment.</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="text-4xl">✅</div>
            <p className="text-lg font-medium text-foreground">Token refreshed successfully!</p>
            <p className="text-sm text-muted-foreground">Redirecting...</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="text-4xl">❌</div>
            <p className="text-lg font-medium text-foreground">Token exchange failed</p>
            <p className="text-sm text-destructive">{errorMsg}</p>
            <p className="text-sm text-muted-foreground">Redirecting back...</p>
          </>
        )}
      </div>
    </div>
  );
}
