import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import AdAccountsPage from "@/components/pages/AdAccountsPage";

function AdAccountsRouteShell() {
  const matches = useMatches();
  const hasChild = matches.some((m) => m.routeId === "/ad-accounts/$id");
  return (
    <ProtectedGuard>
      {hasChild ? <Outlet /> : <AdAccountsPage />}
    </ProtectedGuard>
  );
}

export const Route = createFileRoute("/ad-accounts")({
  component: AdAccountsRouteShell,
});
