# Deep Comparison: OmniCloud vs. Telegram-Drive

Both **OmniCloud** and **Telegram-Drive** leverage a user's private Telegram account (Saved Messages or dedicated private channels) as free or low-cost cloud file storage. However, they are engineered with completely different architectures, form factors, data backends, and target workflows. 

---

## 1. Architectural & Conceptual Overview

| Dimension | OmniCloud | Telegram-Drive |
| :--- | :--- | :--- |
| **Primary Form Factor** | Self-hosted Web Application & HTTP API server (`@hilbras/omnicloud`) | Local-First Desktop & Mobile Native App (Tauri 2 / Rust) |
| **Hosting Model** | Runs as a persistent server process (Docker, Node.js, VPS, or local machine); accessed via web browser. | Runs as a native desktop client (Windows, macOS, Linux) or mobile app (Android & Google TV). |
| **Logical Metadata Store** | **PostgreSQL** (relational database holding folders, files, versions, trash, search index, and activity logs). | **SQLite** (local database storing file inventory, cache, sync state, and queues). |
| **Storage Backend** | A private Telegram channel (`OmniCloud Storage`) created and managed via MTProto. | Telegram Saved Messages and/or user-selected Telegram channels. |
| **Multi-User / Sharing** | Single-user per deployment (multi-user collaboration is not supported). | Single user client application, featuring local WebDAV and REST integrations. |
| **Licensing** | Open Source (MIT License), npm package (`@hilbras/omnicloud`). | Open Source with an optional one-time $5 lifetime ad-free supporter license. |

---

## 2. Technology Stack & Monorepo Layout

### **OmniCloud**
OmniCloud is structured as a pnpm monorepo containing:
- **`apps/api`**: Fastify HTTP server which also serves the built React web application on a single port (default `4000`).
- **`apps/web`**: React, Vite, and Tailwind CSS frontend.
- **`packages/core`**: Pure domain logic and storage abstractions (decoupled from Prisma and Telegram).
- **`packages/crypto`**: Client-side encryption protocol implementation.
- **`packages/database`**: Prisma schema, migrations, and repositories.
- **`packages/shared`**: DTOs, error codes, MIME helpers, and search query parsers.
- **`packages/telegram`**: `TelegramStorageProvider` and MTProto connection manager.
- **`packages/sdk`**: Published npm package (`@hilbras/omnicloud`), CLI commands, and server bundle.

### **Telegram-Drive**
Telegram-Drive is built around **Tauri 2**:
- **Backend (Rust):** Tokio, Actix Web, Grammers (Telegram MTProto client library in Rust), and SQLite for local metadata and queue state.
- **Frontend (Web):** React 19, TypeScript, Tailwind CSS 4, TanStack Query/Virtual, PDF.js, HLS.js, and MP4Box.
- **Platforms:** Windows (x64), macOS (Intel & Apple Silicon), Linux (AppImage, Debian, RPM, Arch), Android, and Google TV.

---

## 3. Storage, Sync & File Management

### **OmniCloud**
- **Lifecycle:** Uploads stream to a temporary disk spool, are hashed with SHA-256, transmitted to Telegram, verified, and recorded in PostgreSQL. 
- **Versioning:** Every file replacement creates a new version while preserving historical versions in Telegram and PostgreSQL without duplicating blobs.
- **Trash & Retention:** Soft-deletes items to Trash. Purged automatically after `TRASH_RETENTION_DAYS` (default 30; `0` disables auto-purge).
- **Search:** Features a robust search query language supporting operators (`name:`, `type:`, `ext:`, `size:`, `folder:`, `starred:`, `trashed:`, `after:`, `before:`).

### **Telegram-Drive**
- **Lifecycle:** Direct peer-to-peer style transfers between the local client and Telegram MTProto servers. Durable upload/download queues recover across application and window restarts.
- **Folder Sync:** Bidirectional sync mapping between local directories and Telegram channels, featuring safety checks, mass-deletion guards, and conflict resolution (*Keep Local*, *Keep Remote*, *Keep Both*).
- **Integrations:** Includes a local **WebDAV server** (`127.0.0.1:8551`) and an opt-in local **REST API** (`127.0.0.1:8550`) for programmatic file/folder operations.
- **Media Playback:** Built-in image viewer, PDF viewer, audio player, video streaming (HLS/fMP4), and archive manager (ZIP/RAR/7z).

---

## 4. Security & End-to-End Encryption (E2EE)

### **OmniCloud**
- **Authentication & Sessions:** Telegram login via phone number, verification code, QR code, or cloud password. Sessions are server-side tokens (hashes stored in Postgres). Telegram sessions at rest are sealed with AES-256-GCM using `OMNICLOUD_ENCRYPTION_KEY`.
- **E2E Encryption (OCE2):** Opt-in client-side encryption. Files are encrypted on-device before upload using per-file data keys. Large files are encrypted chunk-by-chunk.
- **Recovery:** Recovery codes allow key restoration; password resets restore account access only and cannot decrypt files if the key is lost.

### **Telegram-Drive**
- **Authentication & Storage:** Telegram API credentials stored locally; sensitive hashes/tokens are secured in the operating system's credential manager or Android Keystore.
- **Encryption (TDENC2):** Opt-in client-side encryption using XChaCha20-Poly1305 (TDENC2 format). Supports Vault-level keys and individual file passphrases.
- **Recovery:** Requires manual backup of vault passphrases and recovery bundles. The application cannot recover lost vault keys.

---

## 5. Developer & Administrator Tooling

### **OmniCloud**
- **CLI (`omnicloud`):** Manages server startup (`omnicloud start`), migrations (`omnicloud migrate`), encryption keys (`omnicloud key generate`), recovery codes, uploads/downloads, and legacy file migration.
- **TypeScript SDK:** Fully documented SDK (`@hilbras/omnicloud`) for building custom client applications against an OmniCloud backend.
- **Health & Diagnostics:** Includes endpoints and commands for integrity scans (detecting missing Telegram objects or size/hash mismatches) and a two-step repair planner.

### **Telegram-Drive**
- **Local Control:** Loopback-only WebDAV and REST APIs for mounting drives in OS file managers or scripting automation.
- **Testing & QA:** Comprehensive end-to-end testing suites (`npm test`, `cargo test`) and platform build verification scripts.

---

## Summary Recommendation

- **Choose OmniCloud if:** You want a centralized, self-hosted web cloud drive (running on Docker or a VPS) with a powerful PostgreSQL metadata backend, a full TypeScript SDK, a command-line interface, and a browser-accessible web UI.
- **Choose Telegram-Drive if:** You want a local-first desktop or mobile application with deep OS integration (system tray, native notifications, folder sync, WebDAV mounting, offline media caching, and Android/TV support).
