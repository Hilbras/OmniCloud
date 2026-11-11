# Next features — plan

Six features chosen after the first plan shipped. Each phase is independently
useful, tested, and documented. Phases 5 and 6 touch the encryption protocol and
carry an explicit external-review gate.

Order: **folder shares → PWA → background uploads → provider adapters → key
rotation UX → team spaces.** Each phase leaves the suite green.

## Ground rules

- Every phase ships with tests and updated docs.
- Gates: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`.
- No plaintext fallback for encrypted data; no unverified crypto change.
- A phase can be marked accepted-with-blocker only with the blocker recorded here.

---

## Phase 1 — Folder share links

Status: **implemented** (plaintext downloads; encrypted files listed as locked).

Goal: share a whole folder with one link, read-only.

- Schema: `ShareLink.folderId` (nullable), `fileId` nullable; a database check
  enforces exactly one target. Migration `99j_folder_shares`.
- Create: `POST /api/shares` accepts `folderId`; the folder must belong to the
  user and not be trashed.
- Public listing: `GET /api/shares/download/:token/meta` returns `kind: "folder"`
  with the active descendants, without leaking paths outside the subtree.
- Download: `GET /api/shares/download/:token/files/:fileId` serves a plaintext
  file only when it is inside the shared folder subtree; encrypted files are
  `locked` and refused with `409`.
- Limits: password, expiry and max-downloads apply; only downloads count.
- UI: “Share” on folders, folder browsing view on `/s/:token` with per-file
  download buttons and lock badges.
- Tests (4): listing + inside/outside download, password + revocation, locked
  encrypted file, invalid target combinations.

Acceptance: a recipient opens one link, browses the tree and downloads every
plaintext file; nothing outside the folder is reachable.

## Phase 2 — Installable PWA

Status: **implemented** except Web Share Target (not started).

Goal: the web app installs like an app and opens offline.

- `manifest.webmanifest` with 192/512 any + maskable icons, `/drive` start URL,
  standalone display, shortcuts.
- Service worker: app-shell precache, cache-first static assets, network-first
  navigations, `/api/` never cached, `offline.html` fallback.
- Install card in the app (bottom-left), only when `beforeinstallprompt` fires,
  hidden in standalone mode and remembered after “Not now”.
- Tests (4): manifest completeness, document links, worker cache rules,
  self-contained offline page.
- Docs: [`pwa.md`](pwa.md) with desktop/Android/iOS manual checks. Installing on
  a device needs a browser/device session and is recorded as a manual check.

Acceptance: install prompt appears, the installed app opens the drive shell
offline and shows the cached listing. Share Target is a follow-up.

## Phase 3 — Background uploads in the Electron main process

Status: **implemented**; live GUI run blocked in this environment (no display),
so the quit/relaunch flow is covered by the queue tests plus the manual
checklist. Per-folder targeting and progress are follow-ups.

Goal: uploads continue after the window is closed or the app is quit.

- Main-process queue persisted as JSON in `userData`, one job per file with path,
  folder, operation id and status; atomic writes; crash recovery.
- Authenticated API calls from main using the renderer's `omnicloud_session`
  cookie read from the Electron session store; files stream via `openAsBlob`.
- Retry with 1s → 4s backoff, three attempts; native notification on
  completion/failure; tray tooltip shows the active count.
- Preload bridge: `queue()`, `cancel(id)`, `onQueueChange`.
- Tests (5): persistence + restart resume, retry success, attempt limit, cancel,
  stable job fields.
- Docs: [`desktop-uploads.md`](desktop-uploads.md), checklist items in
  `desktop-checklist.md`.

Acceptance: kill the app mid-upload, relaunch, the upload finishes once. The
queue unit tests cover the state machine; the manual checklist covers the live
Electron run, which needs a desktop session and is recorded as an environment
blocker for this run.

## Phase 4 — Storage provider adapters (local disk first)

Status: **implemented** (local disk + single-account sign-in; S3 follows the
same contract).

Goal: run OmniCloud without Telegram.

- `LocalStorageProvider` implements the full `StorageProvider` contract over a
  directory: `<id>.bin` + `<id>.json` sidecar, atomic temp→rename writes, SHA-256
  verification, byte-range streams, caption lookup for recovery, health probe.
- `STORAGE_PROVIDER=local` + `LOCAL_STORAGE_DIR` select the backend in the
  container; `ensureStorage` creates a `provider = "local"` registration without
  a Telegram channel, and health probes the directory.
- `AUTH_MODE=local` + `LOCAL_AUTH_EMAIL`/`LOCAL_AUTH_PASSWORD` add a
  single-account sign-in; Telegram credentials are optional only when both local
  modes are set. The login page branches on `GET /api/auth/mode`.
- Tests: provider contract (6), local sign-in/mode/ensure (5), end-to-end upload,
  download from disk and readability from a fresh container (3).
- Docs: deployment “Local storage mode”, `.env.example`, limitations.

Acceptance: a fresh instance with both local modes uploads, lists, downloads and
shares files without a Telegram account. S3 remains a follow-up.

## Phase 5 — Key rotation UX

Status: **accepted with external blocker.** Groundwork exists from the previous
plan: `rotateVersionKeys` (re-wraps DEK/metadata under a new epoch, content
untouched) and `POST /api/files/:id/rotate` (all versions in one transaction,
epoch guards). Tests cover both.

Blocked on the independent cryptographic review tracked in
`docs/audits/encryption-review.md`. The remaining client flow changes how the
root key, recovery blob, device pairings and local name index relate; shipping
it before that review would put users' only copy of their keys on an unreviewed
protocol change. The UI stays hidden and the API is not exposed in the app.

Remaining after the gate:

- per-version header endpoint (`GET /api/files/:id/versions/:versionId/header`);
- client re-wrap loop with a resumable journal and dual-URK access;
- recovery blob re-encryption + new recovery code, pairing invalidation;
- Settings → Encryption → Rotate key with progress and warnings.

Acceptance (unchanged): after rotating, every file decrypts with the new key,
the old key fails, the new recovery code works, and an interrupted rotation
resumes.

## Phase 6 — Team spaces

Status: **accepted with external blocker.** The sharing model, key hierarchy,
roles, API/DB sketch and the six invariants are documented in
[`team-spaces-design.md`](team-spaces-design.md). No server-side code exists.

Blocked on the same cryptographic review, plus the OCE2 name-strategy decision
recorded in the design (space name key vs. OCE2 forbidden in spaces). Both are
preconditions in the plan and cannot be resolved by implementation alone.

Acceptance (unchanged): a removed member cannot decrypt new writes; role
enforcement covered by API tests; invite links work once.

## Verification policy

- Each phase: unit + API tests for its behaviour, full gates, docs updated.
- End-to-end evidence for user-visible flows in `docs/evidence/`.
- External blockers are recorded in this file at the phase; work stops at the
  gate instead of shipping unreviewed crypto.
