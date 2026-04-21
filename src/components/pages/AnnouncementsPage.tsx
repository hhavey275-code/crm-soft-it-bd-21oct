import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminAnnouncements } from "@/components/admin/AdminAnnouncements";

export default function AnnouncementsPage() {
  return (
    <DashboardLayout>
      <AdminAnnouncements />
    </DashboardLayout>
  );
}
