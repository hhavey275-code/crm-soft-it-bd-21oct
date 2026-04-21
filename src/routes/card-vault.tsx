import { createFileRoute } from "@tanstack/react-router";
import CardVaultPage from "@/components/pages/CardVaultPage";

export const Route = createFileRoute("/card-vault")({ component: CardVaultPage });
