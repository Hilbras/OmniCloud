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
- Docs: [`pwa.md`](pwa.md) with desktop/Android/iOS manual checks.

Acceptance: install prompt appears, the installed app opens the drive shell
offline and shows the cached listing. Share Target is a follow-up.

## Phase 3 — Background uploads in the Electron main process

Status: **implemented** (tray uploads; per-folder targeting and progress are
follow-ups).

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
Electron run.

## Phase 4 — Storage provider adapters (local disk first)

Goal: run OmniCloud without Telegram.

- `LocalStorageProvider` implementing the existing `StorageProvider` contract
  (put/get/stream/range/delete/list/find-by-caption) over a directory, with a
  metadata sidecar per object.
- `STORAGE_PROVIDER=local` + `LOCAL_STORAGE_DIR`; storage rows carry
  `provider = "local"`; per-folder targeting and file migration use the same
  resolver.
- Health check and reconciliation understand both providers.
- S3-compatible adapter is a follow-up using the same contract.
- Tests: provider contract suite against a temp directory (including range and
  caption lookup), API upload/download/migrate with local storage, restart keeps
  objects readable.
- Docs: `docs/deployment.md` local mode; limitations.

Acceptance: a fresh instance with `STORAGE_PROVIDER=local` uploads, lists,
downloads, shares and migrates files without a Telegram account.

## Phase 5 — Key rotation UX

Goal: a user can rotate the root key without losing access.

- Version header endpoint: `GET /api/files/:id/versions/:versionId/header`.
- Client flow: generate a new URK, re-wrap every version with
  `rotateVersionKeys`, store via `POST /api/files/:id/rotate`, then re-encrypt the
  local name index and create a new recovery blob (new recovery code shown once).
- Resumable: a rotation journal records the last completed file; an interrupted
  run resumes without half-rotated files.
- Access: while rotating, the client keeps both URKs in memory; after completion
  the old URK is dropped and device pairings are invalidated.
- UI: Settings → Encryption → Rotate key, with progress and a clear warning that
  the recovery code changes.
- Tests: crypto vectors (already present), journal resume, index re-encryption,
  recovery blob round-trip, API epoch guards (already present).
- **External gate:** ships only after the independent cryptographic review
  recorded in `docs/audits/encryption-review.md`. Until then the UI stays hidden
  and the API is admin-only.

Acceptance: after rotating, every file decrypts with the new key, the old key
fails, the new recovery code works and an interrupted rotation resumes.

## Phase 6 — Team spaces

Goal: shared folders with roles, per-member keys and audit.

- Resolve the OCE2 name strategy (space name key vs. OCE2 forbidden in spaces) and
  record the decision in `team-spaces-design.md`.
- Space key wrapped to each member under their URK; file DEKs wrapped under the
  space key; resumable re-wrap on member removal.
- Roles owner/editor/viewer enforced server-side; one-time invites in the URL
  fragment; audit events.
- UI: spaces list, member management, role badges, rotation progress.
- Tests: the six invariants already listed in `team-spaces-design.md`, plus role
  matrix and invite expiry.
- **External gate:** cryptographic review, same as Phase 5.

Acceptance: a removed member cannot decrypt new writes; role enforcement covered
by API tests; invite link works once.

---

## Verification policy

- Each phase: unit + API tests for its behaviour, full gates, docs updated.
- End-to-end evidence for user-visible flows in `docs/evidence/`.
- External blockers are recorded in this file at the phase; work stops at the
  gate instead of shipping unreviewed crypto.
