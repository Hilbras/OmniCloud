# Future feature plan

Date: 2026-11-10
Scope: features beyond the audit remediation in `docs/audits/full-project-remediation-plan.md`.
Execution: one phase at a time; each phase ends with green gates and a concrete verification, not a status claim. External credentials/certificates are called out explicitly.

## Ground rules

- No custom cryptography and no plaintext fallback for encrypted files.
- No claim of server-side search over names the server never sees.
- No promise of “connect through installed Telegram” for storage: Telegram exposes no deep link that accepts a QR login token.
- New dependencies only when the repository cannot already do the job.
- Desktop artifacts stay unsigned until signing credentials exist; the UI says so.
- Every phase updates docs and CHANGELOG in the same slice.

## Phase 1 — WebDAV write support (start now, no external dependencies)

Status: **done 2026-11-10.** `PUT` streams to spool with the upload cap, creates or replaces, and maps domain errors to 4xx; `MOVE`/`COPY` honour `Destination` and `Overwrite`; `MKCOL` works; encrypted overwrite/copy is refused; `PROPPATCH`/`LOCK`/`UNLOCK` return 501. `WEBDAV_WRITE=false` rejects every mutating method. HTTP integration tests cover PUT create/overwrite/missing parent/oversize, MOVE, COPY, `Overwrite: F`, and read-only mode (17 WebDAV tests). Docs include a client matrix. A live mount with a real client still needs a signed-in Telegram account on this machine; it is the documented external step.

Goal: a mount can be used like a normal drive.

- `PUT /dav/**`: stream body to a temp file, enforce `MAX_UPLOAD_MB`, reject missing/oversized bodies, create or replace by path, return `201`/`204`, plaintext storage (documented).
- `MKCOL /dav/**`: explicit folder creation (already exists via `POST`; alias it).
- `MOVE /dav/**`: rename within the same folder and move across folders, honour `Destination` + `Overwrite`.
- `COPY /dav/**`: server-side copy of files (download → upload); reject folders until recursive copy is implemented.
- `PROPPATCH` + `LOCK`/`UNLOCK`: either implement enough for Finder/Explorer or return `501` with a documented client-support matrix.
- Correct status codes (`409` missing parent, `412` failed overwrite precondition, `423` locked).
- Docs: supported client matrix and encrypted-file behaviour.
- Tests: PUT size limits, nested PUT, overwrite, MOVE/COPY, read-only mode still `403`, and a live smoke with a real client if one is available.

Acceptance: all WebDAV tests pass; `WEBDAV_WRITE=false` rejects mutating methods; `curl -T` uploads a file visible in the drive.

## Phase 2 — Desktop release and auto-update

Status: **in progress.** `electron-updater` runs for packaged builds, downloads
in the background, prompts to restart, installs on quit, and is available from
the tray. GitHub is the publish feed; `latest*.yml` and blockmaps are part of the
release artifacts. CI now passes optional Apple/Windows signing secrets instead
of disabling identity discovery. Verified: updater loaded in the packaged app
and reported “not an AppImage” under the unpacked dir build. External: Apple
Developer ID + notarization and a Windows code-signing certificate; Linux
`.deb` updates require reinstalling (only AppImage self-updates). Not yet
verified: a real version-to-version update, which needs two published releases.

Goal: installable, updatable desktop builds for Linux, macOS and Windows.

- Linux: keep `.deb`/AppImage, add `.rpm` if cheap.
- macOS: Developer ID signing + notarization; `dmg` and `zip`.
- Windows: Authenticode signing for NSIS.
- CI: secrets for Apple/Windows certificates, fail the release job when a signed build is expected but missing, keep unsigned builds for PRs.
- `electron-updater`: check on launch, download in background, prompt to restart; channel + feed from GitHub Releases; never update while an upload is running.
- Release notes and update UI show version and artifact.
- External: Apple Developer account + certificate, Windows code-signing certificate. Until provided, CI produces unsigned artifacts and the UI warns.

Acceptance: a signed artifact installs without OS warnings; an older build detects, downloads and installs the new one; signed checks are enforced in CI.

## Phase 3 — Sharing

Status: **in progress (plaintext + OCE1 links done; folder shares pending).** Schema/migration for
`ShareLink`, repository, service, API, public `/s/:token` page and the share
dialog are implemented. Tokens are random 32-byte values stored only as
SHA-256; passwords use scrypt; links support expiry, download limits and
revocation; public endpoints are rate-limited and hide expired/revoked/
exhausted links behind `404`. OCE1 links carry a re-wrapped DEK and the link secret lives only in the URL
fragment; the share page reads the envelope header, derives the share KEK and
decrypts in the browser. OCE2 links are refused. Tests include a crypto
round-trip proving the link secret opens the DEK without the owner's URK, and
that the owner's wrapped key does not; API tests cover required key material,
metadata exposure and the download. Manual fresh-browser verification is still
pending. Folder shares are not implemented. Tests: 6 API share
tests (download, password, revoke, limit, expiry, encrypted refusal).

Goal: share a file or folder without giving away the whole drive.

- Database: share links (token hash, target, expiry, password hash, max downloads, revokedAt, createdAt), audit events.
- API: create/list/revoke; unauthenticated download route with rate limits and no listing leakage.
- Encryption: OCE1/OCE2 sharing policy. Recommended: share the wrapped key in the URL fragment (never sent to the server) for OCE1; disable OCE2 sharing until the key-transfer UX is reviewed.
- Web UI: share dialog, copy link, expiry/password options, revoke list.
- Docs: threat model, revocation wording, expiry semantics.
- Tests: token unguessability, expiry, revocation, password attempts, encrypted share decrypt in a fresh browser.

Acceptance: a fresh browser can download a shared file with the correct key; revoking stops access immediately; no server-side name leakage for OCE2.

## Phase 4 — Multi-device keys and rotation

Status: **pairing done; rotation pending.** A device wraps the URK under a
random link secret; the server stores only the wrapped payload and the secret
stays in the URL fragment. The pairing is one-time, account-bound, expires in
10 minutes by default, and the second device decrypts and installs the URK
without any file export. UI: Settings → “Pair another device”, public
authenticated `/pair/:id` page. Tests: API one-time/expiry/wrong-account
validation (4) and a web crypto round-trip (2).

Rotation groundwork is implemented and tested: `rotateVersionKeys` in
`packages/crypto` unwraps a version's DEK and metadata under the old URK, then
re-wraps the same DEK and re-encrypts the metadata under the new URK and epoch,
bound by AAD; the content ciphertext is untouched. `POST /api/files/:id/rotate`
stores the result for the file and every version in one transaction, refusing a
non-increasing epoch, a partial version set, a plaintext file or mismatched
version epochs. Tests: crypto round-trip, old key cannot open the new blobs,
wrong file/version binding rejected (3); API store-all-versions, epoch guard,
partial set, plaintext refusal (4). Remaining: the client flow (recovery blob
re-wrap, device pairings invalidation, index re-encryption), the UI, and
resumability across an interrupted rotation.

**External blocker for the remaining rotation work.** The rotation design
changes how the root key, recovery blob and name index relate; the project's own
policy is that encryption changes ship only after the independent cryptographic
review tracked in `docs/audits/encryption-review.md`, which has not happened.
Building and shipping the client flow (including the recovery-code re-wrap and
per-version header reads it needs) before that review would ship an unreviewed
protocol change to users' only copy of their keys, so it is deliberately
deferred until the review lands.

Goal: use the same encrypted drive on another device without exporting a file.

- Device pairing: second device shows a challenge; an unlocked device approves it and transfers the URK over an authenticated ephemeral channel (QR + short code; no server knowledge of the key).
- Recovery code remains the fallback.
- Key-epoch rotation: re-wrap DEKs and index; old epoch can no longer decrypt new writes; document that old ciphertext remains decryptable with the old key.
- UI: devices list, “approve device”, “rotate key”, clear warnings.
- Tests: pairing replay, wrong code, index/wrapped-key migration, vectors for epoch changes.

Acceptance: second device restores the URK without manual copying; rotation invalidates the old epoch for new content; interrupted rotation is resumable.

## Phase 5 — Resumable and background uploads (desktop)

Status: **in progress (queue persistence done).** Unfinished uploads are mirrored
into IndexedDB from the renderer: name, type, last-modified, bytes (structured
clone), folder, replace target, encryption format, paused flag and the original
`operationId`. On the next load the queue restores them oldest-first and resumes
automatically, except jobs the user explicitly paused. Resume keeps the
operation id, so the server treats it as the same operation and a retry cannot
create a duplicate object. Per-item pause/resume/cancel/retry are in the uploads
panel; concurrency stays at 1. Telegram has no server-side resumable upload
session, so a resumed transfer starts from byte 0 — the job survives, not the
byte offset. Transient failures (network, 429, 5xx) are retried in place with
exponential backoff (1s, 4s, 15s cap; 3 attempts total) using the same
operation id; 4xx errors and aborts are not retried. Tests: persistence
round-trip, operation-id stability across pause, store list/delete/clear,
IndexedDB-unavailable fallback (4), retry classification/backoff/abort (5).

Background operation after window close already works: the desktop window's
`close` handler hides the window instead of destroying it, so the renderer (and
its queue) keeps running while the app stays in the tray, and notifications fire
on completion. Quitting the app mid-upload is covered by the IndexedDB restore
on the next launch.

The first page of every listing (drive folders and files, plus the other list
pages that use the same hook) is saved to IndexedDB after a successful load. If
a later fetch fails, the saved page is put back into the query cache and the
drive renders it with an "Offline — showing the last listing saved on this
device" banner instead of an error page; pagination is disabled while offline.
Only server-visible metadata is cached: OCE2 names are opaque on the server and
are resolved from the encrypted name index, so the cache is not a plaintext copy
of hidden names. Entries older than 7 days are ignored. Tests: store/key/age/
clear/fallback (5).

Thumbnails for plaintext images are cached in the same IndexedDB database
(newest 120, keyed by file id + `updatedAt` so a replaced file never shows the
old picture). Encrypted thumbnails are deliberately **not** persisted: their
bytes are decrypted in the tab, and writing them to disk would undo the point of
encrypting the file. The cache is wiped on sign-out. Tests: key stability,
cacheability (plaintext only, size cap), round-trip, eviction, fallback (5).

File bodies can be kept offline explicitly: the file details panel offers
**Keep offline** / **Remove** for plaintext files up to 64 MB. The copy is the
server's bytes stored in IndexedDB (total budget 512 MB, oldest evicted first),
keyed by id + `updatedAt`, and `downloadFile` serves it without touching the
network — including when the API is unreachable. Encrypted files are not
offered: their stored bytes are ciphertext, and reading them offline would need
the URK, which is a separate feature. Copies are wiped on sign-out. Tests: key,
eligibility, round-trip, eviction, fallback (5). Bulk “make this folder
available offline” is not implemented.

Goal: large uploads survive sleep, restart and flaky Telegram connections.

- Persist upload jobs (file path, size, hash, operation id, progress, status) in local SQLite/JSON state.
- Resume by re-reading the spool and continuing the Telegram operation; never re-upload a completed object.
- Queue with pause/resume/cancel, concurrency 1 per account, retry with backoff and clear error classes.
- Background operation after window close (tray), native notification on completion/failure.
- Offline cache: file list + thumbnails available offline; explicit “make available offline” per folder.
- Tests: process kill during upload, restart resumes, duplicate prevention, queue ordering.

Remaining: a bulk “make this folder available offline” action, and offline
copies of encrypted files (would store ciphertext and require the URK to read).

Acceptance: kill the app mid-upload, relaunch, upload completes without duplicate objects; queue state survives restart.

## Phase 6 — Desktop and web UX polish

Status: **in progress.** Window size/position/maximized state persists in
`window-state.json` with validation (corrupt/absurd bounds fall back to a safe
default). Settings has a **Launch at login** switch backed by
`app.setLoginItemSettings`. Native app menu (Open Drive, Check for updates,
edit/view/window roles) and `omnicloud://drive` / `omnicloud://file/<id>` deep
links are implemented; file links open the drive with the file's details panel.
Tests: window-state validation and deep-link parsing. OS notifications for
upload completion/failure use the Web Notifications API, request permission on
enqueue, and are covered by tests. Tray actions (show, open in browser, upload
files, check updates, quit), folder upload, drag-to-move and HTTP range requests
are implemented; the custom title bar carries minimize/maximize/close on Linux
and Windows, and the app logo is installed. The per-OS manual checklist lives in
[`desktop-checklist.md`](desktop-checklist.md). Remaining and explicitly
accepted gaps: EXIF stripping and a full accessibility audit (reduced motion and
dialog focus traps are done).

Goal: the app feels native, not a wrapped website.

- Native menu, tray actions (upload folder, open drive, pause queue, quit), launch at login.
- Window-state persistence (size/position/maximized), multi-window if needed.
- Deep links: `omnicloud://file/<id>`.
- OS notifications, progress in taskbar/dock.
- Folder upload, drag-to-move between panes, keyboard-first file operations.
- Preview cache and video range requests; EXIF-stripping option.
- Accessibility pass: focus order, labels, reduced motion, contrast.
- Tests: unit tests for window-state helpers; manual platform checklist.

Acceptance: documented checklist per OS; no web-only controls in desktop; reduced-motion honoured.

## Phase 7 — Search and index lifecycle

Status: **in progress.** Encrypted name-index export/import is implemented in
Settings: export downloads the encrypted container; import validates it with the
current root key before replacing the stored index, so a wrong key or corrupt
file cannot wipe working names. Saved searches are implemented in the search overlay (newest first, deduped,
capped at 10, remove per chip). A consistency tool compares local names with the active + trashed file list,
reports stale entries and hidden files with no name, and can remove stale
entries. Rebuild is implemented: a new `/api/files/:id/header` endpoint returns the first
48 bytes, and the client decrypts each metadata blob with the URK to restore
names, MIME types, descriptions and crypto ids. Settings → Name index health →
**Rebuild names**. Test: API header slice + crypto rebuild round-trip.

Goal: local search is trustworthy across devices and after a reload.

- Index rebuild from server listing + envelope headers + decrypted metadata.
- Export/import encrypted index; optional passphrase backup.
- Saved searches and recent queries.
- Index consistency tool: detect missing/stale entries, repair without data loss.
- Server-side search unaffected; document exactly what remains local.
- Tests: rebuild on a second device, corrupted index, partial metadata, OCE1/OCE2 mixed.

Acceptance: a fresh device recovers all display names without re-uploading; corrupted index does not hide files.

## Phase 8 — Storage, accounts and tokens

Status: **in progress.** API tokens support `readOnly`, `expiresAt` and a
`scope`: `full` (default), `upload` (only `POST /api/files` and version uploads)
or `webdav` (only the DAV listener). Read-only tokens reject every mutating
API/WebDAV request with `403`; expired tokens resolve as unauthenticated; a
narrow scope cannot be combined with `readOnly`. The tokens page has a scope
selector and shows the scope per token. Tests cover read-only enforcement,
expired tokens, past-expiry rejection, upload-only upload+deny-list, WebDAV-only
deny, unknown scope and the readOnly combination. Activity log UI is implemented with action/date filters, pagination, and CSV
export; `/api/activity` accepts `action`, `from`, `to`. Quota alerts (≥90%) and subtree folder usage (top 10, including direct root
files) are implemented on the storage dashboard. A duplicate-content report
groups active files by SHA-256, shows the wasted bytes and the file names, and
is covered by a core test. Multi-storage groundwork: `File.storageId` and
`Folder.storageId` record which channel holds or receives objects (migration
`99h` backfills existing rows), the engine resolver takes a storage id scoped to
its owner, downloads/deletes/version cleanup use the file's recorded storage,
and an in-memory engine cache is keyed per storage. Accounts can create and list
extra private channels (`GET/POST /api/storages`, oldest is the default, max 5),
with a storage-channels card on the storage page. Folders carry an upload
target (`storageId` on create/patch, validated to a channel the same account
owns), uploads walk up the folder chain to the nearest target and record it on
the file, replacements stay in the file's existing channel, and the folder
details panel has an **Upload target** selector when more than one channel
exists. Existing files migrate between channels through
`POST /api/files/:id/migrate` (and a details-panel control): every version is
copied, SHA-256-verified, metadata is repointed in one transaction, and only then
are the old objects removed; a failure deletes the copies and leaves the file
readable where it was. Tests: default upload, second-storage download routing,
list/create/unauth API, folder target create/inherit/upload routing, clearing a
target, rejecting a foreign storage id, migration success (bytes readable from
the new channel) and a failed copy leaving the original intact.

Goal: stronger account and capacity controls.

- Multiple Telegram channels/accounts per user; choose target per folder; migrate between storages safely.
- Per-folder size and dedupe reports; quota alerts.
- API token scopes (read-only, upload-only, WebDAV) and expiry; token usage audit.
- Activity log UI with filters and CSV export.
- Version retention policies and restore UI.
- Tests: authorization matrix for scopes, migration rollback, quota enforcement.

Acceptance: read-only token cannot mutate; storage migration is resumable and verified; quota alert fires before failure.

## Phase 9 — Mobile and interoperability

Status: **in progress (WebDAV + browser SDK verified).** A real `rclone`
v1.76.0 binary was driven against the production WebDAV listener through an API
token over Basic auth: folder create, upload, byte-identical read, move and
delete all passed. The opt-in test (`RCLONE_BIN=... vitest run
test/rclone-webdav.test.ts`) is skipped by default so the suite stays hermetic;
evidence and command are in `docs/evidence/webdav-rclone.md` and the client
matrix in `docs/deployment.md`. Mounting needs FUSE and was not exercised.

A browser entry now ships as `@hilbras/omnicloud/browser`: `OmniCloudClient`,
the in-memory OCE1 helpers, crypto primitives and shared helpers, built in a
separate tsup invocation. The bundle has no static `node:` imports and the
server-only Telegram stack is absent; export surface is covered by 3 tests.
Evidence: `docs/evidence/sdk-browser-entry.md`. The main dts worker still runs
out of memory in this environment, which is pre-existing and independent.

Goal: reach beyond the desktop/browser.

- Android/iOS client on `packages/core` + `packages/sdk` (roadmap Phase 8).
- Documented SDK browser entry or a thin browser client package.
- rclone/WebDAV recipes tested against a real server.
- Optional S3-compatible/local-disk storage provider adapter (roadmap), with the same key-handling rules.

Remaining and external blockers: a mobile client needs Android/iOS toolchains
and a physical device for verification, neither available here; an
S3/local-disk provider is optional and not started.

Acceptance: mobile QR/code sign-in, upload/download/search flows verified on a device; rclone mount works for read and write.

## Phase 10 — Team spaces (optional, larger bet)

Status: **design documented; implementation not started.** The sharing model is
written in [`team-spaces-design.md`](team-spaces-design.md): space key wrapped to
each member under their URK, file DEKs wrapped under the space key, resumable
re-wrap on member removal, role matrix, API/DB sketch, and the invariants that
must be tested before shipping. It records the two blockers explicitly: the OCE2
name-hiding strategy is undecided (space-scoped name key vs. OCE2 forbidden in
spaces), and the re-wrap job depends on the pending key-epoch rotation
machinery, which needs crypto review.

- Shared folders with per-member wrapped keys; member add/remove re-wraps keys.
- Roles (owner/editor/viewer), invitation links, audit.
- Sharing model documented before any code; OCE2 name-hiding conflicts must be resolved.

Acceptance: a removed member cannot decrypt new writes; role enforcement covered by API tests.

## Prioritisation

1. WebDAV write (unblocked, immediate interoperability).
2. Desktop signing/auto-update (distribution quality; external certs).
3. Sharing (user-facing value; needs crypto decision).
4. Multi-device keys (security prerequisite for wider use).
5. Resumable uploads (desktop differentiator).
6. UX polish, search rebuild, accounts/tokens.
7. Mobile, alternative providers, team spaces.

## Verification policy

Each phase closes only when:

- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` pass;
- new critical paths have real-PostgreSQL or end-to-end tests;
- the user scenario is exercised (WebDAV mount, packaged desktop, second device, shared link);
- docs and limitations match the code;
- external blockers are recorded, never silently skipped.
