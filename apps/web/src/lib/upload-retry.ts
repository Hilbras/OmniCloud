import { ApiError } from "../api/client";

/** Total tries per upload job, including the first one. */
export const MAX_UPLOAD_ATTEMPTS = 3;

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15_000;

/**
 * Transient failures are worth retrying: the server never saw the request, was
 * rate limiting, or failed while handling it. A 4xx is the client's fault and
 * will fail the same way again, and an abort is deliberate.
 */
export function isRetryableUploadError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === "ABORTED") return false;
  if (error.status === 0) return error.code === "NETWORK_ERROR";
  return error.status === 429 || error.status >= 500;
}

/** 1s, 4s, 15s (capped) for attempts 1, 2, 3. */
export function uploadRetryDelay(attempt: number): number {
  const delay = BASE_DELAY_MS * 4 ** Math.max(0, attempt - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

/** Waits, but rejects immediately with the same ABORTED error the upload uses. */
export async function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new ApiError(0, "ABORTED", "Upload cancelled");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new ApiError(0, "ABORTED", "Upload cancelled"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
