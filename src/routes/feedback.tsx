import { createFileRoute } from "@tanstack/react-router";
import FeedbackPage from "@/components/pages/FeedbackPage";

export const Route = createFileRoute("/feedback")({ component: FeedbackPage });
