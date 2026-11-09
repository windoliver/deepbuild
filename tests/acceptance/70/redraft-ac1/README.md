# Blind redraft of #70 AC1: the R1 end-to-end suite on Linux, but for the moved parts

AC1 `#70.d09103cb`: "The R1 end-to-end suite passes on Ubuntu LTS and Fedora with Claude Code: the release preflight's
live lanes, but for the parts moved to #1712, #1713, #1714, #1715 and #1716". The owner amended it on 2026-11-08. The ID
is `scripts/proof-change.mjs`'s: SHA-256 of that text, trimmed, white space collapsed, first eight hex digits. The other
criteria's IDs come out unchanged by the same method. This replaces `../e2e.live.test.ts` (`#70.3a94aeb5`, written before
the amendment). Nothing outside this folder was edited. `../helpers.ts` is imported for `REPO`, `requireLinux` and
`distribution` only.

## What it read

Issue #70 as it reads on 2026-11-08, including the paragraph that lists what moved; #1712 to #1716; `docs/technical-design.md`;
AGENTS.md; origin/main `d4ed7be7` (the live suites of #666, #668, #669, #27, #567, #1156, #18 and #25, and their
`helpers.ts` for criterion IDs); and the change's `scripts/lanes.mjs`, `helpers.ts` and the original AC1 test. It never
saw the Linux twins (`tests/acceptance/{668,669,1156}/linux/`), so it assumes their titles carry the same criterion IDs as
the macOS suites, under the README rule that each title starts with its criterion and ID.

## What it runs

A lane is live when one of its commands sets `DEEP_HARNESS_LIVE=1`. Today that is `spine checkpoint`, `setup checkpoint`,
`done gate checkpoint`, `risky calls checkpoint`, `spine exit` and `claude code adapter live`. The list is read from
`releaseLanes` at run time, so a live lane added later is kept and must pass. Each command runs exactly as `lanes.mjs` lists
it for this platform (on Linux, the twins under `linux/`), with vitest's JSON report added.

| Lane | Suite | Kept | Left out, and where it moved |
|---|---|---|---|
| spine checkpoint | #666 | all | none |
| setup checkpoint | #668 (Linux twin) | all but AC4 | AC4 `#668.3ee80c65` → #1713 |
| done gate checkpoint | #669 (Linux twin) | all but AC2, AC4, AC5 (AC1, AC3, AC6 if there) | `#669.b95b4d96`, `#669.059078dc`, `#669.b5400502` → #1716 |
| risky calls checkpoint | #1156 (Linux twin) | none | the whole suite → #1716 |
| spine exit | #567 | none | the whole suite → #1715 |
| claude code adapter live | #18 mapping, #18 install | none | #18's live suites → #1712 |
| claude code adapter live | #25 live, #25 live-redraft | none | #25's live suites → #1712 |
| claude code adapter live | #27 | all but AC2 | AC2 `#27.6e863673` → #1714 |

The Codex half (#1712) has no lane, so no Codex session runs and the original's Codex test is gone. The release lanes that
start no session (`hub churn`, `hub sessions`, `ecosystem corpus`, `operator calibration`, `gpu validation`) are not live
lanes, which is how the original read "the R1 end-to-end suite" too.

### How a moved part is left out

- A whole suite that moved is never started. Its lane and file are printed by name.
- A moved criterion inside a kept file is filtered out with vitest's `-t`, a negative lookahead on its ID
  (`^(?!.*(?:#668\.3ee80c65))`), so its session never runs. The report lists it as skipped, and the test prints it with
  the issue it moved to.
- Every other test in the report must read `passed`. A skipped test whose own title lacks a moved ID was dropped by the
  filter (through a describe's title, say). That fails, naming the test. A kept file must pass at least one test. A file
  error outside its tests fails. A non-zero exit fails unless a failed test explains it. A failure of a moved test alone
  doesn't count. A runner killed outright always fails.
- A moved ID that matches no test is printed (`nothing was left out for it`). That test then ran as kept and counts.

## How to run

In each VM (`../README.md`: What each VM needs, How to run), from a login shell, built as there:

```sh
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/70/redraft-ac1 e2e.live.test.ts   # by hand: spends plan usage
node node_modules/typescript/bin/tsc -p tests/acceptance/70/redraft-ac1/tsconfig.json
```

Without `DEEP_HARNESS_LIVE=1`, off Linux, with no `claude` on PATH or no `CLAUDE_CODE_OAUTH_TOKEN`, the live test fails
`BLOCKED`. Nothing skips. One run sees one distribution, so a pass needs a run in each VM. Logs and reports go to `/tmp/dh70-*`.

## Wrong programs

The second test starts no session and runs anywhere. It checks the plan against the real `releaseLanes`: every kept part is
run, and every moved part is left out by name. Then it plants three wrong programs:

- a lanes list without `done gate checkpoint`, and one whose `claude code adapter live` lost #27: each reads missing, by name;
- the filter: #668's AC4 title is excluded and its AC1 title is kept;
- the judge: a moved test failing beside a passing kept test passes. A kept test skipped through a describe that carries a
  moved ID fails, named. So do a kept failure and a run with no kept pass.

Two mutants were seen to fail it: `plan` reporting nothing missing, and `judge` counting a skipped test as passed.
