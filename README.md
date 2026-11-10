# OmniCloud

**A self-hosted cloud drive that keeps your files in your own Telegram account.**

[![CI](https://github.com/Hilbras/OmniCloud/actions/workflows/ci.yml/badge.svg)](https://github.com/Hilbras/OmniCloud/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@hilbras/omnicloud)](https://www.npmjs.com/package/@hilbras/omnicloud)
[![license](https://img.shields.io/npm/l/@hilbras/omnicloud)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](./docs/deployment.md)

> Maintained by **[Hilbras](https://github.com/Hilbras)** · MIT licence · npm package
> [`@hilbras/omnicloud`](https://www.npmjs.com/package/@hilbras/omnicloud)

OmniCloud gives you a familiar drive interface — folders, search, trash, stars,
versions, storage statistics — while the bytes live in a private Telegram
channel that only your account can read. PostgreSQL holds the logical
filesystem. Telegram holds the files. OmniCloud is the layer between them.

```bash
npm install @hilbras/omnicloud
npx omnicloud
```

That applies the schema, starts the server and opens <http://localhost:4000>.

> **Telegram is the physical storage. PostgreSQL is the logical filesystem.
> OmniCloud is the cloud layer that ties them together.**

---

## Contents

- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [What the server can see](#what-the-server-can-see)
- [Features](#features)
- [Requirements](#requirements)
- [Configuration](#configuration)
- [Command reference](#command-reference)
- [API](#api)
- [SDK](#sdk)
- [Security](#security)
- [Backups](#backups)
- [Limitations](#limitations)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Desktop app](#desktop-app)
- [Contributing](#contributing)
- [License](#license)

---

## What you get

|                  |                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **One package**  | The web app, the HTTP API, the SDK and the `omnicloud` command ship as `@hilbras/omnicloud` on npm.                          |
| **One port**     | The API serves the built web app, so there is no second process to manage.                                                   |
| **One database** | PostgreSQL holds the filesystem metadata. There is no object store to pay for.                                               |
| **Your storage** | Files are stored as messages in a private Telegram channel in your own account. Nothing is uploaded to a third-party bucket. |
| **Your keys**    | Client-side encryption is available and optional. When it is on, the server and Telegram hold ciphertext only.               |

---

## Quick start

You need Node.js 20 or newer, a PostgreSQL database, and a Telegram API
application (free, about two minutes at [my.telegram.org](https://my.telegram.org)).

**1 — Start PostgreSQL.** If you do not already have one, this runs a local
instance:

```bash
docker run -d --name omnicloud-postgres -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=omnicloud -e POSTGRES_PASSWORD=omnicloud-dev-only -e POSTGRES_DB=omnicloud \
  postgres:16-alpine
```

**2 — Install and start.**

```bash
mkdir my-omnicloud && cd my-omnicloud
npm init -y
npm install @hilbras/omnicloud
npx omnicloud
```

The first run asks for three values in the terminal and saves them to `.env`:

| Value               | Where it comes from                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | For the container above: `postgresql://omnicloud:omnicloud-dev-only@127.0.0.1:5432/omnicloud` |
| `TELEGRAM_API_ID`   | [my.telegram.org](https://my.telegram.org) → **API development tools**                        |
| `TELEGRAM_API_HASH` | The same page                                                                                 |

OmniCloud generates `OMNICLOUD_ENCRYPTION_KEY` for you, applies the schema,
starts the server and opens the browser. Later runs skip the questions.

To write `.env` yourself instead, create it with those four keys.
`OMNICLOUD_ENCRYPTION_KEY` is 64 hex characters — `openssl rand -hex 32`
produces one. **Back it up separately from the database.** On a server without a
desktop, use `npx omnicloud start --no-open`.

**3 — Sign in.** The web app opens at <http://localhost:4000>. Enter your phone
number and confirm the code Telegram sends, or sign in with a QR code. On first
sign-in OmniCloud creates a private channel named **OmniCloud Storage** in your
account and stores every file as one message in it.

---

## How it works

```text
Browser ──► OmniCloud (one port: web app + /api)
                 │
                 ├── PostgreSQL ── users, folders, files, versions, trash, stars, activity
                 │
                 └── Storage engine
                        │
                        ▼
                 Telegram (MTProto)
                        │
                        ▼
                 Your private storage channel  ── the actual file bytes
```

**Uploads** stream to a temporary spool on disk, are hashed with SHA-256 while
they are written, are sent to Telegram, are verified, and only then recorded in
PostgreSQL. A failed Telegram upload never leaves behind a file that looks
valid.

**Downloads** stream from Telegram to the browser. The checksum is verified
before the final bytes are sent.

**Deleting** moves a file to Trash. Nothing remote is touched until you delete
it permanently, so restore is lossless. Trashed items are purged after
`TRASH_RETENTION_DAYS` (default 30; `0` keeps them indefinitely).

**Telegram sessions** are sealed at rest with AES-256-GCM using
`OMNICLOUD_ENCRYPTION_KEY`. They never reach the browser and are never logged.

The full design is in [`docs/architecture.md`](docs/architecture.md).

---

## What the server can see

This is the part most cloud storage pages leave out, so it is here in full.
"Server" means the OmniCloud API and its database. "Telegram" means the
provider holding your channel.

|                        | Plaintext upload (default)                         | Encrypted upload (opt-in)                                                         |
| ---------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| File contents          | visible to the server and to Telegram              | ciphertext only, for both                                                         |
| File name              | visible to the server and to Telegram              | visible to the server, unless you turn on the experimental "Hide the name" format |
| Folder name            | visible to the server                              | visible to the server                                                             |
| Size, type, timestamps | visible to the server                              | visible to the server                                                             |
| Your Telegram session  | sealed with AES-256-GCM, never sent to the browser | the same                                                                          |

Two consequences worth stating plainly:

- **Encryption is opt-in and has not been independently reviewed.** Until you
  enable it and migrate your existing files, files you uploaded earlier are
  still plaintext. See
  [`docs/audits/encryption-review.md`](docs/audits/encryption-review.md).
- **Telegram can read your channel.** OmniCloud runs as _your_ Telegram
  account, so Telegram itself is not blind to the content. Client-side
  encryption is what removes Telegram from the trust boundary for file
  contents.

---

## Features

### Files and folders

- Drag-and-drop upload with progress, cancel and retry
- Folders with rename, move, star, and recursive trash and restore
- Rename, move, star, replace (creates a new version), trash, restore, and
  permanent delete
- Batch actions on a multi-file selection
- Grid and list views, breadcrumbs, context menus, a details panel, keyboard
  shortcuts
- Encrypted previews: images and video decrypt in the tab, and the object URL is
  revoked afterwards — the plaintext is never written to the browser cache

### Versions

- Every replacement of a file creates a new version; the old one is kept
- Restore an earlier version from the details panel, or delete a single
  historical version, with a confirmation
- A restore points the file back at the version that already exists rather
  than copying its content — the encryption format binds each version's id
  into the authentication of its records, so a copy under a new id could never
  be decrypted
- `TRASH_RETENTION_DAYS` bounds how long deleted data lingers

### Finding things

Search understands a small query language:

| Field              | Examples                                |
| ------------------ | --------------------------------------- |
| `name`             | `name:report`, `name:quarterly pdf`     |
| `type` / `ext`     | `type:pdf`, `ext:png`                   |
| `size`             | `size:>100MB`, `size:<=2gb`, `size:5mb` |
| `folder`           | `folder:Projects`                       |
| `starred`          | `starred:true`                          |
| `trashed`          | `trashed:false`                         |
| `after` / `before` | `after:2026-01-01`, `before:2026-06-30` |

Sort by name, size, type, created or modified date, ascending or descending.
Starred and Recent views sit alongside the drive.

### Trust and recovery

- SHA-256 checksum stored for every file and verified on download
- Integrity scan that reports missing Telegram objects, size mismatches and —
  in deep mode — hash mismatches
- Reconciliation with a two-step repair: plan first, then apply. Repairs never
  delete Telegram messages
- A structured activity log of meaningful actions
- Health endpoints: `/api/health`, `/api/health/database`, `/api/health/ready`,
  `/api/health/live`
- A request id on every log line and every error response

### End-to-end encryption (experimental, opt-in)

- Files are encrypted on your device before upload with a per-file data key.
  The server and Telegram receive ciphertext only.
- Large files are encrypted chunk by chunk, so peak memory follows the chunk
  size rather than the file size
- Encrypted files are marked in the UI, and legacy plaintext uploads can be
  migrated with a verify-before-delete flow that keeps the original if anything
  goes wrong
- Recovery codes let you restore your key if you lose it. A password reset
  restores account access only — it cannot decrypt your files.
- The experimental OCE2 format hides the **file name** behind an opaque
  placeholder that only your browser can undo. It is not enabled by default and
  has not been reviewed.
- Available in the web app, the npm SDK and the CLI.

> Encryption is **opt-in and experimental**. It has not been independently
> reviewed — see [`docs/audits/encryption-review.md`](docs/audits/encryption-review.md)
> and [`docs/limitations.md`](docs/limitations.md).

### Operations

- Storage dashboard: usage, per-type breakdown, largest files, trash size, and
  an optional quota
- An hourly check for a newer npm release, with a notice in the sidebar
  (`UPDATE_CHECK_ENABLED`)
- Structured logs with redaction — passwords, codes, cookies and session
  strings are never written
- A `omnicloud` command that applies migrations and starts the server, so
  deployment is one process under systemd, pm2 or Docker
- **WebDAV server** (optional, opt-in via `WEBDAV_ENABLED=true`): a dedicated
  HTTP server exposing the folder tree under `/dav` for mounting with WebDAV
  clients that support Bearer, Basic or cookie authentication

---

## Desktop app

OmniCloud is available as a desktop application for Linux, macOS and Windows,
built with Electron. It bundles the server, the web app and a native window
into a single package — no separate Node.js install or browser needed.

Download the artifact for your system from the
[GitHub Releases page](https://github.com/Hilbras/OmniCloud/releases):

| System                        | File                                               | Install                                              |
| ----------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Linux (Debian/Ubuntu)         | `OmniCloud-<version>-linux-x64.deb` / `-arm64.deb` | `sudo dpkg -i <file>` then `sudo apt-get install -f` |
| Linux (portable)              | `OmniCloud-<version>-linux-x64.AppImage`           | `chmod +x <file>` and run it                         |
| macOS (Intel / Apple silicon) | `OmniCloud-<version>-mac-x64.dmg` / `-arm64.dmg`   | Open the `.dmg`, drag OmniCloud to Applications      |
| Windows (x64)                 | `OmniCloud-<version>-win-x64.exe`                  | Run the installer                                    |

The artifacts are unsigned. macOS Gatekeeper and Windows SmartScreen will warn
on first launch; allow the app in System Settings / More info if you trust the
build.

The Linux package name is `omnicloud`; the app appears in your application menu
as **OmniCloud**.

### First run

On first launch the app opens a setup window. Enter the Telegram API ID/hash,
the PostgreSQL URL, and generate an encryption key there; **Save and continue**
writes the config file (Linux: `~/.config/omnicloud/.env`, macOS:
`~/Library/Application Support/OmniCloud/.env`, Windows:
`%APPDATA%\OmniCloud\.env`; mode 600 on Unix), applies the bundled database
migrations, starts the server on `http://127.0.0.1:4000` and opens the app
window. No file editing is required.

The setup window also opens when the saved configuration is incomplete or the
database cannot be reached, prefilled with the current values. For automation,
`OMNICLOUD_ENV_FILE` can point at a preseeded file instead.

### What the desktop app contains

| Component             | Role                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| Electron main process | Spawns and monitors the bundled server, manages the tray icon            |
| Bundled server        | The same `@hilbras/omnicloud` server bundle, running on `localhost:4000` |
| Built web app         | Served by the bundled server from the same port                          |
| PostgreSQL            | Not included — point `DATABASE_URL` at your own instance                 |

The desktop app is distributed as `.deb`/AppImage, `.dmg`/`.zip` and NSIS
`.exe` artifacts from GitHub Releases. It is not published to npm: the npm
package would contain only the Electron shell, not the server, web assets or
Prisma engine it needs to run.

### Updating the desktop app

Download the installer for your platform from GitHub Releases and run it again
(`.deb`/AppImage, `.dmg`/`.zip`, or `.exe`). The app is not published to npm.

---

## Requirements

| Component  | Requirement                                                                   |
| ---------- | ----------------------------------------------------------------------------- |
| Node.js    | 20 or newer (22 recommended)                                                  |
| PostgreSQL | 14 or newer (the bundled Docker example uses 16)                              |
| Telegram   | An `api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org)    |
| Network    | Outbound access to Telegram's servers; inbound access to the server port only |

---

## Configuration

Configuration comes from environment variables. The `omnicloud` command also
reads a `.env` file in the current directory; variables already set in your
shell always win.

| Variable                          | Required          | Default              | Purpose                                                                                                                                                |
| --------------------------------- | ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                    | yes               | —                    | PostgreSQL connection string                                                                                                                           |
| `TELEGRAM_API_ID`                 | yes               | —                    | Your Telegram application id                                                                                                                           |
| `TELEGRAM_API_HASH`               | yes               | —                    | Your Telegram application hash                                                                                                                         |
| `OMNICLOUD_ENCRYPTION_KEY`        | yes in production | —                    | 64 hex characters. Seals Telegram sessions at rest. **Back it up separately from the database.**                                                       |
| `HOST`                            | no                | `0.0.0.0`            | Address to listen on                                                                                                                                   |
| `PORT`                            | no                | `4000`               | Port to listen on                                                                                                                                      |
| `NODE_ENV`                        | no                | `production`         | The `omnicloud` command defaults to `production`; running the API directly defaults to `development`. `production` requires `OMNICLOUD_ENCRYPTION_KEY` |
| `LOG_LEVEL`                       | no                | `info`               | `fatal`, `error`, `warn`, `info`, `debug` or `trace`                                                                                                   |
| `COOKIE_SECURE`                   | no                | `true` in production | Set `false` only for a plain-HTTP deployment                                                                                                           |
| `ALLOWED_ORIGINS`                 | no                | same-origin          | Comma-separated origins allowed to make state-changing requests and credentialed CORS calls                                                            |
| `TRUST_PROXY`                     | no                | `false`              | Trust `X-Forwarded-*` headers. Enable only behind a reverse proxy you control                                                                          |
| `MAX_UPLOAD_MB`                   | no                | `256`                | Largest accepted upload, in megabytes                                                                                                                  |
| `STORAGE_QUOTA_GB`                | no                | `0` (none)           | Optional quota shown on the Storage dashboard                                                                                                          |
| `TRASH_RETENTION_DAYS`            | no                | `30`                 | Days before trashed items are purged. `0` keeps them indefinitely                                                                                      |
| `UPLOAD_OPERATION_RETENTION_DAYS` | no                | `7`                  | Days terminal upload replay records are kept for retries. `0` keeps them forever                                                                       |
| `WEB_DIST_DIR`                    | no                | bundled copy         | Directory the built web app is served from. Defaults to the copy inside the package                                                                    |
| `UPDATE_CHECK_ENABLED`            | no                | `true`               | Check npm hourly for a newer release                                                                                                                   |
| `UPDATE_PACKAGE_NAME`             | no                | `@hilbras/omnicloud` | Package to check for updates                                                                                                                           |
| `VITE_SITE_URL`                   | no                | Vercel URL           | Canonical origin for the landing page, `robots.txt` and `sitemap.xml`                                                                                  |
| `WEBDAV_ENABLED`                  | no                | `false`              | Set `true` to start the dedicated WebDAV listener                                                                                                      |
| `WEBDAV_HOST`                     | no                | `127.0.0.1`          | Interface the WebDAV listener binds to. Change only behind a trusted proxy                                                                             |
| `WEBDAV_PORT`                     | no                | `8551`               | Port for the dedicated WebDAV listener. The path is always `/dav`                                                                                      |
| `WEBDAV_WRITE`                    | no                | `false`              | Set `true` to allow `POST`/`MKCOL`/`DELETE`. Read-only mode rejects them with `403`                                                                    |

The repository ships a commented template at [`.env.example`](.env.example).

---

## Command reference

The package installs one command, `omnicloud`:

| Command                                      | What it does                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `omnicloud`                                  | Applies migrations, starts the server and opens the web app                     |
| `omnicloud start [--no-open] [--env <file>]` | Starts the server. `--no-open` skips the browser, `--env` reads a specific file |
| `omnicloud migrate [--env <file>]`           | Applies pending database migrations and regenerates the Prisma client           |
| `omnicloud version`                          | Prints the installed version                                                    |
| `omnicloud help`                             | Prints usage                                                                    |

The encryption and session commands:

| Command                                                        | What it does                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `omnicloud login [--url <baseUrl>]`                            | Stores an API token. The token is prompted for, never passed as an argument |
| `omnicloud logout`                                             | Removes the stored token                                                    |
| `omnicloud key generate [--keyfile <path>\|--reveal]`          | Generates an encryption key and stores it locally                           |
| `omnicloud key status [--keyfile <path>\|--reveal]`            | Shows the local key state                                                   |
| `omnicloud recovery generate --reveal`                         | Creates and stores a recovery record, showing the code once                 |
| `omnicloud recovery restore [--keyfile <path>\|--reveal]`      | Restores a key from a recovery record                                       |
| `omnicloud upload <path> --encrypt [--folder <id>]`            | Uploads a file with client-side encryption                                  |
| `omnicloud download <id> [--decrypt] [-o <path>]`              | Downloads a file, decrypting it when asked                                  |
| `omnicloud migrate <fileId\|all>`                              | Encrypts legacy plaintext files in place                                    |
| `omnicloud versions <fileId> [--restore <id>] [--delete <id>]` | Lists versions, restores one, or deletes one                                |

Secrets are read from muted interactive prompts only. They are never accepted as
arguments, never written to the environment, and never printed.

The encryption commands talk to an OmniCloud server and keep their own state in
`~/.config/omnicloud/config.json` (or `$XDG_CONFIG_HOME/omnicloud/config.json`).
They never read `.env` and never run the first-run setup.

Run them with `npx omnicloud <command>` in your project directory, or add scripts
to your `package.json`:

```json
{
  "scripts": {
    "start": "omnicloud"
  }
}
```

The server listens on `HOST:PORT` (default `0.0.0.0:4000`). The browser opens
`127.0.0.1` when `HOST` is `0.0.0.0`.

### Running as a service

```bash
npx omnicloud start --no-open
```

Run it under systemd, pm2 or Docker so it restarts after a crash or a reboot.
Example units and a reverse-proxy configuration are in
[`docs/deployment.md`](docs/deployment.md).

---

## Running from source

```bash
git clone https://github.com/Hilbras/OmniCloud.git
cd OmniCloud
pnpm install          # also generates the Prisma client and builds shared types
cp .env.example .env  # then fill in TELEGRAM_API_ID, TELEGRAM_API_HASH, OMNICLOUD_ENCRYPTION_KEY
docker compose up -d  # PostgreSQL on localhost:5432
pnpm db:migrate
pnpm dev              # API on :4000, web on :5173 (proxies /api)
```

| Command             | Purpose                              |
| ------------------- | ------------------------------------ |
| `pnpm dev`          | API and web app with hot reload      |
| `pnpm build`        | Build every package and the web app  |
| `pnpm test`         | Unit and integration tests           |
| `pnpm lint`         | ESLint                               |
| `pnpm typecheck`    | TypeScript across the workspace      |
| `pnpm format:check` | Prettier check                       |
| `pnpm db:migrate`   | Apply database migrations            |
| `pnpm db:seed`      | Create a local user with sample data |

The repository layout:

```text
apps/
├── api/        Fastify HTTP server; also serves the built web app
└── web/        React, Vite and Tailwind web application
packages/
├── core/       Domain logic, the storage abstraction and the services
├── crypto/     The shared client-side encryption protocol implementation
├── database/   Prisma schema, migrations and repositories
├── shared/     DTOs, error codes, the search parser and MIME helpers
├── telegram/   TelegramStorageProvider and the MTProto connection manager
└── sdk/        @hilbras/omnicloud: the SDK, the omnicloud command, the server bundle
```

`packages/core` depends only on `packages/shared`. It never imports Prisma or
Telegram, so the domain logic can be tested and reused without either.

To build the npm package the way it is published:

```bash
cd packages/sdk && npm pack
```

`prepack` builds the SDK, the CLI and the server bundle automatically.

---

## API

The full reference is [`docs/api.md`](docs/api.md). The shape of it:

```text
Health      GET  /api/health · /api/health/database · /api/health/ready · /api/health/live
Auth        POST /api/auth/telegram/start · /api/auth/telegram/verify
            POST /api/auth/telegram/qr/start · /api/auth/telegram/qr/status · /api/auth/telegram/qr/password
            POST /api/auth/telegram/password · /api/auth/logout · /api/auth/logout-all
            GET  /api/auth/me ; GET·PUT·DELETE /api/auth/recovery
Tokens      GET·POST /api/tokens ; DELETE /api/tokens/:id
Storage     POST /api/storage/ensure · /api/storage/health/check · /api/storage/integrity/check
            POST /api/storage/reconciliation · /api/storage/reconciliation/plan · /api/storage/reconciliation/apply
            GET  /api/storage/health · /api/storage/stats
Files       GET  /api/files ; POST /api/files ; GET /api/files/:id · /api/files/:id/download
            GET  /api/files/:id/versions ; POST /api/files/:id/versions/:versionId/restore
            POST /api/files/:id/versions/prune ; DELETE /api/files/:id/versions/:versionId
            POST /api/files/:id/replace · /api/files/:id/move · /api/files/:id/trash · /api/files/:id/restore
            PATCH /api/files/:id ; POST /api/files/batch ; DELETE /api/files/:id
Folders     GET  /api/folders · /api/folders/tree ; POST /api/folders ; PATCH /api/folders/:id
            POST /api/folders/:id/move · /api/folders/:id/trash · /api/folders/:id/restore
            POST /api/folders/batch ; DELETE /api/folders/:id
Trash       GET  /api/trash · /api/trash/retention ; POST /api/trash/empty · /api/trash/purge
Collections GET  /api/starred · /api/recent · /api/search · /api/activity
Update      GET  /api/update/check
```

List responses include pagination (`page`, `limit`, `total`, `hasMore`). Errors
share one envelope with a request id:

```json
{ "error": { "code": "FILE_NOT_FOUND", "message": "File not found", "requestId": "..." } }
```

---

## SDK

The same package is a TypeScript SDK for applications that talk to an OmniCloud
server:

```bash
npm install @hilbras/omnicloud
```

```ts
import { OmniCloudClient } from "@hilbras/omnicloud";

const cloud = new OmniCloudClient({ baseUrl: "https://my-omnicloud.example" });

const file = await cloud.files.upload(
  { data: new Blob(["hello"]), name: "hello.txt" },
  { onProgress: (p) => console.log(`${p.percent}%`) },
);

await cloud.folders.create("Documents");
await cloud.files.star(file.id);
const found = await cloud.search.query("type:txt size:<1KB");
```

Node applications can stream a large download straight to disk with
`downloadToFile`, or iterate `downloadStream` without buffering it. The package
also exports the server building blocks — `StorageEngine`,
`TelegramStorageProvider` and the domain services — for custom deployments.

See [`docs/sdk.md`](docs/sdk.md) for the full reference.

---

## Security

Highlights:

- Sessions are server-side tokens. The database stores only a hash, and logout
  revokes immediately.
- Telegram sessions are sealed at rest with AES-256-GCM and are never exposed.
- Every operation checks ownership on the server. Client-supplied user ids are
  ignored.
- Filenames are sanitised. Client-declared MIME types are never trusted.
- Authentication endpoints are rate-limited, and state-changing requests are
  checked against an origin allow-list.
- Responses carry strict security headers, including a content security policy
  for the web app.
- Logs are redacted. Passwords, codes, cookies and session strings are never
  written.

> **Known advisory (operator action).** `npm audit` reports three high-severity
> findings through Prisma (`prisma`, `@prisma/config`, `deepmerge-ts`). To clear
> them in your installation, add
> `"overrides": { "deepmerge-ts": "^8.0.2" }` to your project's `package.json`,
> run `npm install`, then `npx omnicloud migrate`. Details are in
> [`docs/security.md`](docs/security.md#open-advisory-deepmerge-ts-via-prisma-operator-action).

To report a vulnerability, follow the process in [`SECURITY.md`](SECURITY.md)
rather than opening a public issue.

---

## Backups

OmniCloud keeps data in three places, and a complete backup needs all three:

| Data                                  | Where it lives                   | How to back it up                                  |
| ------------------------------------- | -------------------------------- | -------------------------------------------------- |
| Metadata, folders, versions, sessions | PostgreSQL                       | `pg_dump` on a schedule                            |
| File bytes                            | Your private Telegram channel    | Telegram keeps them; download important files too  |
| `OMNICLOUD_ENCRYPTION_KEY`            | Your environment or secret store | Keep a copy apart from the database and the server |

Without the encryption key, a restored database cannot use its stored Telegram
sessions. Without the database, the channel holds the bytes but no folder
structure. The restore order, and a restore drill, are in
[`docs/deployment.md`](docs/deployment.md#backups).

---

## Limitations

- **End-to-end encryption is opt-in and unreviewed.** Encrypted files are
  protected such that Telegram and the server hold only ciphertext, but the
  protocol has not been through an independent cryptographic review. Files
  uploaded before you enabled it stay plaintext until you migrate them.
- **Key recovery depends on your recovery code.** Losing both your key and your
  recovery code means losing the file contents. A password reset restores
  account access only. Device pairing transfers the key, but key-epoch
  rotation and revocation are not implemented yet.
- **Telegram is the storage backend.** Telegram's own rate limits, file-size
  rules and availability apply to you.
- **Single account per deployment.** Public share links for plaintext and OCE1
  files exist; there is no multi-user collaboration, folder sharing or OCE2
  sharing.
- **Restoring a version replaces the content in place.** It does not create a
  new version, and there is no scheduled version retention.
- **WebDAV has no locks or property updates.** `PUT`, `MOVE` and `COPY` work;
  `PROPPATCH`, `LOCK` and `UNLOCK` return `501`. Uploads are plaintext, and a
  `PUT` over an encrypted file is refused.
- The live Telegram path is verified against a real account; the evidence is in
  [`docs/limitations.md`](docs/limitations.md) and
  [`docs/audits/live-e2ee-smoke.md`](docs/audits/live-e2ee-smoke.md).

---

## Documentation

### Using OmniCloud

| Document                                               | Contents                                      |
| ------------------------------------------------------ | --------------------------------------------- |
| [`docs/README.md`](docs/README.md)                     | The documentation index, with reading paths   |
| [`docs/api.md`](docs/api.md)                           | The authoritative HTTP API reference          |
| [`docs/sdk.md`](docs/sdk.md)                           | SDK reference, streaming APIs and the CLI     |
| [`docs/deployment.md`](docs/deployment.md)             | Production setup, reverse proxy, backups      |
| [`docs/troubleshooting.md`](docs/troubleshooting.md)   | Common problems and fixes                     |
| [`docs/telegram.md`](docs/telegram.md)                 | The Telegram connection, sessions and storage |
| [`docs/storage.md`](docs/storage.md)                   | Uploads, downloads, versions and integrity    |
| [`docs/storage-provider.md`](docs/storage-provider.md) | The storage provider interface                |

### How it works

| Document                                           | Contents                               |
| -------------------------------------------------- | -------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)     | System design and data flow            |
| [`docs/execution-plan.md`](docs/execution-plan.md) | The delivery plan and what is verified |

### Security

| Document                                                                                             | Contents                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [`docs/security.md`](docs/security.md)                                                               | Trust model, controls and operator guidance      |
| [`docs/limitations.md`](docs/limitations.md)                                                         | What this release does not guarantee             |
| [`SECURITY.md`](SECURITY.md)                                                                         | How to report a vulnerability                    |
| [`docs/security/threat-model.md`](docs/security/threat-model.md)                                     | Threats and mitigations                          |
| [`docs/security/current-security-baseline.md`](docs/security/current-security-baseline.md)           | Where plaintext, credentials and keys live today |
| [`docs/security/encryption-requirements.md`](docs/security/encryption-requirements.md)               | What the encryption design must satisfy          |
| [`docs/security/encryption-protocol-v2.md`](docs/security/encryption-protocol-v2.md)                 | The OCE2 protocol specification                  |
| [`docs/security/recovery-and-device-revocation.md`](docs/security/recovery-and-device-revocation.md) | Recovery and revocation design                   |
| [`docs/security/legacy-migration.md`](docs/security/legacy-migration.md)                             | Migrating plaintext uploads                      |
| [`docs/security/architecture-decisions/`](docs/security/architecture-decisions/)                     | Architecture decision records                    |

### Evidence

| Document                                                                                   | Contents                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [`docs/audits/encryption-readiness-report.md`](docs/audits/encryption-readiness-report.md) | The pre-encryption repository audit                            |
| [`docs/audits/encryption-review.md`](docs/audits/encryption-review.md)                     | The cryptographic review package — **no reviewer engaged yet** |
| [`docs/audits/live-e2ee-smoke.md`](docs/audits/live-e2ee-smoke.md)                         | Live end-to-end run against a real Telegram account            |
| [`docs/audits/deep-scan-remediation.md`](docs/audits/deep-scan-remediation.md)             | The deep-scan findings and their fixes                         |
| [`docs/audits/test-evidence.md`](docs/audits/test-evidence.md)                             | Recorded test and bundle evidence                              |
| [`docs/evidence/`](docs/evidence/)                                                         | Streaming and performance measurements                         |
| [`docs/release-checklist.md`](docs/release-checklist.md)                                   | The release procedure                                          |
| [`CHANGELOG.md`](CHANGELOG.md)                                                             | Release history                                                |

---

## Roadmap

- **v0.4** — shipped: streaming large-file encryption, legacy migration, CLI
  encryption commands, version restore and delete, trash retention, the npm
  update check, and the first publish of `@hilbras/omnicloud` on npm.
- **v0.5** — shipped: WebDAV server (`WEBDAV_ENABLED`, `WEBDAV_HOST`,
  `WEBDAV_PORT`, `WEBDAV_WRITE`), alternative storage providers design, and the
  deep comparison with Telegram-Drive.
- **v0.5.x** — Electron desktop app for Linux, macOS and Windows, published as
  `.deb`/AppImage, `.dmg`/`.zip` and NSIS `.exe` artifacts on GitHub Releases
  (not npm).
- **Next** — folder and OCE2 sharing, multi-device key pairing, resumable
  desktop uploads, alternative storage providers (S3, local disk), and an
  independent cryptographic review.
- **Later** — sync clients, an Android client, team spaces, collaboration.

Open work is tracked in [`docs/execution-plan.md`](docs/execution-plan.md).

---

## Contributing

Pull requests are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Before
submitting, run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`,
which is what CI runs. For larger changes, open an issue first.

---

## License

[MIT](LICENSE) © 2026 Hilbras
