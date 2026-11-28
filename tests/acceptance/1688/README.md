# Acceptance tests for #1688: exports read nowhere but their own file

Written first, blind, from issue #1688 (its report, Scope, three acceptance criteria and Proof), the design and base
commit `e87cefc44`, by a job that never saw an implementation. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Node's test runner and built-ins
only; the `.mjs` files hold no comments (the comment ratchet's ceiling for a new file is 0), so what they would say is
here.

| AC | ID | Tests |
|---|---|---|
| AC1 | `#1688.e0a10d9d` | `ac1-plant.test.mjs` (a planted export with no reader fails the lint, named; a planted export another file reads is not named), `ac1-clean.test.mjs` (two: the lint passes on the change's files; it passes with every `packages/*/src` file in the change) |
| AC2 | `#1688.9c597d35` | `ac2-api-report.test.mjs` (the API report half). The `affected.mjs` half is a person's recorded run: see below |
| AC3 | `#1688.49c6e110` | `ac3-imports.test.mjs` |

IDs are the first 8 hex of the SHA-256 of each criterion's text after `- [ ] `, trimmed, whitespace collapsed (as
`scripts/proof-change.mjs`'s `criterionId`). Each test's name starts with its ID and its AC number.

Run, from the repo's root, under Node 24:

```
node --test --test-concurrency=1 'tests/acceptance/1688/*.test.mjs'
```

## What was read

`AGENTS.md`; the issue; `docs/technical-design.md` (Dogfooding, Repo guards); `scripts/lanes.mjs` (the `lint` lane's
commands and `changedPaths`); `scripts/api-surface.mjs`; the head of `scripts/affected.mjs`; `scripts/twins-lint.mjs`
and `scripts/proof-runs.mjs` (`twinOverlay`, `failedAtAssertion`); `scripts/proof-change.mjs` (`criterionId`);
`contracts/api-report/extension-api.api.md`; `packages/readings/src` and its `package.json`; and suite
`tests/acceptance/3413/` for the house shape.

## The surfaces (my choice where the issue leaves it open)

- **The lint's command.** `node scripts/unread-exports.mjs`, run from the repo's root with no arguments, named
  `unread-exports`. It reads the change's files as `scripts/lanes.mjs`' `changedPaths` does: the files that differ from
  `git merge-base HEAD origin/main`, committed or not, plus untracked files git doesn't ignore. Of those, it checks the
  package source files (`packages/<package>/src/**`, TypeScript and JavaScript). For each name such a file exports that
  no other file of the repo reads, it prints one line starting `FAIL unread-exports` that holds the file's repo path and
  the name, and exits 1. With none it prints a line starting `PASS unread-exports` and exits 0. When it can't run (no
  merge base, git fails, a file it can't parse) it prints `BLOCKED unread-exports: ...` and exits 2 or 3, never a PASS.
  What counts as a reader (an import, a re-export, a test's import) is the lint's to decide; the tests below only pin a
  plain import from another file as a reader. Whether it joins the `lint` lane in `scripts/lanes.mjs` is the
  implementer's (an edit there needs an approval tag); no test here reads the lane.
- **A scratch copy with the merge base under it.** As #3413's: the checkout's tracked and unignored files are copied to
  a temp folder; each file that differs from the merge base is first put back as the merge base has it and committed,
  that commit is the copy's `origin/main`, and the working tree's files are committed on top. The copy links the
  checkout's `node_modules` (left out of git by `.git/info/exclude`), so a lint built on `typescript` loads. Git runs
  with no `GIT_*` variable, global or system config; HOME, TMPDIR and the XDG folders are the sandbox's. The checkout is
  never written.
- **AC1's plant.** In the copy, two functions are appended to the alphabetically first `.ts` file of
  `packages/readings/src` other than `index.ts`: `zorvanthicUnreadHelper`, read by nothing, and `zorvanthicReadHelper`,
  read by a new file `packages/readings/src/zorvanthic-reader.ts` that imports it with a relative `./<file>.js` import.
  Both are committed as part of the change. Then an untracked `packages/readings/src/zorvanthic-plant.ts` exports
  `zorvanthicUntrackedHelper`, read by nothing. The lint must exit 1, name the host file with `zorvanthicUnreadHelper` and
  the untracked file with `zorvanthicUntrackedHelper` on `FAIL unread-exports` lines, and no line may name
  `zorvanthicReadHelper`. A lint that names every export, or only committed files, fails it.
- **"Passes on the cleaned packages" (AC1).** Two runs. First the lint as is, in the copy: exit 0, a `PASS unread-exports`
  line, and no `FAIL`/`BLOCKED`/`INVALID`/`INCONCLUSIVE` line. Second, so "the cleaned packages" means every package and
  not only the files the change happened to touch: the copy's history is rewritten (the working tree is not) so that
  `origin/main` is a commit holding the merge base without any `packages/*/src` file, with the merge base and the change
  on top. The lint's merge base is then that commit, and every package source file is a file of the change. It must
  pass the same way. This is the strong reading of the Scope's first bullet ("each name with no reader outside its
  file, package by package"); if a name must stay exported with no reader in the repo (a published entry, say), the lint
  must know why, or this is a dispute for the blind redraft.
- **The API report (AC2).** `contracts/api-report/` must hold the same files as at the merge base, each byte for byte.
  And the report API Extractor makes now must equal the merge base's: `node scripts/api-surface.mjs --root <folder>`
  runs from the checkout (its own `node_modules` API Extractor) on a temp folder holding the change's
  `packages/contracts/extension-api.json` and the merge base's report. No `FAIL api` line may show, and no `BLOCKED api`
  line about API Extractor or the report. That folder is no git checkout, so the script then stops at its Rust half
  (`BLOCKED api: cargo-semver-checks ...` or `no commit at HEAD`), which the test accepts: the crates aren't what this
  issue changes, and cargo-semver-checks builds about a gigabyte of rustdoc.
- **`affected.mjs` per package (AC2's other half).** Not a test: `node scripts/affected.mjs` runs every reached suite
  under the throttle's grant, for a change as wide as this one hours long, and its results depend on the machine's load
  and on `known-failures.json`. It is a person's recorded run, per package touched, of `node scripts/affected.mjs` on the
  change, compared with the same run on the merge base, showing no new failure. Without that record AC2's half stays
  INCONCLUSIVE and the pull request says `Part of #1688`, however the test above reads.
- **"A name that lost its export" (AC3).** For each changed code file (`.ts`, `.mts`, `.js`, `.mjs` and kin, outside
  `tests/acceptance/`) that exists at the merge base: the names it exports there (`export function|class|const|let|var|
  interface|type|enum|namespace <name>`, and `export { a, b as c }` lists, `default` left out) that it no longer
  exports, a deleted file losing all of them. "An acceptance test or twin" is every file under `tests/acceptance/`: code
  files, twins' whole files (read as at the repo path they replace) and twins' `lines.json` (their `wrong` lines, read
  as at the path they edit). Imports read are static `import ... from`, `export ... from`, `* as ns` with `ns.<name>`,
  and `{ ... } = await import('...')` and `(await import('...')).<name>` with a literal specifier. A relative specifier
  hits a lost name of the file it resolves to (`dist/<x>.js` read as `src/<x>`); a package specifier
  (`@deepbuild/<name>` or a subpath of it) hits a lost name of any of its `src` files that no `src` file of the package
  exports any more. No hit may remain.
- **Why AC3 also asks that the change drop exports.** On the merge base the change is empty, so "no test imports a
  name that lost its export" holds of nothing. A twin can't plant the failure either: the before lane refuses a twin
  that replaces files under the test paths, and making a test import a lost name is exactly that. So the test also
  asserts that at least one name lost its export, the Scope's first bullet; it fails at the base for that reason,
  plainly, at its assertion.

## Twins

`twins.json` names one twin, `api-report-edited` for AC2: its `lines.json` adds a planted method line under
`export interface Deep {` in `contracts/api-report/extension-api.api.md`, a report no longer the merge base's, which
the test must fail. AC2's test is the only one that passes at the base; the AC1 and AC3 tests fail at the base at their
assertions, so they need none (a wrong lint can't be kept as lines of a file that doesn't exist yet).

## At the base

`BASE-FAILURE.txt` holds the base run. 1 pass, 4 fail:

- The three AC1 tests fail for the expected reason: `scripts/unread-exports.mjs` does not exist (asserted before any
  copy is made).
- AC2 passes at the base, plainly: the report is the merge base's and the extension API still gives it. Its twin is the
  wrong program it catches.
- AC3 fails for the expected reason: the change drops no export (no acceptance test imports a lost name, since none is
  lost).
