# Acceptance tests for #2331: a deep command's first clock time loads no date-format data

Written first and blind, at base commit `1c4d1f0e`, from issue #2331 (updatedAt 2026-11-15T07:52:50Z), the design
(Numbers version 0 has to hold; Tests written first) and the base, before any implementation. The implementing agent does
not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

Read at the base: `packages/hub/src/{list,inbox,rows,visible}.ts`, `packages/hub/package.json`, the `toLocale*`/`Intl`
uses in `packages/*/src`, `tests/acceptance/{1463,16}/helpers.ts`, `tests/acceptance/1463/{README.md,inbox.test.ts}`,
`scripts/proof-change.mjs` (criterion IDs, test spans), `scripts/proof-runs.mjs` (tags, twins) and `scripts/affected.mjs`.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm run build --workspaces`) and `deep-hook` built
(`cargo build --locked -p deep-hook`), as #1463 needs:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2331 --no-file-parallelism
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2331 judges week   # no hub, no build
node node_modules/typescript/bin/tsc -p tests/acceptance/2331/tsconfig.json
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1463 --no-file-parallelism   # criterion 3
```

`inbox.test.ts` runs the built CLI, so rebuild after changing `packages/hub/src/list.ts`. `week.test.ts` imports the
source. Delete `tests/acceptance/2331/node_modules/.vite/` before committing.

## The surfaces

- **`deep inbox`**, the built CLI run against a real hub in a temp HOME. The world comes from #1463's `makeWorld`,
  imported unchanged: the hub's clock is noon today in Asia/Kolkata, and one session has three open asks. Their
  defaults fall at 16:40 today, at 07:05 tomorrow and at 09:05 in three days, so `when` takes all three of its forms.
  Processes and folders come from #16's helpers. Only processes started here are stopped, and only by PID.
- **The preload** is `count-formatters.cjs`, loaded through `NODE_OPTIONS=--require` into `deep inbox`'s process and
  any child of it. It wraps `Intl.DateTimeFormat` and `Intl.NumberFormat` (with or without `new`) and the
  `toLocaleString`, `toLocaleDateString` and `toLocaleTimeString` methods of Date, Number and BigInt. It counts each
  call with its stack and writes one record per process at exit. If no record comes from the `inbox` process, the test
  fails; it is never read as zero.
- **`when`** comes from `packages/hub/src/list.ts`, where the issue names it and the base already exports it. `clock`
  isn't exported, and no seam is asked for. Every minute's `when(at, at)` is `at ` followed by `clock(at)`, and every
  other result contains `clock(at)`, so `clock` is compared through `when`. The hub-down sentence is compared through
  `deep inbox`.
- **The oracle** is in `kit.ts` (`baseParts`, `whenFrom`). It is the text the base writes, built from the base's own
  expressions (list.ts lines 33, 38-46), not from the implementation under test. Because `week.test.ts` passes at the
  base, the copy is shown to equal the base over every fixture minute.

## The time zones

Each week starts at local midnight three days before its change. The test sets the zone in the test process (`TZ`)
and imports `list.ts` afresh. The fixture is **BLOCKED** unless `getTimezoneOffset` and the locale clock both show the
zone's offsets and the clock times on either side of its change.

| Zone | Change in the week | Why |
|---|---|---|
| America/New_York | 1 Nov 2026, 02:00 → 01:00 | Clocks go back: 01:00-01:59 comes twice, and the day has 25 hours |
| Australia/Lord_Howe | 4 Oct 2026, 02:00 → 02:30 | A half-hour change, in a zone half an hour off UTC |
| America/Havana | 8 Mar 2026, 00:00 → 01:00 | Midnight is skipped, so "today" and "tomorrow" begin at 01:00 |

Each minute of the week is used as `now`. For each one, `at` is the same minute, the minute's last millisecond, a minute
earlier, 12, 24, 25, 36 and 48 hours later, and a day earlier. That gives 90,720 comparisons per zone.

## Criterion → test → wrong programs

| Criterion | Test | Wrong programs it fails on | At the base |
|---|---|---|---|
| 1. `deep inbox` over an ask with a default constructs no date or number formatter, counted by a preload | `inbox.test.ts`, run once with the hub up and once with it down. Each run checks, in order: (a) the exit code (0 up, 3 down); (b) each ask's line holds `If you don't answer: <label>, <oracle's when>` (the 16:40 ask reads `at 16:40`); (c) with the hub down, the first line is the base's `The hub isn't answering, since HH:MM; …` at a minute the hub could have stopped; (d) the preload left a record from `deep inbox`'s process; (e) zero formatters, each one named with its stack | The base. Any `Intl.DateTimeFormat` (including `resolvedOptions().timeZone`), `Intl.NumberFormat` or `toLocale*String` on the path. A fix that drops or rewrites a default's time or the hub-down time fails (b) or (c). A run the preload never reached fails (d). `judges.test.ts` shows the preload counts each wrapped kind, changes no result, and counts nothing in a process that formats nothing | **Fails both tests at (e)**. By my reading of the base, the hub-up run makes 5 formatters (three `toLocaleTimeString`, two `toLocaleDateString`) and the hub-down run makes 6 (one more for the hub-down line). (a)-(d) pass |
| 2. For every minute of a week across a DST change, in three zones, `clock` and `when` return what they return today | `week.test.ts`, one test per zone: every comparison equals the oracle, and the count is exactly 90,720 | `judges.test.ts` runs the same comparison over the base's `when` with one part wrong, in each zone: the clock in UTC, the clock frozen at the week's first offset, tomorrow as 24 hours later, a 12-hour clock, an unpadded hour, a clock rounded to the minute, the calendar day in UTC, the date of the month in UTC, the weekday in UTC, and next month's name. Each one fails in every zone. The frozen offset first fails at the change, and the 24-hour tomorrow first fails on the day before it, so each week does reach its change | **Passes by design**: today's text is the oracle |
| 3. `tests/acceptance/1463/` passes as it does on main | `tests/acceptance/1463/`, run unchanged. Nothing is copied | Its own | As on main |

`judges.test.ts` has no criterion tag, needs no hub or build, and passes at the base.

## Not covered, and limitations

- **Criterion IDs are computed at run time, not written as literals.** This job had no shell, so it could not compute
  SHA-256. `kit.ts` derives `ID` from the issue's criterion text the same way `scripts/proof-change.mjs` does, so the
  reported test names carry the right `#2331.xxxxxxxx` tags. However, `prepareRuns` chooses files by literal tags in the
  file or its imports, so the proof lane will not find these files until the literal IDs are written into `kit.ts`. The
  job owner can print them before freezing with
  `node -e "const c=require('crypto');for(const t of process.argv.slice(1))console.log('#2331.'+c.createHash('sha256').update(t.trim().replace(/\s+/g,' ')).digest('hex').slice(0,8))" '<text 1>' '<text 2>'`.
  For the same reason there is no `twins.json`: criterion 2 passes at the base, and its wrong programs are the
  in-test ones above, not checkout twins.
- **Scope with no criterion is not tested.** That covers the app's `clock_time` (`crates/deep-app/src/notify.rs`),
  `deep`, `deep status`, `deep status --why` and `deep inbox undo`. Those paths share `clock` and `when`, so criterion 2
  covers their text, but nothing here counts their formatters.
- **Possible false failures:**
  - If the hub moved an ask's deadline, the text is still checked against its `default_at`, but the literal
    `at 16:40` check fails, as #1463's AC8 would.
  - A run that crosses local midnight skips the literal check.
  - Setting `TZ` mid-process needs vitest's default `forks` pool. Under worker threads, the guard reports BLOCKED
    rather than comparing in the wrong zone.
- **Nothing here was run.** This job had no shell, so neither vitest nor tsc ran, and the base result above is
  predicted, not observed.
