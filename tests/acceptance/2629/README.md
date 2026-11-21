# Acceptance tests for #2629: packageDigest depends on the checkout's umask, a 664 file gives a different digest than git's 644

Written first, blind, from issue #2629 (its report, chosen fix and three acceptance criteria) as the brief quoted it,
the design and base commit `eb027b613` ("Merge pull request #2928 …", origin/main), by a job that never saw an
implementation; none existed, and no other branch, worktree, pull request or stash was read, nor the live issue. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2629.aee527ff` | `modes.test.ts` (2): packages/jobs/score and packages/jobs/import at 664/775 give their stamped digest, as at 644/755; a small package under seven other mode pairs gives its 644/755 digest |
| AC1 | `#2629.aee527ff` | `install.test.ts` (1): the extension host's installer takes a package stamped at 644 from 664 files, with the stamped digest |
| AC2 | `#2629.5fd60962` | `modes.test.ts` (2): setting a plain file's execute bit or clearing an executable's changes the digest, under umask 022 and 002; clearing packages/jobs/import's 755 file moves it off its stamped digest |
| AC3 | `#2629.9f639da0` | `stamped.test.ts` (1): each of 19 stamped packages, its files at 644/755 as git records them, gives the digest its deepbuild.json carries |

The ID is `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, whitespace collapsed, first 8 hex) over each
criterion's text as the brief gave it, after `- [ ] `; the live issue body wasn't read, so it isn't checked against
it. Every test's name starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: How we know version 0 works (Dogfooding).
- At the base: `packages/extension-host/src/digest.ts` (`packageDigest`: `stat.mode & 0o7777` in each file's line),
  `src/index.ts` (the public entry exporting it), `src/host.ts` (`admit`: the refusal "envelope digest … isn't its
  files' digest … so it isn't installed"; `checkNow`'s matching check), `scripts/guide.mjs` (stamps
  docs/extension-guide/{typescript,json-rpc}), `scripts/proof-change.mjs` (`criterionId`), the committed modes of the
  stamped packages (`git ls-tree`), suite `351/` (`helpers.ts`: world, host, `pkg`, `stamp`, `installError`; its
  `plain` fixture; `twins.json`), suite `154/helpers.ts` (how `deep install` is run) and suite `2564/` (layout).

## The surface under test

`packageDigest` through `@deepbuild/extension-host`'s public entry, `packages/extension-host/src/index.ts`, loaded by
Vitest from source (no build needed, no stale `dist`). For the user-visible effect, the extension host's install
(`ExtensionHost.install({ from, builtBy: null })`, what `deep install <folder>` runs in the hub), on a world of a real
record, asks core and supervisor, through #351's suite's helpers.

File modes are set with `chmod` on temp copies, never through this process's umask. A "checkout under umask X" is the
committed files of HEAD written by `git archive` and then chmod-ed per `git ls-tree`'s mode: 100644 → the umask's
plain mode, 100755 → its executable mode.

## Readings where the issue leaves a choice

- **"as git records it"**: git keeps the owner execute bit (S_IXUSR) only. So a file whose mode has 0o100 set is
  755, any other 644, whatever its group, other, read or write bits. Beyond the two umasks the criterion names, the
  small package is also tried at 600/700, 666/777, 640/750, 444/555, 644/744 and 654/711 (group execute without owner
  execute counts as 644): all are "755 when the owner execute bit is set and 644 otherwise". Setuid, setgid and
  sticky bits aren't tried (macOS refuses some on plain files to non-root); the criterion's rule covers them alike.
- **"one package checked out under umask 002 and under umask 022 gives the same digest"**: the issue's own packages,
  packages/jobs/score (12 files, all 644) and packages/jobs/import (one 755 file, `tool/lottie.wasm`, the 775 case),
  and the expected value is the digest their deepbuild.json carries: the issue's reproduction (score: stamped
  `d1:fd6d8bea…`, `d1:12d86c45…` at 664 on the base, as `BASE-FAILURE.txt` shows). Plus a small package of our own
  (a manifest, `index.ts`, `data/words.txt`, an executable `main`) for the other mode pairs.
- **The user-visible effect**: `deep install` needs a running hub; the installer's refusal is raised by the
  extension host's `install`, which the hub calls, so the test calls it on #351's world. The package is #351's
  `plain` fixture (a manifest and an `index.ts`), chmod-ed 644, stamped with `packageDigest`, then chmod-ed 664.
  Installing score itself was not tried (its install runs its tool's qualification, a heavier world, #154's).
- **"Setting or clearing a file's execute bit"**: `chmod` of one file between the umask's plain and executable modes
  (644↔755 under umask 022, 664↔775 under umask 002), each compared with the package's digest before, and the
  digest checked to come back when the bit is put back. A wrong fix that drops the mode entirely fails these.
- **"Digests already stamped in the repo"**: every committed `deepbuild.json` with a `digest` (`git grep`), less
  (a) the all-zero `d1:000…` placeholders test fixtures carry until a test stamps them, (b) the partial overlays
  under `tests/acceptance/220/twins/` (replacement files, not packages), and (c) `docs/extension-guide/plugin`, whose
  stamped digest doesn't match its files at the base under umask 022 either (see Not tested). That leaves 19
  packages, listed in `stamped.test.ts`: `contracts/fixtures/R1`, `docs/evidence/366/stocks/{claude-code,codex}/package`,
  `docs/extension-guide/{json-rpc,typescript}`, `packages/channels/{chat,email,paseo,text}`, `packages/checks/playtest`,
  `packages/jobs/{bakes,encode,foley,import,score,speech,typeset}`, `packages/sources/{gmail,linear}`. "Still match"
  is read as: each one's committed digest equals `packageDigest` of its committed files at 644/755. Three hold a 755
  file (`docs/extension-guide/json-rpc/main`, `packages/jobs/import/tool/lottie.wasm`,
  `packages/jobs/typeset/tool/typeset.wasm`), so a fix that hashes every file as 644 fails it.

## Base results

`BASE-FAILURE.txt` is the run at the base, whole, with the checkout's path replaced by `<repo>`, on macOS (arm64),
Node 24, umask 0022, under heavy load (~130). 6 tests: 3 fail, 3 pass, nothing BLOCKED.

- AC1 (3 tests) fails, for the issue's reason: score at 664 gives `d1:12d86c45…`, not its stamped `d1:fd6d8bea…`;
  the small package at 664/775 gives another digest than at 644/755; the installer refuses the package stamped at
  644 from its 664 files with "test/umask-install's envelope digest d1:bd4c1a57… isn't its files' digest
  d1:c5e0f1ca…: it changed since it was built, so it isn't installed".
- AC2 (2 tests) and AC3 (1 test) pass at the base, as expected: the base hashes the execute bit (with every other
  bit), and the stamped digests were made on 644/755 files. They guard the fix. Each fails on a planted wrong
  program, `twins/mode-ignored` (`twins.json`): `packageDigest` with every file's mode hashed as 644. On it, AC2's
  first test fails at "setting index.ts's execute bit changes the digest", its second at import's stamped digest
  (`d1:2938c2b2…` for `d1:8fb7886b…`), and AC3 lists 3 mismatches (the packages holding a 755 file).

That a right fix passes was checked once outside the suite, without editing the source: a scratch Vitest config
swapped `./digest.js` inside `packages/extension-host/src/` for a copy hashing `stat.mode & 0o100 ? 755 : 644`; all
6 tests passed. The same swap to the twin gave the 4 failures above (AC1's score/import test fails there too).

## Run them

With the repo's Node (24), on macOS or Linux, from the repo root:

```sh
npm ci                                   # once, if node_modules is missing
node node_modules/vitest/vitest.mjs run tests/acceptance/2629
node node_modules/typescript/bin/tsc -p tests/acceptance/2629/tsconfig.json
```

About 3 s. No build needed (the public entry is loaded from source). Temp folders are `/tmp/dh2629-*` and #351's
`/tmp/dh351-*`, removed after each file. No network, no process started or stopped, nothing outside the temp
folders written.

## Not tested, and noted separately

- `docs/extension-guide/plugin/deepbuild.json` carries `d1:64749e5b…`, which its committed files don't give at the
  base under umask 022 (nor on this checkout): stale since a later change to the folder, unrelated to the umask. It
  is left out of AC3; it is a separate finding, not this issue's.
- `node scripts/guide.mjs` restamping the two examples, and suites 139/154/162 on a umask 002 checkout: they follow
  from AC1 and AC3 and need the whole hub; not run here.
