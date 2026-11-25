# Acceptance tests for #231, Oracle lane: an upstream renderer's law that holding still costs the same however long, run against our export

Written first, blind, from issue #231 (as saved on November 22, 2026), its oracle map (`issues/231.md` in the oracle
repository the issue's Oracle line links), the two upstream files that map pins, the #231 suite's surface
(`tests/acceptance/231/README.md`, written by the same job) and base commit `5fcfb690b`
(`5fcfb690ba6592ad567c303ecf67054dbcbdfc3c`), by a job that never saw an implementation of #231; none existed, and no
other worktree, branch or PR was read. #136's rule applies: a linked test counts only when run against our output, so
the upstream law's cases here read what `deep-show run`'s `export` answers. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criterion 1, the one criterion of ten the oracle map links an upstream test to. The map calls the rest of that
criterion ours (the 1,800-frame delivery and its fidelity, the exact counts of 1); those are the #231 suite's
`holds.test.ts`. Criteria 2 to 10 have no upstream test.

## Sources

| Criterion | Upstream, pinned | Files | Use | License |
|---|---|---|---|---|
| 1 | an upstream renderer at commit `cfd33af5aa7cc0d6aa7dfe13919744e2124629dc` | `tests/benchmarks/test_laws.py`, lines 536 to 555 (`test_holding_still_costs_the_same_however_long`), with what it reads of the same file: `SLACK` (line 54), `render` (65 to 73), `growth` (76 to 83) and `measured` (86 to 92); `tests/benchmarks/work.py`, the work counters it compares | port | MIT. No upstream code or data is copied into this folder, so nothing is vendored and no notice is carried |

| Upstream | What it holds | Our output |
|---|---|---|
| the scene: one object added, then a wait; any object of its catalogue that has nothing updating it | a held scene has no time reader | a film this suite makes (`helpers.ts` `holdFilm`): a ground and one still thing, a `rect@1`, a `circle@1` or a `path@1` in turn, with no channel, so nothing in view reads the time |
| the scene told at 10 frames a second, for 1 s and for a whole number of seconds from 2 to 30 | the two runs compared | the film at 10 fps, 1 s (10 frames) and each of 2 s to 30 s (20 to 300 frames), each delivered as H.264 with AAC by a fresh `deep-show run` |
| its work counters: calls, loops, points computed, bytes hashed, bytes uploaded, each compared | work, which is the same on every machine, where time is not | the reply's `work`, our export's own work counters, each compared: `draws`, `hashes`, `fidelity.draws`, `fidelity.hashes`, `frames_read_back`, `digests_read_back`, `digest_bytes_read_back` |
| `growth`: the longer run's count over the 1 s run's; a count both leave at 0 didn't grow, one only the longer run makes grew without bound | each count's growth | `judges.ts` `growth`, the same three cases |
| the assertion: the worst growth is at most 1 + `SLACK`, 1.1; its message names the seconds, the count and both readings | holding still costs the same however long | `judges.ts` `growthFailures`: at most 1.1 for every counter, the failure reading `held <n> s, <x>x the <counter> of 1 s: <a> → <b>` |
| its guard elsewhere in the file that a run counted some work | a law over no work proves nothing | each 1 s hold must count at least one draw and one hash |

Not ported: the file's other laws (growth with size, shared uploads, history, restating, remembered constructions),
which no criterion of #231 states; the upstream's random draw of 25 cases, in whose place every length from 2 to 30
runs; its run before the counted one, which our counters don't need, since each export is a fresh process and a cold
start's compiles are not among the work counters.

## Run them

Put Node 24.22 and the pinned Rust toolchain first on PATH. The file builds `deep-show` when its test first needs it,
with the command below, in the checkout, into `$CARGO_TARGET_DIR` or `target/`, and copies `debug/deep-show` out. With
`DEEP_231_BIN_DIR` set to a folder that holds `deep-show-full`, no cargo runs and that binary is used (the #231
suite's variable).

```sh
cargo build --locked --bin deep-show --no-default-features --features full
node node_modules/vitest/vitest.mjs run --root tests/acceptance/231-oracle --no-file-parallelism hold.test.ts  # AC1
node node_modules/typescript/bin/tsc -p tests/acceptance/231-oracle/tsconfig.json                             # type-check (exits 0)
```

The test has an hour (helpers.ts sets it). It makes 32 small exports (320 × 180), each in a fresh process: three 1 s
holds, one of each kind, and one hold of each length from 2 s to 30 s. Temp folders are removed after the test; no
process is stopped by name or port; nothing leaves the machine and no model is called. The judge is shown failing a
planted set, and passing its clean twin, when `helpers.ts` loads (`judges.ts` `proveJudges`), before a binary is
asked for. `lane.json` says the suite runs alone; it reads no clock, so `scripts/lanes.mjs` needs no line for it.

## Criteria to tests

| AC | ID | File | Test, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#231.ceba88e3` | hold.test.ts | 1: for each length from 2 s to 30 s, no work counter of the hold's delivery is over 1.1 times the 1 s hold's of the same kind, its delivery counting 10 frames a second; each 1 s hold counts a draw and a hash. Wrong program: the merge base, whose export draws and hashes every frame (a 30 s hold is 300 draws to the 1 s hold's 10) and whose reply holds no `work` |

1 test in 1 file.

## The surface under test

`deep-show run`'s `export` (the delivery form, as the #231 suite's README gives it) and, of its reply, `receipt.frames`
and **`work`**, the export's work counters, a name the #231 suite chose: `{"draws", "hashes", "fidelity": {"draws",
"hashes"}, "frames_read_back", "digests_read_back", "digest_bytes_read_back"}`, each a whole number. This suite adds
no name of its own, plants no program and needs no Cargo feature beyond `full`.

## Fixtures

Made at test time by `helpers.ts`; no personal data; licence CC0. A hold film is 320 × 180 at 10 fps: a ground, and
one still thing over it (a rect, a circle or a closed path), no channel, and a stereo tone (440 and 660 Hz) as long as
the film. The kinds take turns by length: 2 s a rect, 3 s a circle, 4 s a path, and so on.

## Legs that read BLOCKED or INCONCLUSIVE

BLOCKED, never a pass, when cargo can't run or the build fails, or `DEEP_231_BIN_DIR` lacks `deep-show-full`. The
counts hold on any machine, so no leg waits for a reference Mac. A port runs none of the upstream's code, so the lane
needs no upstream runner.

## Readings where the issue and the map leave a choice

- **Which counts.** The upstream counts its interpreter's work and its own hashing and uploads; none of those exist
  here. The law is the map's: "a held span costs the same work however long it lasts, counted by work counters rather
  than time". So every counter of ours is held to it, the readbacks among them.
- **The map's "draw, readback and hash".** The map says a held span costs one frame's draw, readback and hash; the
  criterion now says no frame is read back. Both hold under this test: a counter that stays at 0 didn't grow, and one
  that reads the same for 1 s and for 30 s didn't either.
- **A delivery, not a draft.** The upstream counts a whole render. A delivery counts export.fidelity's redraw too, so
  `fidelity.draws` and `fidelity.hashes` are under the law; a draft would leave them at 0.
- **10 frames a second** is the upstream harness's rate, kept as an input. The criterion's own 60 fps holds are the
  #231 suite's.
- **Every length, three kinds.** The upstream draws 25 pairs of an object and a length at random from its whole
  catalogue. Here all 29 lengths run, on three kinds of still item the base draws; the law's expected value doesn't
  depend on the kind.
- **The slack** is the upstream's 0.1, kept as its expected value. The #231 suite holds the same holds to exactly 1
  draw and 1 hash.
