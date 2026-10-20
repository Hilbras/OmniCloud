# Deployment

This guide covers running OmniCloud v0.2 in production: requirements, the
environment, the build, single-port serving, reverse proxying, migrations,
backups, monitoring and scaling limits.

## Requirements

| Component                | Requirement                                                |
| ------------------------ | ---------------------------------------------------------- |
| Node.js                  | 20 or 22 (the SDK and workspace declare `>=20`)            |
| Package manager          | pnpm 12.x (the repo pins `pnpm@12.5.1`)                    |
| PostgreSQL               | 14 or newer                                                |
| Telegram API credentials | An `api_id`/`api_hash` pair from <https://my.telegram.org> |

The API needs outbound network access to Telegram's MTProto servers. It does
not need inbound access to anything except the port it listens on.

## Environment variables

Loaded and validated by `apps/api/src/config.ts`. Invalid values fail at
startup.

| Variable                   | Required      | Default                                                   | Notes                                                                                                                                                                          |
| -------------------------- | ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`             | yes           | —                                                         | PostgreSQL connection string used by Prisma                                                                                                                                    |
| `TELEGRAM_API_ID`          | yes           | `0`                                                       | Must be non-zero; startup throws otherwise                                                                                                                                     |
| `TELEGRAM_API_HASH`        | yes           | `""`                                                      | Must be non-empty; startup throws otherwise                                                                                                                                    |
| `SESSION_SECRET`           | no            | `development-only-secret-change-me`                       | Reserved; no longer signs sessions (browser sessions are server-side tokens). Keep it set in production anyway                                                                 |
| `OMNICLOUD_ENCRYPTION_KEY` | in production | _(none)_                                                  | Seals Telegram session strings at rest (AES-256-GCM). Use `openssl rand -hex 32`. Losing it makes stored Telegram sessions unreadable; back it up separately from the database |
| `PORT`                     | no            | `4000`                                                    | Must be a positive integer                                                                                                                                                     |
| `HOST`                     | no            | `0.0.0.0`                                                 | Config value (note: the bootstrap currently listens on `0.0.0.0`)                                                                                                              |
| `NODE_ENV`                 | no            | `development` (the `omnicloud` command sets `production`) | `production` requires `OMNICLOUD_ENCRYPTION_KEY`                                                                                                                               |
| `LOG_LEVEL`                | no            | `info`                                                    | Fastify/pino level (`fatal`…`trace`)                                                                                                                                           |
| `COOKIE_SECURE`            | no            | `false`                                                   | Set `true` when served over HTTPS (the only accepted true value is the literal `true`)                                                                                         |
| `MAX_UPLOAD_MB`            | no            | `256`                                                     | Positive integer; multiplied by `1024*1024` to set the multipart file-size cap                                                                                                 |
| `WEB_DIST_DIR`             | no            | unset (`null`)                                            | Directory of the built web app; when present the API serves the SPA                                                                                                            |
| `ALLOWED_ORIGINS`          | no            | unset (empty = same-origin)                               | Comma-separated origin allowlist for state-changing requests                                                                                                                   |
| `STORAGE_QUOTA_GB`         | no            | `0` (unlimited)                                           | Positive number sets the quota ceiling shown on the dashboard; `0`/unset = `null`                                                                                              |
| `TRUST_PROXY`              | no            | `false`                                                   | Enables Fastify `trustProxy`; needed for correct client IPs behind a reverse proxy (`true` is the only accepted true value)                                                    |
| `UPDATE_PACKAGE_NAME`      | no            | `@hilbras/omnicloud`                                      | npm package polled for newer releases; the web sidebar shows a notice when one exists                                                                                          |
| `UPDATE_CHECK_ENABLED`     | no            | `true`                                                    | Set `false` to disable the periodic npm check entirely (no outbound registry request)                                                                                          |
| `TRASH_RETENTION_DAYS`     | no            | `30`                                                      | Days a trashed file or folder is kept before it is permanently removed; `0` keeps the trash indefinitely                                                                       |

Notes:

- Boolean variables only read the literal string `true` as true; anything else
  is false.
- `int()` variables must be positive integers — `0` or a non-integer throws.
- `ALLOWED_ORIGINS` is split on commas, trimmed and empties dropped; each entry
  must be a full origin (`https://cloud.example`, no trailing slash), matching
  the `Origin` header exactly.

## Install from npm

The published package `@hilbras/omnicloud` includes the full server, the built
web app and the Prisma schema. It installs one command, `omnicloud`:

```bash
mkdir omnicloud-app && cd omnicloud-app
npm init -y
npm install @hilbras/omnicloud
```

Put your configuration in `.env` in that directory (see the variable table
above), then:

```bash
npx omnicloud             # applies the schema, starts the server, opens the browser
npx omnicloud start --no-open   # the same without opening a browser (servers)
```

Each start regenerates the Prisma client for the installed version and applies
pending migrations, so a fresh install and an upgrade both need no extra step.
`npx omnicloud migrate` runs only the schema step, if you want it separately.

For production, run the command under a supervisor so it restarts after a
crash or reboot. A minimal `systemd` unit:

```ini
[Unit]
Description=OmniCloud
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
WorkingDirectory=/srv/omnicloud-app
ExecStart=/usr/bin/node /srv/omnicloud-app/node_modules/@hilbras/omnicloud/dist/cli.js start --no-open
Restart=on-failure
User=omnicloud
EnvironmentFile=/srv/omnicloud-app/.env

[Install]
WantedBy=multi-user.target
```

Adjust the `node` path to the output of `which node`. The unit runs the
package's own entry point directly, so it does not depend on npm at startup.
Keep the `.env` file readable only by the service user, and pin the version
(`npm install @hilbras/omnicloud@0.3.0`) so upgrades happen deliberately.

## Build

From the repository root:

```bash
pnpm install
pnpm db:generate    # prisma generate
pnpm db:migrate     # prisma migrate deploy
pnpm build          # build:types, then every package
```

`postinstall` already runs `db:generate` and `build:types`, so a fresh install
is close to ready; run `db:migrate` explicitly against each environment.

Workspace scripts:

| Script             | Action                                               |
| ------------------ | ---------------------------------------------------- |
| `pnpm db:generate` | `prisma generate` (required before the API compiles) |
| `pnpm db:migrate`  | `prisma migrate deploy` (applies pending migrations) |
| `pnpm build`       | Build type declarations and all packages             |
| `pnpm dev:api`     | Run the API in watch mode (development)              |

### Custom domain

The web build takes its canonical origin from `VITE_SITE_URL`. It is inlined at
build time and drives the canonical link, Open Graph and Twitter tags, the
JSON-LD `@id`/`url`/`logo` fields, `robots.txt` and `sitemap.xml`.

```bash
VITE_SITE_URL=https://cloud.example.com pnpm --filter @omnicloud/web build
```

Leaving it unset falls back to the default Vercel deployment URL. Changing it
requires a rebuild, because the value is baked into the static output.

Steps to attach a domain to the Vercel project:

1. Add the domain in the Vercel project settings (**Settings → Domains**).
2. Point the domain's DNS at Vercel — either a `CNAME` to `cname.vercel-dns.com`
   or an `A` record to Vercel's anycast addresses, as Vercel shows for the
   domain.
3. Set `VITE_SITE_URL=https://your.domain` in the deployment's environment
   variables and redeploy so the build picks it up.
4. Confirm the built output: `dist/index.html` must contain zero occurrences of
   the old domain, and `dist/robots.txt` must list
   `Sitemap: https://your.domain/sitemap.xml`.

`apps/web/src/lib/site-url.ts` is the single runtime source of truth and falls
back to the same default, so per-route canonical URLs produced by
`usePageMeta` always match the static tags.

## Single-port serving

When `WEB_DIST_DIR` is set to the web app's build output and the directory
exists, the API registers static file serving and a SPA fallback:

- `GET` requests that do not start with `/api/` and do not match a file are
  answered with `index.html`.
- Anything else falls through to the JSON not-found handler
  (`404 NOT_FOUND`).

This lets one process on one port serve both the API and the UI. Without
`WEB_DIST_DIR`, unknown routes return JSON `404` and the UI must be served
separately and configured to call the API (same origin or an allowed origin).

## Reverse proxy

Recommended topology: a TLS-terminating reverse proxy (nginx, Caddy, Traefik)
in front of the API.

- **HTTPS:** terminate TLS at the proxy; the API speaks plain HTTP internally.
- **`COOKIE_SECURE=true`:** required so the session cookie is only sent over
  HTTPS. Without it, do not expose the API publicly.
- **`TRUST_PROXY=true`:** so Fastify derives the client IP from
  `X-Forwarded-For`. The auth rate limiter keys on `request.ip`; without this,
  all clients share the proxy's IP and hit the 10/min limit together.
- **`ALLOWED_ORIGINS`:** if the UI is served from a different origin than the
  API, list those origins explicitly. Same-origin deployments can leave it
  unset (the check falls back to comparing the request `Origin` host to `Host`).

Example (nginx, same origin):

```nginx
server {
  listen 443 ssl;
  server_name cloud.example;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Set `COOKIE_SECURE=true`, `TRUST_PROXY=true` and (optionally)
`ALLOWED_ORIGINS=https://cloud.example`.

## Database migrations

Migrations live in `packages/database/prisma/migrations/`:

| Migration             | Content                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0_init`              | Users, Telegram sessions, storage registrations, folders, files                                                                                                 |
| `1_v02_reliability`   | Adds `starred`, `deletedAt`, `currentVersionId`, `versionCount`; creates `FileVersion` and `ActivityEvent`; new indexes; backfills version 1 for pre-v0.2 files |
| `2_v02_trash_batch`   | Adds `trashBatchId` to `File` and `Folder`                                                                                                                      |
| `3_browser_sessions`  | Server-side browser sessions (token hashes, expiry, revocation)                                                                                                 |
| `4_upload_operations` | Upload operation records used for idempotent uploads and recovery                                                                                               |

Apply with the npm package:

```bash
npx omnicloud migrate
```

or from a source checkout:

```bash
pnpm db:migrate
```

For local schema work use `prisma migrate dev` (via the database package's
`migrate:dev` script). `prisma migrate deploy` in production never prompts and
is safe to run repeatedly.

## Backups

**Back up PostgreSQL.** The database holds the only mapping from user-visible
file names and folder structure to Telegram messages. The Telegram channel
contains opaque documents; without the database there is no way to reconstruct
which message is which file, and a lost `Storage` row (channel id + access
hash) makes the channel effectively inaccessible to OmniCloud.

- Use `pg_dump` (or your managed provider's snapshots) on a schedule and store
  backups off-host.
- The two tables that are irreplaceable are `File`/`FileVersion` (message
  references and checksums) and `Storage` (channel id + access hash). `User`
  and `TelegramSession` can be recreated by signing in again.
- Restoring a backup only makes sense against the same Telegram account and
  channel; restoring into a different account produces metadata pointing at
  messages that do not exist (visible as `missing` in an integrity report).
- Do not back up the Telegram session string into places with broader access
  than the database itself — it grants full account access.

### What a database backup does not contain

OmniCloud has two classes of data, and they need different protection:

| Data                                              | Where it lives                                         | How to recover it                                              |
| ------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Files, folders, versions, metadata, `Storage` row | PostgreSQL                                             | Restore the database backup                                    |
| File bytes                                        | The Telegram channel                                   | Telegram keeps them; the database maps names to them           |
| Telegram sessions                                 | PostgreSQL, **sealed** with `OMNICLOUD_ENCRYPTION_KEY` | Needs the key. Without it, sign in again                       |
| The encryption key itself                         | Your environment, **not** the database                 | Back it up separately, in a secrets manager or an offline copy |

A database backup restored without the matching `OMNICLOUD_ENCRYPTION_KEY` keeps
all files and folders, but every stored Telegram session becomes unreadable.
Users then sign in again, which is safe. Store the key apart from the database
backups, so one compromise does not expose both.

Keep the key stable: changing it without re-sealing makes existing sessions
unreadable in the same way.

## Monitoring

Public, unauthenticated probes:

| Endpoint                   | Use                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/health`          | Overall status: `status`, `database`, `storage` (`unknown`), `uptimeSeconds`, `version` |
| `GET /api/health/database` | Database-only probe for readiness checks                                                |

`GET /api/health` always returns HTTP `200`; health is reported in the body, so
inspect `status`/`database` (`healthy` or `unavailable`) rather than the status
code. Alert on `database = unavailable`.

Authenticated, per-user storage health is at `GET /api/storage/health` (cached)
and `POST /api/storage/health/check` with `{ "deep": true }` (real Telegram
round-trip). A deep probe is the right readiness signal for storage; do not poll
it aggressively — it consumes Telegram rate budget.

Logs are structured JSON from Fastify/pino; each line carries the request id
(`x-request-id`), so error reports can be correlated with both the API response
and the log stream.

## Trash retention

Trashed files and folders are kept for `TRASH_RETENTION_DAYS` days (default 30) and then removed for good. The server runs the purge every six hours for
every user, and also on startup, so expired items disappear without anyone
having to empty the trash by hand.

- `GET /api/trash/retention` reports the configured period; the web trash page
  shows it, so users know how long they have.
- `POST /api/trash/purge` runs the purge for the calling user on demand.
- Setting `TRASH_RETENTION_DAYS=0` disables the purge entirely and keeps the
  trash indefinitely.

The purge removes a file's Telegram message before its database record, as
`POST /api/trash/empty` does. A file whose remote delete fails keeps its
record, so the object can be found and cleaned up later rather than being
stranded. A trashed folder is removed only once it holds nothing, so a file
trashed more recently than its folder keeps the folder alive until it is
eligible too.

The purge is a **permanent deletion**. There is no undo for it, so a retention
period shorter than your users expect is a data-loss risk rather than a storage
saving. Set it to `0` if you would rather keep everything.

## Update check

The server polls the npm registry once an hour for the newest published
version of `UPDATE_PACKAGE_NAME` and caches the result. The web app reads that
cached result and shows a notice under the app title in the sidebar when a
newer version exists.

| Endpoint                | Auth | Purpose                                      |
| ----------------------- | ---- | -------------------------------------------- |
| `GET /api/update/check` | none | The cached result of the last registry check |

The endpoint is public because it exposes only the running version and the
newest published version of an open-source package — no user data. It returns
one of:

| `status`           | Meaning                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `update_available` | A newer version is published; the sidebar shows a notice         |
| `up_to_date`       | The published version is the same or older                       |
| `not_published`    | The package does not exist on npm yet                            |
| `unknown`          | The registry could not be reached; the last error is in `detail` |

Behavior worth knowing:

- The registry is contacted **at most once an hour**, regardless of how many
  browsers are open, because the result is cached server-side. Polling
  `/api/update/check` from many clients does not multiply the traffic.
- A failed check never raises: it is reported as `unknown` and retried on the
  next interval. It also never blocks startup.
- The check makes one outbound HTTPS request per hour to `registry.npmjs.org`.
  Set `UPDATE_CHECK_ENABLED=false` to disable it in environments that must not
  make outbound requests.
- Only `update_available` renders a notice. An unpublished package or a failed
  lookup is deliberately not shown, so the badge stays meaningful.

## Docker Compose (PostgreSQL)

The repository ships a development database:

```bash
docker compose up -d postgres
```

This starts `postgres:16-alpine` with user/database `omnicloud` on port `5432`,
bound to `127.0.0.1`, and a named volume. The password comes from
`POSTGRES_PASSWORD`, and defaults to a development-only value that must not be
used outside a local machine. It matches the default `DATABASE_URL` in
`.env.example`:

```dotenv
DATABASE_URL=postgresql://omnicloud:omnicloud-dev-only@127.0.0.1:5432/omnicloud
```

Only PostgreSQL is containerized. The API and web app run as Node processes.
In production, point `DATABASE_URL` at your managed or self-hosted PostgreSQL
and do not expose port 5432 publicly.

## Upgrading from v0.1

The v0.2 migrations are additive:

- New columns are nullable or have defaults (`starred` defaults to `false`,
  `versionCount` to `0`).
- `FileVersion` and `ActivityEvent` are new tables.
- Indexes are added; two v0.1 indexes are dropped and replaced by
  `deletedAt`-aware equivalents.
- `1_v02_reliability` **backfills** a version-1 row for every existing file and
  repoints `currentVersionId`/`versionCount`, so files uploaded before v0.2 have
  complete version history.
- `2_v02_trash_batch` adds `trashBatchId`. Existing rows get `NULL`; folder
  restore falls back to timestamp equality for rows without a batch marker, so
  pre-v0.2 trash state still restores correctly.

Upgrade procedure:

```bash
pnpm install
pnpm db:migrate     # applies 1_v02_reliability then 2_v02_trash_batch
pnpm build
# restart the API
```

No data migration downtime is required beyond the migration itself: all steps
are `ALTER TABLE ADD COLUMN` with defaults or new tables/backfills, so the old
process keeps working until you restart. As always, take a database backup
before migrating.

## Scaling limits

v0.2 is designed as a **single-process** application:

- **In-memory rate limiting.** The auth limiter is a per-process fixed window;
  it does not coordinate across replicas.
- **Per-user MTProto connections.** One connection per user per process;
  multiple replicas would each hold their own session for the same account,
  which is out of scope and can trigger Telegram session duplication.
- **Uploads use disk, not memory.** Each upload is written to a temporary
  directory while it is hashed. Size concurrency by the free space in that
  directory (`os.tmpdir()`, usually `/tmp`) and by `MAX_UPLOAD_MB`, not by
  process memory.
- **One PostgreSQL database, one Telegram account per user.** There is no Redis,
  no external queue and no shared cache.

Scale vertically (more CPU/RAM for the Node process) rather than horizontally.
If you need multiple instances, put them behind a deployment that pins each
user to a single process and introduce shared state for rate limiting — neither
is provided in v0.2.

## Build requirements

The SDK declaration bundle (`packages/sdk`, `dts.resolve: true`) inlines the
whole workspace type graph and needs about 2.3 GB of heap. Its build script
therefore sets `--max-old-space-size=4096`. Running `tsup` without that flag can
fail intermittently with `ERR_WORKER_OUT_OF_MEMORY`. Keep the flag when changing
the SDK build.
