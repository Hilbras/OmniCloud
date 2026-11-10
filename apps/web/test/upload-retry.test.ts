import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import {
  MAX_UPLOAD_ATTEMPTS,
  isRetryableUploadError,
  sleepUnlessAborted,
  uploadRetryDelay,
} from "../src/lib/upload-retry";

describe("upload retry policy", () => {
  it("retries network, rate-limit and server failures", () => {
    expect(isRetryableUploadError(new ApiError(0, "NETWORK_ERROR", "offline"))).toBe(true);
    expect(isRetryableUploadError(new ApiError(429, "UNKNOWN", "slow down"))).toBe(true);
    expect(isRetryableUploadError(new ApiError(500, "UNKNOWN", "boom"))).toBe(true);
    expect(isRetryableUploadError(new ApiError(503, "UNKNOWN", "unavailable"))).toBe(true);
  });

  it("does not retry client mistakes, aborts or non-API errors", () => {
    expect(isRetryableUploadError(new ApiError(400, "VALIDATION_ERROR", "bad"))).toBe(false);
    expect(isRetryableUploadError(new ApiError(409, "CONFLICT", "exists"))).toBe(false);
    expect(isRetryableUploadError(new ApiError(413, "TOO_LARGE", "big"))).toBe(false);
    expect(isRetryableUploadError(new ApiError(0, "ABORTED", "cancelled"))).toBe(false);
    expect(isRetryableUploadError(new Error("something else"))).toBe(false);
  });

  it("backs off exponentially and caps the wait", () => {
    expect(uploadRetryDelay(1)).toBe(1000);
    expect(uploadRetryDelay(2)).toBe(4000);
    expect(uploadRetryDelay(3)).toBe(15_000);
    expect(uploadRetryDelay(10)).toBe(15_000);
    expect(MAX_UPLOAD_ATTEMPTS).toBe(3);
  });

  it("wakes early when the upload is aborted", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const waiting = sleepUnlessAborted(5_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "ABORTED" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("resolves after the delay when not aborted", async () => {
    await expect(sleepUnlessAborted(5)).resolves.toBeUndefined();
  });
});
