import { createFileRoute } from "@tanstack/react-router";
import BillingsPage from "@/components/pages/BillingsPage";

export const Route = createFileRoute("/billings")({ component: BillingsPage });
