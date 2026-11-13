# #306 criterion AC3 blind redraft, after #1958: a missing pack version's document opens with its instances kept and skipped

#306's AC3 says a document that names a pack version this build lacks "is refused with pack_missing, naming the pack and
the version, never drawn with another version, and a check that needs it is BLOCKED; the pack versions task later opens
such a document and keeps that pack's instances byte for byte". Its suite, `tests/acceptance/306/missing.test.ts`,
asserts the whole-document refusal. #1958 is that pack versions task, and its Scope says: "A version whose bytes are gone:
the document opens; each instance of it is kept byte for byte through other writers' patches and skipped when drawing
with pack_missing, naming the pack and the version; … a check that touches one is BLOCKED; nothing draws one with
another version; this replaces the whole-document refusal the pack format task describes (#306)". The refusal is then no
longer what a correct program does. The redraft keeps #306's scenario and every other half of AC3, and replaces only the
refusal with #1958's open.

Written from issue #306 (closed; AC3), issue #1958 (read live with `gh issue view`), the frozen `tests/acceptance/306/`
(README.md, helpers.ts, missing.test.ts, BASE-FAILURE.txt), #1958's own blind suite (`tests/acceptance/1958/`: README.md,
helpers.ts, missing.test.ts; tests, not an implementation; not in this checkout's HEAD, so read from its test-only commit
`5b04651c3` in this repository's objects, which adds `tests/acceptance/1958/` and nothing else), the design
(`docs/canvas-primitives.md`: Pack, Pack: retired and missing; `docs/technical-design.md`: Composition, "Documents that
age well", and Dogfooding; AGENTS.md, Proof), `tests/acceptance/1718-redraft-1720/REDRAFT.md` for form, and base
`eeb45a10a`, read only for how the surfaces are driven: `crates/deep-show/src/hub.rs` (`show`, `present`, `verdict`,
`refused_reply`), `verdict.rs` (`blocked_in_claim`), `shared.rs` (`read`), `crates/deep-canvas/src/show.rs` (`stamp`) and
`crates/deep-canvas/src/document/packs.rs` (`resolve`). I never read an implementation of #1958, any diff, branch, pull
request or other worktree.

## What #1958 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `306/missing.test.ts` › AC3 with 1.0.0 installed, a board naming test/chart@2.0.0 is refused naming the pack and 2.0.0, never drawn with 1.0.0, no revision current, its check BLOCKED | #306 AC3 | It asserts the refusal whole: outcome `refused`, no snapshot, no current revision, a `pack_missing` error. #1958: "the document opens; each instance of it is kept byte for byte … and skipped when drawing with pack_missing … this replaces the whole-document refusal". A correct program presents the board, and the original fails it at its first assertion | `306-redraft-1958/missing.test.ts` › AC3 with 1.0.0 installed, a board naming test/chart@2.0.0 opens, c1 kept and skipped with pack_missing naming the pack and 2.0.0, never drawn with 1.0.0, its check BLOCKED (redraft 1958) |
| `306/missing.test.ts` › AC3 with no pack installed, a board naming test/chart@1.0.0 is refused naming the pack and 1.0.0, and its check is BLOCKED | #306 AC3 | The same: the store lacks the version the board names, so a correct program opens it with c1 skipped | `306-redraft-1958/missing.test.ts` › AC3 with no pack installed, a board naming test/chart@1.0.0 opens, c1 kept and skipped with pack_missing naming the pack and 1.0.0, and its check is BLOCKED (redraft 1958) |

Each test keeps the original's scenario: the build without scene3d (`r1`); test/chart@1.0.0 installed and the board naming
test/chart@2.0.0, or no pack installed and the board naming test/chart@1.0.0; c1 `chart.bars@1` {n: 5}; the board shown
from your shell on DOC.a and its `deep show --check` on DOC.b. Two calls are added: the same board without c1 on DOC.c,
the reference for "skipped when drawing", and `read` of DOC.a, for "kept". The names are the originals' with the refusal
words replaced by the open's, and "(redraft 1958)" added, so that a name never says "refused" over a test that asserts
the board opens.

| Half of AC3 | In #306's test | In the redraft |
|---|---|---|
| Refused whole | outcome `refused`, no snapshot, no current revision | Replaced: outcome `presented` with no error; the snapshot is the same board's without c1, drawn in the same process (c1 skipped when drawing); `read` of DOC.a gives c1 as sent (kept byte for byte), which it can only do from a current revision |
| pack_missing, naming the pack and the version | an error among `issues` whose JSON names both | Kept: a `pack_missing` among the reply's `notices`, `issues` or `blocked` rows whose JSON names both, its `ids` exactly [c1] (#1958's notice `pack_missing {pack, version, ids}`) |
| Never drawn with another version | no snapshot at all | Kept: no `expansions` row for c1 (#306: every expansion has one, naming the version it went through), and the snapshot above |
| A check that needs it is BLOCKED | `deep show --check` from your shell, `result` BLOCKED; the first test also a pack_missing naming both on the check's reply | Kept as it was, with the check's pack_missing read where the open's is, and in the first test no expansion of c1 at the check either |

## Kept as they are

Every other test of `tests/acceptance/306/`: none of AC1, AC2, AC4, AC5, AC7 or AC8 opens a document naming a version the
store lacks. AC6's board names test/solid@1.0.0, which the pack check refused for a module the build lacks; it is refused
with `module_missing` (Canvas module: "A build without it refuses documents that need it with `module_missing`"), which
#1958 doesn't touch.

## Readings

- **The open is #1958's suite's surface** (its README, The missing version): presented with no error, `pack_missing`
  among `notices` (or `issues`, with nothing of severity `error`), its `ids` the pack's instances, no `expansions` row for
  them, and the snapshot of the document's other items alone. A `blocked` row is read too, since #1958 names the pack in
  one at a check; any of the three counts.
- **"The other items alone"**: #306's board has no other item, so the reference is the same board with c1 left out and
  `packs: []`, drawn on DOC.c in the same process. At the base it presents with one snapshot, the look's ground, and the
  board that draws c1 through the installed version gives another (BASE-FAILURE.txt).
- **"Kept byte for byte"** for a board sent by `deep show`: the hub adds the writer's `layer` to each item (`stamp`), so
  `read`'s c1 less `layer` is compared with c1 as sent, by canonical JSON; at the base an installed pack's c1 reads back
  that way. #306's scenario has one writer, so "through other writers' patches" is #1958's own suite's to read.
- **The check stays #306's**: `deep show --check` from your shell, no claim, as #306's README defines it ("of a document
  that needs a missing pack or module answers `result: "BLOCKED"`"). #1958's suite reads its check in a claim because at
  the base an unknown kind outside a claim stays a notice and its check can pass (`blocked_in_claim`). Nothing in #306,
  #1958 or the design narrows a missing pack's BLOCKED to a claim ("a check that touches one is BLOCKED"; AGENTS.md,
  invariant 2), and a whole-document check touches every item, so a program that keeps the missing pack a notice outside a
  claim and passes this check fails here, at `result`. The check's reply outcome isn't read: neither issue says whether a
  BLOCKED check's revision is presented.
- **"No revision current"** goes with the refusal. It isn't replaced by a `revisions` call: `read` of a document sent by
  `deep show` answers only from its current revision (`ref_unresolved` otherwise), so the read that shows c1 kept shows
  the board current.

## Wrong programs they still fail

- The base, #306's program: the board is refused whole. Both tests fail at "opens (presented)".
- A loader that draws c1 with the installed test/chart@1.0.0: an `expansions` row for c1 and a snapshot with the bars. The
  first test fails at "no expansion", and at the snapshot if the row is left out.
- An open that keeps the pack_missing as an error, names another version, or gives other `ids`: fails at "no error" or at
  the pack_missing assertion.
- An open that drops or rewrites c1 in the stored document: fails at "kept byte for byte".
- An open whose check passes, the missing pack treated as an unknown kind outside a claim: fails at `result` BLOCKED.

## On the base

`BASE-FAILURE.txt` is the one run at `eeb45a10a` (warm build, 3 s): 2 tests, 2 failed, each at its first assertion, the
open, where the base answers `refused` with a `pack_missing` error. By hand at the base: the board without c1 presents with
its own snapshot, an installed pack's c1 reads back as sent less `layer`, and the missing pack's check is BLOCKED already,
so the base fails only the half #1958 replaces. Not run: any implementation of #1958 (none exists here).

## Run it

```sh
npm ci                          # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/306-redraft-1958 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/306-redraft-1958/tsconfig.json
```

The file builds `deep-show` with `--features r1` through #306's `useBuilds` (imported unchanged, as are the scenario, the
calls and the reply readers; `helpers.ts` adds only the readers of #1958's open). A run with `--root` leaves Vitest's cache
in this folder's `node_modules/.vite`; delete it. `scripts/lanes.mjs` needs `'tests/acceptance/306-redraft-1958/'` in its
`alone` list, as `'tests/acceptance/306/'` is, since the file builds `deep-show`. That edit is the
implementer's, at the swap.

## At merge

The frozen `tests/acceptance/306/` stays as written. The owner's call is to swap its two AC3 tests in `missing.test.ts` for
the two here, and to keep its other tests as they stand.
