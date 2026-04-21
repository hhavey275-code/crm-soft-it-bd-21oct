import { createFileRoute } from "@tanstack/react-router";
import WalletBalancesPage from "@/components/pages/WalletBalancesPage";

export const Route = createFileRoute("/wallet-balances")({
  component: WalletBalancesPage,
});
