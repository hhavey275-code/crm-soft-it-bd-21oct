// Server-only: Cloudflare R2 presigned uploads for ad videos (browser -> R2 directly, Meta pulls by URL).
import { AwsClient } from "aws4fetch";
import { cleanKey } from "@/lib/serverKey";

export function r2Config() {
  const accountId = cleanKey(process.env.R2_ACCOUNT_ID);
  const accessKeyId = cleanKey(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = cleanKey(process.env.R2_SECRET_ACCESS_KEY);
  const bucket = cleanKey(process.env.R2_BUCKET);
  const publicUrl = String(process.env.R2_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

export function safeVideoKey(name: string) {
  const ext = (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? "mp4").toLowerCase();
  return `videos/${Date.now()}-${crypto.randomUUID()}.${ext}`;
}

export async function presignVideoUpload(fileName: string, contentType: string) {
  const c = r2Config();
  if (!c) throw new Error("Cloudflare R2 সেটআপ করা হয়নি");
  const key = safeVideoKey(fileName);
  const aws = new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, service: "s3", region: "auto" });
  const url = new URL(`https://${c.accountId}.r2.cloudflarestorage.com/${c.bucket}/${key}`);
  url.searchParams.set("X-Amz-Expires", "3600");
  const signed = await aws.sign(new Request(url, { method: "PUT", headers: { "Content-Type": contentType || "video/mp4" } }), { aws: { signQuery: true } });
  return { uploadUrl: signed.url, publicUrl: `${c.publicUrl}/${key}`, contentType: contentType || "video/mp4" };
}
