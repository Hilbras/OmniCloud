# SDK (`@hilbras/omnicloud`) v0.3

The package ships three things:

- the `OmniCloudClient` HTTP client, which works in Node and in the browser;
- the server-side building blocks (storage abstraction, domain services and the
  Telegram integration), which need a persistent MTProto connection and so run
  on the server only;
- the `omnicloud` command, which runs a complete OmniCloud server
  (see [`deployment.md`](deployment.md#install-from-npm)) and provides the
  end-to-end-encryption commands documented in [omnicloud CLI](#omnicloud-cli).

## Install

```bash
npm install @hilbras/omnicloud
# or
pnpm add @hilbras/omnicloud
```

Requires Node 20+. The package is ESM-first with a CJS build and TypeScript
types.

To run a server instead of calling one, see the `omnicloud` command in the
[README](../README.md#quick-start).

## `OmniCloudClient`

```ts
import { OmniCloudClient } from "@hilbras/omnicloud";

const cloud = new OmniCloudClient({
  baseUrl: "https://cloud.example", // default: same-origin (relative URLs)
  token: undefined, // optional Bearer token
  fetchImpl: undefined, // custom fetch (tests/polyfills)
  retry: { attempts: 3, baseDelayMs: 300 }, // transient-failure retry
  headers: { "x-custom": "value" }, // extra headers on every request
});
```

| Option              | Default        | Notes                                                                                                                                              |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`           | `""`           | Trailing slash is stripped; empty means relative URLs (same origin)                                                                                |
| `token`             | —              | Adds `Authorization: Bearer <token>`. The stock server uses cookie auth, so this is only for deployments that place token auth in front of the API |
| `fetchImpl`         | global `fetch` | Inject a polyfill or a test double                                                                                                                 |
| `retry.attempts`    | `3`            | Total attempts including the first                                                                                                                 |
| `retry.baseDelayMs` | `300`          | Backoff doubles per retry                                                                                                                          |
| `headers`           | `{}`           | Merged into every request                                                                                                                          |

All requests are sent with `credentials: "include"`, so cookie sessions work
in the browser and in Node fetch.

### Errors

Any non-2xx response throws:

```ts
import { OmniCloudError } from "@hilbras/omnicloud";

try {
  await cloud.files.get("missing-id");
} catch (error) {
  if (error instanceof OmniCloudError) {
    error.status; // HTTP status, e.g. 404
    error.code; // stable code, e.g. "FILE_NOT_FOUND"
    error.message; // human-readable
    error.requestId; // correlate with server logs (may be undefined)
    error.details; // optional structured detail
  }
}
```

`code` mirrors the server's `ERROR_CODES`; the full table is in
[api.md](./api.md#error-codes). Cancellation surfaces as
`OmniCloudError(0, "ABORTED", ...)` and network failures during XHR uploads as
`OmniCloudError(0, "NETWORK_ERROR", ...)`.

### Retry policy

`request()` retries an operation when it throws an `OmniCloudError` whose status
is `408`, `429` or `>= 500`, up to `retry.attempts` with exponential backoff.
This covers idempotent JSON calls. Uploads handle their own retry (see below);
downloads do not retry automatically.

## Namespaced API

Every group is a sub-client, so calls read as `cloud.files.list(...)`,
`cloud.trash.empty()`, and so on. All response shapes match the DTOs in
`@omnicloud/shared` and the HTTP reference.

### `auth`

```ts
const session = await cloud.auth.me();
// { user, storage, health } — all null when signed out

await cloud.auth.startTelegramLogin("+15551234567");

const verify = await cloud.auth.verifyTelegramCode("+15551234567", "12345");
if (verify.status === "password_required") {
  const done = await cloud.auth.submitTelegramPassword("+15551234567", "••••••");
  // { status: "ok", user }
}

await cloud.auth.logout();

// OCE1 recovery record: opaque ciphertext only — the server never sees the code.
const { recoveryBlob } = await cloud.auth.getRecoveryBlob(); // string | null
await cloud.auth.setRecoveryBlob(blobBase64); // exactly 72 bytes, base64
await cloud.auth.clearRecoveryBlob();
```

In the browser, the session cookie is set by the server; the SDK relies on
`credentials: "include"`. Sign-in must be initiated from the same origin (or an
origin listed in `ALLOWED_ORIGINS`), because state-changing requests are
origin-checked.

### `files`

```ts
// List active files. folderId: null = root; omit to span every folder.
const page = await cloud.files.list({ folderId: null, sort: "name", order: "asc", limit: 50 });
// { files: FileDTO[], pagination }

await cloud.files.get("file-id");
await cloud.files.versions("file-id");

// Version history: restore an earlier version, or remove one.
// Restoring points the file back at the version that already exists — nothing
// is re-uploaded, so the restored content keeps the version id its ciphertext
// is bound to and decrypts exactly as before. The current version cannot be
// removed this way.
await cloud.files.restoreVersion("file-id", "version-id");
await cloud.files.deleteVersion("file-id", "version-id");

// Upload with progress and cancellation
const controller = new AbortController();
const file = await cloud.files.upload(
  { data: new Blob([bytes]), name: "report.pdf" },
  {
    folderId: null,
    retry: 2, // 2 retries → up to 3 attempts total
    signal: controller.signal,
    onProgress: ({ loaded, total, percent }) => console.log(percent, "%"),
  },
);

// Buffers the whole file in memory. Deprecated: use downloadToFile or downloadStream for large files.
const result = await cloud.files.download("file-id", (p) => console.log(p.loaded, p.total));
// { data: Buffer | Uint8Array, contentType, size, sha256, integrityVerified }

cloud.files.downloadUrl("file-id"); // direct href for an <a> tag

// Stream instead of buffering: use this for large files. Read the stream to the
// end; a truncated transfer errors with DOWNLOAD_INCOMPLETE instead of ending quietly.
const { stream, size, sha256 } = await cloud.files.downloadStream("file-id");
for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
  // handle each chunk; memory does not grow with the file
}

// Node only: stream straight to disk. The bytes go to a `.part` file that is
// renamed into place only after the full length is verified, so a failed or
// truncated download leaves nothing at the target path.
await cloud.files.downloadToFile("file-id", "/tmp/report.pdf");

// Upload inputs: a Blob/File, a Uint8Array, a web ReadableStream, a Node
// Readable, or (Node only) a file path. Streams are read in chunks.
await cloud.files.upload({ data: nodeReadable, name: "big.bin" });
await cloud.files.upload({ path: "/data/big.bin", name: "big.bin" });

await cloud.files.replace("file-id", { data: new Blob([newBytes]), name: "report-v2.pdf" });
await cloud.files.rename("file-id", "new-name.pdf");
await cloud.files.star("file-id", true);
await cloud.files.move("file-id", "folder-id"); // or null for root
await cloud.files.trash("file-id");
await cloud.files.restore("file-id");
await cloud.files.delete("file-id"); // PERMANENT (use trash first)

await cloud.files.batch("trash", ["id-1", "id-2"]);
await cloud.files.batch("move", ["id-1"], { folderId: null });
// { requested, succeeded, failed, errors }
```

`UploadInput.data` accepts a `Blob`/`File` in the browser or a
`Uint8Array`/`Buffer` in Node; `name` is the filename and also determines the
server-side MIME type.

`UploadOptions`:

| Option       | Default | Notes                                     |
| ------------ | ------- | ----------------------------------------- |
| `folderId`   | —       | Target folder; omit for root              |
| `onProgress` | —       | Receives `{ loaded, total, percent }`     |
| `signal`     | —       | Aborts the upload (`AbortController`)     |
| `retry`      | `2`     | Number of retries after the first attempt |

`DownloadResult.sha256` comes from the `X-Content-SHA256` response header.
`integrityVerified` is `null`: the server no longer reports it as a header,
because it verifies the checksum before releasing the final bytes. A download
that fails verification does not complete. Treat a rejected or truncated
download as a failed integrity check.

### `folders`

```ts
const root = await cloud.folders.list(); // root children
await cloud.folders.list({ parentId: "folder-id" });
await cloud.folders.list({ sort: "name", starred: true }); // filtered query
const tree = await cloud.folders.tree(); // FolderDTO[]

const folder = await cloud.folders.create("Documents", null);
await cloud.folders.rename(folder.id, "Docs");
await cloud.folders.star(folder.id, true);
await cloud.folders.move(folder.id, "parent-id"); // or null for root

const { affectedFolders, affectedFiles } = await cloud.folders.trash(folder.id);
await cloud.folders.restore(folder.id);
await cloud.folders.delete(folder.id); // PERMANENT subtree

await cloud.folders.batch("move", ["id-1"], { parentId: null });
```

`folders.list` accepts the shared `ListQuery` plus `parentId`. When `parentId`
is provided it is sent as `?parentId=<id>` (empty string for root); otherwise
the other query params are serialized normally.

### `trash`

```ts
const trashed = await cloud.trash.list({ page: 1, limit: 50 });
// { files, folders, pagination }

const result = await cloud.trash.empty();
// { deletedFiles, deletedFolders, failedFiles }
```

`failedFiles > 0` means some remote objects could not be deleted; the affected
items remain in the Trash and the call can be retried.

```ts
// How long trashed items are kept before they are removed for good.
// 0 means the server keeps the trash indefinitely.
const { days } = await cloud.trash.retention();

// Remove the expired trash now, without waiting for the server's scheduled
// job. Items still within their retention period are left alone.
const purged = await cloud.trash.purge();
// { deletedFiles, deletedFolders, failedFiles, skippedFiles }
```

### `storage`

```ts
const storage = await cloud.storage.ensure(); // creates the channel if needed
const stats = await cloud.storage.stats(); // StorageStatsDTO

const { health, stats: withStats } = await cloud.storage.health();
// GET /api/storage/health returns both in one call

const healthDeep = await cloud.storage.check(true); // deep Telegram round-trip
const report = await cloud.storage.integrityCheck({ deep: false }); // read-only
const server = await cloud.storage.serverHealth(); // public GET /api/health
```

Note the naming: `storage.health()` returns the combined
`{ health, stats }` payload, while `storage.check(deep)` returns just the
`StorageHealthDTO` from the explicit probe endpoint.

### `search`

```ts
const results = await cloud.search.query("type:pdf size:>10MB after:2026-01-01", {
  page: 1,
  limit: 50,
});
// { files, folders, pagination }
```

See the [query language](./api.md#search-query-language).

### `recent` and `activity`

```ts
const recent = await cloud.recent.list({ page: 1, limit: 20 });
// { items: [{ file, lastAction, lastActionAt }], pagination }

const activity = await cloud.activity.list({ page: 1, limit: 50 });
// { events: ActivityEventDTO[], pagination }
```

### Pagination usage

Every listing returns `{ page, limit, total, hasMore }`. Iterate with:

```ts
async function* allFiles(cloud: OmniCloudClient, query: ListQuery = {}) {
  let page = 1;
  for (;;) {
    const result = await cloud.files.list({ ...query, page, limit: 200 });
    yield* result.files;
    if (!result.pagination.hasMore) break;
    page += 1;
  }
}
```

`limit` is capped server-side at 200 (`MAX_PAGE_SIZE`).

## Node vs browser

| Concern    | Browser                                                                          | Node                                                                                              |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Session    | httpOnly cookie via `credentials: "include"`                                     | Cookie header must be supplied by the caller if cookie auth is used; otherwise run with a `token` |
| Upload     | `XMLHttpRequest` for real upload progress and `abort()`                          | `fetch` + `FormData` (no granular progress)                                                       |
| Download   | Streamed via `response.body.getReader()` with progress; `data` is a `Uint8Array` | Same code path; `data` is a `Buffer` (the SDK prefers `Buffer` when available)                    |
| File input | `Blob` / `File`                                                                  | `Buffer` / `Uint8Array`                                                                           |

The upload client automatically uses XHR when `XMLHttpRequest` exists and falls
back to `fetch` otherwise. `AbortSignal` works in both paths (XHR calls
`xhr.abort()`; fetch is not used when XHR is available).

## Streaming encryption (large files)

Files of any size can be encrypted chunk by chunk, so peak memory follows the
4 MiB chunk rather than the file size. Use these instead of `uploadEncrypted` /
`downloadEncrypted` when handling large files.

### Upload

```ts
import { uploadEncryptedStream } from "@hilbras/omnicloud";

const result = await uploadEncryptedStream(client, "/path/to/video.mp4", {
  name: "video.mp4",
  urk, // your user root key (never sent to the server)
  folderId: "fld_123", // optional
  retry: 2, // optional, default 2
  signal: controller.signal, // optional
  spoolDir: "/secure/tmp", // optional, defaults to the OS temp dir
});
```

The plaintext is encrypted into a `0600` temporary spool file first, then the
spool is streamed as a multipart body. The spool is deleted in a `finally`
block, including when the upload fails or is aborted. Retries replay the exact
same ciphertext bytes — nothing is re-encrypted and nothing is buffered in
memory.

### Download and decrypt to disk

```ts
import { downloadDecryptedToFile } from "@hilbras/omnicloud";

const result = await downloadDecryptedToFile(client, "file_456", {
  urk,
  targetPath: "/downloads/video.mp4",
  // Or derive the path from the encrypted file name:
  // resolveTarget: (metadata) => `/downloads/${metadata.name}`,
  signal: controller.signal,
});
console.log(result.bytes, result.sha256, result.metadata.name);
```

The envelope is streamed from the response, decrypted chunk by chunk, and
written to `<targetPath>.part`, which is renamed into place **only after the
authenticated manifest verifies**. A truncated, tampered, or corrupt download
rejects and leaves nothing behind at the target path.

Downloading a file that is not OCE1-encrypted rejects with a clear error; there
is no fallback to plaintext.

### Larger files in the browser

In the browser, `encryptFileStreaming` (used internally by the web app above
32 MiB) spools ciphertext to OPFS where available, falling back to in-memory
Blob parts with a documented 1 GiB ceiling above which it rejects explicitly.

Measured throughput and caveats are in
[`docs/evidence/web-streaming-bench.md`](evidence/web-streaming-bench.md).

## omnicloud CLI

`npx omnicloud` (installed globally as `omnicloud`) runs the server and the
end-to-end-encryption commands. Encryption commands talk to an **existing**
OmniCloud server over HTTP; they never start one and never read `.env`.

### Setup

1. In the web app create a personal API token: **Settings → API tokens**.
2. Store it once:

```bash
omnicloud login --url https://cloud.example
# API token (paste from the web app): ····   ← typed with echo off
```

`login` validates the token against the server before saving it to
`~/.config/omnicloud/config.json` (override with `--config <path>`), which is
written at mode `0600`. `omnicloud logout` removes the stored token locally;
revoke it server-side in the web app.

### Commands

```bash
omnicloud key generate --keyfile ~/omnicloud.key   # new root key, persisted 0600
omnicloud key generate --reveal                    # new root key, printed once (TTY)
omnicloud key status                               # fingerprint only
omnicloud key status --reveal                      # fingerprint + key (TTY)

omnicloud recovery generate --reveal               # new recovery code, stored on server
omnicloud recovery restore --keyfile ~/omnicloud.key   # recover key from the code
omnicloud recovery restore --reveal                # recover key, printed once (TTY)

omnicloud upload report.pdf --encrypt              # client-side OCE1 upload
omnicloud upload report.pdf --encrypt --folder fld_123
omnicloud download file_456 --decrypt -o report.pdf  # decrypt locally
omnicloud download file_456 -o raw.bin             # raw stored bytes (ciphertext for OCE1)
omnicloud migrate file_789                         # encrypt one legacy file in place
omnicloud migrate all                              # encrypt every plaintext file

omnicloud versions file_456                        # list a file's version history
omnicloud versions file_456 --restore ver_1        # make an earlier version current
omnicloud versions file_456 --delete ver_1         # remove one historical version
```

`upload` and `download` switch to the streaming path automatically for large
files (8 MiB and above for uploads), so the commands above need no extra flag
for multi-gigabyte files.

### Secret-handling rules

- **Secrets never appear in argv or environment variables, and are never
  logged.** The API token and root key enter the CLI through an interactive
  muted-echo prompt or a file the user explicitly created at mode `0600`.
- **On-screen secrets require `--reveal` and an interactive terminal.**
  `key generate`, `key status`, `recovery generate` and `recovery restore`
  print a key or code only when you pass `--reveal` and stdout is a TTY;
  redirected output is refused rather than silently written to a file.
- **No plaintext fallback.** `upload` requires `--encrypt` (there is no
  plaintext upload path), and `download --decrypt` refuses files that are not
  OCE1 — it tells you to `omnicloud migrate` them instead of writing anything.
- **Migration verifies before deleting.** `migrate` re-downloads and decrypts
  the stored ciphertext, byte-compares it with the original, and only then
  removes the plaintext predecessor (and only when no other history is lost).

### Keyfile threat note (explicit opt-in)

`--keyfile <path>` stores the root key as plaintext bytes on disk, mode `0600`
(created inside a `0700` directory). Anything that can read that file —
malware, a compromised account, a stolen backup of your home directory — can
decrypt every file the key protects. The CLI prints this warning when the file
is created and warns again if the file is ever found with loose permissions.
Prefer interactive entry, or keep the key only as a recovery code in your
password manager, on machines you do not fully control.

### Config reference

`~/.config/omnicloud/config.json` (or `$XDG_CONFIG_HOME/omnicloud/config.json`,
or `--config <path>`):

```json
{
  "url": "https://cloud.example",
  "token": "…personal API token…",
  "keyfile": "/home/you/omnicloud.key"
}
```

`url` and `keyfile` are not secrets; `token` is, which is why the file is
always written at `0600`.

## Server-side building blocks

The package re-exports the pieces a self-hosted integration may need beyond the
HTTP client.

Storage abstraction and helpers:

- `StorageEngine`, `sha256Hex`, `mapProviderError`, `sanitizeFileName`
- Types: `StorageProvider`, `StorageEngine`, `StoredRef`, `StoredObject`,
  `StorageUploadInput`, `TransferControl`, `TransferProgress`, `StorageHealth`,
  `EngineRetryPolicy`, `EngineUploadResult`, `ItemQuery`, `Paged`,
  `PageRequest`, `Repos`, `StorageRecord`, `StorageStats`, `FileTypeBucket`

Domain services and records:

- `FileService`, `FolderService`, `SearchService`, `StatsService`,
  `TrashService`, `IntegrityService`, `RecentService`, `ActivityService`,
  `noopActivityRecorder`
- Types: `FileRecord`, `FolderRecord`, `FileVersionRecord`, `ActivityEventRecord`,
  `ActivityRecorder`, `FileDownload`, `FolderMutationResult`,
  `IntegrityCheckOptions`, `EngineResolver`, `UserRecord`, `DomainError`

Telegram integration (server-side only):

- `TelegramClientManager`, `TelegramConnectionService`,
  `TelegramStorageProvider`, `mapTelegramError`, `TELEGRAM_PROVIDER`
- Types: `ConnectionStatus`, `TelegramCredentials`, `TelegramStorageOptions`

Shared vocabulary and query helpers:

- `ERROR_CODES`, `fileCategory`, `isFileCategory`, `mimeFromFilename`,
  `mimeMatchersForType`, `parseSearchQuery`, `parseSize`, `paginationMeta`
- DTO and enum types including `FileDTO`, `FolderDTO`, `FileVersionDTO`,
  `ActivityEventDTO`, `StorageStatsDTO`, `StorageHealthDTO`, `HealthDTO`,
  `IntegrityReportDTO`, `BatchResultDTO`, `SessionInfo`, `ListQuery`,
  `PaginationDTO`, `SortField`, `SortOrder`, `ItemStatus`, `ErrorCode`,
  `ApiErrorBody`, `ConnectionState`, `HealthStatus`, `UserDTO`, `StorageDTO`.

Because `TelegramClientManager` and the Telegram provider require a live
MTProto connection, import them only in server code. `OmniCloudClient` and the
shared types are safe in any runtime.
