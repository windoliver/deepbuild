# @deepbuild/evidence

## What it is for

The evidence store (#15): files kept by hash, intake checks on media, redaction, origin, sends and retention, plus the secret scrub (gitleaks rules, field-name rules and scrub by value). The record, the archive, the hub, the reading package, `checks-command`, `checks-journey`, the extension host, the routing replay and the CLI's debug bundle use it.

## Where new code goes

- `src/index.ts`: the store (`openEvidenceStore`) and the public entry. A job's `writer.file` intake (#1820) hashes a private disk copy, optionally against its listed sha256, before atomically keeping it; `verify` checks cached binary bytes without holding the entire file in memory. These are store operations, not extensions: only the store owns its hash paths and journal.
- `src/scrubbing.ts`: the pure-text public entry (`@deepbuild/evidence/scrubbing`), also re-exported by the main entry. The archive worker uses it without loading storage, zstd and the digest worker. `src/scrub.ts`: the scrub pass and complete-line prefix cuts, with the matches from that same scan; `src/patterns.ts`: reading the gitleaks rules; `src/fields.ts`: field-name, header and auth-scheme rules; `src/intake.ts`: media type and whole-file checks.
- A parts-backed transcript retains its ordinary concatenated-byte SHA-256. `chunks` verifies it without materializing the whole copy; retention follows its ordered parts, and `sync` its manifest and each part's file (#1410). `src/digest.ts`, `src/digest-worker.ts` and `src/continuation.ts` keep and resume the verified digest state off the hub's event loop, so reopening need not decompress every preceding part. A joined copy under 8 MiB keeps a native running hash in memory instead and is read once more after a restart: hashing every small copy in JavaScript cost the archive's budgets about a fifth more instructions. This storage logic is core-owned; an extension cannot provide evidence integrity or retention from a private archive folder.
- Tests: `test/`; the acceptance suites are `tests/acceptance/15/` and `tests/acceptance/761/`.

## What it may import

Core foundation, under the record: `node:` built-ins only, no workspace package. It never imports the record, an extension, the hub, the CLI or the app.

## Deviations

- `gitleaks`: gitleaks' default rules vendored unchanged at tag v8.30.1 with their MIT license; `gitleaks.toml` is upstream's generated file, so never edit it, and `build-patterns.mjs` converts its Go RE2 patterns into `dist/patterns.json` during the package build. `src/patterns.ts` reads those unchanged conversions; no conversion is deferred to the first prompt. The scrub's keyword index is built once without scanning every rule for each keyword.
- `src/fields.ts`: ported from makecindy/cindy `redact.ts` at commit 82d44ec under Apache-2.0; its header keeps the license notice and lists what changed from the original, so keep both.
