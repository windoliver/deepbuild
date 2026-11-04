# Evidence for #1002: a Set up that didn't finish is offered again

The reference Mac ran these at 58065355, which is the change merged with origin/main d07ce8d2. The Linux box (spark-c89f) ran the CLI half.

## The acceptance tests (`tests/acceptance/1002`)

| Criterion | Tests | This change, on the Mac | Merge base 407d600d |
|---|---|---|---|
| `#1002.4273b842` | `cli.test.ts`, `app.test.ts` | pass, in two runs | fail: `deep status` runs no setup again; `deep-replica: unknown argument --first-screen` |
| `#1002.8e3f037e` | `cli.test.ts` ×2, `app.test.ts` ×2 | pass, in two runs | fail, the same |
| `#1002.1f6f1740` | `screens.test.ts` | pass, in two runs, on the taste call in `taste.json` | fail |

The twins and controls in `twins.test.ts` pass, 9 of 9, both here and at the base. On Linux the CLI half passes and the macOS tests are BLOCKED.

## The screenshots

The check run takes these at the reference window, 1512 × 982 points at 2×, light. Both runs gave the same bytes, and they are the bytes the taste call names.

- `first-screen-settings.png`, `54020635…`: Home after setup stopped on an unparseable `~/.claude/settings.json`.
- `first-screen-hub.png`, `b80873c3…`: Home after the hub didn't start.

## The real app, by hand

Run with a temporary HOME and the launcher stand-in, so the real launchd and `~/.deepbuild` were never touched. The app and the hub were stopped by PID.

- `e2e-stopped-window.png`: the welcome after `deep-app --set-up` failed on `{ not json`. It shows Set up and the whole reason with its fix.
- `e2e-stopped-menubar.png`: the menu bar reads "Setup didn't finish". Taken at 387c3a68. At 58065355, macOS put the status item under the notch, so it could not be captured; the replica's `menu-bar.txt` check passed.
- `e2e-finished-window.png` and `e2e-finished-menubar.png`: after the file was fixed, Set up finished and wrote `{"version":"0.0.0"}`. The reopened app offers no Set up.

## Other suites on the Mac at 58065355

- `tests/acceptance/326/setup`: 12 of 12 pass.
- `tests/acceptance/19/setup`: 14 of 14 pass.
- `cargo test -p deep-app -p deep-replica`: 6 test files fail, and each fails the same way on origin/main d07ce8d2: acceptance_1141, acceptance_34 ac11, acceptance_326_panels_planted, acceptance_327_card ac5, acceptance_992_app outside its harness, and headless `replica_equals_live_tree`.
