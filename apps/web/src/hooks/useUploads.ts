import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ApiError, errorMessage } from "../api/client";
import { replaceFile, uploadFile, type UploadResult } from "../api/upload";
import { invalidateDriveQueries, invalidateVersionQueries } from "../lib/queries";
import { encryptFormatPref } from "../lib/crypto-session";
import { notify, requestNotificationPermission } from "../lib/notifications";
import {
  createUploadJobStore,
  fileFromPersistedJob,
  toPersistedJob,
  type UploadJobStore,
} from "../lib/upload-queue-store";
import {
  MAX_UPLOAD_ATTEMPTS,
  isRetryableUploadError,
  sleepUnlessAborted,
  uploadRetryDelay,
} from "../lib/upload-retry";
import { useToast } from "../components/Toasts";
import { useNameIndex } from "./useNameIndex";
import type { EncryptionFormat } from "@omnicloud/shared";

export type UploadStatus = "queued" | "uploading" | "paused" | "done" | "error" | "cancelled";

export interface UploadItem {
  id: number;
  name: string;
  size: number;
  loaded: number;
  percent: number;
  status: UploadStatus;
  message?: string;
}

interface UploadJob {
  id: number;
  file: File;
  /** null = new file in a folder; a string = new version of that file id. */
  replaceId: string | null;
  folderId: string | null;
  /** Stable for the job's life, so a retry is recognised by the server as the same upload. */
  operationId: string;
  /** The encrypted format to store the file in; null keeps a replacement plaintext. */
  format: EncryptionFormat | null;
}

let uploadIdCounter = 0;

/** A unique key per upload job. Falls back where randomUUID is unavailable (insecure origins). */
function newOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface UploadsController {
  uploads: UploadItem[];
  enqueue: (files: File[], folderId: string | null) => void;
  replace: (file: File, fileId: string, format: EncryptionFormat | null) => void;
  cancel: (id: number) => void;
  /** Stops the current transfer but keeps the job (and its bytes) for later. */
  pause: (id: number) => void;
  /** Restarts a paused job from the beginning, reusing its operation id. */
  resume: (id: number) => void;
  retry: (id: number) => void;
  dismiss: (id: number) => void;
  clearFinished: () => void;
  /** Opens the native file picker; files go into the given folder. */
  openPicker: (folderId: string | null) => void;
  /** Hidden input backing `openPicker` — render it once in the layout. */
  pickerInputRef: RefObject<HTMLInputElement>;
  /** Wire to the hidden input's onChange. */
  onPickerChange: () => void;
}

/**
 * Owns the upload queue: sequential processing, per-item progress, cancel via
 * AbortController/XHR.abort, pause/resume, and retry of failed or cancelled
 * uploads.
 *
 * Unfinished jobs are mirrored into IndexedDB so a reload, a renderer crash or
 * a closed window does not lose the user's file. A resumed job keeps its
 * operation id, which the server treats as the same upload — so retrying after
 * a restart cannot create a duplicate object. Telegram has no resumable
 * server-side upload session, so a resumed transfer starts from byte 0; what
 * survives is the job, not the byte offset.
 */
export function useUploads(): UploadsController {
  const queryClient = useQueryClient();
  const toast = useToast();
  const nameIndex = useNameIndex();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const jobs = useRef(new Map<number, UploadJob>());
  const controllers = useRef(new Map<number, AbortController>());
  const cancelledJobs = useRef(new Set<number>());
  const pausedJobs = useRef(new Set<number>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timers = useRef(new Map<number, number>());
  const mounted = useRef(true);
  const restored = useRef(false);
  const store = useRef<UploadJobStore | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const pickerFolder = useRef<string | null>(null);

  if (store.current === null) store.current = createUploadJobStore();

  useEffect(() => {
    mounted.current = true;
    const registeredTimers = timers.current;
    // Snapshot the Map instance: the ref itself may be reassigned, but the
    // live controllers are the ones created during this mount.
    const registeredControllers = controllers.current;
    return () => {
      mounted.current = false;
      for (const timer of registeredTimers.values()) window.clearTimeout(timer);
      for (const controller of registeredControllers.values()) controller.abort();
    };
  }, []);

  const clearDismissTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const scheduleDismiss = useCallback(
    (id: number) => {
      clearDismissTimer(id);
      const timer = window.setTimeout(() => {
        timers.current.delete(id);
        setUploads((prev) => prev.filter((entry) => entry.id !== id));
        jobs.current.delete(id);
      }, 5000);
      timers.current.set(id, timer);
    },
    [clearDismissTimer],
  );

  const run = useCallback(
    async (job: UploadJob): Promise<void> => {
      // A queued job can be cancelled before it ever gets a controller.
      if (cancelledJobs.current.delete(job.id)) {
        jobs.current.delete(job.id);
        setUploads((prev) =>
          prev.map((entry) => (entry.id === job.id ? { ...entry, status: "cancelled" } : entry)),
        );
        return;
      }
      // A paused job must not start just because the queue reached it.
      if (pausedJobs.current.has(job.id)) {
        setUploads((prev) =>
          prev.map((entry) => (entry.id === job.id ? { ...entry, status: "paused" } : entry)),
        );
        return;
      }
      const controller = new AbortController();
      controllers.current.set(job.id, controller);
      setUploads((prev) =>
        prev.map((entry) => (entry.id === job.id ? { ...entry, status: "uploading" } : entry)),
      );
      try {
        const options = {
          signal: controller.signal,
          onProgress: ({
            loaded,
            total,
            percent,
          }: {
            loaded: number;
            total: number;
            percent: number;
          }) => {
            setUploads((prev) =>
              prev.map((entry) =>
                entry.id === job.id
                  ? { ...entry, loaded, size: total || entry.size, percent }
                  : entry,
              ),
            );
          },
        };
        const attemptUpload = () =>
          job.replaceId === null
            ? uploadFile(job.file, job.folderId, {
                ...options,
                operationId: job.operationId,
                format: job.format,
              })
            : replaceFile(job.file, job.replaceId, {
                ...options,
                operationId: job.operationId,
                format: job.format,
                requireEncryption: job.format !== null,
              });
        // Transient failures are retried in place with the same operation id,
        // so a request that did reach the server cannot commit twice.
        let result: UploadResult;
        for (let attempt = 1; ; attempt += 1) {
          try {
            result = await attemptUpload();
            break;
          } catch (error) {
            const interrupted = pausedJobs.current.has(job.id) || controller.signal.aborted;
            if (interrupted || attempt >= MAX_UPLOAD_ATTEMPTS || !isRetryableUploadError(error)) {
              throw error;
            }
            setUploads((prev) =>
              prev.map((entry) =>
                entry.id === job.id
                  ? {
                      ...entry,
                      message: `Connection problem — retrying (${attempt + 1}/${MAX_UPLOAD_ATTEMPTS})`,
                    }
                  : entry,
              ),
            );
            await sleepUnlessAborted(uploadRetryDelay(attempt), controller.signal);
          }
        }
        // A file stored as OCE2 has an opaque name at the server, so the
        // client is the only place that can know what it is called. Record it
        // in the index, which is encrypted with the root key.
        // OCE2 needs an entry for its hidden name; OCE1 needs the crypto ids so
        // a later rename can re-encrypt the metadata blob.
        if (
          result.file.encryptionFormat === "OCE2" ||
          result.cryptoFileId !== undefined ||
          result.cryptoVersionId !== undefined
        ) {
          nameIndex.upsert({
            id: result.file.id,
            name: job.file.name,
            mimeType: job.file.type || null,
            description: null,
            size: result.file.size,
            folderId: result.file.folderId,
            starred: result.file.starred,
            trashed: result.file.trashed,
            versionCount: result.file.versionCount,
            createdAt: result.file.createdAt,
            updatedAt: result.file.updatedAt,
            ...(result.cryptoFileId !== undefined ? { cryptoFileId: result.cryptoFileId } : {}),
            ...(result.cryptoVersionId !== undefined
              ? { cryptoVersionId: result.cryptoVersionId }
              : {}),
          });
        }
        if (!mounted.current) return;
        void store.current?.delete(job.id);
        setUploads((prev) =>
          prev.map((entry) =>
            entry.id === job.id ? { ...entry, status: "done", percent: 100 } : entry,
          ),
        );
        invalidateDriveQueries(queryClient);
        if (job.replaceId !== null) invalidateVersionQueries(queryClient, job.replaceId);
        const encrypted = result.file.encryptionFormat !== null;
        const successMessage =
          job.replaceId === null
            ? `Uploaded "${job.file.name}"${encrypted ? " (encrypted)" : ""}`
            : `Replaced "${job.file.name}"${encrypted ? " (encrypted)" : ""}`;
        toast.success(successMessage);
        notify("OmniCloud upload complete", successMessage, `upload-${job.id}`);
        scheduleDismiss(job.id);
      } catch (error) {
        if (!mounted.current) return;
        const message = errorMessage(error, "Upload failed");
        const cancelled = error instanceof ApiError && error.code === "ABORTED";
        const paused = pausedJobs.current.has(job.id);
        if (paused) {
          setUploads((prev) =>
            prev.map((entry) =>
              entry.id === job.id ? { ...entry, status: "paused", message: undefined } : entry,
            ),
          );
          return;
        }
        // A terminal failure is not resumed automatically on the next load;
        // the job stays in the panel so the user can retry it deliberately.
        void store.current?.delete(job.id);
        setUploads((prev) =>
          prev.map((entry) =>
            entry.id === job.id
              ? { ...entry, status: cancelled ? "cancelled" : "error", message }
              : entry,
          ),
        );
        if (!cancelled) {
          toast.error(`Could not upload "${job.file.name}": ${message}`);
          notify(
            "OmniCloud upload failed",
            `Could not upload "${job.file.name}": ${message}`,
            `upload-${job.id}`,
          );
        }
      } finally {
        controllers.current.delete(job.id);
      }
    },
    [queryClient, scheduleDismiss, toast, nameIndex],
  );

  // Restore jobs that were still pending when the renderer last went away.
  // Runs once per mount: `run` changes identity with the hooks above, so the
  // guard is a ref rather than a dependency.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let cancelled = false;
    void (async () => {
      const records = await store.current!.list();
      if (cancelled) return;
      records.sort((a, b) => a.createdAt - b.createdAt);
      for (const record of records) {
        const file = fileFromPersistedJob(record);
        const job: UploadJob = {
          id: record.id,
          file,
          replaceId: record.replaceId,
          folderId: record.folderId,
          operationId: record.operationId,
          format: record.format,
        };
        uploadIdCounter = Math.max(uploadIdCounter, record.id);
        jobs.current.set(job.id, job);
        if (record.paused) pausedJobs.current.add(job.id);
        setUploads((prev) => [
          ...prev,
          {
            id: job.id,
            name: file.name,
            size: file.size,
            loaded: 0,
            percent: 0,
            status: record.paused ? "paused" : "queued",
          },
        ]);
        if (!record.paused) queue.current = queue.current.then(() => run(job));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run]);

  const enqueueJob = useCallback(
    (job: UploadJob) => {
      jobs.current.set(job.id, job);
      void store.current?.put(toPersistedJob(job.id, { ...job, paused: false }));
      setUploads((prev) => [
        ...prev,
        {
          id: job.id,
          name: job.file.name,
          size: job.file.size,
          loaded: 0,
          percent: 0,
          status: "queued",
        },
      ]);
      queue.current = queue.current.then(() => run(job));
    },
    [run],
  );

  const enqueue = useCallback(
    (files: File[], folderId: string | null) => {
      requestNotificationPermission();
      for (const file of files) {
        uploadIdCounter += 1;
        enqueueJob({
          id: uploadIdCounter,
          file,
          replaceId: null,
          folderId,
          operationId: newOperationId(),
          format: encryptFormatPref(),
        });
      }
    },
    [enqueueJob],
  );

  const replace = useCallback(
    (file: File, fileId: string, format: EncryptionFormat | null) => {
      uploadIdCounter += 1;
      enqueueJob({
        id: uploadIdCounter,
        file,
        replaceId: fileId,
        folderId: null,
        operationId: newOperationId(),
        // Preserve the target's format: a plaintext file stays plaintext, and
        // an encrypted file must not silently lose encryption.
        format,
      });
    },
    [enqueueJob],
  );

  const cancel = useCallback((id: number) => {
    const wasPaused = pausedJobs.current.delete(id);
    void store.current?.delete(id);
    const controller = controllers.current.get(id);
    if (controller) {
      controller.abort();
    } else if (wasPaused) {
      // The paused job already left the queue, so nothing will dequeue it.
      setUploads((prev) =>
        prev.map((entry) =>
          entry.id === id ? { ...entry, status: "cancelled", message: undefined } : entry,
        ),
      );
    } else {
      // Not started yet: mark it so `run` skips it when dequeued.
      cancelledJobs.current.add(id);
    }
  }, []);

  const pause = useCallback((id: number) => {
    const job = jobs.current.get(id);
    if (job === undefined) return;
    pausedJobs.current.add(id);
    void store.current?.put(toPersistedJob(id, { ...job, paused: true }));
    const controller = controllers.current.get(id);
    if (controller) {
      // The abort surfaces as an ABORTED error; `run` sees the paused flag and
      // keeps the job instead of treating it as cancelled.
      controller.abort();
    } else {
      setUploads((prev) =>
        prev.map((entry) => (entry.id === id ? { ...entry, status: "paused" } : entry)),
      );
    }
  }, []);

  const resume = useCallback(
    (id: number) => {
      const job = jobs.current.get(id);
      if (job === undefined) return;
      pausedJobs.current.delete(id);
      void store.current?.put(toPersistedJob(id, { ...job, paused: false }));
      setUploads((prev) =>
        prev.map((entry) =>
          entry.id === id
            ? { ...entry, status: "queued", percent: 0, loaded: 0, message: undefined }
            : entry,
        ),
      );
      queue.current = queue.current.then(() => run(job));
    },
    [run],
  );

  const retry = useCallback(
    (id: number) => {
      const job = jobs.current.get(id);
      if (job === undefined) return;
      cancelledJobs.current.delete(id);
      pausedJobs.current.delete(id);
      clearDismissTimer(id);
      void store.current?.put(toPersistedJob(id, { ...job, paused: false }));
      setUploads((prev) =>
        prev.map((entry) =>
          entry.id === id
            ? { ...entry, status: "queued", percent: 0, loaded: 0, message: undefined }
            : entry,
        ),
      );
      queue.current = queue.current.then(() => run(job));
    },
    [clearDismissTimer, run],
  );

  const dismiss = useCallback(
    (id: number) => {
      clearDismissTimer(id);
      controllers.current.get(id)?.abort();
      cancelledJobs.current.add(id);
      pausedJobs.current.delete(id);
      jobs.current.delete(id);
      void store.current?.delete(id);
      setUploads((prev) => prev.filter((entry) => entry.id !== id));
    },
    [clearDismissTimer],
  );

  const clearFinished = useCallback(() => {
    setUploads((prev) => {
      for (const entry of prev) {
        if (entry.status === "uploading" || entry.status === "queued") continue;
        jobs.current.delete(entry.id);
        void store.current?.delete(entry.id);
      }
      return prev.filter((entry) => entry.status === "uploading" || entry.status === "queued");
    });
  }, []);

  const openPicker = useCallback((folderId: string | null) => {
    pickerFolder.current = folderId;
    pickerInputRef.current?.click();
  }, []);

  const onPickerChange = useCallback(() => {
    const input = pickerInputRef.current;
    if (input === null) return;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) enqueue(files, pickerFolder.current);
  }, [enqueue]);

  return {
    uploads,
    enqueue,
    replace,
    cancel,
    pause,
    resume,
    retry,
    dismiss,
    clearFinished,
    openPicker,
    pickerInputRef,
    onPickerChange,
  };
}
