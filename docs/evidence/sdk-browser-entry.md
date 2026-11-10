# Browser entry for the SDK

Date: 2026-11-10

Goal: give browser callers a supported import that does not drag in Node
builtins or the server-side Telegram stack.

## What was added

- `packages/sdk/src/browser.ts` — the browser surface:
  - `OmniCloudClient` / `OmniCloudError`
  - in-memory OCE1 helpers: `uploadEncrypted`, `downloadEncrypted`
  - crypto primitives (`encryptFile`, `decryptFile`, `generateUrk`, `readHeader`, …)
  - shared helpers (`ERROR_CODES`, `isEncryptedFormat`, `fileCategory`, …)
- `packages/sdk/tsup.browser.config.ts` — separate tsup invocation, single entry,
  ESM only, `platform: "browser"`, `node:` builtins external.
- `package.json` exports `@hilbras/omnicloud/browser`; scripts `build:browser`
  and `prepublishOnly` runs it.
- `packages/sdk/test/browser-entry.test.ts` — export-surface guard (3 tests).

## Why a separate build invocation

Adding a second declaration entry to the main tsup config exhausted the dts
worker's memory. A separate process with one entry keeps the memory profile of
the main build. The main build's dts worker still runs out of memory in this
environment (pre-existing, unrelated to this entry); `build:browser` succeeds on
its own.

## Verification

```bash
cd packages/sdk
pnpm build:browser
node -e "import('./dist/browser.js').then(m=>console.log(Object.keys(m).join(',')))"
```

Result:

```
ESM dist/browser.js     93.77 KB
DTS dist/browser.d.ts   27.38 KB
static-node-imports: 0
AuthenticationError,BindingError,ENCRYPTION_FORMAT,ERROR_CODES,KEY_EPOCH_V1,
ManifestError,Oce1Error,OmniCloudClient,OmniCloudError,TrailingDataError,
UnsupportedFormatError,ValidationError,decryptFile,downloadEncrypted,encryptFile,
fileCategory,generateId,generateUrk,isEncryptedFormat,isFileCategory,
mimeFromFilename,mimeMatchersForType,paginationMeta,parseSearchQuery,parseSize,
readHeader,uploadEncrypted
```

- No static `node:` imports in the bundle. Dynamic `node:` imports remain inside
  Node-only helpers that the browser entry does not export.
- The bundle imports and evaluates in plain Node, so the module graph is valid.
- `packages/sdk` typecheck and the 3 browser-entry tests pass.
