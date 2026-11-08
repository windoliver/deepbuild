# Blind redraft for #1002: the first screen on the real window

Issue #1454 asks that "#1002's and #994's first-screen criteria pass on the real window through their blind redrafts", and that "the first screen's proof moves to the pane a person gets: Set up on the real window". The first draft read `deep-replica --first-screen`, a replica that draws Home. A person's first screen is the real `deep-app` window. This folder judges that window. The first draft stays as it is, and the implementing agent doesn't edit these files (AGENTS.md, Proof).

**Status: these tests have never read a real window.** This job's process had no Accessibility or Screen Recording permission, so every window test stopped `BLOCKED`. Their failure messages, sizes and timings are untried, and a dispute over any of them is likely until a first run. See `BASE-FAILURE.txt`.

## What was read

- `AGENTS.md`, the Proof section, and the Dogfooding bullet in `docs/technical-design.md`.
- Issues #1002 and #994. #1454 only for the sentences that name this job, and its opening size, 960 × 640.
- The design: How it installs, States people see, First-party extensions that ship on by default, An ask and your answer getting back, Replica, and the reference window under Decided.
- The base, `c12a65bb`: `tests/acceptance/1002/`, `994/`, `1172/` (README, `helpers.ts`, `probe.swift`, `welcome.test.ts`, `shown.test.ts`), `crates/deep-app/src/{main,lib,views,setup,notify,record,single}.rs`, `packages/hub/src/setup.ts`.

No implementation of #1454 was read: no other branch, worktree or PR.

## What is redrafted

| Criterion text | ID | Test | The wrong programs |
|---|---|---|---|
| AC1: "With Claude Code's settings file unparseable, Set up fails naming the file; reopening the app offers Set up again with that reason, and the count reads setup didn't finish, never 0" | `#1002.4273b842` | `first-screen.test.ts`, first test | `twins.test.ts`: spike window, record first |
| AC1: "the merge base opens on "0 asks need you" and fails, naming the count"; Scope: "offer Set up while that record is missing, whatever else exists" | `#1002.4273b842` | `first-screen.test.ts`, "whatever else exists" | the base itself, if the reading from code holds (`BASE-FAILURE.txt`) |
| AC2: "After the file is fixed, Set up from the app finishes, writes its record, and the next `deep` command runs no setup" | `#1002.8e3f037e` | `first-screen.test.ts`, third test | `twins.test.ts`: no record |
| AC2: "a setup whose hub doesn't start is offered again the same way" | `#1002.8e3f037e` | `first-screen.test.ts`, fourth test | `twins.test.ts`: record first, hub dead |
| AC3: "Shown to you: screenshots of the app offering Set up again with the reason, and the count reading setup didn't finish, taken by the check run from the app at the reference window" | `#1002.1f6f1740` | `shown.test.ts` | `judges.test.ts`, the taste call |

**Stays with the old suite, not about the first screen:** `../cli.test.ts`, the first `deep` command's half of AC1 and AC2, and `../twins.test.ts`. The record's shape stays pinned there.

**Superseded here, kept there:** `../app.test.ts` and `../screens.test.ts` read the replica. This folder doesn't touch them.

**In the Scope, tested nowhere here:** "never 0 or an empty Needs you". No criterion names the view, and this suite doesn't open it.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm ci --ignore-scripts; npm run build --workspaces`), cargo and `swiftc` on `PATH`, on macOS with the screen unlocked, and with Accessibility and Screen Recording granted to the process that runs the tests:

```sh
caffeinate -di npx vitest run --root tests/acceptance/1002/first-screen-redraft --no-file-parallelism
DA1002_SCREENS=<dir> caffeinate -di npx vitest run --root tests/acceptance/1002/first-screen-redraft --no-file-parallelism shown
npx vitest run --root tests/acceptance/1002/first-screen-redraft judges    # no app, anywhere
node node_modules/typescript/bin/tsc -p tests/acceptance/1002/first-screen-redraft/tsconfig.json
```

- **Permissions.** `probe access` reads them and the lock. Without them, or with the screen locked, a window test fails `BLOCKED`, never passes. In Claude Code the Bash tool's sandbox hides them, so run outside it.
- **Real windows.** Each launch opens the real app on your screen and brings it forward. Nothing clicks with your mouse: a press is the one a screen reader sends.
- **Builds.** The helpers build `deep-app` and its plants and copy each to `$TMPDIR/da-first-screen-bin-<uid>`. `deep-hook` is built by `../helpers.ts`. No `Cargo.toml` was edited: `plant-spike-window` and `plant-posts-unchecked` are already there.
- **Folders.** Homes are `/tmp/da1002-*/h`. Nothing touches the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`. Processes stop by PID. Screenshots are of one window, never the display.
- **`--root` cache.** Vitest writes `node_modules/.vite/` here. Delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs this folder in a macOS, logged-in, `alone` lane. The implementer makes that edit.

## The surface

The real binary with no arguments, in a temp home whose `PATH` holds `../helpers.ts`'s stand-ins, read through `probe.swift`, `screencapture -l<window>`, `sips` and Vision. `probe.swift` is #1172's with two additions: `access` reports the lock, and `press` can match a name exactly. `window.ts` is #1172's approach, shared with `../../994/first-screen-redraft/`.

**Each first-screen judgment runs at two sizes:** the size the app opens at, whatever that is, and the reference window, 1512 × 982. A criterion holds only at both. The design names the reference window for first-screen criteria. #1454 names the gap with 960 × 640, the window a person gets.

### What the implementation must provide, which the issue leaves open

1. **`deep-app` with no arguments opens the window a person gets**, resizable through the Accessibility API to 1512 × 982, at any opening size.
2. **The one Set up button:** a node with role `AXButton`, named exactly `Set up`, that takes `AXPress`, inside the window's frame, drawn so Vision reads a line that is exactly `Set up`. At the base `Set up` takes the press, as #1172's README records.
3. **The window's count in words.** A node's name and the pixels both match `set up didn't finish`, spacing and apostrophe free. Where it sits is free. `0 asks need you` appears on neither.
4. **The menu-bar item says it too.** Its title matches the same words. Empty or a bare number fails. This is stricter than the first draft, which required only "not empty, not a number": the design has one count, and a person sees the menu bar without the window.
5. **The reason, on the nodes and on the pixels.** For the settings file: the path, or `~/.claude/settings.json`, and `fix`. For the hub: `hub` and `start`.
6. **Set up's own failure shows on the window.** The pixels name `.claude/settings.json`, or the hub. The press may hold the app while setup runs, and the tests retry their reads for up to 3 minutes. The base's failure line has no node, so pixels alone are judged here.
7. **The app runs the `deep` on `PATH`**, as the base's `setup::set_up` does, carrying `DEEP_HUB_LAUNCHER`. The stand-ins and twins enter there.
8. **SIGTERM ends the app** and frees its claim on the home, so a test can reopen it.
9. **A finished setup in the same window:** no `Set up`, and nothing reading setup didn't finish, within 30 s of the record, and after reopening.
10. **`DEEP_APP_APPEARANCE=light`** still forces light. Every launch sets it, since the reference window is light.
11. **The finished record** stays `~/.deepbuild/setup-finished.json` with `version` equal to `deep --version`, as `../README.md` pins.
12. **A folder with no finished record offers Set up**, even with a hub answering and no reason kept. It reads setup didn't finish. See the first dispute.

## The taste call

`shown.test.ts` writes `set-up-again-settings.png`, `set-up-again-hub.png` and `run.json`, the app's SHA-256, to `$DA1002_SCREENS`. Each picture is 3024 × 1964 px from the real window. A picture of another size is INCONCLUSIVE. The judges only confirm the state. Nothing reads a picture to judge how it looks.

`TASTE.json` is #1172's shape, with `verdict` null until a person calls it. No call, no person, or other pictures reads INCONCLUSIVE, never PASS. `looks_wrong` fails, quoting the note. A kept folder holding a recorded call's files, from the same app, stands. "Attached to the PR and shown to you" no test can see: the implementing agent does it.

## Disputes and assumptions a redraft may revisit

1. **"Whatever else exists".** The base decides otherwise on purpose: `setup.ts` says a folder with neither record "is a home set up before these records, or a hub run on its own, and is left as it is". The issue's Scope says "while that record is missing, whatever else exists", and the blind job follows the issue. It is the one real run this job could find where the base opens on "0 asks need you", the failure AC1 names. It has its own test, so a dispute can drop it alone. The CLI's check (`packages/cli/src/main.ts`) has the same condition, and this suite doesn't test it.
2. **The merge base.** The issue's "merge base" is #1002's, whose real window was #337's spike. Building it is out of scope here. `record-first` shows the judge failing on a real window that reads "0 asks need you", and `plant-spike-window` stands in for the spike.
3. **Pixels and nodes both.** A person reads pixels and a screen reader reads nodes, so the count, Set up and the reason must hold on both. Vision can misread on a loaded Mac or a long wrapped path. Words are compared squashed, with lines joined, which limits that but doesn't remove it.
4. **Opening size.** The Welcome pane's text at 960 × 640 is untried. A reason cut off there fails here, as it would for a person.
5. **A press is not a mouse click**, as in #1172's README.
6. **The twins plant `deep`, not the app.** They show the real app trusting a wrong setup. The app-side wrong program is the spike. The written readings in `judges.test.ts` cover a lost reason or a button only a screen reader gets.

## Files

- `first-screen.test.ts`: the tagged tests. `twins.test.ts`: wrong programs on the real window, no tag. `judges.test.ts`: written readings and the taste call, no tag, no app. `shown.test.ts`: the capture.
- `helpers.ts`: launches, judges, planted `deep`. `window.ts`: the outside reader. `probe.swift`. `TASTE.json`. `tsconfig.json`. `BASE-FAILURE.txt`.
