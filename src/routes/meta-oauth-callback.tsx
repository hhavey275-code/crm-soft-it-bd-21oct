import { createFileRoute } from "@tanstack/react-router";
import MetaOAuthCallback from "@/components/pages/MetaOAuthCallback";

export const Route = createFileRoute("/meta-oauth-callback")({ component: MetaOAuthCallback });
