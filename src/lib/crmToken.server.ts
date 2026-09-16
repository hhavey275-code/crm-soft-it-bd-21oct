// Server-only helpers for signing/verifying CRM automation job tokens.
// The helper extension never holds a long-lived secret: every job/learn link
// carries a short-lived HMAC-signed token minted here.
import { createHmac, timingSafeEqual } from "node:crypto";

export type CrmJobPayload = {
  scope: "topup" | "learn" | "autopilot";
  host: string;
  requestId?: string;
  accountId?: string;
  amount?: number;
  walletKind?: string;
  actorId?: string;
  /** True when this top-up job was launched by the Auto-pilot (no human click). */
  autopilot?: boolean;
  exp: number; // epoch seconds
};

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf as any)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function secret(): string {
  const s = process.env["CRM_JOB_SECRET"];
  if (!s) throw new Error("CRM_JOB_SECRET is not configured");
  return s;
}

export function signCrmToken(payload: CrmJobPayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export type CrmVerifyResult =
  | { payload: CrmJobPayload; reason: null }
  | { payload: null; reason: "malformed" | "bad_signature" | "expired" | "no_secret" };

export function verifyCrmTokenDetailed(token: string): CrmVerifyResult {
  let key: string;
  try {
    key = secret();
  } catch {
    return { payload: null, reason: "no_secret" };
  }
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return { payload: null, reason: "malformed" };
  let payload: CrmJobPayload;
  try {
    const expected = createHmac("sha256", key).update(body).digest();
    const given = fromB64url(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return { payload: null, reason: "bad_signature" };
    }
    payload = JSON.parse(fromB64url(body).toString("utf8")) as CrmJobPayload;
  } catch {
    return { payload: null, reason: "malformed" };
  }
  if (!payload?.exp || payload.exp * 1000 < Date.now()) return { payload: null, reason: "expired" };
  return { payload, reason: null };
}

export function verifyCrmToken(token: string): CrmJobPayload | null {
  try {
    const [body, sig] = String(token).split(".");
    if (!body || !sig) return null;
    const expected = createHmac("sha256", secret()).update(body).digest();
    const given = fromB64url(sig);
    if (given.length !== expected.length) return null;
    if (!timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(fromB64url(body).toString("utf8")) as CrmJobPayload;
    if (!payload?.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
