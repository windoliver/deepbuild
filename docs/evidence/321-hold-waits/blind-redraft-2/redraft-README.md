# Blind redraft of #1101 criterion 1 (`#1101.5140ae1c`)

Written blind at `6a4df9a89` from the issue, the design and the base, with no implementation.

This folder's `push.test.ts` runs in place of `tests/acceptance/1101/push.test.ts` as a whole file. It redrafts
criterion 1's two tests and carries that file's criterion-3 tests (`#1101.2d545cc0`) copied unchanged. It imports only
`../1101/helpers.ts` (the base's suite, read-only), so it runs from this folder or from `../1101` alike. Nothing under
`tests/acceptance/1101/` was edited.

## What was read

Only these:

- **The issue**: #1101's current text (Scope, the seven criteria, Proof).
- **The design**: `docs/technical-design.md`, Plans before acting ("A hold before what can't be undone": a 10 s hold the
  hub keeps, the card's receipt counting it down with Undo) and Repo guards (tests wait for events; a timer that only
  bounds a wait carries `// deadline:`); `docs/canvas-primitives.md`, Question card (arming, the one-line receipt with
  Undo); `AGENTS.md`.
- **The base** at `6a4df9a89`: the existing blind suite `tests/acceptance/1101/` (README, `helpers.ts`,
  `push.test.ts`, `undo.test.ts`), `tests/acceptance/16/helpers.ts` (`sleep`, the `Ev` type),
  `packages/hub/src/holds.ts` (its header: a hold denies the call, naming its ask, and once you say yes the same call
  runs; a push's plan reads "Revert it with a new commit" at the base), `packages/hub/src/plant.ts` (none of #1101's
  plants is listed at the base), `packages/hub/src/hookmap.ts` (`tool.before` and `tool.after`), and
  `crates/deep-replica/src/drive/mod.rs` (`launch` from a fixture at NOW; `wait_for` with `t` and `step_ms` lands the
  clock exactly on `t`).

## What the test holds

### The world, the yes and the hold's start

As the base suite has them (`../1101/README.md`, The world, The yes): a real `deep hub run` on its test clock in a temp
HOME under the shipped default guards; a Claude Code session on the hook wire whose `git push origin main` is held with
an authority ask; Allow pressed once the card arms on the ask's card in the replica, and what the app sent replayed to
the hub signed, as the app sends it. **The hold starts** at the `ts` of the `ask.answered` the hub records for that yes.

### "The push starts"

A git process for the push starts only when the hub lets the agent's PreToolUse of it through: the agent stand-in runs
a real `git push` to a bare repository on disk for a call the hub let through, and for nothing else, as Claude Code
does. So **the push starts** when the hub's reply lets the call through, read as the hub's clock right after that
reply. The bare repository shows the push too: it must not hold `main` before 10 s, and must hold it once the call ran.

The issue leaves open how the hub keeps the hold: it may refuse a re-run of the call inside the hold, keep the call
waiting until the hold ends, or tell the agent only when the hold ends. The test is the same for all three. The agent
runs the call:

1. at once after the yes, as a held call is told to (waited on for up to 1 s of real time);
2. 9.5 s into the hold, the hub's clock stepped there with `test.clock` (waited on for up to 1 s);
3. once the clock is stepped to 10 s, unless a try was already let through.

**No git process for 10 s**: no try is let through with the hub's clock below 10 s into the hold, and `origin` holds no
`main` once the clock reads 9.5 s. **The push starts at 10 s**: once the clock reaches 10 s, a try kept waiting comes
back let through, or the new try is, within a window of real time that ends 1 s before 10 s of real time have passed
since the yes. A hold kept on real time can't end inside that window, so only the hub's clock can have ended it. A push
that is let through only after the window fails as a hold on real time, and one never let through fails as still held.

**INCONCLUSIVE, never PASS**: when real time carried the hub's clock past 10 s before the run brought it there, when no
try was sent inside the hold, or when that window came out under 2 s with the push not yet let through.

### The countdown

The ask's page, `ask/<ULID>`, drawn headless by the real `deep-drive` over a copy of the hub's record taken 9.5 s into
the hold. The replica's virtual clock is moved with `wait_for` to these times into the hold, landing exactly on each:

| Into the hold | The receipt must read | Beside it |
|---|---|---|
| 0 ms and 100 ms | "Starts in 10 s" at one of the two at least | an Undo control at both |
| 2.5 s | "Starts in 8 s" or "Starts in 7 s" | an Undo control |
| 5.5 s | "Starts in 5 s" or "Starts in 4 s" | an Undo control |
| 8.5 s | "Starts in 2 s" or "Starts in 1 s" | an Undo control |

An Undo control is a node named `Undo` or the card's `card-undo` (the base's `undoControls`). The issue's "Starts in
10 s · Undo" is read as that text beside that control, whatever separates them. The two first reads let a countdown that
names the seconds left rounded down show 10 s at its start, and one that rounds up show it a little after a hold that
starts a few ms after the answer's `ts`. The half-second reads accept the seconds left rounded either way, so they read
the count, not a rounding rule. A receipt whose number doesn't move, or that moves on real time, fails at 2.5 s.

## Tests

| Test | ID | Plant | Must fail naming |
|---|---|---|---|
| approving a fixture push starts no git process for 10 s, its receipt reads "Starts in 10 s · Undo" counting down on a virtual clock, and the push starts at 10 s | `#1101.5140ae1c` | none | (the hold, the push's start or the receipt, each naming the ask) |
| a planted card that starts the push at the click fails, naming the step | `#1101.5140ae1c` | `hold-starts-at-click` | the step, `` the step `git push origin main` (ask:…) `` |
| after the push runs, its receipt says it ran and can't be undone, with no Undo control in the text snapshot (copied unchanged) | `#1101.2d545cc0` | none | |
| a planted receipt that still shows Undo fails, naming the receipt (copied unchanged) | `#1101.2d545cc0` | `receipt-keeps-undo` | the receipt of the ask |

The plant goes by `DEEP_HUB_PLANT`, as the base suite gives it: the card is pressed in `deep-drive`'s `env-plants`
build with it, and the hub gets it too only when `packages/hub/src/plant.ts` lists it. The plant test first holds the
clean run to the same judge (its hold failures are none and it was seen), then needs a failure that names the step's
command and its ask. A plant the build ignores runs clean and fails as "wasn't caught".

## What it leaves out

- The other criteria (AC2, AC4 to AC7) stay in `../1101`'s other files; AC3 is only carried.
- Whether the hub tells the agent anything when the hold ends: the agent stand-in runs the call at 10 s whether told
  or not, so a hub that withholds the yes until 10 s and one that refuses re-runs inside the hold read the same.
- Whether the hub itself starts a git process: only the bare repository's refs and the agent's let-through calls are
  read, not a process list (the hub runs git of its own for other reasons).
- The countdown's look between the reads, and the app quitting during the hold.

## Settled here where the inputs were silent

1. The hold starts at the `ask.answered` `ts`, not at a hold event of its own: the base names none.
2. "Counting down on a virtual clock" is the replica's virtual clock moved over one copy of the record taken during
   the hold, so the hold must be in the record for the app to draw.
3. The 9.5 s try (not 9 s) and the real-time window come from this draft, not the issue.

## How to run

With Node 24.22 and cargo on `PATH`, on macOS, from the checkout:

```sh
npm ci --ignore-scripts && npm run build --workspaces
npx vitest run --root tests/acceptance/1101-redraft-ac1 --no-file-parallelism --testTimeout=1200000
node node_modules/typescript/bin/tsc -p tests/acceptance/1101-redraft-ac1/tsconfig.json
```

The builds are `../1101/helpers.ts`'s (`deep-hook`, `deep-drive` plain and with `env-plants`, under
`scripts/throttle.mjs`); build them before a timed run so the file stays within 20 minutes, since the criterion-1
tests are capped at 20 minutes each. Homes are under `/tmp`; nothing touches `~/.deepbuild`, `~/.claude` or
`~/Library/LaunchAgents`; only processes the test started are stopped, by PID. Vitest writes `node_modules/.vite/`
under `--root`; delete it before committing.

`tsconfig.json` is the base suite's. Not run here: vitest (the coordinator runs it at the base after the macOS build).
