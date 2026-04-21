import { useAuth } from "@/contexts/AuthContext";

type AppRole = "admin" | "client" | "superadmin" | "seller" | "agency";

export function useRole() {
  const { role, isAdmin, isSuperAdmin, isSeller } = useAuth();

  const roles: AppRole[] = role ? [role as AppRole] : [];
  const isAgency = role === "agency";

  const hasRole = (r: AppRole) => role === r || (r === "admin" && isSuperAdmin);
  const isSuperadmin = isSuperAdmin;
  const isClient = role === "client";

  const primaryRole = (): AppRole => {
    if (isSuperAdmin) return "superadmin";
    if (isAdmin) return "admin";
    if (isAgency) return "agency";
    if (isSeller) return "seller";
    return "client";
  };

  const dashboardPath = () => {
    const r = primaryRole();
    if (r === "superadmin") return "/admin/dashboard";
    if (r === "admin") return "/admin/dashboard";
    if (r === "agency") return "/dashboard";
    if (r === "seller") return "/admin/dashboard";
    return "/client/dashboard";
  };

  return { roles, hasRole, isAdmin, isSuperadmin, isClient, isSeller, isAgency, primaryRole, dashboardPath };
}
