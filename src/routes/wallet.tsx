import { createFileRoute } from "@tanstack/react-router";
import AgencyWalletPage from "@/components/pages/AgencyWalletPage";

export const Route = createFileRoute("/wallet")({ component: AgencyWalletPage });
