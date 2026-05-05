import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const AdAccountsPage = lazy(() => import("@/components/pages/AdAccountsPage"));

function AdAccountsRouteShell() {
  const matches = useMatches();
  const hasChild = matches.some((m) => m.routeId === "/ad-accounts/$id");
  return (
    <ProtectedGuard>
      {hasChild ? <Outlet /> : <Suspense fallback={<PageSkeleton />}><AdAccountsPage /></Suspense>}
    </ProtectedGuard>
  );
}

export const Route = createFileRoute("/ad-accounts")({
  component: AdAccountsRouteShell,
});
