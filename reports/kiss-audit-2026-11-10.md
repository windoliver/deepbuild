# KISS and modularity audit, 2026-11-10

Base: main at `1b264d21`. Asked for: audit package by package, apply KISS, hill-climb modularity and extensibility,
reduce lines, remove unnecessary tests, no regression.

There is little left to cut by machine. This is the ninth audit in four days, and six analyzers over all 36 packages
and 41 crates found no dead production code that an acceptance suite doesn't pin, no repeated or empty test, and no
boundary breach. The change is 21 files, +35 −355, of which 270 lines are three one-off scripts. Four checks are red
on main; none comes from this change, and one of them is one step closer to green.

## What was measured

Each analyzer ran over every package or crate. The scripts are not in the repo; the method is in the row.

| Question | Method | Result |
|---|---|---|
| Is production code reached by production? | The type checker resolves every identifier in `packages/**` (526 files). Reach starts at module-level code, then at names an acceptance suite, script or benchmark holds. | 13,049 declarations in 324 source files. None is unreached except two that only a package test called. 268 functions, methods and constants are reached only from a name an acceptance suite, a script or a benchmark holds (below). |
| Does an export have an importer? | Each exported name against every tracked code file. | 3 values no file imports (`CONTINUE_ROOM`, `memoryPressure`, `SHIPPED_RATE_CARD`) and one more the entry re-exports to nobody (`canonicalModel`). The other 50 are types of exported signatures. |
| Is an option set, an optional parameter passed? | The checker resolves each object literal's fields and each call's arguments. | One real hit: `memoryPressure(env)`, never passed. The rest read outside data through a cast. |
| Is code written twice? | Runs of identical lines, comments and blanks dropped. | Source: 176 lines in 19 runs of 6 or more. Package tests: 550 lines in 54 runs of 8 or more. Rust: 1,008 lines in 67 runs of 12 or more, of about 400,000 handwritten. |
| Is a Rust `pub` item used? | Each name against every tracked file. | 10 items named once, 64 lines: one removed, one a planted twin, three left with reasons (below), five in crates on the interfaces lane. |
| Does a test assert, and is it the only one? | Every `it` and `test` outside `tests/acceptance`: 236 files, 1,642 cases. | None without an assertion (eight assert through an imported helper). No body and no title appears twice. |
| Is the JavaScript free of unused names? | The checker with `checkJs` over 171 files in `scripts/`, `benchmarks/`, `tests/*.mjs` and the packages' `.mjs` files, which no lane compiles. | 9 unused names; 6 removed, 3 left (below). |
| Do the packages keep their boundaries? | The import graph from the checker's module resolution. | 0 runtime cycles, 0 package cycles, 0 undeclared edges, 0 imports past an entry, 0 unused workspace dependencies. 6 type-only cycles, one more than at #1909: `hub/src/list.ts` and `rows.ts`, from #1463. The hub entry loads 7 files and 1,212 lines, down from 50 and 8,366. |

## What changed

| Goal | Change | Proof |
|---|---|---|
| Extensibility: one name branch fewer | `hub/src/core.ts`: `threadOf` reads the facts' `daemon` through a new `manyThreads`, which `mcpHello` now shares. #1023 had added a second `session.agent === 'codex'` past the ratchet's count. | On the built hub the name test and the fact agree for all 12 names tried. `tests/agent-name-branches.test.mjs` no longer names `core.ts`. `hub/test/threads.test.ts`, `codex-hub.test.ts` and `tests/acceptance/322/github.test.ts`: 37 of 37 pass. |
| KISS: code only its own test called | `checks-journey`: `featuresWithoutJourney` is gone; its test line now reads `selectJourneys(...).withoutJourney`, the field production returns. `plantBlock`, a test helper, moved from `src/png.ts` into its one test. | 9 of 9 pass. With `withoutJourney` planted to return every changed feature, the edited case fails: `expected [ 'about', 'cart' ] to deeply equal [ 'about' ]`. |
| KISS: one reader of a recording | `hub/src/github-source.ts`: `recordedFetch` and `recordedGraphql` share `recorded`. | Old and new give the same answer in 60 of 60 cases over six recordings, a missing and a broken file included, and both re-read the file at each request. `322/github.test.ts` passes, as above. |
| KISS: no export or option nothing uses | `hub/src/heavy.ts` (`memoryPressure` loses its export and its parameter), `hub/src/context-fit.ts`, `readings/src/usage.ts`, `checks-review/src/models.ts` and its entry. | `tsc --noEmit` on the root config passes. No file names any of the four. |
| Lines: a dead public function | `crates/deep-codecs/src/mp4.rs`: `decoder_info`, 41 lines, had no caller. | `cargo check -p deep-codecs --all-targets` is clean, with no warning. `cargo test -p deep-codecs`: 21 pass and 1 fails, as on base (below). |
| Lines: scripts nothing names | `scripts/plans-proof.mjs`, `scripts/frame-fs-calls.mjs` and `scripts/frame-fs-calls/counter.c` are deleted, 270 lines. Each made one closed issue's evidence (#69, #1457), which stays in `docs/evidence/`. The owner left the call to this audit; it was one of #2143's questions. | No tracked file names any of them. `scripts/repo-rules.mjs` reports the same one failure as before (below), and `scripts/design-links.mjs` passes. |
| KISS: unused names in JavaScript | Five unused imports in `benchmarks/doctor.mjs`, `hub-sessions.mjs`, `wiki.mjs`, `scripts/app-inventory.mjs` and `main-watch.mjs`; one unused binding in `scripts/corpus.mjs`. | `node --check` on each. The scan now reports only the three left on purpose. |

No acceptance test, golden, contract, known-failure list or guarded script was touched. No test was removed: none
was found that asserts nothing or repeats another.

## Red on main, not from this change

None of these is in `scripts/known-failures.json`. The first belongs to open issues #1689 and #1891; the other three
are filed as #2171, #2172 and #2173.

1. **`tests/agent-name-branches.test.mjs` fails.** Main had three branches past the list; two remain, both at
   `hub/src/status.ts:145` (`row.agent !== 'claude-code' && row.agent !== 'claude'`, from #1296). No fact says where
   an agent's plan windows are read from, and `cursor` and `grok` share Claude Code's adapter, so no cap or fact can
   stand in today. It needs a fact, which is #1689's and #1891's subject.
2. **`tests/acceptance/323/review.test.ts` AC12 and AC13 fail** (#2171). The same two cases fail on a hub built from
   the base's sources, with the same message: a PR's unresolved review threads give no open item.
3. **`deep-codecs`' `export::tests::the_same_frames_give_the_same_h264_part` fails some runs of the crate's tests
   together** (#2172) and passes alone: two encodes of the same frames differ when other encoder tests run beside
   them. It failed two whole-crate runs before main was merged, one on base and one here, and passed the one after.
4. **`scripts/repo-rules.mjs` fails its `deps` lane** (#2173): `crates/deep-app/Cargo.toml` names `accesskit_macos`
   with no reason in `scripts/repo-rules.json`. Main at `579001dd` adds four more lines of the same kind, for `wat`
   and `wasmparser` in `tests/acceptance/544/wat` and `545/wat`.

## Left alone, with reasons

- **Code no production caller reaches**: 268 functions, methods and constants in `packages/*/src`; 129 are named
  only by an acceptance suite. Most are in `checks-journey` (50, 716 lines), the extension host's API (69, 710),
  `proof` (35, 335) and `gate` (12, 150). The suites are never edited, so they stay; #1982 holds the decision. The
  match is by name, so a few may have no user at all.
- **deep-app's rich table cells** (`with_rich`, `Rows::rich`): no caller, and #1477's scope names them.
- **Five dead `pub` items in crates on the interfaces lane** (`read_and_check_with`, `apply_lagged`, `unit_ev100`,
  `is_first_party`, `SPLINE_PIECES`): a public change to make on purpose, in #1908. `show_window` in deep-replica is
  named in `tests/acceptance/327/README.md`; `leaked_world` is #2009's planted twin; `PART_FIELDS` in
  deep-canvas-vector is one line, and its crate was not built here.
- **The two test reporters in `checks-command/runtime`** share 33 lines. They load inside the checked repo's own
  runner, and the only suite that covers them has failures on main, so the fold is not provable today.
- **`deep-codecs/src/apple.rs`** builds the same format description twice, about 22 lines. Folding it moves when
  platform objects are released, and no test decodes real media.
- **`hub/test/asleep.test.ts` and `background.test.ts`** each carry the socket client `test/hub.ts` exports.
  `background.test.ts` fails on main (#1890), so neither was edited.
- **Three unused names in JavaScript**: `scripts/throttle.mjs:144` is a guarded lane file;
  `checks-journey/runtime/driver.mjs:469` and `scripts/design-links.mjs:31` are parameters their callers fill by
  position.
- **Package tests**: each file's header names the wrong program it failed on. None is unnecessary by the rule in
  AGENTS.md.
- **The larger folds are already issues**: #1904 to #1908 (one GitHub client, rules written once, copies in the hub
  and the extension host, checks-journey's unread fields, Rust helpers), #1891 to #1896 and #1687.

## After merging main

Main was merged once at `579001dd`, 80 commits past the base, with no conflict. Each check below then ran once.

| Check | Result |
|---|---|
| `tsc --noEmit` on the root config | exit 0 |
| `scripts/proof.mjs guard` | PASS, 2 commits checked |
| `scripts/repo-rules.mjs` | fails as on main: the five `deps` lines above; every other lane passes |
| `tests/package-deps.test.mjs` | 2 of 2 pass |
| `tests/agent-name-branches.test.mjs` | fails as on main, on `status.ts:145` alone |
| `cargo check -p deep-codecs --all-targets` | clean, no warning |
| `cargo test -p deep-codecs --lib` | 22 of 22 pass |
| `checks-journey` `units` and `png`, hub `threads` and `codex-hub`, `322/github`, `323/review` | 49 of 51 pass; the two that fail are #2171's |
| The six edited JavaScript files under `checkJs` | no name unused or not found |

## Not run

`node scripts/affected.mjs`, the preflight, clippy, `cargo fmt`, and every acceptance suite but
`322/github.test.ts` and `323/review.test.ts`. No crate but `deep-codecs` was checked; `deep-hook` was built only
because the hub tests start it. The acceptance suite for memory pressure (#1015) was not run; `memoryPressure` lost
a parameter no caller passed.
