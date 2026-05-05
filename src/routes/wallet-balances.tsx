import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const WalletBalancesPage = lazy(() => import("@/components/pages/WalletBalancesPage"));

export const Route = createFileRoute("/wallet-balances")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><WalletBalancesPage /></Suspense>
  ),
});
