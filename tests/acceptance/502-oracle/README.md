# Acceptance tests for #502, Oracle lane: libebur128's loudness tests and FFmpeg's subtitle recipes run against our export

Written first, blind, from issue #502 (`gh issue view 502 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/502.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the upstream files that page
pins (read from that branch's `doneright/oracles/vendor/`), the #502 suite's surface and fixture
(`tests/acceptance/502/README.md`, `helpers.ts` and `fixtures/film.json`, written by the same job) and base commit
`c072ff92d`, by a job that never saw an implementation of #502; none existed, and no other worktree, branch or PR was
read. #136's rule applies: a linked test counts only when run against our output, so every upstream case here is
asserted against what `deep-show run`'s `export` answers or writes. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criteria 7, 8 and 10, the three the Oracle page links an upstream test to. The other eight have no upstream
test (the page's "No upstream test" table) and stay with `tests/acceptance/502/`, as do these three criteria's parts
the page calls ours: the 12 LU fixture mix, the idle limiter, the 0.1 LU band and the planted normalizer (7); writing
the PCM export and its receipt (8); frame times at 24000/1001 rounded down to the millisecond and the planted 24 fps
writer (10).

## Sources

| Criterion | Upstream, pinned | Files | Use | License |
|---|---|---|---|---|
| 7 | libebur128 `67b33abe1558160ed76ada1322329b0e9e058b02` | `test/tests.c` lines 252-255 (`lra[]`) and 312-327 (`TEST_LRA` and the six files it names) | port | MIT (`COPYING`, Jan Kokemüller 2011), its notice kept in `ebur128.test.ts` |
| 8 | libebur128, the same commit | `test/tests.c` lines 246-284 (`gr[]`, `TEST_GLOBAL_LOUDNESS` and the nine files it names) | port | MIT, the same notice |
| 7, 8 | EBU loudness test set v05 (30 March 2016) | the signal files the macros name, from #500's cache (`tests/acceptance/500/bake/README.md`: The EBU signals) | test data | the set's readme: provided as is, "may only be used for technical testing purposes"; never copied into the repository |
| 10 | FFmpeg `24e860f6d3c4f2ebae65ed7649e2a8860d512879` | `tests/fate/subtitles.mak` (the recipes `fate-sub-srt`, `fate-sub-webvtt`, `fate-sub-srt-madness-timeshift`), `tests/fate-run.sh` (`fmtstdout`), and `tests/ref/fate/sub-srt`, `sub-webvtt`, `sub-srt-madness-timeshift` (what each reference holds a cue to) | run on our code; port | LGPL-2.1-or-later; nothing of it is copied: the lane runs three command lines with an installed `ffmpeg`, a separate program |

No upstream code or reference output is copied. Each libebur128 macro's reading is re-expressed against the export's
receipt, with its files, expected values and tolerances written in `ebur128.test.ts` beside the line each comes from.
Each FATE recipe's command line is run as `fmtstdout` builds it, with our sidecar where FATE names its sample, and the
comparison FATE makes against its reference is ported: every cue FFmpeg reads is held to the fixture file's caption.

| Upstream | Cases | Expected (upstream) | Our output |
|---|---|---|---|
| `TEST_GLOBAL_LOUDNESS` (tests.c 266-284) | 7 files: 3341-1 (criterion 8's case), -2, -3, -4, -5, -7, -8 | `gr[]`: −23, −33, then −23; ±0.1 | the receipt's `integrated` and `delivery.integrated` of a PCM export whose master is the file |
| `TEST_LRA` (tests.c 312-327) | 6 files: 3342-1 to -4, 3341-7 (3342-5), 3341-8 (3342-6) | `lra[]`: 10, 5, 20, 15, 5, 15; ±1 | the receipt's `lra` and `delivery.lra` of the same kind of export |
| `fate-sub-srt` | `fmtstdout ass -i <file>.srt` | every Dialogue's start, end and text equal the reference's (centiseconds) | our `film.srt`: four Dialogues, each caption's lines joined by `\N`, each time within one centisecond of the fixture's millisecond time |
| `fate-sub-webvtt` | `fmtstdout ass -i <file>.vtt` | the same | our `film.vtt`, the same |
| `fate-sub-srt-madness-timeshift` | `fmtstdout srt -itsoffset 3.14 -i <file>.srt -c:s copy` | every cue's millisecond times kept, 3.14 s later | our `film.srt` remuxed: each cue's times are the fixture's plus 3,140 ms exactly, its lines unchanged |

Not ported: the 5- and 6-channel copies of signal 6 (an export's master is stereo); `ebur128_loudness_global_multiple`
(tests.c 286-310; an export has one master); the `EXACT_PASSED` column (`gre[]`, `lrae[]`), libebur128's own outputs,
which its file says need not match; FATE's other subtitle recipes (other formats); `fate-run.sh`'s cpu, thread and
hwaccel flags, which don't reach a subtitle demuxer. The ASS times are held within a centisecond, not to FFmpeg's own
rounding of a millisecond, which differs between FFmpeg releases; the remux holds every millisecond exactly.

## Run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci                      # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/502-oracle ebur128.test.ts
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/502-oracle subtitles.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/502-oracle/tsconfig.json   # type-check (exits 0)
```

Each file builds `deep-show` once through `tests/acceptance/502/helpers.ts` and fails each test when the build fails.
**`scripts/lanes.mjs` needs `'tests/acceptance/502-oracle/'` in its `alone` list** (this job writes only its folders;
the implementer makes that edit). Every `it` passes a 3,600,000 ms timeout. Temp folders are under `/tmp` and removed
after each file; no process is stopped by name or port. Delete `tests/acceptance/502-oracle/node_modules/.vite` after
a `--root` run. `ebur128.test.ts` exports about 13 minutes of film (64 × 64 at 24 fps), each file once.

A lane whose runner is missing fails with a line starting `BLOCKED:`, never passes:

- `ebur128.test.ts`: the EBU set is read from #500's cache (`~/Library/Caches/deepbuild/ebu-loudness/`, or
  `DEEP_EBU_LOUDNESS`), fetched there on first use; a test that can't read it is BLOCKED, with its unblock line.
- `subtitles.test.ts`: the runner is an installed `ffmpeg` with the srt and webvtt demuxers (PATH,
  `/opt/homebrew/bin`, `/usr/local/bin`, or `DEEP_FFMPEG` and `DEEP_FFPROBE`); without one each test is BLOCKED
  (unblock: `brew install ffmpeg`). It also speaks the film's words with `say -v Samantha`, as the #502 suite does.

## The surface under test

Exactly the #502 suite's `export` (`tests/acceptance/502/README.md`: The surface under test); nothing new is named
here.

### The films

- `ebur128.test.ts`: `masterFilm` (the #502 suite's): 64 × 64 at 24 fps, one strip at unity on the master playing the
  EBU file, the span the file's length rounded up to the second; exported with `video.codec: h264`, `audio.codec: pcm`
  and no `loudness_profile`, so no gain is applied and the receipt still carries the readings.
- `subtitles.test.ts`: the fixture film (`tests/acceptance/502/fixtures/film.json`), exported at `frame_rate: [24000,
  1001]` over `range: [0, 8446237800]` (its 287 whole frames) with `captions: {mode: open, files: [srt, vtt]}`, as
  the #502 suite's `sidecars.test.ts` exports it; the expected cues and times are the file's table for 24000/1001.

`BASE-FAILURE.txt` states the expected failure at the base: the receipt has no loudness reading there, and the fixture
film's document is not presented.
