# Blind redraft for #994: the first screen on the real window

Issue #1454 asks that "#1002's and #994's first-screen criteria pass on the real window through their blind redrafts". The first draft read the count from `deep-replica --first-screen` and the row from the replica's `window.rs`. A person's first screen is the real `deep-app` window. This folder judges that window. The first draft stays as it is, and the implementing agent doesn't edit these files (AGENTS.md, Proof).

**Status: these tests have never read a real window.** This job's process had no Accessibility or Screen Recording permission, so every window test stopped `BLOCKED`. Their failure messages, sizes and timings are untried, and a dispute over any of them is likely until a first run. See `BASE-FAILURE.txt`.

## What was read

As `../../1002/first-screen-redraft/README.md` lists, plus `tests/acceptance/994/` (README, `helpers.ts`, `app.test.ts`, `taste.test.ts`, `window.rs`) and `tests/acceptance/27/helpers.ts`. No implementation of #1454 was read.

## What is redrafted

| Criterion text | ID | Test | The wrong programs |
|---|---|---|---|
| Scope: "the window's count says the hub isn't answering while it can't read" | none, Scope | `first-screen.test.ts`, "started with no hub answering" and "the count follows the hub" | `plant-spike-window`, in the same file |
| Scope: "a refused poll is counted and shown the same way" | none, Scope | `first-screen.test.ts`, "a refused read" | the same judge as above |
| AC3: "With notifications denied for the app, an open ask's row says not notified" | `AC3 #994.649376f0` | `first-screen.test.ts`, the row, with an allowed control | AC3's planted app, `plant-posts-unchecked`, failing naming the ask |
| AC5: "screenshots of the app window with the hub not answering count, the not notified ask row ..., taken by the check run from the app at the reference window" | `AC5 #994.f8ef6a91` | `shown.test.ts` | the taste judge in `../../1002/first-screen-redraft/judges.test.ts` |

**Stays with the old suite, not about the first screen:**

- AC1, the late hub, and the retry schedule: `../app.test.ts`, the notifier's process rules.
- AC2, one app per user: `../app.test.ts`.
- AC3's `deep doctor` and its log line: `../hub.test.ts`, `../app.test.ts`.
- AC4, sounds and one notification per session: `../sound.rs`.
- The deadline: `deadline-redraft/`.
- The third picture of AC5, `notification.png`: `../taste.test.ts`. It isn't a window of the app, and that test screenshots the whole display, which this job doesn't do. So AC5 now takes two calls, one here on two pictures and one there. The owner should decide whether that split stands.

**About the first screen, not handed to this job, left on the replica:** Scope's "the count says so with the fix", with notifications off or alerts set to none, stays in `../window.rs`. It would fit this suite in a few lines if the owner wants it moved.

## How to run

As `../../1002/first-screen-redraft/README.md` says, for permissions, the lock, windows, builds and the `--root` cache:

```sh
caffeinate -di npx vitest run --root tests/acceptance/994/first-screen-redraft --no-file-parallelism
DA994_SCREENS=<dir> caffeinate -di npx vitest run --root tests/acceptance/994/first-screen-redraft --no-file-parallelism shown
npx vitest run --root tests/acceptance/994/first-screen-redraft judges    # no app, anywhere
node node_modules/typescript/bin/tsc -p tests/acceptance/994/first-screen-redraft/tsconfig.json
```

Homes are #27's, `/tmp/dh27-*/h`. `HOME` is one for every process. Nothing touches the real `~/.deepbuild`. `scripts/lanes.mjs` needs this folder in a macOS, logged-in, `alone` lane. The implementer makes that edit.

## The surface

The real binary with no arguments beside a real hub, in a home `deep setup` set up (`../helpers.ts`, `setUpWorld`), read through `../../1002/first-screen-redraft/window.ts`, one copy for both redrafts. Asks come from a session of the Claude Code stand-in through its own `deep mcp`, after the window is up. Each first-screen judgment runs at the size the app opens at and at the reference window.

One stand-in stays: `DEEP_APP_NOTIFICATION_SETTING`, at the OS boundary, since no test may change System Settings. `../README.md` pinned it, and the base reads it.

### What the implementation must provide, which the issue leaves open

1. **`deep-app` with no arguments opens the window a person gets**, on Needs you for a set-up home, resizable to 1512 × 982, as #1172 pins.
2. **The count while the hub can't be read.** A node's name, the pixels and the menu-bar title all match `hub isn't answering` or `hub not answering`, and no `N asks need you` appears. It is stricter than the first draft, which read one node: a number may be old with the hub down, and the base's `Reach::count` shows none.
3. **The count once the hub answers.** A node and one pixel line hold `0 asks need you`, or `1 ask needs you`, and nothing says the hub isn't answering.
4. **The count follows the hub within 8 s**, two retries and a tick, both ways, while the app runs. Late on a machine loaded over half its cores is INCONCLUSIVE. Never is a failure.
5. **A refused read:** a hub that refuses the app's hello counts as one that can't be read. The test writes a wrong `~/.deepbuild/control.token` under a running hub, which holds its own token from launch.
6. **The ask's row:** exactly one node's name holds the question, and that name says `not notified`. Pixels hold the question and `not notified`. The handle isn't judged here: #1172 does that.
7. **With notifications allowed**, no node or pixel line says `not notified`.
8. **`plant-posts-unchecked` stays a feature of `deep-app`** that leaves the row unmarked, as the base's does.
9. **`DEEP_APP_APPEARANCE=light`** still forces light.

## The taste call

`shown.test.ts` writes `hub-not-answering.png`, `not-notified-row.png` and `run.json` to `$DA994_SCREENS`. `TASTE.json` holds no call, so the run reads INCONCLUSIVE, never PASS, as `../../1002/first-screen-redraft/README.md` describes.

## Disputes and assumptions a redraft may revisit

1. **A stale token as the refused read.** It is a refusal of the hello, the one a real hub gives without a seam. A refused `events.read` on a connection that said hello isn't produced here.
2. **Pixels hold "not notified" somewhere.** The row's name ties it to the ask on the nodes. On the pixels it is only present, since the separator between the question and the words reads unevenly.
3. **The menu bar saying it.** This reads the one count as one, as `crates/deep-app/src/lib.rs`'s `menu_bar_line` does.
4. **8 s** is this job's margin, not the issue's.

## Files

`first-screen.test.ts`, `shown.test.ts`, `judges.test.ts` (no tag, no app), `helpers.ts`, `TASTE.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
