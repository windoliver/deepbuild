# Whole-project audit, 2026-11-09

Base: main at 06fd33cd. Asked for: read the whole project, find what is broken, inconsistent, inefficient or no
longer needed, and fix what is sure.

Thirteen readers each took one area and wrote findings with evidence; the lead ran main's own checks, re-read the
findings it acted on, and applied the fixes below. The per-area files are in
[`whole-project-audit-2026-11-09/`](whole-project-audit-2026-11-09/). They are the readers' own words: only the
findings listed under "Fixed" and "Checked by the lead" were re-read against the code by a second pair of eyes.

## Not everything was read

The readers could not split their areas further (the session's agent limit), so the large areas were read in part.
Each area file ends with a table of what was read in full, skimmed and not read. The biggest gaps:

- `packages/hub/src/core.ts`: about 1,900 of 7,879 lines (relay, the stall gate, Your rules, answers on the trusted
  path, the canvas tools).
- `packages/asks/src/index.ts`: about 1,800 of 2,544 lines; most of `checks-journey`.
- `crates/deep-gpu-layer`: nearly all of its 33,700 lines were searched, not read. Most of `deep-marks-render`.
- `crates/deep-show`: about a third read. `crates/deep-app`: about 17,000 lines not read. `crates/deep-replica`:
  about 9,000.
- `crates/deep-canvas-scene3d` mesh building and most of `deep-scene3d-render/src/lib.rs`.
- `docs/technical-design.md` and `docs/canvas-primitives.md`: checked by search, not read end to end.
- `tests/acceptance/`: structure only, by design. Most unit test bodies: names only.
- Speed and memory were not looked for again: PR #2051 (open) swept them today.

## Main's own checks, before and after

| Check (lint lane unless said) | On main | After this change |
|---|---|---|
| `tsc --noEmit` (typecheck lane) | 3 errors in 2 test files | passes |
| `cargo clippy --workspace --all-targets -- -D warnings` | fails: 123 sites in 17 crates' own code, 14 in blind tests | 0 in crate code; the 14 in blind tests remain |
| `scripts/repo-rules.mjs` | 126 FAIL lines: 66 dependencies with no reason, 2 crates with no card, 58 secret findings | passes |
| `cargo fmt --all -- --check` | 1,259 hunks | 1,258 (not reformatted, see below) |
| `scripts/canvas-lint.mjs` | 43 FAIL lines | unchanged |
| `scripts/vendor-rebase.mjs check` | 38 FAIL lines | unchanged |
| `scripts/conformance-lint.mjs` | 6 FAIL lines | unchanged |
| `scripts/slots-check.mjs` | 6 FAIL lines | unchanged |
| `scripts/canvas-closures.mjs drift` | 1 FAIL line | unchanged |
| `scripts/record-reader-guard.mjs` | 1 FAIL line | unchanged |
| `scripts/color-literal-guard.mjs` | 3 FAIL lines (known, #1623) | unchanged |

Clippy had been stopping at the first crate that failed, so each later crate's errors were hidden behind it. Run
with `--keep-going` to see them all.

## Fixed

Each line was checked by the lead. Nothing is committed.

**Typecheck.** `packages/extension-host/test/environment-handles.test.ts`: an unused import.
`packages/hub/test/people.test.ts`: a value read past an optional chain. Neither changes what the test asserts.

**Clippy, 123 sites.** All are rewrites that keep behavior: constant-size chunks as arrays, index loops as
iterators, a negated float comparison written out with its NaN case, type aliases, test modules moved to the end of
their file, dead parameters and one dead closure removed. Three are worth naming:

- `crates/deep-canvas/src/schedule/mod.rs`: `OpError.actual`, added today by #1732, grew the error past clippy's
  128-byte limit and failed 31 functions. It is boxed now.
- `crates/deep-canvas-input/src/track.rs`: the planted whole-track scan keeps `.last()` under an `allow` with its
  reason, because walking every entry is the plant (#308's lookup budget).
- `crates/deep-gpu-layer/src/liveview.rs`: `bind_source` and `scaled` are used only by the test meter and are now
  built only with it; the two `Kit` fields it reads carry an `allow` outside that feature.

**Repo rules.**

- 64 dependency reasons added to `scripts/repo-rules.json`, each taken from the manifest's own comment or the code
  that uses it, and `image` moved to the table `crates/deep-app/Cargo.toml` now declares it in.
- Cards written for `crates/deep-canvas-media` and `crates/deep-logic`.
- Personal home paths redacted to `~/` in 13 `BASE-FAILURE.txt` logs and `docs/evidence/1348/suite.txt` (27 places).
  These are saved outputs, not tests.
- 16 allow entries for placeholders that are plainly made up (a home under the user `you`, keys marked `FAKE`).

**Bugs, each with a test that failed first.**

- `crates/deep-canvas-cells/src/emulator.rs`: a cursor saved before the panel shrank was restored off the grid, and
  the next byte panicked (quit vim after making the panel smaller). `ESC[65535B`, `C` and `X` overflowed a `u16`.
- `packages/checks-review/src/diff.ts`: a removed line starting `-- ` was read as a file header, so later hunks of
  the file were lost. New `packages/checks-review/test/diff.test.ts`.
- `packages/config-eval/src/launcher.ts`: a judge's `"score": null` was read as a grade of 0.
- `packages/gate/src/mask.ts`: the masked-exit rule missed `|&`. The conformance kit's reference copy of the rule
  (`packages/conformance/src/slots/check-kind.ts:70`) still has the old pattern.

**No longer needed.** `has_bc` and `Surface::upscale_name` in `crates/deep-scene3d-render` (no caller anywhere),
and two `scripts/known-failures.json` lint entries for `crates/deep-text/src/worker.rs`, removed in #140.

**Text that disagreed with the code.** `README.md` (what `npm run build` builds; the preflight's lanes and its
15-minute budget), the cards of `deep-scene3d-render`, `deep-hook`, `deep-contracts`, `gate`, `checks-numbers` and
`budget`, four comments in `crates/deep-canvas/src/registry` and `document/check.rs`, the evidence store's refusal
text (it takes webm too), and `scripts/motion.mjs`'s blocked line, which the lanes read as FAIL.

**Proof run.** Workspace clippy; `tsc --noEmit`; repo rules; unit tests of the 18 Rust crates touched (all pass);
`diff.test.ts`, `launcher.test.ts`, the gate's `floor` and `claim` tests, and the one `regressions.test.ts` case
that holds the new line. Not run: `node scripts/affected.mjs`, the acceptance suites, preflight, and the
interfaces lane (`cargo-semver-checks` is not installed on this Mac).

## Second pass: bugs fixed test first

The owner then asked for every bug held with confidence to be fixed. Six fixers took disjoint areas. Each fix has a
test that was seen to fail for the finding's reason before the fix and pass after it. The lead read every source
change and re-ran the tests: 661 Rust tests in the 14 touched crates and 242 TypeScript tests in 26 files pass.

**Hub (`packages/hub`).**

- `staging.ts`: a copy that succeeds late no longer erases another copy's failure, so a discard with a file that
  can't be copied is no longer staged (HUBREST-2).
- `core.ts`: a one-core host has one check slot, as the lease table has (HUB-CORE-2).
- `agents.ts`, `runs.ts`, `acceptance.ts`: four detached promises now catch and say what wasn't recorded
  (HUBREST-A4, -B3).
- `numbers.ts`: the first fold of a record of about 490,000 rows or more no longer throws (HUBREST-B1).
- `setup.ts`: a second setup after deep-hook moved keeps your status line as yours (HUBREST-1).
- `promises.ts`: "in 30s" sets its wake-up; "look at 3 files" sets none (HUBREST-9).
- `holds.ts`: a redirection, a comment or a line continuation is not read as the push's remote (HUBREST-A7).

**Other packages.**

- `supervisor/src/egress.ts`: a credential holding `$` patterns reaches its host byte for byte (ts-small-a-18).
- `supervisor/src/supervisor.ts`: a cleanup that threw runs again when asked (ts-small-a-19).
- `leases`: a hook-written `session.end` ends its session's leases, and a session that starts again is not ended
  (ts-small-b-2, -3).
- Nothing run no longer reads as passed: `conformance` gate run on an empty corpus and the state-source kit on a
  fixture with no change, `checks-review` on a rubric with no rule, `checks-work` on a floor lacking a number,
  `proof` on a Kani harness that printed no check (TSP-9, TSP-8, ts-small-a-9, -10, ts-small-b-1).
- `extension-host`: two store puts under way together can't both pass the quota; two stream reads at once keep
  both cursors; a library file's size is its bytes, not its base64 length; a cron line for a date that never
  comes is refused (HOST-2, HOST-8, TSP-6, TSP-16).
- `gate/src/checkouts.ts`, `checks-command`, `env-local/src/warm.ts`: what a crash or a failed start left behind
  is removed (ts-small-a-4, -5, -21, -25).

**deep-hook and deep-relay.**

- `matcher.rs`: an option's value is not read as the subcommand, for aws, docker, docker-compose and gh
  (RUST-APP-2).
- `shell.rs`: a command nested deeper than 64 levels of syntax is denied as unread instead of overflowing the
  stack (RUST-APP-1).
- `deep-relay/src/macos.rs`: a relay URL with no port is opened on 443 (RUST-APP-7).

**Canvas crates.**

- `deep-logic`: a logic item's write and read regions are sized without wrapping and refused past the largest
  memory; a tour with no period plays once instead of looping (canvas-core-1, -6).
- `deep-canvas`: a recipe's `sum` ends at 2^53; an expression past 1,024 tokens or 64 levels is refused instead
  of overflowing the stack; `one_track` counts each hash once; a control or time remap that is not an object is
  refused (canvas-core-2, -5, -26, -10).
- `deep-canvas-input`, `deep-canvas-motion`: a range or limits written high to low is refused instead of
  panicking (canvas-core-18, RCM-3, RCM-4).
- `deep-canvas-marks`: a negative computed count, an empty windowed series, a log scale reaching 0, periods over
  no rows and a negative box size no longer panic or hang (RCM-5, P1-1, P1-2, P1-3, RCM-8).
- `deep-canvas-sheet`: placement sums sizes in u64 (RCM-6). `deep-canvas-media`: a reference distance of 0 gives
  a gain of 0, not NaN (RCM-10).

**Codecs, deep-show, 3D.**

- `deep-codecs`: the mp4 probe no longer panics on a 64-bit box size or crafted table values, and no longer
  loops on run counts past the last sample; the table probe checks key uniqueness in one pass (RUST-GPU-1, -2,
  -4, -5).
- `deep-show`: `batch` checks a column's length without overflow; a stdin line that is not UTF-8 is answered
  `bad_input` instead of ending the program; a PTY master closes on exec; an unreadable golden store refuses
  `record` and `decide` instead of being overwritten (SHOW-5, -4, -1, -8).
- 3D: `half()` keeps small values and stops at the largest finite half; a glTF byte stride under its element is
  refused (RUST3D-7, RUST3D-5).
- `scripts/motion.mjs`: with no `deep-drive` built it prints its BLOCKED line instead of crashing.

**Choices made in these fixes that the owner may want different.**

- "at N" followed by a word ("at 9 and report back") now sets no wake-up; only a bare "at 9", or one with
  minutes or am/pm, does.
- deep-hook's syntax bound is a new private 64, not the existing `DEPTH` of 12, and the denial text still says
  12.
- The expression bounds (1,024 tokens, 64 levels) and the 64 MiB write bound are picked values.
- A log scale through a bar or area with no written domain is refused `out_of_range` at the scale, where it was
  `bad_encode` at the set.
- New refusal codes `store_unreadable` and `store_unwritable` on the golden store.

**Skipped, with the reason.** A non-finite recipe result as an error (a design choice; backed out), `Budget::of`
casts (design choice), an unreadable `budget` (two blind suites name a class that does not exist), nested SVG
groups (the overflow is in the XML parser), the joined hub's cut spool line and the app's Needs you drift (no
small test, and a design choice), the 512 MiB library cap, the reading chain's detached promise, the golden
store's in-place write, and the Linux sandbox helper (cannot be tested on this Mac).

## Third pass: the open choices taken and the gaps closed

The owner then said: take what the lead recommends on each choice, and close the gaps. This section replaces the
two paragraphs above ("Choices made" and "Skipped"). Four fixers and the lead worked test first, as before. The
Linux sandbox helper was tested inside two Linux virtual machines (Ubuntu and Fedora).

**The choices, as taken.**

- "at 9 and report back" sets its wake-up again. A number before a word sets none ("look at 3 files"), unless
  the word joins a clause or is about the clock (`and`, `then`, `so`, `but`, `o'clock`, `sharp`, `today`).
- deep-hook's denial now names both bounds: 12 shells, substitutions or evals deep, or 64 levels of syntax.
- The expression's 64 levels and the logic item's 64 MiB are the design's own numbers
  (`docs/canvas-primitives.md`: Parsing caps nesting at 64 levels; a logic memory of at most 64 MiB). The 1,024
  token bound stays a picked value: the design states none.
- The log scale's `out_of_range` and the golden store's two new refusal codes stay. No page lists the store's
  refusal codes, so there was nothing to bring up to date.

**Fixed in this pass.**

- `hub/src/core.ts`: a claim whose checks could not start gets an `INCONCLUSIVE` verdict that says why, where it
  got none and waited forever (HUB-CORE-1).
- `hub/src/wiki-build.ts`: the reading chain's detached promise catches and says what wasn't recorded
  (HUBREST-B2). `hub/src/hookmap.ts`: an MCP tool call keeps its tool's name (DOCS-DATA-7).
- `checks-command`: a pytest file whose every test the source skips ran nothing, where it passed
  (ts-small-a-1).
- `conformance`: the check-kind kit's reference mask pattern reads `|&` as the gate does.
- `extension-host/src/sources.ts`: a library file is read up to 380 MiB, where a file between 384 and 512 MiB
  was read whole and then failed to encode (TSP-4).
- `deep-hook/src/remote.rs`: a cut line in the spool no longer holds back every request after it
  (RUST-APP-3). `deep-app/src/record.rs`: only the core's `ask.later` moves an ask to Later (RUST-APP-13).
- Linux sandbox helper (`supervisor/native/helper-linux.c`): `O_TMPFILE` opens count as writes; the agents'
  own settings files (`.claude`, `.codex`, `.mcp.json`, `.claude.json`) can't be written from inside; a TCP
  fast-open send, which carries data before any connect is checked, is refused (ts-small-a-14, -20, -15).
- `deep-canvas`: a recipe result that is not a finite number is an error, not a null; a `budget.lights` that
  is negative, fractional or a string is refused `out_of_range` (canvas-core-16, -11).
- `deep-sandbox-wasmtime`: a stack budget stays under the native stack and a memory budget inside a 32-bit
  memory, where a large number wrapped or overflowed (canvas-core-4).
- `deep-canvas-vector`: an SVG whose elements nest past 64 levels, in its text or through `<use>`s, is refused
  before it is parsed, and a mask that deep is left unread. It aborted the process before (RCM-7).
- `deep-show`: the golden store is written to a temporary file and renamed, so a reader never sees it cut
  short (SHOW-8). A kit call that matched no module, or a module none of whose parts ran, is `INVALID`, not
  `PASS`; a run over some parts only writes no ledger (SHOW-10).

**What these change for someone who relied on the old behavior.**

- A library file between 380 and 384 MiB was read before and is refused now.
- An SVG nested 65 to about 130 levels deep imported before and is refused now. No SVG in the repo nests past 5.
- A kit run with `parts` over every module answers `INVALID` overall when some module has none of those parts,
  and it no longer writes a ledger.

**Still skipped, with the reason.**

- `deep-codecs` `serve_live` sum (RUST-GPU-5): it sits behind the sandbox and a live decoder; no unit test
  reaches it.
- An unreadable `budget`: blind suites 392 and 629 name a class that does not exist.
- The app showing an ask again after Later, and a spool line the hub refuses (the other halves of RUST-APP-13
  and -3): design choices.
- The committed pytest case can't run on this Mac: the check refuses a virtual environment's `python3`, and no
  other Python here has pytest. It was seen failing and passing through a temporary probe that carried pytest
  beside the test.

**Acceptance suites run once on the finished tree.**

| Suite | Result | Our change? |
|---|---|---|
| 1294, 1328, 19 `authority`, 304 `classes`, 393, 446, 498 `decode` and `gate` | all pass | |
| 306, 397 | pass, 1 skipped each | |
| 498 `capture` | 7 pass, 1 `INCONCLUSIVE` (needs a person and a camera) | no |
| 398, 1175 (SVG import) | 80 pass, 3 fail | no: 2 are `BLOCKED` (the pinned Chrome is not installed); the third, a pattern fill against Chrome's picture, fails with the same numbers on a clean main |
| 1156 `fast` | 6 fail | no: the same 6 fail on a clean main, run beside it |
| 19 `watchonly` AC6 | fails | no: fails on a clean main |
| `checks-command` `regressions`, node:test case | fails | no: fails on a clean main |
| 138 | 85 pass, 6 fail, 7 skipped | no, by reading: `budgets.json` against the merge base, a category list, and module `input` with no fixtures |
| 402 | 31 pass, 8 fail | no, by reading: 3 need a reference Mac, 1 `budgets.json`, 4 first drafts whose redrafts pass |
| 420 | 31 pass, 3 fail | no, by reading: sweeps missing for newer light and material params |
| 238 | 5 pass, 21 blocked | not judged: its assembler, a Docker image and the merge-base build are missing, so no sandbox code ran |
| 1097 | 6 pass, 2 fail | no: the two merge-base controls, red on main |
| 19 `budgets`, `doctor`; 30 `record` | fail | no, by reading: `budgets.json`, `deep-gpu` not built, pytest and go not installed |

"By reading" means the failing assertion was read against the diff; the suite was not run on a clean main.

**Proof run at the end.** `tsc --noEmit` exit 0; `scripts/repo-rules.mjs` exit 0; workspace clippy clean in
crate code (the 14 sites in blind tests 1141, 995 and 327 remain); `cargo fmt --check` at 1,258 hunks, main's
1,259; PR #2051's patch still applies on this tree for the 11 files both change.

## Issues filed for what is left

After the third pass, seven readers checked every finding again against the merged code, each trying to refute
it. Of 304 entries in the area files: 138 held, 84 were already fixed, 37 turn on intent, 10 are covered by an open
issue, 14 are a second copy of a finding in the same file, 17 are true with no effect, and 4 were wrong.

The ones that held are filed in groups a single change can close. They were read from the code, not reproduced,
unless the issue says so.

| Issue | Title | Holds |
|---|---|---|
| #2118 | Claims and checks in the hub: a check that never started, a carried failure and a Closes check each end in the right verdict | 8 findings |
| #2119 | Setup and doctor keep what a running session wrote, and name the home and program they really use | 4 findings |
| #2120 | Push holds, starts and runs: a forced push, an armed merge with no number and two starts at once are each held to their rule | 8 findings |
| #2121 | Agents sync, skill updates and their undo leave your files as the plan said | 9 findings |
| #2122 | Products, heavy leases, the canvas core and waits: five cases the hub gets wrong after a restart or a failure | 5 findings |
| #2123 | Wiki builds, channel sends, library fetches, review threads and disputes each finish or say why not | 6 findings |
| #2124 | No package takes another plug-in's names through replaces, and the published API, the help text and the facts reader match the code | 4 findings |
| #2125 | The extension host: series windows, schedules, work deliveries and project enters behave after a restart, a failure or a second registration | 8 findings |
| #2126 | A child that exits before it reads its input fails its call and never takes the hub or an eval down | 3 findings |
| #2127 | The Linux sandbox: what it checked is what runs, an x32 call meets the filter, a run listens only where granted, and git steps are not granted `/` | 4 findings |
| #2128 | GitHub delivery: a verdict after a restart finds its commit, one failing compare does not block a repo, and a failed read never refuses a status | 3 findings |
| #2129 | Asks targets, the runner, env-local, budget, the session plug-in, the Lean comparator and evidence: eight defects in the small packages | 8 findings |
| #2130 | Document check and registry: a patch to a budgeted document takes the whole check, and the seal refuses what it can't digest or sees twice | 7 findings |
| #2131 | Recipes: a step that names a recipe, a false condition, a break-out and an `at` with no `pos` each expand or refuse as the design says | 8 findings |
| #2132 | Logic items: determinism never passes a time it did not seek to, and a tour with a period under a step does not hang the bake | 3 findings |
| #2133 | deep-show: a terminal whose host ended, a pack file outside its folder, the GPU lease and a video item's frame | 6 findings |
| #2134 | deep-hook: a standing rule for one cloud account covers only that account, and an option's value is never read as the subcommand | 2 findings |
| #2135 | The app and the relay: an ask whose Later ended is back in Needs you, two packages' views keep their own panels, and a relay check that never ran is not passed | 3 findings |
| #2136 | Proof lanes: the unit lane runs no by-hand or fixture test, and a runner that exits non-zero is never passed | 6 findings |
| #2137 | The interface lane, the closure lint, the loop facts and planted programs in shipped TypeScript | 4 findings |
| #2138 | Mark sets: the numbers check holds text marks to the row limit, a too-wide series is refused before it is sized, and a dashed line keeps the dash limit | 8 findings |
| #2139 | A seek in a mix with no processors, the effects reference interpreter's mip chain and deep-motion's README | 3 findings |
| #2140 | Codecs and video: sums over a movie file's numbers never overflow, the encode job reads one frame at a time, and a failed AAC decode is an error | 5 findings |
| #2141 | The structural steps' test never passes with nothing run, a table hash that is not 64 hex digits is refused, and the glyph atlas keys a variable font's coordinates | 3 findings |
| #2142 | 3D scenes: the frame fast path moves everything that reads t, a proxy's hash reads its ratio and error, and tangents give one bitangent sign | 7 findings |
| #2143 | Owner calls from the Nov 9 audit: 37 questions where the design is silent or says two things | 37 questions |
| #2144 | The canvas lint passes on main: 30 findings no known-failures entry records | a lane red on main |
| #2145 | The carried-patch check passes on main: 18 hunks in the vendored UI crates have no row, no mark or pass their budget | a lane red on main |
| #2146 | Every verdict and doctor code maps to a verdict, and doctor.item@1's frozen digest matches its schema: the conformance lint passes on main | a lane red on main |
| #2147 | The slot check passes on main: the library source slot has a kit, and the channel kit's reference fill is judged with its answers awaited | a lane red on main |
| #2148 | The closure drift check and the record reader guard pass on main: Map projections has its closure list, and the app reads the record through its one reader | a lane red on main |
| #2149 | cargo fmt --all --check passes on main | a lane red on main |

Covered by issues that were already open: #2075, #1853, #281, #1823, #2044, and with a comment adding the
missing case, #1847, #1624, #47 and #230. #2086 (clippy) has a comment saying what this change leaves.

## Left alone on purpose

- **`cargo fmt`.** 1,258 hunks across the crates. One command fixes it (`cargo fmt --all`), and it will conflict
  with every open pull request that touches Rust. Best run right after the open ones land.
- **Clippy inside blind tests.** `tests/acceptance/1141/app/{bulk,environment}.rs` (4), `995/app/panel.rs` (1),
  `327/*` (9, already in `known-failures.json`). They need a blind redraft or a recorded lint entry.
- **`unit_ev100`** in `crates/deep-canvas-scene3d/src/look.rs`: no caller, but the crate is on the interfaces
  lane's list, so its removal is a public change to make on purpose.
- **Guarded files.** Findings in `scripts/lanes.mjs`, `affected.mjs` and `proof*.mjs` need a signed approval tag.
- **Every bug below that the second pass did not take.** Each needs a failing test first (AGENTS.md); the fixes
  are written out in the area files.

## Open findings, worst first

290 findings: 189 broken, 85 inconsistent, 9 unneeded, 7 inefficient. By the readers' own confidence: 85 sure,
153 likely, 52 questions. These are the ones to look at first.

Items the second pass fixed are still listed here as the readers wrote them.

### Checked by the lead against the code

1. **A discard can run as "staged" with one file never copied.** `packages/hub/src/staging.ts:138`.
   `why ??= await …` reads `why` before the await and assigns after it, so a copy that succeeds late overwrites
   another copier's failure with `undefined`. `git checkout -- .` then runs with no copy of that file. Fix:
   take the result into a local, then `why ??= failed`. (02-hub-rest, HUBREST-2)
2. **On a one-core host no check ever starts.** `packages/hub/src/core.ts:819` gives
   `Math.floor(CORES / 2)` slots, 0 on one core; `packages/leases/src/index.ts:434` declares
   `Math.max(1, …)`. Fix: the same `Math.max(1, …)` in the core. (01-hub-core, HUB-CORE-2)
3. **A second `deep setup` after deep-hook moved saves our own status line forwarder as "yours".**
   `packages/hub/src/setup.ts:250-259` compares the command with the new path only, so the old path is kept as
   your status line. The reader traced what follows (yours is lost, deep-hook runs itself); the lead checked the
   save. (02-hub-rest, HUBREST-1)
4. **The preflight's slot check and conformance lint fail on main.** The `deep.registerSource, library` row
   ships with no kit, `service_unpromoted` has no verdict mapping, and `channel@1`'s kit reads BLOCKED on its own
   reference fill. Seen in this run; the reader traces the first two to #1731 and #1334, merged today.
   (03, TSP-7, TSP-2)
5. **A motion run with no `deep-drive` binary crashes** on an unhandled spawn error instead of printing its
   BLOCKED line (`scripts/motion.mjs:12`). Seen in this run.

### From the readers, not re-checked

Runtime safety:

- deep-hook: an option's value is read as the subcommand, so `aws --profile p kms create-key` and
  `docker compose -f x.yml up` miss their guard entries; unbounded recursion in the shell reader can overflow
  its stack, and the call then runs unguarded. (11, RUST-APP-2, RUST-APP-1)
- Egress filter: a credential holding `$$`, `$&` or `` $` `` is corrupted by string `replace`
  (`packages/supervisor/src/egress.ts:187`; fix: a function replacer). (04, ts-small-a-18)
- Linux sandbox helper: `O_TMPFILE` in the write mask refuses every directory open outside a write grant; TCP
  Fast Open opens a connection the egress rule never sees; no deny rule for the agents' hook and MCP files.
  Read from the C only. (04, ts-small-a-14, -15, -20)
- Five detached promises in the hub have no catch (`agents.ts:733`, `runs.ts:414,428`, `wiki-build.ts:551`,
  `acceptance.ts:270`): a failed append is an unhandled rejection. (02, HUBREST-A4, -B2, -B3)
- A claim whose snapshot or checkout fails for any cause but the budget gets no verdict. (01, HUB-CORE-1)
- A hook-written `session.end` ends no lease: its holder is built as `session:<raw id>`, which no lease's holder
  equals (`packages/leases/src/index.ts:214`). (05, ts-small-b-2)

A check that can pass with nothing run (invariant 2):

- A pytest run whose tests are all skipped or xfailed ends `passed`. (04, ts-small-a-1)
- A review against a rubric page with no readable rule always passes. (04, ts-small-a-9)
- `deep-conformance gate run` on an empty corpus prints `PASS gate@1: 0 cases`. (03, TSP-9)
- state-source@1's kit passes a fixture that offers no change. (03, TSP-8)
- A Kani harness whose checker printed no `Check N:` line reads `passed`. (05, ts-small-b-1)
- `scripts/affected.mjs` never reads a test job's exit status; `canvas-closures.mjs` and `gpu-validation.mjs`
  pass on zero inputs; the unit lane runs 20 by-hand files and 185 acceptance `.test.mjs` files are in no lane.
  (12, SCRIPTS-5, -10, -1, -3)
- `deep-show kit` with `parts: []` or a misspelt module answers PASS. (10, SHOW-10)

Input from a file or the wire that panics or hangs:

- mp4 probe: a 64-bit box size panics, and `stts`/`ctts` run counts from the file loop to the full u32, which
  hangs the decode worker and the app waiting on it. (08, RUST-GPU-1, -2)
- Documents: `clamp` with `min > max` panics in four places (a `limits` modifier, a control's `range`, a
  computed mark set, an outline box); an empty `series@1` with a window panics; a log scale whose domain
  reaches 0 loops about two billion times. (07, RCM-3 to RCM-5, P1-1, P1-2)
- Logic: an item's `writes.count` is multiplied in u32 unchecked, so a release build wraps the region size and
  the check passes; `sum(k, a, b, term)` never ends once `a` reaches 2^53. (06, canvas-core-1, -2)
- `deep-show serve` opens PTY masters without close-on-exec; an unreadable golden store reads as empty and the
  next `record` overwrites it. (10, SHOW-1, SHOW-8)
- A relay URL with no port can never be opened, though the README sets the relay up on 443. (11, RUST-APP-7)

Wrong pictures:

- The 3D frame fast path rewrites only solids and the camera, so a look's print grain, a moving puff and water
  freeze at t = 0 in the live view; a proxy mesh's hash leaves out its ratio and error. (09, RUST3D-1, -2)
- The bitangent's sign differs between unit meshes, so a normal map's green flips between shapes. (09, RUST3D-3)
- The glyph atlas drops variable-font coordinates, so small text at other weights draws at the default. (08,
  RUST-GPU-13)

Docs and data:

- Codex MCP calls are classed under the full `mcp__server__tool` name, so `delete_*` tools count as `change`.
  (13, DOCS-DATA-7)
- `adapters/loops.facts.json` stops at Codex 0.163 while `codex.facts.json` covers 0.166. (13, DOCS-DATA-1)
- The design says Ajv validates contracts and `node:sqlite` waits; no package uses Ajv and three import
  `node:sqlite`. It also says a plant is never chosen by an environment variable. Both are rows under
  Decisions, which only the owner changes. (13, DOCS-DATA-3, -9)
- `.deepbuild/approvers` is on no ref, so no `deep/approved/` tag can be read. (13, DOCS-DATA-10)

## Counts by area

| File | Area | Sure | Likely | Question |
|---|---|---|---|---|
| 01-hub-core | `packages/hub`: core, server, gate runner | 1 | 6 | 4 |
| 02-hub-rest | the rest of `packages/hub` | 9 | 29 | 10 |
| 03-contracts-conformance-host | contracts, conformance, extension host, CLI | 11 | 15 | 4 |
| 04-ts-packages-a | asks, record, gate, checks, supervisor, runner, env-local | 10 | 14 | 3 |
| 05-ts-packages-b | evidence, verdicts, leases, github, budget and 14 more | 4 | 10 | 3 |
| 06-canvas-core | deep-canvas, sandbox, logic, graph, input | 9 | 25 | 8 |
| 07-canvas-modules | marks, motion, effects, cells, media, sheet | 12 | 15 | 2 |
| 08-gpu-text-codecs | GPU layer, renderers, text, codecs | 7 | 6 | 3 |
| 09-scene3d | the two 3D crates | 4 | 6 | 2 |
| 10-deep-show | deep-show | 4 | 7 | 1 |
| 11-app-hook-relay | app, replica, hook, relay, workspace files | 6 | 9 | 1 |
| 12-scripts-tests | scripts, benchmarks, test setup | 5 | 7 | 7 |
| 13-docs-adapters-packs | docs, adapters, packs, spikes, vendor | 3 | 4 | 4 |

Some of the readers' "sure" findings are fixed above and are still listed in their files as written.
