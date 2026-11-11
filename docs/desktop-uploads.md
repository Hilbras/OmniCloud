# Desktop background uploads

The Electron main process owns a durable upload queue, so tray uploads keep
running when the window is hidden and resume after a relaunch.

## Files

| File                           | Purpose                                             |
| ------------------------------ | --------------------------------------------------- |
| `apps/desktop/upload-queue.ts` | Durable queue: enqueue, cancel, retry, persist      |
| `apps/desktop/main.ts`         | Wires the queue to the tray, session cookie and API |
| `apps/desktop/preload.ts`      | `desktopUpload.queue/cancel/onQueueChange` bridge   |

## Behaviour

- State lives in `userData/upload-queue.json`, written atomically (temp file +
  rename). A job left `uploading` by a crash is treated as `queued` on load.
- Each job keeps its `operationId` across restarts, so the server treats a retry
  as the same upload and cannot create a duplicate file.
- The uploader reads the `omnicloud_session` cookie from the Electron session
  store and posts multipart to `/api/files` with `openAsBlob`, so large files
  stream from disk instead of being buffered.
- Retries use 1s → 4s backoff, three attempts total; then the job is marked
  `error` and a notification is shown.
- Tray tooltip shows the active count; completion/failure raises a native
  notification and tells the renderer to refresh.
- Tray “Upload files…” always enqueues into the main queue (root folder). The
  renderer's own picker still uploads to the open folder through the browser
  queue.

## Manual checks

- [ ] Tray → Upload files…, hide the window: the tooltip shows the active count
      and a notification appears on completion.
- [ ] Quit the app mid-upload, relaunch: the job resumes and finishes once.
- [ ] Same file queued twice with different operation ids creates two files;
      the same job retried creates one.
- [ ] Upload while signed out: job retries, then shows “Sign in to resume”.
- [ ] Cancel a queued job in the bridge (`desktopUpload.cancel(id)`): it never
      uploads.

## Limits

- Tray uploads target the root folder; per-folder targeting needs the renderer
  to pass a folder id through the bridge (not wired yet).
- Telegram has no resumable upload session: a resumed job re-sends bytes from
  the start; the operation id prevents duplicates.
- Upload progress is not surfaced in the main-process queue yet.
