# Independent cryptographic review — package and findings tracker

**Status:** package assembled; **no external review has taken place yet.** No document, UI string, or release note may claim "independently reviewed" until the exit criteria below are met and this file records the completed review.

**Purpose (plan M3):** an independent cryptographer or qualified review service examines the OCE1 design and implementation. This file is the single tracker for scope, hand-off contents, findings, fixes, and retests.

## Review scope

Requested review areas (in priority order):

1. **Protocol design** — OCE1 v1 envelope: versioning, suite selection, AAD binding (file id, version id, key epoch, chunk index, type bytes), chunked XChaCha20-Poly1305 construction, manifest/completion binding, nonce rules.
2. **Key hierarchy** — URK → HKDF (KEK / MEK) separation; per-file DEK wrapped under KEK; what the server can and cannot derive; password/reset paths that must not touch file keys.
3. **Recovery container** — recovery code (256-bit) → HKDF → wrapped-URK blob; misuse, code entropy, verification oracle risks, and the auth-recovery vs encryption-recovery split.
4. **Device enrollment design draft** — planned cross-device key transfer (design only; not yet implemented — reviewer should flag design flaws before M6 code).
5. **Implementation quality of `packages/crypto`** — constant-time concerns with the chosen libraries, key-material lifetime in JS, error taxonomy leaking oracle information, test coverage gaps.
6. **Migration and legacy handling** — verify-before-delete ordering, PENDING-resume hash check, plaintext-history retention rules (`docs/security/legacy-migration.md`).

Out of scope for this round: Android local storage (no client exists yet), sharing/permissions (not implemented), web supply-chain process (documented separately; reviewer comments welcome but not gating).

## Hand-off package

| Item                                                 | Path                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Protocol specification (normative)                   | `docs/security/encryption-protocol-v1.md`                                           |
| Recovery & device-revocation design                  | `docs/security/recovery-and-device-revocation.md`                                   |
| ADR 0001 — platform & library evaluation             | `docs/security/architecture-decisions/0001-e2ee-platform-and-library-evaluation.md` |
| ADR 0002 — crypto stack                              | `docs/security/architecture-decisions/0002-e2ee-crypto-stack.md`                    |
| Crypto implementation (all of it — small on purpose) | `packages/crypto/src/`                                                              |
| Known-answer vectors + recovery KAT                  | `packages/crypto/test/vectors/v1.json`                                              |
| Vector & cross-client verification evidence          | `docs/audits/kat-vectors.md`                                                        |
| Live E2EE smoke evidence (29/29)                     | `docs/audits/live-e2ee-smoke.md`                                                    |
| Migration design                                     | `docs/security/legacy-migration.md`                                                 |
| Live migration evidence (14/14)                      | `docs/audits/m2-migration-smoke.md`                                                 |
| Threat model                                         | `docs/security/threat-model.md`                                                     |
| Three-tier execution plan                            | `docs/execution-plan.md`                                                            |

Reproduce everything locally:

```bash
pnpm --filter @omnicloud/crypto test
pnpm --filter @omnicloud/crypto run verify:vectors
pnpm --filter @omnicloud/crypto run verify:vectors:cross-client   # needs firefox + geckodriver
```

## Process

1. Engage an external cryptographer or independent review service; give them this repository (or a tagged snapshot) plus the table above.
2. Reviewer delivers findings with severity. Record each finding in the table below.
3. Fix all **high** and **medium** findings; retest; record evidence links.
4. Publish the review report under `docs/audits/` (or link the reviewer's public report).
5. Only after steps 3–4 may docs/UI use "independently reviewed" wording.

Snapshot to review: commit `7b237d3` or later on `Hilbras/OmniCloud` (record the exact reviewed commit here when the review starts).

## Findings

_None yet — no review has been performed._

| #   | Severity | Area | Finding                     | Status | Fix commit | Retest evidence |
| --- | -------- | ---- | --------------------------- | ------ | ---------- | --------------- |
| —   | —        | —    | (empty until review begins) | —      | —          | —               |

Severity model: **High** = breaks a stated security property (confidentiality/integrity of file content or keys); **Medium** = weakness that needs a fix before production E2EE wording; **Low** = hardening/documentation; **Info** = design feedback with no defect.

## Exit criteria (plan M3)

- [ ] External reviewer engaged; reviewed commit recorded above.
- [ ] Review report received and stored/linked.
- [ ] All high findings fixed and retested.
- [ ] All medium findings fixed and retested.
- [ ] This tracker's table reflects final states with evidence links.
- [ ] Wording gate opened: only then may docs/UI say "independently reviewed".
