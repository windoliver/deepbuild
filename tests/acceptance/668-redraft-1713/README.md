# Blind redraft of #668 AC4 for #1713, as #3596 words it

Written blind by the job that sees only the issues, the design and the base commit. The earlier draft in this folder
was deleted unread and this one written from scratch.

## What this job read

- #668's AC4 only: "`deep doctor` exits 0 with every item OK or "not checked"; with DeepBuild's hook entry removed by
  hand it names the missing installation with its exact fix and exits non-zero".
- #1713 whole: the doctor exits 3 with no app running, so that AC4 couldn't pass; the fix is the AC passing or an
  owner decision recorded in the design.
- #3596 whole. Its Scope fixes the redraft ("no failed item, and exit 0 or 3", with #19's rule standing: 1 when an item
  failed, else 3 when one wasn't checked, else 0, and a warning changes neither), and its last criterion is the text
  held here: "after setup and the session no item of `deep doctor` is failed and it exits 0 or 3, and the entry
  removed by hand is still named with its fix".
- `docs/technical-design.md` at the base: the exit-code table (0 ok; 1 a failed item; 2 usage; 3 not decided, an item
  not checked or a hub it couldn't read; 1 when both 1 and 3 apply) and, under "Hooks are evidence, not a state
  machine", the owner decision on #1713 (2026-11-27): `deep doctor` right after setup, with no app running, exits 3,
  never 0.
- As surfaces only: `tests/acceptance/668/helpers.ts` (imported, never edited: the temporary home, the stand-ins, the
  checkout-web fixture, the made-up session through your user settings, the hand removal), `tests/acceptance/668/
  fast.test.ts` (how its AC4 tag is built), `packages/hub/src/doctor.ts` and `packages/hub/src/plant.ts` (the doctor's
  exit and the plants it reads).

Base: `e92eff449` (`claude/issue-1713-doctor-exit`).

## How the criterion is read

1. **"After setup and the session"**: `deep setup` in the checkout, the hub answering, then #668's made-up session
   (the failing test run, the fix, the passing run, the commit, Stop and SessionEnd through your user settings into
   the real deep-hook and hub) until the record holds its `agent.stop`.
2. **"No item of `deep doctor` is failed"**: `deep doctor --json`, as a person runs it after setup (no `--prompt`,
   which spends plan usage), in the shell you start sessions from (Claude Code's telemetry pointed at the receiver and
   the Keychain stand-in, as #668's reading 5 has it). No item may have level `fail`. A `warn` is allowed: a warning
   changes neither (#3596).
3. **"It exits 0 or 3"**: the exit is 0 or 3, and the one the exit-code table gives for the items it printed: 3 when
   any item reads not checked, else 0. So a doctor that exits 0 over an item not checked fails, as the owner decision
   says ("exits 3 ..., never 0").
4. **"The entry removed by hand is still named with its fix"**: #668's second half kept as #668's own suite reads it:
   with the hub stopped (the hub puts back an entry removed while it runs), DeepBuild's PreToolUse entry is taken out
   of `~/.claude/settings.json` by hand; `deep doctor --json` must show a failed item naming `PreToolUse` and that
   file, whose fix is the command `deep setup` (never `--undo`), and exit non-zero. By the exit-code table a failed
   item makes that exit 1, also when an item reads not checked beside it. Running that fix puts the entry back and
   the doctor no longer names it.

## Planted wrong programs

The doctor reads `DEEP_HUB_PLANT` through `packages/hub/src/plant.ts`. What it offers for its exit:

| Plant | What it does | Where it can show |
|---|---|---|
| `not-checked-exits-0` | exits 0 when no item failed, whatever reads not checked | only when nothing fails and an item reads not checked: the doctor after setup |
| `doctor-not-checked-first` | exits 3 whenever an item reads not checked, over a failed one | only when an item fails and one reads not checked: the doctor with the entry removed |
| `doctor-misses-hooks` (#668's) | reads DeepBuild's hook entries as installed whenever setup's record of them exists | the doctor with the entry removed |

The second test runs the doctor with each and requires the first test's check to fail on it, naming `#668.3ee80c65`.
A plant that only differs from the right doctor when an item reads not checked is reported `INCONCLUSIVE` (the test
fails saying so) when no item read not checked in that run, never as a pass.

## At the base

Both tests fail (`BASE-FAILURE.txt`). The doctor after setup and the session exits 1 with `hub.service`
(`service_unpromoted`: the login service runs the CLI from this git worktree), `canvas.gpu`, `canvas.headless` and
`canvas.verdict` failed, and `canvas.packs`, `app.notifications`, `claude.prompt` and `app.footprint` not checked: the
failures #3596's Scope names. The half with the entry removed by hand already holds: `claude.hooks` fails
(`hooks_missing`) with the fix `deep setup`, the doctor exits 1, and the fix puts the entry back.

On the planted doctors: `doctor-not-checked-first` exits 3 over the removed entry's failed item and the check fails on
it, naming the criterion; `doctor-misses-hooks` names no missing hook entry and the check fails on it, naming the
criterion. `not-checked-exits-0` can't show at this base, since items fail after setup and it then exits 1 like the
right doctor: the planted test fails `INCONCLUSIVE` saying so. It shows once #3596 leaves no item failed there.

The `hub.service` failure here comes partly from running in a worktree: #3596's Decision needed asks whether a service
whose program sits in a worktree should fail regardless. If the owner says it should, this test can't pass from a
worktree, only from a plain checkout.

## How to run

```sh
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin RUSTUP_HOME=$HOME/.rustup CARGO_HOME=$HOME/.cargo
npm ci && npm run build --workspaces
cargo build --locked -q -p deep-hook
npx vitest run --root tests/acceptance/668-redraft-1713 --no-file-parallelism
```

It starts no agent and spends nothing. Folders go under `/tmp/dh668-*` with `HOME` set there; the real `~/.deepbuild`,
`~/.claude`, the Keychain and launchd are never touched; processes are stopped by PID only (#668's helpers). Terminal
output goes to `$TMPDIR/deep-668-proof/redraft-1713/terminal.txt`. Delete `node_modules/.vite/` in this folder before
committing.

## Files

- `doctor.test.ts`: both tests, tagged `#668.3ee80c65` as `fast.test.ts` tags its AC4.
- `lane.json`: alone, since it starts hubs and builds deep-hook.
- `tsconfig.json`: the root options with `noEmit`.
- `BASE-FAILURE.txt`: the run at the base.
