import { supabase } from "@/integrations/supabase/client";

const CHUNK_SIZE = 50;
const MAX_CHUNK_RETRIES = 2; // initial + 2 retries = 3 attempts per chunk
const RETRY_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function invokeChunk(body: any) {
  return await supabase.functions.invoke("get-account-insights", { body });
}

/**
 * Fetch account insights from Meta API in chunks to avoid edge function timeout.
 * Each chunk is retried up to MAX_CHUNK_RETRIES times on transient failure
 * so a single bad chunk does NOT abort the entire "Update All" run.
 * Returns merged insights, rate-limited list, and per-chunk failure info.
 */
export async function chunkedMetaSync(
  ids: string[],
  options?: {
    date?: string;
    date_from?: string;
    date_to?: string;
    onProgress?: (synced: number, total: number) => void;
  }
): Promise<{ insights: Record<string, any>; rate_limited: any[]; failed_account_ids: string[]; failed_chunks: number }> {
  const allInsights: Record<string, any> = {};
  const allRateLimited: any[] = [];
  const failedAccountIds: string[] = [];
  let failedChunks = 0;
  const total = ids.length;

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    options?.onProgress?.(Math.min(i + CHUNK_SIZE, total), total);

    const body: any = { ad_account_ids: chunk, source: "meta" };
    if (options?.date) body.date = options.date;
    if (options?.date_from) body.date_from = options.date_from;
    if (options?.date_to) body.date_to = options.date_to;

    let success = false;
    let lastError: any = null;

    for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      try {
        const { data, error } = await invokeChunk(body);

        if (error) {
          const errMsg = typeof error === "object" && error?.message ? error.message : String(error);

          // Auth expiry — refresh once and retry immediately (doesn't count as a regular retry)
          if (errMsg.includes("401") || errMsg.includes("Unauthorized")) {
            console.warn("Session expired during Meta sync. Refreshing...");
            const { error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError) throw new Error("Your session has expired. Please log in again.");
            const retry = await invokeChunk(body);
            if (retry.error) throw retry.error;
            if (retry.data?.insights) Object.assign(allInsights, retry.data.insights);
            if (retry.data?.rate_limited?.length) allRateLimited.push(...retry.data.rate_limited);
            success = true;
            break;
          }

          throw error;
        }

        if (data?.insights) Object.assign(allInsights, data.insights);
        if (data?.rate_limited?.length) allRateLimited.push(...data.rate_limited);
        success = true;
        break;
      } catch (err: any) {
        lastError = err;
        // Backoff before next attempt (except after the last attempt)
        if (attempt < MAX_CHUNK_RETRIES) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }

    if (!success) {
      failedChunks++;
      failedAccountIds.push(...chunk);
      console.error(
        `[chunkedMetaSync] Chunk ${i / CHUNK_SIZE + 1} failed after ${MAX_CHUNK_RETRIES + 1} attempts:`,
        lastError
      );
      // Continue with the next chunk — DO NOT throw, otherwise remaining accounts won't update
    }
  }

  return { insights: allInsights, rate_limited: allRateLimited, failed_account_ids: failedAccountIds, failed_chunks: failedChunks };
}
