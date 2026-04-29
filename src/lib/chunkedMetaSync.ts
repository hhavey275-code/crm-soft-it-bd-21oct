import { supabase } from "@/integrations/supabase/client";

const CHUNK_SIZE = 30;
const CONCURRENCY = 3;
const RETRY_CHUNK_SIZE = 10;
const MAX_CHUNK_RETRIES = 2; // initial + 2 retries = 3 attempts per chunk
const RETRY_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function invokeChunk(body: any) {
  return await supabase.functions.invoke("get-account-insights", { body });
}

/**
 * Run an array of async tasks with a maximum concurrency.
 */
async function runPool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fetch account insights from Meta API in chunks to avoid edge function timeout.
 * Each chunk is retried up to MAX_CHUNK_RETRIES times on transient failure
 * so a single bad chunk does NOT abort the entire "Update All" run.
 * Chunks run in parallel (CONCURRENCY=3). After all chunks finish, any
 * still-failed account ids are auto-retried once in smaller batches.
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
): Promise<{
  insights: Record<string, any>;
  rate_limited: any[];
  failed_account_ids: string[];
  failed_chunks: number;
  meta_calls: number;
  attempted: number;
  succeeded: number;
  failed: number;
  auto_retried: number;
}> {
  const allInsights: Record<string, any> = {};
  const allRateLimited: any[] = [];
  let failedAccountIds: string[] = [];
  let failedChunks = 0;
  let metaCalls = 0;
  const total = ids.length;
  let synced = 0;

  const buildBody = (chunk: string[]) => {
    const body: any = { ad_account_ids: chunk, source: "meta" };
    if (options?.date) body.date = options.date;
    if (options?.date_from) body.date_from = options.date_from;
    if (options?.date_to) body.date_to = options.date_to;
    return body;
  };

  // Process a single chunk with retries. Returns true on success.
  async function processChunk(chunk: string[], maxRetries: number): Promise<boolean> {
    const body = buildBody(chunk);
    let lastError: any = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const { data, error } = await invokeChunk(body);
        if (error) {
          const errMsg = typeof error === "object" && error?.message ? error.message : String(error);
          if (errMsg.includes("401") || errMsg.includes("Unauthorized")) {
            console.warn("Session expired during Meta sync. Refreshing...");
            const { error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError) throw new Error("Your session has expired. Please log in again.");
            const retry = await invokeChunk(body);
            if (retry.error) throw retry.error;
            if (retry.data?.insights) Object.assign(allInsights, retry.data.insights);
            if (retry.data?.rate_limited?.length) allRateLimited.push(...retry.data.rate_limited);
            if (retry.data?.meta_calls?.total) metaCalls += Number(retry.data.meta_calls.total) || 0;
            return true;
          }
          throw error;
        }
        if (data?.insights) Object.assign(allInsights, data.insights);
        if (data?.rate_limited?.length) allRateLimited.push(...data.rate_limited);
        if (data?.meta_calls?.total) metaCalls += Number(data.meta_calls.total) || 0;
        return true;
      } catch (err: any) {
        lastError = err;
        if (attempt < maxRetries) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }
    console.error(`[chunkedMetaSync] Chunk of ${chunk.length} failed after ${maxRetries + 1} attempts:`, lastError);
    return false;
  }

  // Build initial chunks (size 30) and run in a parallel pool of CONCURRENCY.
  const initialChunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    initialChunks.push(ids.slice(i, i + CHUNK_SIZE));
  }

  const tasks = initialChunks.map((chunk) => async () => {
    const ok = await processChunk(chunk, MAX_CHUNK_RETRIES);
    synced += chunk.length;
    options?.onProgress?.(Math.min(synced, total), total);
    if (!ok) {
      failedChunks++;
      failedAccountIds.push(...chunk);
    }
  });

  await runPool(tasks, CONCURRENCY);

  // Auto-retry layer: smaller batches of 10, sequential to avoid hammering.
  let autoRetried = 0;
  if (failedAccountIds.length > 0) {
    const toRetry = [...failedAccountIds];
    failedAccountIds = [];
    console.log(`[chunkedMetaSync] Auto-retrying ${toRetry.length} failed account(s) in smaller batches...`);
    for (let i = 0; i < toRetry.length; i += RETRY_CHUNK_SIZE) {
      const chunk = toRetry.slice(i, i + RETRY_CHUNK_SIZE);
      const ok = await processChunk(chunk, 1);
      if (ok) {
        autoRetried += chunk.length;
      } else {
        failedAccountIds.push(...chunk);
      }
    }
  }

  const failed = failedAccountIds.length;
  const succeeded = total - failed;

  return {
    insights: allInsights,
    rate_limited: allRateLimited,
    failed_account_ids: failedAccountIds,
    failed_chunks: failedChunks,
    meta_calls: metaCalls,
    attempted: total,
    succeeded,
    failed,
    auto_retried: autoRetried,
  };
}
