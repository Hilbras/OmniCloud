# WebDAV write path verified with real rclone

Date: 2026-11-10

Goal: prove that a third-party WebDAV client — not just the project's own
fetch-based tests — can create folders, upload, read, move and delete files
through the production listener.

## Setup

- `rclone v1.76.0` (linux/amd64), downloaded from `downloads.rclone.org`.
- Backend: `apps/api/src/webdav/server.ts` started by `apps/api/test/harness.ts`
  on an ephemeral loopback port with `webDavWriteEnabled: true`.
- Authentication: a real API token created through `POST /api/tokens`, passed to
  rclone as an obscured password over HTTP Basic (the documented path).
- Config:

  ```ini
  [omni]
  type = webdav
  url = http://127.0.0.1:<port>/dav/
  vendor = other
  user = omnicloud
  pass = <obscured API token>
  ```

## Command

```bash
RCLONE_BIN=/tmp/rclone pnpm --filter @omnicloud/api exec vitest run test/rclone-webdav.test.ts
```

## Result

```
✓ test/rclone-webdav.test.ts (1 test) 980ms
  ✓ creates a folder, uploads, reads, moves and deletes a file  744ms
```

The test performs, in order:

1. `rclone mkdir omni:RcloneFolder` — `MKCOL` returns `201`.
2. `rclone copyto hello.txt omni:RcloneFolder/hello.txt` — `PUT`.
3. `rclone cat omni:RcloneFolder/hello.txt` — byte-identical round-trip.
4. `rclone lsf omni:RcloneFolder/` — file is listed.
5. `rclone moveto ... hello.txt ... moved.txt` — `MOVE`; listing shows only the
   new name.
6. `rclone deletefile ... moved.txt` — `DELETE`; folder is empty.

## Notes

- The child process must be asynchronous (`execFile`): the WebDAV listener runs
  in the test process, and a synchronous child would block the event loop. The
  first attempt used `execFileSync` and every PROPFIND timed out — a test-harness
  bug, not a server bug.
- The test is skipped unless `RCLONE_BIN` is set, so the normal suite stays
  hermetic and does not download binaries.
- Mounting (`rclone mount`) needs FUSE and was not exercised; the copy/move
  path above covers the read/write contract.
