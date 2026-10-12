# Post-audit remediation report

Baseline: `origin/main` at `654370f`, release 0.2.35. Work branch:
`post-audit-remediation`. Every finding below was checked against the source, and
each fix has a test that fails on the previous code.

This report covers the remediation work in progress. It is not a release
recommendation; see "Release gate" at the end.

## Method

For each reported finding: read the source, reproduce the defect with a focused
test, fix it, confirm the test fails on the previous code and passes on the fix,
then run the repository's own checks. Findings that could not be reproduced are
recorded as such rather than fixed speculatively.

## Findings and status

| ID   | Severity | Finding                                                                                                                                 | Status                   | Evidence                                                                                                                                                                                                                    |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | P1       | A failed version write left a file row pointing at a Telegram object the cleanup then deleted                                           | Fixed                    | Reproduced (`rows=1, objects=0`); `createWithFirstVersion` / `replaceWithVersion` write in one transaction. Test: `packages/core/test/atomic-commit.test.ts`. Real-PostgreSQL check: a failed commit rolls back with no row |
| R-2  | P1       | A failed cleanup of an orphaned object was discarded, so the leftover was invisible                                                     | Fixed                    | Reproduced (`objectsLeft=1, recordsLeft=0`); the leftover is recorded in the activity log with its message id. Test: `packages/core/test/cleanup-failure.test.ts`                                                           |
| R-3  | P1       | Two concurrent recoveries of one `UNKNOWN` operation committed two file rows for one object                                             | Fixed                    | Reproduced (`fulfilled,fulfilled`, `files=2, objects=1`); the claim result is now checked. Test: `packages/core/test/unknown-claim-race.test.ts`. PostgreSQL: two concurrent claims produce exactly one winner              |
| R-4  | P1       | A failure while marking an upload complete after the file was committed made the retry write a second file and a second Telegram object | Fixed                    | Reproduced (`files=2, objects=2`); the committed file id is recorded before the status change. Test: `packages/core/test/completion-failure.test.ts`                                                                        |
| R-5  | P1       | One lost response produced three Telegram objects under the production retry policy                                                     | Fixed                    | Reproduced (`putCalls=3, objects=3`); an ambiguous write is no longer retried by the engine. Test: `packages/telegram/test/upload-not-retried.test.ts`                                                                      |
| R-6  | P2       | SDK uploads and replacements sent no idempotency key, so a retry could duplicate server-side                                            | Fixed                    | Four tests in `packages/sdk/test/upload-idempotency.test.ts` and `upload-stream-memory.test.ts`; all fail on the previous code. The SDK also appended the file before `folderId`, which the server missed                   |
| R-7  | P2       | A `detach-dangling` action for a dangling upload operation changed nothing but was reported `applied`                                   | Fixed                    | Reproduced; it now reports a failure. Test: `packages/core/test/reconciliation-apply.test.ts`                                                                                                                               |
| R-8  | P2       | Adoption of an unknown object loaded the whole object into memory                                                                       | Fixed                    | Reproduced (`download` called, not streaming); the engine's new `hashObject` reads in chunks. Test: `packages/core/test/adopt-streaming.test.ts`                                                                            |
| R-9  | P2       | The dev database was published on every interface with a hardcoded password                                                             | Fixed                    | Tests: `apps/api/test/docker-compose-defaults.test.ts`. The compose file binds `127.0.0.1` and reads `POSTGRES_PASSWORD`; README, `.env.example` and `docs/deployment.md` updated                                           |
| R-10 | P2       | Five dependency advisories, two critical, in the `vitest` dependency tree                                                               | Fixed                    | `vitest` upgraded 3.2.7 to 4.1.11; the audit drops from five advisories to one low (`esbuild`, via `tsup`)                                                                                                                  |
| R-11 | P2       | The main CI job silently skipped the PostgreSQL integration tests                                                                       | Fixed                    | The migrations job already runs them (13 tests with the variable set). A new step fails the job when any test is skipped; verified to exit 1 with 8 skips and 0 with none                                                   |
| R-12 | P3       | Two tracked `.env.template-copy.*.bak` files with no values                                                                             | Fixed                    | Removed; `.gitignore` now excludes that pattern                                                                                                                                                                             |
| R-13 | P1       | Operations left in `COMMITTING` after a crash were expected to be stale                                                                 | Not reproduced as stated | The reproduction showed a different defect (R-4). No separate stuck-`COMMITTING` case was reproduced, so no change was made for it                                                                                          |
| R-14 | P2       | `resolveUnknown` does not check its claim result                                                                                        | Fixed as part of R-3     | The unchecked claim was the cause of R-3                                                                                                                                                                                    |

## Verification

Static, mock-based, and database-backed checks were run. No finding was verified
against a live Telegram account in this remediation, except the single caption
search performed earlier at 0.2.29, which is recorded in
`docs/phase-0-report.md`.

`docs/audits/test-evidence.md` records the exact commands and counts.

## Remaining risks and limitations

- The streamed upload path in the SDK (a stream or async-iterable input) still
  buffers into one Blob. This is deliberate: the source can be read once, so a
  retry needs the bytes. Spool-to-disk is not implemented.
- The search-error case for an `UNKNOWN` upload leaves the operation `UNKNOWN` and
  reports it; there is no automatic retry.
- Reconciliation scans are still capped, and partial scans are reported as such.
- Rate limiting remains per process and in memory.
- The remaining `esbuild` advisory is development-only.

## Release gate

Not satisfied. P1 findings in this report are fixed and tested, but the gate also
requires live Telegram verification, which has not been run for this work.
