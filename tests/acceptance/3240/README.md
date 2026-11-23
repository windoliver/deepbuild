# Acceptance tests for #3240: GPU time by grant and the line

Drafted blind from issue #3240, `docs/parallel-proof.md` section 6 (its bullets "GPU time and the line (#3240)", "The
load, by who made it (#3067)" and "Tables of a test's own") and section 13, the Dogfooding part of
`docs/technical-design.md`, AGENTS.md and the base commit `618ab3ab4` (the design for #3240 as amended, on origin/main
`f8c6cff82`; the first draft was on `85088608b`, whose design gave the first sample `gpuUnread`). For surfaces and
sandbox technique I also read the base's `scripts/throttle.mjs` and `tests/acceptance/3067/` and `2924/`. The helpers
are this suite's own; no test imports the code under test: `scripts/throttle.mjs` is run as a process. Per AGENTS.md
the implementing agent doesn't edit these tests; a dispute goes to a blind redraft.

## Run

```sh
node --test 'tests/acceptance/3240/*.test.mjs'
```

On the Mac (the issue's "Runs on"), with the Command Line Tools' `swiftc`. They must run under `node --test`: only
inside a test run does a table of a test's own exist (section 6). The whole command takes a little over 10 minutes,
most of it `cost.test.mjs`:

| File | Takes | Load it makes |
|---|---|---|
| `report.test.mjs` | under 1 s | none |
| `gpu-unread.test.mjs` | a few seconds | none |
| `line.test.mjs` | about 20 s (8 s of it shows the second request waiting) | 2 cores of spinning |
| `log.test.mjs` | about 10 s, and a `swiftc` build of the GPU stub | two GPU stubs drawing for a few seconds |
| `gpu.test.mjs` | about 65 s (the sampler's second sample comes a minute after its first), and the build | two GPU stubs drawing 10 s |
| `cost.test.mjs` | 10 min 10 s (the criterion's 10 minutes), in a file of its own to be scheduled apart | none |

**The live table at `~/.deepbuild/throttle/` is never read or written.** Every `throttle.mjs` process gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's temp sandbox and a temporary `HOME` there, with
`DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PROOF_VITEST_REPORT` and `DEEP_THROTTLE_READINGS` unset.
Each process starts in its own process group and is stopped after its test by that group's PID; `load` is stopped by
its own PID (SIGTERM). Nothing is stopped by name or port.

## The surface

- `node scripts/throttle.mjs load`, stopped by its PID, and `load.log` in the table's folder: one JSON line a sample,
  the first at its start, a minute between them. The fields read are section 6's: `waiting` (a count for each of
  `build`, `bay-pair`, `test` and `timed`), `idle` and `busy` (cores), each `grants` entry's and `outside`'s `gpu`
  (seconds), `gpuTop` (`pid`, `command`, `gpu`, `grant`), `gpuUnread` (a short reason), beside #3067's.
- `node scripts/throttle.mjs load --report` over a `load.log` in the table's folder, by the lines section 6 states:
  `<p>% of minutes with a request waiting beside two or more idle cores (<n> of <m>)`, `GPU read in <n> of <m>
  samples, <s> s in all`, `GPU <name> <s> s, <p>%` and `GPU top commands under no grant: <command> <s> s, ...`.
- `node scripts/throttle.mjs <class> --wait <min> -- <command>` holds a stub grant, or waits for one. The stub notes its
  pid and the `DEEP_THROTTLE` it sees (`<class>:<id>`, the grant's ID) in an events file.
- **A GPU stub that draws on the GPU** is `gpudraw <name> <seconds>`, a Swift program built in the test by `swiftc -O`
  under the sandbox's `HOME` (the offline Metal compiler isn't installed, so its compute kernel is compiled from source
  as it starts). It keeps three command buffers of a 1M-thread kernel in flight for `<seconds>`, notes `drawn`, then
  idles with its device open until killed, so its accelerator client stays listed. Metal's own timestamps say it kept
  the GPU busy all 10 s; the GPU time the registry gives it is less, about 1.4 to 2.6 s here, since the machine's GPU
  is shared.
- **The GPU reference is the test's own `ioreg`**, the listing section 6 names (`/usr/sbin/ioreg -r -l -d 2 -w 0 -c
  IOAccelerator`): for a pid, the sum over the clients its `IOUserClientCreator` names of their `AppUsage` entries'
  `accumulatedGPUTime`. The CPU reference is the test's own `/bin/ps -A -o pid=,ppid=,%cpu=,ucomm=`, as in #3067's
  suite.
- **A CPU stub that "spins 2 cores"** is #3067's: one `node` process of 24 threads that spin only while the process is
  behind 2 seconds of CPU a second, so it holds 2 cores whatever the machine's load.
- **A failing GPU read** is arranged by PATH: `load` runs with a stub `ioreg` first on its PATH that notes each call,
  prints a marked error naming a path under the sandbox's `HOME`, and exits 1. Section 6 has `ioreg` run by name from
  the PATH, as `ps` is.

## The tests

| File | Criterion | Test |
|---|---|---|
| `gpu.test.mjs` | #3240.6f5727c7 | `load` takes its first sample; then a `test` stub grant whose child is `gpudraw` (asserted under the holder) and an ungranted `gpudraw` (the same name, asserted) each draw 10 s, both done before the second sample. In the second sample: not failed, no `gpuUnread`; the `grants` entry with the grant's ID has class `test`, the holder's pid and a `gpu` within a fifth of the child's time by the test's own `ioreg`; `outside.gpu` is at least the ungranted process's time less a fifth; `gpuTop` has five entries at most, none at 0; a stub that used more than all but four processes by a fifth is listed, and a listed stub names its grant (the child) or none (the ungranted one), command `gpudraw`, `gpu` within a fifth. |
| `gpu-unread.test.mjs` | #3240.2d406576 | With the stub `ioreg` failing and one idle stub grant: the first sample isn't `failed`, lists the grant, holds a non-empty `gpuUnread`, and has no `gpu` in the grant's entry or `outside` and no `gpuTop`; the log holds neither the stub's error text nor a path under a home. Then `load --report` over that log prints `GPU read in 0 of 1 samples, 0.000 s in all` and no `GPU <name> ...` share line or top-commands line. |
| `line.test.mjs` | #3240.f0d5ecc3 | A `build` stub grant whose child spins 2 cores, and a second `build` request (`--wait 10`) shown waiting 8 s later (its command not started, its throttle still running) and still waiting after the sample. The first sample: `waiting` is exactly `{build: 1, bay-pair: 0, test: 0, timed: 0}`; `idle` and `busy` are numbers from 0 to `cores`, `cores` is the machine's (`os.cpus().length`, 18 here), and `idle + busy` is `cores` within 0.01; `busy` is at least the spinner's reading less 0.5. |
| `report.test.mjs` | #3240.7baf5908 | `fixtures/line-and-gpu.jsonl` (below). Prints `60% ... (3 of 5)` (or `60.0%`) of minutes with a request waiting beside two or more idle cores; `GPU read in 4 of 6 samples, 33.250 s in all`; exactly the lines `GPU test 10.000 s`, `GPU build 1.250 s` and `GPU outside 22.000 s`, with shares each within 0.1 of 30.075%, 3.759% and 66.165% that add up to 100.0; `GPU top commands under no grant:` naming exactly `WindowServer 12.500 s`, `renderer 5.500 s`, `encoder 2.500 s`, `viewer 0.750 s` and `indexer 0.500 s`, in any order. |
| `cost.test.mjs` | #3240.a54f81e0 | `load` runs 10 minutes and 5 s beside one idle stub grant, as the child of a shell that then prints `times`. The first sample already holds a GPU read; at the end `load` is still running, ends on a SIGTERM to its PID, wrote 10 or 11 samples, each with its GPU read (not failed, no `gpuUnread`, a `gpu` for `outside` and every grant), and its user and system CPU with the `ps` and `ioreg` listings it waited for is under 1% of the elapsed time. |
| `log.test.mjs` | #3240.712a690c | A `test` stub grant's child and an ungranted process draw on the GPU, each started with a marked argument, a marked environment value (the sampler has it too) and a binary under the sandbox's `HOME`; a `build` grant is held and a `build` request waits. In `load`'s first sample, which holds `gpuTop` and lists each stub that led all but four processes: `load.log`'s text holds none of the argument, the environment value, the sandbox's `HOME`, the sandbox, the user's home, `.mjs`. Every text in the sample is `at`, a `class` of the four, an `id` or `grant` that is this table's, or a `command` with no `/` that equals what the test's own `ps` printed as that pid's `ucomm`; `waiting`'s keys are the four classes. |

**#3240.c02cf7da** ("The 24-hour table from the reference Mac, with both additions, is on this issue") is a step by
hand: no test here covers it.

### The fixture

`fixtures/line-and-gpu.jsonl` (named `.jsonl` since the repository ignores `*.log`) holds six samples on 18 cores:

| # | Load | GPU | Grants (GPU s) | outside GPU s | waiting | idle | Counts in the line |
|---|---|---|---|---|---|---|---|
| 1 | 30 | read | test 2 | 3 | build 2 | 5 | yes |
| 2 | 25 | read | test 4.5, build 1.25 | 10 | none | 8 | no |
| 3 | 10 (below the cores) | read | test 3.5 | 4 | test 1 | 2 | yes (exactly 2) |
| 4 | 40 | read | none | 5 | build 13, test 5 | 1.5 | no |
| 5 | 50 | failed | | | (none: failed) | | not a minute of the line |
| 6 | 20 | `gpuUnread` | timed (no gpu) | | bay-pair 1 | 3 | yes |

Each read sample's `gpuTop` sums to its numbers; `gpudraw` and `exporter` are under grants, and six commands are under
none. Wrong reports it tells apart: GPU over the minutes above the cores only (test 6.5, build 1.25, outside 18); a
sample whose GPU wasn't read counted as read (`GPU read in 5 of 6`, a `GPU timed` line); each share rounded alone
(30.1, 3.8 and 66.2 add up to 100.1); idle "more than 2" in place of "2 or more" (2 of 5).

## How each criterion is read

- **#3240.6f5727c7, "gives each its GPU time within a fifth".** Each's GPU time is what the registry counted for it
  between the sampler's two reads, which the test reads itself: the stubs start after the first sample, so their
  clients are new since its read and their whole time is the change, and they idle after drawing, so their time at the
  second sample is the time the test reads after it. "Within a fifth" is no more than a fifth of that time above or
  below. "To `outside`" can't be read off `outside` within a fifth, since `outside` is every other process on a
  machine whose WindowServer and other sessions draw too, so `outside` is held to at least the ungranted process's
  time less a fifth, and the process itself is read in `gpuTop`. The by-name plant (both stubs are `gpudraw`) gives
  the grant both stubs' time, about twice its own.
- **#3240.2d406576, "the sample says the GPU wasn't read, and the report counts it in no share".** "Made to fail" is an
  `ioreg` that exits 1 at every call, so the first sample's read before and its own fail; the sample "says so" in
  `gpuUnread`, with no `gpu` and no `gpuTop` (section 6: never a zero), and the rest of it is still a reading. "Counts it
  in no share" is read on the report over the log that sample is in: it counts no sample as read and prints no GPU share.
  A sampler that writes zeros gives a sample with no `gpuUnread` (where the test fails), and a report that counts it as
  read (`1 of 1`).
- **#3240.f0d5ecc3, "its idle and busy cores sum to the machine's".** `idle + busy` is the sample's `cores` within
  0.01, and `cores` is the machine's (18). A sum alone would pass `idle: 18, busy: 0`, so `busy` must also hold the
  held grant's 2 spinning cores (at least the test's own `ps` reading of the spinner less 0.5). "1 request waiting, of
  class `build`" is the whole `waiting` object: 1 for `build` and 0 for the three other classes section 6 lists.
- **#3240.7baf5908** is read on the four lines section 6 gives the report, with the fixture's expected numbers.
- **#3240.a54f81e0, "with the GPU read"**: every sample, the first one too, holds a GPU read (section 6 as amended:
  every sample on macOS holds one).
- **#3240.712a690c, "still holds ... only"**: #3067's check of the first sample, over the new fields, with GPU stubs
  that carry the marks drawing while it is read. A GPU that was read leaves no reason text in the sample.

## Gaps and assumptions

- **The reference Mac's GPU is shared.** WindowServer and other sessions' apps draw all the time, so a stub's GPU time
  in 10 s of drawing depends on the machine: 1.4 to 2.6 s here. Below 0.1 s a stub drew too little to read, and the
  GPU test reads `INCONCLUSIVE` by a skip that says so, never a pass. Metal's own timestamps (about 10 s) count the time
  a command buffer spent on the GPU while others' work shared it, so they aren't the reference; they are shown as a
  diagnostic only.
- **"Within a fifth" against the same counter.** The sampler and the test read the same registry counter, so a right
  sampler reads within a few milliseconds of the test; the fifth is room for nothing but a wrong attribution.
- **`gpuTop` is held only where it must list a stub**: when, by the test's own reads around the sampler's, the stub
  used more than all but four processes by a fifth. Both stubs were listed in every run here.
- **Not asserted, since no criterion names them:** `gpuTop`'s order; the `gpu` of a grant whose tree used no GPU
  (read as a number, 0 or more, in the cost test); the form of `gpuUnread` beyond a non-empty text; a process the
  listing names that `ps` didn't list; a process that ended between reads; the change after a read that wasn't made;
  `ioreg` that can't be run at all or lists no client; a machine other than macOS (every test but the line and report
  tests skips there as `INCONCLUSIVE`); the window `idle` and `busy` are read over, beyond a sum and a busy floor.
- **The report's open forms.** The share of minutes is accepted as `60%` or `60.0%`. "GPU read in" counts every sample
  as `<m>`, the failed one too ("over every sample"). GPU shares are held to within 0.1 of the exact share and to a sum
  of 100.0, not to one rounding rule; the top commands in any order. Only standard output is read.
- **Cost.** As #3067's: the shell's `times` for its children, the sampler and the `ps` and `ioreg` listings it waited
  for, with one idle grant held. 70 or so accelerator clients are listed on this Mac.
- **The waiting request** is shown waiting by #2924's rule (not started 8 s after it was made, its throttle still
  running), not by reading the table's file, which isn't a surface the issue or the design names.
- **darwin only**: `/bin/ps`, `/usr/sbin/ioreg`, `swiftc`, Metal and `/bin/sh`'s `times` as macOS has them.

## On the base

`BASE-FAILURE.txt` (base `618ab3ab4`, macOS, 18 cores, 1-minute load about 30 to 70): 6 fail, 0 pass, in 62 s, each
run once. Every failure is at an assertion and for the expected reason: the base's sampler (#3067) has no `waiting`,
`idle`, `busy`, `gpu`, `gpuTop` or `gpuUnread`, runs no `ioreg`, and its report has none of the new lines.
`log.test.mjs` fails there only at its precondition (the sample holds no `gpuTop`), so its criterion is shown failing
by a twin.

A throwaway right sampler (the base's `throttle.mjs` with section 6's new fields and report lines, kept outside the
checkout with a copy of this folder beside it, never committed; `scripts/` here is the base's, byte for byte) passed
all six, each file run once, at a 1-minute load of 30 to 110: the GPU test read the grant at 1.741 s against the
test's 1.741 s and `outside` at 15.9 s against the ungranted stub's 1.737 s; the line test read
`{build: 1, ...}`, idle 0 and busy 18 of 18 at a load of 54; the cost test read 0.61 s of CPU in 605 s, 0.10% of one core, over 11 samples each with its GPU read.

The wrong programs the criteria name, as twins (`twins/`, `twins.json`, `TWINS-RUN.txt`), each fail their criterion's
test at the assertion the issue names:

| Wrong program | Fails | At |
|---|---|---|
| `by-name`: attributes GPU time by process name | #3240.6f5727c7 | "the grant's gpu is 3.288 s; the test's own ioreg read 1.642 s, so it must be within a fifth of that" |
| `zeros-on-failure`: writes zeros when the GPU read fails | #3240.2d406576 | "the sample taken while ioreg failed doesn't say the GPU wasn't read" |
| `holder-waits`: counts the holder as a waiter | #3240.f0d5ecc3 | "waiting holds 1 request of class build" (it records `build: 2`) |
| `gpu-arguments` (for the criterion that names none): names `gpuTop`'s processes by their whole command lines | #3240.712a690c | "load.log holds a stub's argument" |

Each twin is the base's `throttle.mjs` with only the new fields its test reads, one rule of them planted wrong and
marked `Planted:`, so no twin is a right sampler. The cost and report tests have no twin: they fail on the base at
the criterion's own words.
