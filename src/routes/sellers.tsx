import { createFileRoute } from "@tanstack/react-router";
import SellersPage from "@/components/pages/SellersPage";

export const Route = createFileRoute("/sellers")({ component: SellersPage });
