import { createFileRoute } from "@tanstack/react-router";
import TermsPage from "@/components/pages/TermsPage";

export const Route = createFileRoute("/terms")({ component: TermsPage });
