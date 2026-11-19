# Acceptance tests for #1495: cut a release in one command, refused unless every version and the proof agree

Written first and blind, at `d4cef00fb` (origin/main), from issue #1495's body (Scope, twelve acceptance criteria, Proof,
Not in scope, Depends on), the design and the base, before any implementation. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- **The issue**, #1495, its body only.
- **The design**, `docs/technical-design.md` at `d4cef00fb`: How it installs (Cutting a release; Installs and updates;
  Starting from nothing; Platforms: the sandbox seam and bundled fonts only), How we know version 0 works (case lists
  and the release report, the parity suite's goldens blessed only by your decision and the documents earlier releases
  saved, Dogfooding). `AGENTS.md`.
- **The base**, for surfaces only: `scripts/release-pack.mjs`, `release-stage.mjs`, `release-verify.mjs`,
  `release-rehearse.mjs`, `app-runtime.mjs`, `app-bundle`, `contract-diff.mjs` (`notes`), `parity-suite.mjs`
  (`report`), `lanes.mjs` (`releaseLanes`, how a lane prints `BLOCKED <lane>: ...`), `preflight.mjs`,
  `release-budgets.mjs` (the `release/<version>` tags), `open-issues.mjs`, `npm-launcher.mjs`, `proof-change.mjs`
  (`criterionId`); `packages/supervisor/src` (`seatbelt.ts`, `types.ts`, `index.ts`); `packages/hub/src/canvas.ts`
  (`deep export`, the canvas core found beside the hub's `dist/`); `packages/cli/src/main.ts` (`deep --version`);
  `packages/gate/src/open.ts`; `crates/deep-show/src/kit/goldens.rs` (`decide`) and `migration.rs` (`accept_corpus`);
  `crates/deep-text/src/fonts.rs`; the root and workspace manifests, `package-lock.json`, `Cargo.toml`, `Cargo.lock`,
  `crates/deep-hook`, `packs/*/pack.json`.
- **Suites**, as models; patterns copied, nothing imported: `41` (pack, sign, bundled: the fixture film and its still
  at frame 30), `1349` (a real runtime built once per commit under `target/`), `236` (driving the Seatbelt backend).

No branch, worktree, pull request or session working on #1495 was read.

## Criterion to tests

Each test's name starts `AC<n> #1495.<8 hex>`: SHA-256 of the criterion's text, trimmed, white space collapsed, as
`scripts/proof-change.mjs` computes it. A test marked `(wrong program)` runs a planted program and expects the
criterion's own judgement to fail on it; each such test first checks the plant did the wrong thing it names, so a plant
that isn't there can't pass it.

| AC | ID | Criterion, in short | Tests | Wrong programs it fails on |
| --- | --- | --- | --- | --- |
| AC1 | `#1495.2599b24d` | one crate at the old version refuses the tag, naming the file and both versions | `versions.test.ts`: the twin (bump 1.2.0 to 1.3.0 moves every source in one commit of only those files; the tag goes through); one crate left at 1.2.0 (refused, naming `crates/deep-show/Cargo.toml`, `1.2.0`, `1.3.0`; nothing tagged or published) | the base; a tag step that refuses whatever the versions; a bump that misses a source, moves a third-party pin that sits at 1.2.0 or a pack's own version, or commits another file |
| AC2 | `#1495.33e806c7` | a preflight record for another commit refuses the tag, naming both commits | `preflight.test.ts`: refused on a first run (nothing packed) and on a rerun over a folder already packed for the release commit, naming both full commits; the release commit's report lets the same release through | the base; a report checked only when packing; a tag step that refuses whatever the report |
| AC3 | `#1495.4e3f9f7e` | stopped after the first artifact, run again: only the rest published, the skip reported | `rerun.test.ts` AC3 | the base; a rerun that publishes the first again or reports no skip |
| AC4 | `#1495.7d91f999` | a planted BLOCKED lane is in Known limits; removing it by hand fails the release check, naming it | `known-limits.test.ts` | the base; a list that leaves the lane out or lists lanes that passed; a tag step that never reads the README, or refuses whatever it holds |
| AC5 | `#1495.c2b38fd8` | an app download missing a pack's folder, versions unchanged, fails verification naming pack and artifact; nothing after it published | `verify.test.ts` AC5: the twin (every pack: published), the refusal, `version-verifier` | the base; `version-verifier`; a verifier that refuses every app download |
| AC6 | `#1495.1a706da4` | an artifact built at another commit, under the release's name and version, is refused by sha256, naming it and both digests | `verify.test.ts` AC6: the refusal, `name-version-verifier` | the base; `name-version-verifier` |
| AC7 | `#1495.7644dc0b` | from the extracted app download, sandboxed: `deep --version` and the still; a bundle reading a font from the checkout is refused, naming the path | `app-download.test.ts`: the release's check passes the real app download; the test's own sandboxed run (with controls); `checkout-font` | the base (no release, and no canvas core in the runtime folder); `checkout-font`; an app download needing anything outside its folder, a home or the network |
| AC8 | `#1495.1fbd7770` | a rerun skips the published first by its digest, verifies the other two once each, refuses it with one byte changed | `rerun.test.ts` AC8: the skip, the changed byte, `trust-file-name` | the base; `trust-file-name`; a rerun that verifies or publishes the first again |
| AC9 | `#1495.a1f2c768` | both blessing decisions since the previous tag listed under Looks that moved, with fixture, kind, cause, 3.2% and 9 | `looks.test.ts` AC9: the list, `contract-diff-only` | the base; `contract-diff-only`; a list that keeps the decision made before the tag |
| AC10 | `#1495.f010e08b` | each row's figures are the comparison's the decision answered | `looks.test.ts` AC10: the figures, `self-compare` | the base; `self-compare` |
| AC11 | `#1495.84b5e71f` | no blessing decision: `Looks that moved: none` | `looks.test.ts` AC11: the line, `drop-empty-heading` | the base; `drop-empty-heading` |
| AC12 | `#1495.e029821e` | one row removed by hand: the tag is refused, naming its decision | `looks.test.ts` AC12: the twin, the refusal, `heading-only` | the base; `heading-only`; a tag step that refuses whatever the rows |

## How to run

macOS (the app check's sandbox is Seatbelt and the app downloads are zipped with `ditto`), Node 24.22 or newer, git:

```sh
npm ci && npm run build --workspaces
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1495 --testTimeout=600000 versions.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1495 --testTimeout=600000 preflight.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1495 --testTimeout=600000 rerun.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1495 --testTimeout=600000 known-limits.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1495 --testTimeout=600000 verify.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1495 --testTimeout=600000 looks.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1495 --testTimeout=600000 app-download.test.ts
npx tsc --noEmit -p tests/acceptance/1495/tsconfig.json
```

- **The build.** The release reads `packages/contracts/dist` (through `scripts/contract-diff.mjs notes`) and, for the app
  check, `packages/supervisor/dist`; `app-download.test.ts` imports the supervisor's public entry, whose packages read
  their built files. `npm run build --workspaces` makes them all.
- **Times.** The six fixture files take seconds each (1 to 9 s apiece on this Mac under a load near 100, measured on
  the throwaway check below); at the base each fails in about a second.
- **AC7 builds the real app download once per commit** (`app-download.test.ts`). The first test that needs it runs,
  through `scripts/lease`, with `/opt/homebrew/opt/rustup/bin` first on PATH, `CARGO_INCREMENTAL=0` and
  `CARGO_PROFILE_DEV_DEBUG=0`: `node scripts/release-pack.mjs --repo <checkout> --commit HEAD --out
  target/da1495/<commit12>/archives` (#41's pack, unsigned: release-stage's full build, including deep-hook for both
  Linux targets through zig and the `x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` targets), then
  `node scripts/app-runtime.mjs --archives … --out …/runtime` and the same with `--plant checkout-font` (Node from
  `scripts/fetch-lock.mjs`, git built from source), then wraps each runtime folder in `DeepBuild.app` and zips it
  (`…/plain/DeepBuild-<version>.zip`, `…/checkout-font/DeepBuild-<version>.zip`), marking each step done. Commit your
  work first: the pack refuses a changed tree. A build that fails is BLOCKED, naming the command and its output, never a
  pass. The first run on a commit is long (tens of minutes to hours on this shared Mac); later runs reuse the cache and
  take minutes. This app download is `DeepBuild.app` with `Contents/Info.plist` and `Contents/Resources/runtime/` and
  without `Contents/MacOS/deep-app`: `scripts/app-bundle` would build the app's own binary, a long build that nothing in
  AC7 runs; the runtime folder is the one `scripts/app-bundle` copies.
- **Folders and processes.** Each fixture release lives under `/tmp/dr1495-*`, with a HOME of its own, removed when its
  file ends. git reads no user or system config and runs no hook; npm's registry is a closed loopback port, so nothing
  could be published anywhere. Fixture runs use `spawnSync`, whose timeout stops its own child by PID; AC7's long
  commands each run in a process group of their own, stopped by that group's PID. Nothing touches the real
  `~/.deepbuild`, and nothing reaches past 127.0.0.1.
- **Lanes.** `app-download.test.ts` builds for a long time; it belongs on `scripts/lanes.mjs`'s `alone` list or in the
  release preflight, in a macOS lane. The implementer makes that edit.
- **`--root` cache.** Vitest writes `tests/acceptance/1495/node_modules/.vite/`; it is ignored by git; delete it after.

## The contract (my choice)

The issue names `scripts/release.mjs` and its two steps, release-pack's `--preflight` check, the signed manifest and
what it lists, the platform sandbox, the `Known limits` list and the `Looks that moved` list. Where they leave a shape
open, this is the smallest one that makes each criterion's values checkable, and the implementation provides exactly
this. Sibling scripts' flags (`--repo`, `--commit`, `--out`, `--key`, `--preflight`) are kept.

1. **The command.** `node scripts/release.mjs <step> …`, three steps. Refusals exit non-zero with the reason on stdout
   or stderr.
   - `bump --repo <dir> --version <x.y.z>`: moves every version source (2) of the checkout to `<x.y.z>` and makes one
     commit holding exactly the files it changed.
   - `notes --repo <dir> --commit <sha> --out <dir> --preflight <report.json>`: writes `<out>/NOTES.md` and
     `<out>/README.md` (7) for the release at `<sha>`, and exits 0. It judges nothing (no version, commit or row check):
     every refusal is the tag step's.
   - `tag --repo <dir> --commit <sha> --out <dir> --key <ed25519.pem> --preflight <report.json> --publish <dir>`:
     refuses the release, with nothing published and nothing tagged, when a version source at `<sha>` differs from the
     release's version (naming the file, its version and the release's), when the report isn't for `<sha>`
     (release-pack's own refusal, naming both full commits), when `<out>/README.md`'s Known limits leaves out a lane the
     report reads BLOCKED or INCONCLUSIVE (naming the lane), or when `<out>/NOTES.md`'s Looks that moved has no row for
     a blessing decision since the previous tag (naming the decision's ID). Otherwise it packs what's missing (5),
     verifies and publishes each artifact (8), and tags `release/<version>` at `<sha>` in `<dir>`; exit 0.
   The release's version is the root `package.json`'s `version` at `<sha>`, the one source of truth.
2. **The version sources**, in the real repo's layout: the root `package.json` `version`; each `packages/*/package.json`
   `version` and every `@deepbuild/*` pin in its dependency lists; `package-lock.json`'s `version`,
   `packages[""].version`, and each `packages["packages/<dir>"]` entry's `version` and `@deepbuild/*` pins; each
   workspace crate's `[package] version` (`crates/deep-hook`'s is the hook binary's: `deep-hook --version` prints it)
   and its `[[package]]` entry in `Cargo.lock`; `scripts/app-bundle`'s `CFBundleShortVersionString` (the app bundle);
   and each `packs/*/pack.json` `requires.core`, as `>=<version>`. A third-party pin (npm or crate) and a pack's own
   `version` are not the release's and never move. The release reads and rewrites these files itself, and nothing it
   runs resolves a dependency or reaches a registry: a fixture's third-party pins resolve nowhere (reading its
   workspace with `cargo metadata --no-deps --offline` works).
3. **The output folder** (`--out`) holds the artifacts, `manifest.json` and `manifest.json.sig` as release-pack writes
   them, and `NOTES.md` and `README.md` as `notes` writes them. The key, the report and the publish folder live
   outside the repo.
4. **The signed manifest**, #41's with each artifact's contents:
   `{"commit": "<full sha>", "archives": [{"name", "file", "sha256", "holds": [{"path", "sha256"}]}]}`;
   `manifest.json.sig` is the raw Ed25519 signature over `manifest.json`'s exact bytes. `holds` lists every binary,
   bundled font and first-party pack the artifact holds, one entry per regular file (a pack file by file under its
   folder), its path relative to the folder the artifact is extracted into (`package/…` for an npm archive,
   `DeepBuild.app/…` for the app download), with that file's sha256. An artifact is extracted by its file's extension:
   `.tgz` with `tar -xzf`, `.zip` with `ditto -x -k`. The app download is the entry named `DeepBuild.app`, file
   `DeepBuild-<version>.zip`: `DeepBuild.app` zipped by `ditto -c -k --keepParent`, its runtime folder at
   `DeepBuild.app/Contents/Resources/runtime/` (design: Starting from nothing). The release verifies whatever the
   manifest lists; the app check (9) runs on the `DeepBuild.app` entry.
5. **Packing only what's missing.** `tag` always runs `scripts/release-pack.mjs --repo --commit --out --key --preflight`,
   whose check of the report is the only commit check (the issue: "adds no second one"). When `<out>` already holds
   `manifest.json` and `manifest.json.sig`, signed by `--key` and naming `--commit`, nothing is packed again: the
   release verifies and publishes what that manifest lists. The tests hand the release such a folder, written as
   release-pack writes one and signed with the test's key, so each test's artifacts are its own.
6. **The preflight report** (`--preflight`), the release preflight's record and the release report the issue names:
   `{"commit": "<full sha>", "verdict": "PASS", "lanes": [{"name": "<lane>", "state": "PASS | FAIL | BLOCKED |
   INCONCLUSIVE | INVALID | SKIP", "reason": "<one line>"}]}`. release-pack reads `commit` and `verdict` as at the base;
   the release reads its lanes from `lanes`.
7. **What `notes` writes.**
   - `<out>/NOTES.md`: the contract diff's notes (`node scripts/contract-diff.mjs notes --root <the release commit's
     tree> --release <version>`), the titles merged since the previous tag (from git history; no network), and
     `Looks that moved`: the heading line `## Looks that moved`, then a Markdown table whose header holds, in this
     order, `Fixture or document | Kind | Cause | Pixels past tolerance | Largest change` (more columns may follow),
     with one row per blessing decision since the previous tag (11): the golden's fixture or the corpus document's
     `name`, verbatim; the kind, `golden` or `corpus`; the cause, verbatim as the decision recorded it; the share of
     pixels past the tolerance as a percentage with one decimal and `%` (`3.2%`); the largest change in code values as a
     whole number (`9`). Both figures are the decision's `comparison`'s, never computed again. With no such decision,
     the one line `## Looks that moved: none`.
   - `<out>/README.md`: the release commit's `README.md` with a `## Known limits` section the release generates
     (replacing one it has): one bullet per open known-limit item (10) and one per lane the report reads BLOCKED or
     INCONCLUSIVE, that lane's bullet holding its name and its state. A lane that passed is not listed.
8. **Verifying and publishing** (`tag`), one artifact at a time in the manifest's order. When the publish folder holds a
   file of its name, the release hashes those bytes: the manifest's digest, and it is skipped (`skipped <file>`);
   another, and the release is refused, naming both digests. Otherwise the output folder's copy is read: its sha256 must
   be the manifest's entry (else refused, naming the file and both digests); it is extracted into a fresh folder; every
   `holds` entry must be there with its sha256 (else the release stops, naming the entry and the file); the app download
   takes the app check (9); then `verified <file>`, the copy into the publish folder, and `published <file>`. A write
   into the publish folder that fails stops the run at that artifact, everything before it published; a stopped or
   refused run tags nothing. Report lines start with the word and the file, alone or followed by a space or `:` and
   more words.
9. **The app check.** From the extracted `DeepBuild.app`, under the platform sandbox (`@deepbuild/supervisor`'s backend,
   Seatbelt on macOS) with reads granted to the extracted folder and a fresh HOME only, writes to that HOME only and no
   host: `Contents/Resources/runtime/bin/deep --version` prints the release's version, and `bin/deep export --document
   <HOME>/film.json --still 30 --out <HOME>/<name>.png` exits 0 and writes a PNG. `film.json` is the release commit's
   fixture film, `tests/fixtures/films/release-still/film.json`: a copy of #417's look film, the one #41's AC20 exports
   (the implementation adds it to the repo; each fixture release carries it). A failure stops the release at the app
   download and says what the run said; a refused read names its path.
10. **Open known-limit items** are open issues labelled `known limit` (no such label exists today). When
    `DEEP_KNOWN_LIMITS` names a file, the release reads them from it, a JSON array as `gh issue list --state open
    --label "known limit" --json number,title` prints, and asks GitHub nothing; the tests always set it, to `[]`.
11. **Blessing decisions in a release's history.** No decision record at the base carries the failing comparison's
    figures; these are the fields the implementation records.
    - A golden's blessing is an entry of `parity/goldens/store.json`'s `decisions` (the kit's golden store):
      `{"decision": "<id>", "by", "what": {"bless": {"fixture", "digest", "backend", "cause"}}, "comparison":
      {"share_past_tolerance": <0 to 1>, "largest_change": <code values>, …}}`, `cause` as the decision recorded it and
      `comparison` the failing comparison it answered.
    - A corpus difference's acceptance is an entry of the `accepted` list of a document an earlier release saved,
      `crates/deep-show/kit-corpus/<name>.json`: `{"cause", "decision": "<id>", …, "comparison":
      {"share_past_tolerance", "largest_change", …}}`; its row names the document by its `name`.
    - Since the previous tag: a decision whose ID is in those files at the release commit and not at the previous tag,
      the `release/<version>` tag with the highest version below the release's (as `release-budgets.mjs` reads them;
      with none, the whole history). The kind is `golden` for a store blessing and `corpus` for an acceptance.
12. **Plants.** `DEEP_RELEASE_PLANT=<name>` selects a planted program of `scripts/release.mjs`: the release with that one
    rule changed and everything else, its report lines included, the release's. A name it doesn't know is refused. The
    bundle plant is `scripts/app-runtime.mjs`'s, beside its `system-git`.

    | Plant | Selected by | The wrong program | Read by | The test sees it |
    | --- | --- | --- | --- | --- |
    | `version-verifier` | `DEEP_RELEASE_PLANT` | verifies an artifact by comparing its version strings (the app's Info.plist and runtime `package.json`, an archive's `package.json`) with the release's, instead of its manifest entry | AC5 | it publishes the app download missing a pack, and what follows |
    | `name-version-verifier` | `DEEP_RELEASE_PLANT` | matches an artifact by its file name and its package's name and version, instead of its sha256 | AC6 | it publishes the build from the other commit |
    | `trust-file-name` | `DEEP_RELEASE_PLANT` | a rerun skips an artifact whose file is in the publish folder, without hashing it | AC8 | it skips the changed artifact (`skipped <file>`) and tags |
    | `contract-diff-only` | `DEEP_RELEASE_PLANT` | `notes` from the contract diff alone | AC9 | neither decision has a row |
    | `self-compare` | `DEEP_RELEASE_PLANT` | each row's figures from comparing the new golden (or accepted result) with itself | AC10 | `0%` (or `0.0%`) and `0` in both rows |
    | `drop-empty-heading` | `DEEP_RELEASE_PLANT` | with no decision, `notes` leaves the Looks that moved heading out | AC11 | no heading |
    | `heading-only` | `DEEP_RELEASE_PLANT` | the tag step checks only that the Looks that moved heading is there | AC12 | it tags with a row missing |
    | `checkout-font` | `node scripts/app-runtime.mjs --plant checkout-font` | the runtime folder whose canvas core reads a bundled font from the checkout that laid it out (`<checkout>/crates/deep-text/fonts/<file>`) at run time instead of its compiled-in copy | AC7 | unconfined it exports the still; the release's app check refuses it, naming that path, which exists |

## Fixtures

- **A fixture release** (`helpers.ts`, `firstTree`): a temp git repo with the version sources of (2) in the real layout:
  a private root `package.json` with `workspaces: ["packages/*"]`, three workspace packages (`cli`, `contracts`, `hub`)
  pinning each other exactly, `package-lock.json` (lockfile 3), a workspace `Cargo.toml` with three crates
  (`deep-contracts`, `deep-hook`, `deep-show`, one source file each) and their `Cargo.lock`, `scripts/app-bundle`'s plist line, two packs
  (`foley-1.0.0`, `verbs-1.0.0`, each at its own 1.0.0), a README and the fixture film at its pinned path. Third-party
  pins (`typescript`, `yaml`, `itoa`) sit at 1.2.0, the old release's version, so a bump by text replacement shows.
- **Artifacts** (`npmArchive`, `appDownload`, `writeOut`): npm-shaped `.tgz` files (`package/package.json` and files),
  and a small app download: `DeepBuild.app` with its Info.plist and a runtime folder holding the two packs, a
  `package.json`, a stand-in `bin/deep` and `bin/deep-hook`. The stand-in `deep`, `/bin/sh` and `/bin/cp` only, prints
  the version for `--version` and, for `export … --out <file>`, copies a 480 by 270 PNG it carries there, so it passes
  the app check under the sandbox; the real app download is AC7's alone. `writeOut` writes the release folder as
  release-pack does, signed with the world's key; `drop` leaves one pack's folder out of the zip while the manifest
  still lists it, the version strings unchanged.
- **A history with blessing decisions** (`historyRelease`): at `release/1.2.0`, the golden store holds the first
  blessing of `parity/marks/ring.figure` (`dec-0000-91b2e4f6a0c3`, before the tag, never a row) and
  `crates/deep-show/kit-corpus/saved-chart.json` is a document that release saved. Since the tag, one commit blesses the
  golden again (`dec-0001-5a1f0c2e9b47`, cause "stroke joins now mitre up to a 4:1 limit", comparison 3.2% past
  tolerance, at most 9 code values) and one accepts the corpus document's new result (`dec-0002-c03e7d1a8f62`, cause
  "axis labels now sit on the baseline grid", comparison 1.1% and 4); or, with no blessings, one commit changes only the
  README. A last commit moves every version source to 1.3.0.
- **The preflight report**: lanes `checks` and `parity suite release`, both PASS; AC4 adds `planted lane 1495`, BLOCKED.

## What the issue leaves open, and how these tests read it

- **Which README.** The Known limits list comes from the release report of the release commit, which exists only after
  the preflight ran on that exact commit, so the list can't be in the commit it describes. The tests read the release's
  README, `<out>/README.md`, written by `notes` after the preflight.
- **The release report** is the preflight report's `lanes` (6), one file with the commit and verdict release-pack
  already reads, rather than a second file.
- **"The release check"** in AC4 is the tag step, which reads `<out>/README.md` as it stands.
- **A by-hand edit needs a step between writing and tagging**, so `notes` is its own step; the issue's "two steps" are
  read as the two that change git: bump's commit and the tag.
- **"The kind"** in a Looks that moved row is the kind of blessing: `golden` or `corpus`.
- **AC9's "3.2% and 9"** are read as the golden's figures; the corpus document's row carries its own comparison's
  (1.1% and 4), which AC10 holds each row to.
- **"Naming the decision"** (AC9, AC12) is naming its ID as the record gives it.
- **"A run stopped after the first artifact"**: stopped by a publish that can't land on the second (a folder squats on
  its name in the publish folder), which stops the run there every time, rather than by a signal racing a copy.
- **"One byte of the first changed"** (AC8): which copy the rerun reads is left open, so the same byte is changed in
  both, the output folder's and the published one.
- **"Verifies the other two once each" and "neither extracts nor publishes it again"** are read from the report lines
  (`verified`, `published`, `skipped`; extraction is part of verifying) and from the published copy's inode, mtime and
  size staying put.
- **"The fixture film"** is #41's (#417's look film), frame 30, at a pinned path in the release commit (9).
- **Open "known limit" items** are read as open GitHub issues with that label; none exists today (10).
- **The app download's form** is a zip made by `ditto`; AC7's lacks the app's own binary (How to run).
- **"The hook binary"** is `crates/deep-hook`'s crate version; a pack's `requires.core` moves as `>=<version>`.
- **AC5's "nothing after it"**: an artifact before the app download may be published; one before and one after it.
- **Merged titles** come from git history; no criterion reads them, so no test does.
- **The tag** is `release/<version>`, the name `release-budgets.mjs` reads releases by.
- **"Every read outside its folder and a fresh HOME refused"** is the grant reads of the extracted folder and the HOME,
  writes to the HOME, beside what the sandbox's profile gives every process (the system's own programs and libraries).

## Base

`BASE-FAILURE.txt` holds the run of each file at `d4cef00fb`, once. Every test fails at the missing
`scripts/release.mjs`: the surface doesn't exist on the base, so nothing past that ran and nothing is a pass.
`app-download.test.ts` checks for the script before building anything, so the base run builds nothing.

## How these tests were checked

A throwaway prototype of the contract above, written in a scratch folder outside the repo, was copied to
`scripts/release.mjs` for these runs and removed; nothing of it is committed. All six fixture files passed on it, each
plant test failing its judgement as it should. Eight mutants of it were each caught by the file named: no version
check, a bump that moves a third-party pin (`versions`); the report checked only when packing (`preflight`); a rerun
that publishes everything again (`rerun`); every lane listed (`known-limits`); every decision listed, the one before the
tag included (`looks`); no `holds` check, no sha256 check (`verify`). `app-download.test.ts` ran on it once with its
cache seeded by stand-in runtime folders (the planted one reading a font of the checkout with `cat`), then the seed was
deleted: its three tests passed, and a mutant whose app check runs unsandboxed failed the plant's test. That run is what
showed the sandbox controls hold (a read of the checkout refused, `nc` to a loopback listener refused at the connect)
and aren't vacuous (both succeed unconfined). The real app download was not built, so AC7 against it is unrun.
