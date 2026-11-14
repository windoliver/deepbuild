# #1820 — pack assets on first use

**Issue criteria: proven; PR #2192 can close #1820 when merged.** This is not a claim that the repository-wide preflight passes: inherited diagnostics and unrun/platform checks remain disclosed below.

## Base, authorization and acceptance disposition

Work is on `feat/1820-pack-assets` in the sibling `doneright-1820` worktree; the original dirty `doneright` checkout is untouched. The published branch incorporated main at **`a04378eb2fd34a6c7df923a6077e77c996153752`** with a normal merge, not a force push. Independent acceptance tests were written from issue/design/base `903a1c070`, then committed before implementation when PR creation was authorized.

After the original export draft, its blind redraft and their differing outputs were disclosed, the owner directed closure of the remaining PR gaps. The unchanged blind redraft is now the active export criterion; the superseded draft is retained byte-for-byte as audit data. See [export disposition](issue-1820/export-disposition.md). This is an approved replacement after the one blind redraft, not a modified assertion or a product special case. All other acceptance files are unchanged.

## Requirement → change → proof

| Requirement | Change | Proof |
|---|---|---|
| One authorized first fetch, store by hash, no second fetch | `hub/src/libraries.ts` shares the library network job; `packs.ts` pins manifests; `core.ts` gates first use | Blind `1820/fetch.test.ts`; cache and kind-input regressions |
| Mismatch refused and removed, naming the asset | Source verifies the assembled file; evidence intake verifies a private copy before publishing | Blind mismatch and resumed-splice tests; file-integrity regression; actual production mutant retaining bad bytes fails the unchanged scan |
| 2.2× disk room before any asset byte | Integer-ratio checks before authorization and at download | Blind `disk.test.ts` and Source disk regression; no asset request on refusal |
| License file read; CC BY-SA, NC and GPL refused | Bundled canonical license texts or Source-read terms; restrictive content overrides the manifest label | Blind `license.test.ts` and `scope/license-file.test.ts`; license-authority and spelling regressions |
| Offline BLOCKED with one unblock ask; no unapproved or cross-pack fetch | Persistent asks, exact-plan approval digests, pack-specific rules and Source reachability | Blind `offline.test.ts`; restart, offline-many and decline/rule regressions; wrong-pack-rule production mutant fails naming `acme/voices` |
| Quota and resume | Bounded ranges, checked partial replies, quota pause with `until`, retained partial bytes | Blind `scope/resume.test.ts`; download/quota/range/replay regressions |
| `pack@version` uses identical bytes on re-export | Immutable version copies; export and show share first-use preparation and checked storage | Blind `scope/reuse.test.ts`; **four real CLI PNG checks** in `export-redraft/`: versioned red/blue pixels, byte-identical offline repeats, missing version refusal, no output for an unfetched offline asset |
| Shares #1731's network job | One `Libraries.run` and `Sources.download` path | Existing `tests/acceptance/1731/`, Source and evidence regressions |

The hub export RPC accepts no filesystem paths; the CLI writes only returned PNG bytes. Plain no-pack exports keep their headless/no-hub path. Asset maps and hashes in kind parameters use the pinned pack gate. Export write errors remain a normal CLI error, not an uncaught stack.

## Observed verification

Machine-readable evidence: [test-results.json](issue-1820/test-results.json), [base-comparison.json](issue-1820/base-comparison.json). Raw local output is in `/tmp/deepbuild-1820-proof/`.

- **25/25 adopted #1820 acceptance checks pass**, including real PNG exports. The completed issue/library/download selection reports **36 passed**, no test failures, no WIDE or INCONCLUSIVE lines (`closure-complete.log`).
- The complete set of observed selected results contains **91 distinct passing checks**. One Linux Secret Service check is **INCONCLUSIVE on macOS**. This count combines completed JSONL records, not an assertion that one full lane passed.
- The first combined affected invocation hit the tool deadline while non-light lint jobs waited behind another build. Its completed regression report had 57 passes, one Linux skip and one 5-second download-test timeout during extreme load. That timeout received **one isolated rerun**, unchanged, and passed; the acceptance files that never started were then run. Both outcomes remain in the evidence. No timeout, assertion or test configuration was loosened.
- Workspace TypeScript build: **PASS** (`closure-build.log`). Rust `cargo build --locked -p deep-show -p deep-hook`: **PASS** (`closure-rust-build.log`). Acceptance/regression strict typechecks: **PASS**. The touched Rust file's `rustfmt --check`: **PASS**.
- Baseline without the feature: the same blind acceptance checks fail on missing pack installation, with the hub running (`closure-base-complete.log`), proving missing behavior does not pass.
- Actual production mutants for retained mismatch, another pack's rule and per-asset offline asks each fail their intended assertions. A fourth mutant adds changing bytes to exported PNGs; the adopted blind redraft fails its byte-identical re-export assertion. Sources are restored after every run; tests stay unchanged. Restored targets pass **6 checks** and the restored export redraft passes **4** (`closure-mutants-restored.log`, `closure-export-restored.log`).
- Whitespace and touched-file formatting are clean. The CC-BY-4.0 legal text differs from upstream only by removing its redundant final blank line; all legal text/notices remain unchanged.

## Inherited failures are not hidden or called PASS

A clean worktree at the same `a04378eb2` base ran `affected.mjs` with the same tools. It reported **91 unlisted diagnostics plus 11 listed failures**. The change reported **89 unlisted diagnostics plus the same 11 listed failures**. Multiset comparison finds **zero diagnostics introduced on the change**; the base's two additional entries were environment-kit `lsof` failures under load. The change's 89 findings are all present on the base: dependency tables, carried patches, canvas lint, mappings, conformance/slot checks and projection drift. The stored comparison lists each one. Some later runs also encountered those two inherited environment failures.

Accordingly `affected.mjs` still exits **FAIL on inherited repository findings**; the scoped issue criteria pass. No check or `scripts/known-failures.json` was rewritten to change this status. Those independent repository problems are not requirements of #1820 and were not folded into this PR.

The full import-graph selection, timed/slow/manual suites, platform matrix, live providers, release budgets and full preflight were **not all run**. Nothing unrun is marked PASS. The no-WIDE statement above applies to the explicit scoped runs, not to every possible importer of hub/store code.

## Architecture, size and boundaries

This exceeds the approximate 400-line guideline. Installation, authority, download, file-backed intake and export are one safety path; the independent acceptance and regression checks and verbatim legal texts account for most added lines. No dependency or new user configuration flag was added. Generic file intake/verify belongs in the evidence store because only it owns the hash paths and journal; pack policy stays in the hub, network work in Source.

Reachability is a recorded, quota-limited TCP check to an installed pack's declared URL, with no HTTP request or asset bytes before approval. Unsupported large ranges are refused by name; redirects across hosts are not followed. A quota pause preserves partial bytes and exact approval, and a later use after `until` resumes. Standing rules name `owner/name` and a license list, as library rules do; they are not version-specific. Each first-use job fetches the used asset only. Automatic discovery inside future provider/recipe jobs and a multi-asset batch authorization are not requirements claimed by this issue's single-asset contract.

Every acceptance criterion in #1820 has a passing real-component check plus the required wrong-program evidence. `Closes #1820` is appropriate for the PR; merging remains the owner's action.
