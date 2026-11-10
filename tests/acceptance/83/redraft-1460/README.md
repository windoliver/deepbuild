# Blind redraft of #83 AC11 for the receipt part of #1460

AC11 `#83.15ee3b42`: "golden lines for says done, sent back, PASS, BLOCKED and checks running fit the set width; a fixture
with a long cause keeps "not verified" and the outcome, and shortens the cause first". A fresh run of the blind
acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for this criterion, at base `96b462a6` (Merge pull request #2051),
written beside `tests/acceptance/1460/`. It never saw an implementation. It edits no test outside this folder; the earlier
#83 suite (`../`) is an input it imports from and doesn't change.

## The dispute

#1460's Scope: "Where the chat can't link, the verdict line's receipt part is the address of the claim's page, which `deep
open` takes. The golden line #83's suite pins moves through its blind redraft." Every #83 golden line ends in the bare word
`· receipt`, and the long-cause fixture keeps `receipt`. A line that follows #1460 fails each of them. This redraft keeps each
AC11 test's id, title, steps and expected values as #83 states them and changes only the receipt part:

- **PASS**: `PASS 4/4 · next: you · session/{session8}/{claim}`, the form #1460's suite pins (its README, Pinned 9): the claim's
  page address, `session/<session ID>/<claim ULID>`, with the session's ID cut to its first 8 characters, 43 columns. The test
  fills in the session's and the claim's IDs once it has made them; the line is 66 columns.
- **BLOCKED, sent back, says done, checks running**: #83's line with ` · receipt` gone. With every other part as #83 states it,
  these lines leave 8 to 17 columns for the receipt; no address holding a record ID fits, so the receipt gives way, as #83's
  own order says it does after the cause's floor. Nothing else in these lines changes: the cause stays whole, since the line
  without the receipt fits.
- **long cause**: `receipt` leaves `keeps` for the same reason, and the line must not end in the bare word.
- **(wrong program)**: the two planted strings end in a sample address in place of `receipt`; what they test is unchanged.

`diff -r ../goldens goldens` shows the six one-line changes and nothing else.

## Also in dispute, not this redraft's to settle

At this base #83's goldens fail on main for another reason: #669 added the test count to the line, and `test.verdict` counts
one test per check run, so the PASS golden's state reads `PASS 4/4 · 4 tests · next: you · receipt`, and BLOCKED, sent back,
checks running and long cause get `N tests` too, which shortens their causes. `scripts/known-failures.json` doesn't list them.
Only `says done` (no run finished) fails here on the receipt alone. Settling the test count is #669's redraft, not #1460's, so
the expected values here keep #83's lines without it; those five tests stay failing until that is settled.

## What it read

- AGENTS.md; issue #1460 (Scope, criteria, the owner's settled comment) and issue #83 (AC11).
- `docs/technical-design.md`: the verdict line in the chat; Keymap, placement, window (the Address line).
- `packages/verdicts/src/line.ts` (`LINE_WIDTH`, the order parts give way), `packages/hub/src/core.ts` (`test.verdict`), read
  only to know what the base writes.
- The earlier #83 folder: README, helpers.ts, goldens.test.ts, goldens/, BASE-FAILURE.txt; `tests/acceptance/34/redraft-1579`
  for the layout; `tests/acceptance/1460/README.md` for the receipt's form.

## How to run

Node 24 first on `PATH`, macOS, the workspaces built (`npm ci --ignore-scripts && npm run build --workspaces`) and `deep-hook`
built (`cargo build -p deep-hook --bin deep-hook`), as #83's suite needs:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/83/redraft-1460 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/83/redraft-1460/tsconfig.json
```

Eight tests, no model and no network, under a minute. Each golden starts a real `deep hub run` under a fresh `/tmp/dh83-*`
home with #83's Claude Code stand-in (nothing touches `~/.deepbuild` or `~/.claude`), and stops only the processes it started,
by PID.

## Files

- `goldens.test.ts`: `../goldens.test.ts` with the receipt filled in and the long-cause check that the line doesn't end in it.
- `goldens/`: #83's six goldens, each with its one change.
- `tsconfig.json`, `BASE-FAILURE.txt`.
