# 0013: The hub's paseo readings and table record, the shell journeys check and the Lean runner's flag

Status: accepted (#3715). The comments these came from were taken out to bring their files back under the comment ratchet's ceilings; the design states the rest of what those comments held (`docs/technical-design.md`, How it installs; `docs/canvas-primitives.md`, Asset: tables and Check input: shell journeys), and the decisions below are the ones written nowhere else.

## What the hub reads of paseo

- **Setup reads paseo before it writes anything, and doctor shows the same readings as paseo's items.** `packages/hub/src/paseo-reading.ts`; `packages/hub/src/setup.ts`, `installPaseo`; `packages/hub/src/doctor.ts`, `paseoItems`. The readings are of the paseo on your PATH: its version against the versions paseo's facts cover, DeepBuild's plugin as paseo lists it (installed, enabled, and loaded or refused with paseo's own reason), and whether the source the facts install from resolves (#3428). Doctor shows the items only with a paseo on your PATH.
- **The facts cover a paseo version only when they list it, never between two listed ones.** `packages/hub/src/paseo-reading.ts`, `paseoCovered` (#1884).
- **Installed counts only once paseo lists the plugin as loaded.** `packages/hub/src/setup.ts`, `installPaseo`; `packages/hub/src/paseo-reading.ts`, `pluginProblem`. A plugin paseo refused is said with paseo's own reason, as what keeps it from gating paseo's agents.
- **An npm source is looked up through npm.** `packages/hub/src/paseo-reading.ts`, `sourceProblem`. It names why the facts' source doesn't resolve.

## A job's table record

- **The cells split by the probe's CSV rule.** `packages/hub/src/table-record.ts`, `rows`. The rule is the one of `crates/deep-catalog/src/cells.rs`: a row ends at LF, a CR before it is outside the cell, and a quoted cell's range is inside its quotes. A blank line is no row (#3570).
- **A column's type is the narrowest every cell it holds reads as.** `packages/hub/src/table-record.ts`, `dtype`. It is `i64`, `f64` or `str`, and a missing (empty) cell reads as any.
- **Bytes with no header get no record.** `packages/hub/src/table-record.ts`, `tableRecord`.

## The shell journeys check (#3605)

- **A level's `done` element turns true only at the shell step its level's own `done` first turned true, and never turns false.** `packages/checks/playtest/shell.ts`, `doneFailures`. That step is the row whose step ran the level's last step and left it.
- **Each level load's own input track is replayed as a piece with no shell.** `packages/checks/playtest/shell.ts`, `replayFailures`; `packages/extension-host/src/shell-plays.ts`, `shellRefusal` and `levelTracks`. At every step the replay's arrays must equal the run's, and at its last step its full-state hash, or the replay fails, naming the first step that differs. So a moves journey's check may replay each level track its plays recorded, each a track of this run.
- **The relaunch journey is four launches over one profile store no other play shares.** `packages/checks/playtest/shell.ts`, `LAUNCHES`, `runShell` and `relaunchFailures`. A relaunch holds from its first row every mark the last launch before it that wasn't fresh left; start fresh holds none. Like the pause journey, it is judged from all its plays together.

## The Lean runner

- **comparator runs with its no-sandbox flag on macOS.** `packages/proof/src/lean.ts`, `LEAN_FLAGS`. bubblewrap doesn't exist there; on Linux comparator runs in its own sandbox.
- **A runner name `RUNNERS` doesn't hold is missing, for a run and for its mutants alike.** `packages/proof/src/check.ts`, `RUNNERS` (#1896).

## What the names mean

- **A row's `done`, `custom`, `values` and `level_hash`.** `packages/checks/playtest/shell.ts`, `Row`. The levels finished, the piece's own settings, the loaded level's arrays and its own full-state hash (#3605).
- **An answer's `level_tracks` and `completions`.** `packages/checks/playtest/shell.ts`, `ShellAnswer`. Each level load's own input track, and each completion's shell step (#3605).
- **An input's `moves`.** `packages/checks/playtest/shell.ts`, `ShellInput`. The moves journey's script, and the relaunch journey's first launch's (#3605).
- **A level load's rows.** `packages/checks/playtest/shell.ts`, `loadRows`. The runs of rows with a level loaded, in load order (#3605).
- **An asset record's `fetched`.** `packages/hub/src/libraries.ts`, `AssetRecord`. The URL the hub fetched the file from and when, in ms: what a table a job read from it traces to (#3570).
- **A job's `fetched`.** `packages/hub/src/jobs.ts`, `JobDeps`. A file the hub fetched through the Source block, by its hash: the URL and the time it fetched it (#1820), else undefined.
- **A listed plugin's state.** `packages/hub/src/paseo-reading.ts`, `ListedPlugin`. As `paseo plugin ls --json` lists it: running, failed (with paseo's error) or disabled.
- **A program that couldn't start.** `packages/hub/src/paseo-reading.ts`, `ran`. Its exit code and output, or null when it couldn't start.
