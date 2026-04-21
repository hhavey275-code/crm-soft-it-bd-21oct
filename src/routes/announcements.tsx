import { createFileRoute } from "@tanstack/react-router";
import AnnouncementsPage from "@/components/pages/AnnouncementsPage";

export const Route = createFileRoute("/announcements")({ component: AnnouncementsPage });
