# @deepbuild/evidence

## What it is for

The evidence store (#15): files kept by hash, intake checks on media, redaction, origin, sends and retention, plus the secret scrub (gitleaks rules, field-name rules and scrub by value). The record, the archive, the hub, the reading package, `checks-command`, the extension host and the CLI's debug bundle use it.

## Where new code goes

- `src/index.ts`: the store (`openEvidenceStore`) and the public entry.
- `src/scrub.ts`: the scrub pass; `src/patterns.ts`: reading the gitleaks rules; `src/fields.ts`: field-name, header and auth-scheme rules; `src/intake.ts`: media type and whole-file checks.
- Tests: `test/`; the acceptance suites are `tests/acceptance/15/` and `tests/acceptance/761/`.

## What it may import

Core foundation, under the record: `node:` built-ins only, no workspace package. It never imports the record, an extension, the hub, the CLI or the app.

## Deviations

- `gitleaks`: gitleaks' default rules vendored unchanged at tag v8.30.1 with their MIT license; `gitleaks.toml` is upstream's generated file, so never edit it, and `src/patterns.ts` converts its Go RE2 patterns at load.
- `src/fields.ts`: ported from makecindy/cindy `redact.ts` at commit 82d44ec under Apache-2.0; its header keeps the license notice and lists what changed from the original, so keep both.
