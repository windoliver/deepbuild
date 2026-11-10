# #1820 — pack assets on first use

**PR status: draft; Part of #1820, not Closes.** The feature and actual re-export work in the passing checks below, but a disputed acceptance draft and the repository-wide checks remain red. No failing test was edited, skipped or removed.

## Base and scope

Work is on `feat/1820-pack-assets` in the sibling `doneright-1820` worktree. The original dirty `doneright` checkout is untouched. The PR was rebased onto `7c5e1cc8dcbe33b1f9ad077fa6a7380006597eee`. Independent acceptance tests were written against `903a1c070`, then committed before the implementation once PR creation was authorized. All acceptance files remain byte-identical to their authors' copies; rebase safety stashes remain.

## Requirement → change → proof

| Requirement | Change | Proof |
|---|---|---|
| One authorized first fetch, store by hash, no second fetch | `hub/src/libraries.ts` shares the library network job, `packs.ts` pins manifests, `core.ts` gates document inputs | Blind `1820/fetch.test.ts`; `pack-cache.test.ts`, `pack-ref-safety.test.ts` |
| Hash mismatch refused and removed, naming the asset | Bounded Source download checks the whole file; evidence intake verifies a private copy before publishing | Blind fetch and resumed-splice tests; `asset-file-integrity.test.ts`; production mutant retaining the mismatch fails the unchanged hub-folder scan |
| 2.2× disk space before any asset byte | Integer-ratio checks before authorization and download | Blind `1820/disk.test.ts`, Source disk regression; no asset request on refusal |
| Read license file; refuse CC BY-SA, NC, GPL | Canonical CC0/CC-BY texts shipped verbatim; other terms read through Source; file content wins over manifest ID | Blind `license.test.ts`, `scope/license-file.test.ts`; license authority/forms regressions |
| Offline BLOCKED with one unblock ask; scoped standing rules | Source-recorded zero-byte reachability; persistent asks, approval by plan digest, rules keyed to one pack | Blind `offline.test.ts`; restart, shared-offline-cause and decline/rule regressions; actual wrong-pack-rule mutant fails naming `acme/voices` |
| Quota and resume | One-MiB ranges, retained partial bytes, quota pause with `until`, checked range replies | Blind `scope/resume.test.ts`; download/quota/range/replay tests |
| `pack@version` and the same bytes on re-export | Immutable version copies; shown and exported documents share asset preparation; `canvas.export` returns PNG bytes, not paths | Blind `scope/reuse.test.ts` plus **actual PNG exports** in `export-redraft/export.test.ts`: red v1, blue v2, byte-identical offline repeats, missing version refused, offline unfetched export writes no PNG |
| Reuse #1731's network job | Shared `Libraries.run` and `Sources.download` | Existing `tests/acceptance/1731/` and evidence/Source regressions |

The CLI's no-pack export remains headless and needs no running hub. A pack export uses the hub's pinned store and authority; `canvas.export` accepts no filesystem paths and returns only its rendered PNG. First use finds hashes in the document's asset map and kind parameters, not only the game-asset recipe. Export write errors remain one CLI error, not an uncaught stack.

## Current checks

Raw local output remains in `/tmp/deepbuild-1820-proof/`; there are no secrets in the checked-in evidence summary.

- Workspace TypeScript build: **PASS** (`pr-base-build.log`); subsequent hub/CLI builds after export changes: **PASS**.
- Rust `cargo build --locked -p deep-show -p deep-hook` on the PR base: **PASS** (`pr-rebased-rust-build.log`). The first invocation selected the wrong bin/package pair and failed without compiling; the corrected command is the one counted.
- Acceptance and regression strict typechecks: **PASS** (`pr-acceptance-typecheck.log`, `pr-regressions-final-typecheck.log`). The two earlier optional-header annotations were corrected with the user's explicit approval; no runtime assertion changed.
- Combined scoped `node scripts/affected.mjs`: **81 passed, 2 behavioral failures**, 88 additional lint findings not in the baseline, 11 listed failures (`pr-final-affected.log`). The two behavioral failures are the first export draft described below. Original #1820 checks, #1731 checks, the blind export redraft and selected regressions passed. No WIDE or INCONCLUSIVE lines in this run.
- Export redraft alone: **4 passed**, including real output pixel checks and byte equality, not merely `deep show` (`pr-export-redraft-check.log`).
- Failed-export-write regression: fails before on the uncaught stack, **1 passed** after (`pr-export-write-red.log`, `pr-export-write-check.log`).
- Required production mutants (retained corrupt bytes and another pack's rule), plus per-asset offline asks, each fail their intended assertions, not just the affected command's already-red lint exit (`mutant-*.log`). Mutations restored; **6 tests passed** on the restored code (`pr-mutants-restored.log`).
- No-pack export smoke: **PASS**, actual 480×270 RGBA PNG (`pr-plain-export.log`).
- Comparison against the blind acceptance originals: **PASS**. Tracked implementation diffs have no whitespace findings. After staging the formerly untracked license files, `git diff --cached --check` reports one extra EOF blank line in the verbatim upstream CC-BY-4.0 legal text. Both license files were compared byte-for-byte with their canonical upstream URLs; the upstream whitespace is retained rather than editing the license.

## Blockers before closure

### 1. Export acceptance dispute — first draft retained

`tests/acceptance/1820/export/reexport.test.ts` first raises one **unblock** ask in its offline case. Its later `fetchOnce` sets `before = (await asks(w)).length` (all kinds), then calls `newAsks(w, before, 'authority')`. That helper filters to authority asks *before* slicing. With one old unblock and one new authority, it computes `[authority].slice(1)`, incorrectly yielding zero. The test therefore never answers the genuine authority ask; its subsequent export also remains held.

Observed failures in `pr-final-affected.log`:

- `one ask: expected +0 to be 1` at `export/reexport.test.ts:100`;
- the following re-export stays `held`, because that yes was never sent.

Per Dogfooding, a fresh job received only the issue, design and base—not the implementation, original draft or dispute. Its unchanged draft in `export-redraft/` **passes all four checks** on the same code and proves real PNG contents. Both drafts and both outputs are retained. The first draft has not been weakened or bypassed. **Its blind-redraft disposition still needs approval before replacing that criterion's draft.** No further redraft is allowed for it. This PR deliberately stays `Part of #1820` while the required failing draft stands.

### 2. Repository checks are not green

The original base already reported 75 lint findings absent from `scripts/known-failures.json`, plus 11 listed failures. Subsequent main landings add more; the PR-base run reports **88 non-test findings plus the two export-test failures**. They include dependency tables, carried patches, canvas lints, slot conformance and projection drift. No baseline was rewritten and no check was skipped to turn these green. Existing pack-file rustfmt drift also fails unchanged on the base; unrelated formatting was not edited.

The full all-change selection is much wider than the explicit requirement/regression paths: core/store/host importers reach thousands of checks, including timed, slow, platform and manual ones. It was **not all run**. Earlier Source coverage reported the Linux Secret Service test as **INCONCLUSIVE** on macOS. No full preflight, release budget, platform matrix, live provider check or interface preflight is claimed.

## Size and limits

This is over the approximate 400 handwritten-line target: the hub installation/authority/first-use/export path, shared Source downloader and file-backed evidence intake must connect before downloaded bytes can be used safely. The independent acceptance suites and regression proof account for most additional lines; the two upstream license files retain their notices. No dependency or user-facing configuration flag was added. Store intake/verification belongs in the store because only it owns hash paths and the journal; pack policy stays in the hub and network work in Source.

Reachability is a quota-limited, recorded TCP connection to an installed pack's declared URL, with no HTTP request or asset bytes before authority. Large servers without Range support refuse as `range_not_supported`; cross-host redirects are not followed. A quota pause preserves partial bytes and the exact approval, and a later use after `until` resumes it. Rules intentionally name `owner/name` and a license list, as library rules do; they are not version-specific. Fetching is per used asset, not a speculative download of every asset in the pack. Automatic discovery inside future recipe/provider jobs and a multi-asset batch authorization are not claimed.

Do not mark the issue closed while the acceptance dispute and unverified checks remain.
