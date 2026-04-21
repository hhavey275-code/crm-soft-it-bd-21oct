import { createFileRoute } from "@tanstack/react-router";
import InvoicePage from "@/components/pages/InvoicePage";

export const Route = createFileRoute("/invoice/$requestId")({
  component: InvoicePage,
});
