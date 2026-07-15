// Documents Vault server functions.
// Only the whitelisted vault owner (site_settings.documents_vault_owner_email)
// can call these. All checks are enforced server-side via is_vault_owner() RPC.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, saltHex, hashHex] = stored.split("$");
    if (algo !== "scrypt" || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = scryptSync(password, salt, expected.length);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

async function assertVaultOwner(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_vault_owner", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not the vault owner");
}

async function getSetting(supabase: any, key: string): Promise<string> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value ?? "";
}

export const getVaultStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isOwner } = await context.supabase.rpc("is_vault_owner", {
      _user_id: context.userId,
    });
    if (!isOwner) return { isOwner: false as const, hasPassword: false };
    const hash = await getSetting(context.supabase, "documents_vault_password_hash");
    return { isOwner: true as const, hasPassword: !!hash };
  });

export const setVaultPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { currentPassword?: string; newPassword: string }) => {
    if (!data?.newPassword || data.newPassword.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertVaultOwner(context.supabase, context.userId);
    const existing = await getSetting(context.supabase, "documents_vault_password_hash");
    if (existing) {
      if (!data.currentPassword || !verifyPassword(data.currentPassword, existing)) {
        throw new Error("Current password is incorrect");
      }
    }
    const newHash = hashPassword(data.newPassword);
    const { error } = await context.supabase
      .from("site_settings")
      .update({ value: newHash, updated_at: new Date().toISOString() })
      .eq("key", "documents_vault_password_hash");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const verifyVaultPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { password: string }) => {
    if (!data?.password) throw new Error("Password required");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertVaultOwner(context.supabase, context.userId);
    const stored = await getSetting(context.supabase, "documents_vault_password_hash");
    if (!stored) throw new Error("Vault password not set");
    // Small delay to blunt brute-force attempts
    await new Promise((r) => setTimeout(r, 250));
    const ok = verifyPassword(data.password, stored);
    return { ok };
  });

export const getVaultCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertVaultOwner(context.supabase, context.userId);
    const raw = await getSetting(context.supabase, "documents_vault_categories");
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [] as string[];
    }
  });

export const saveVaultCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { categories: string[] }) => {
    if (!Array.isArray(data?.categories)) throw new Error("categories must be array");
    const clean = data.categories
      .map((c) => String(c).trim())
      .filter((c) => c.length > 0 && c.length <= 60);
    if (clean.length === 0) throw new Error("At least one category required");
    return { categories: clean };
  })
  .handler(async ({ data, context }) => {
    await assertVaultOwner(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("site_settings")
      .update({ value: JSON.stringify(data.categories), updated_at: new Date().toISOString() })
      .eq("key", "documents_vault_categories");
    if (error) throw new Error(error.message);
    return { ok: true, categories: data.categories };
  });