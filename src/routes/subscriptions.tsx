import { createFileRoute } from "@tanstack/react-router";
import SubscriptionsPage from "@/components/pages/SubscriptionsPage";

export const Route = createFileRoute("/subscriptions")({ component: SubscriptionsPage });
