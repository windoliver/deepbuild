# 0017: The logic module's circuit judge and its course shell

Status: accepted (#3715). The design states circuit@2 under Logic: library interfaces and the shell's settings and profile record under its shell and Logic: saves (`docs/canvas-primitives.md`); the decisions below are the ones written nowhere else.

## The circuit's table and judge

- **Each fixed frequency counts once, and each set one as a frequency of its own.** `crates/deep-logic/src/circuit.rs`, `build`. A source whose `f` is set counts apart from the sources with a fixed one (#3604).
- **A network is the nodes its parts join, each winding apart.** `crates/deep-logic/src/circuit.rs`, `no_dc_through_transformers`. An ideal transformer passes no DC, so circuit@2 refuses a DC source in a network a transformer's winding joins, naming both (#3604).
- **A fuse or breaker that opened before its heat reached the opening heat is held to the step it would have reached it, at the last current.** `crates/deep-logic/src/circuit.rs`, `Judge::step`. That step is the expected one when its curve had given none (#3604).
- **At a crossing an RCD's residual is the step before's.** `crates/deep-logic/src/circuit.rs`, `Judge::step`. In phase or against it, the residual is the sum of each pole's rms by the sign it has now. At a crossing it is the step before's while the poles' currents haven't changed, and the library's own reading for the one step they changed on (#3604).
- **An RCD's count has reached 1 within the rounding of a sum of rises.** `crates/deep-logic/src/circuit.rs`, `Judge::step`. The count is compared with 1 − 1e-9 (#3604).
- **A part its curve or count opened that the run never opened fails when the rules are read.** `crates/deep-logic/src/circuit.rs`, `Judge::result`. A fuse, breaker or RCD fails there, naming the step that gives it open (#3604).

## The shell's settings

- **A shell setting's track key and read entry is `settings.<name>`.** `crates/deep-logic/src/piece/checks.rs`, `setting_read`. No control's ID can be that (#3605).
- **Each shell setting an item takes has a number control's slot after the item's other read entries.** `crates/deep-logic/src/piece/checks.rs`, `region_map` (#3605).
- **A control that sets one of the piece's own settings takes what it doesn't give from the setting.** `crates/deep-logic/src/shell.rs`, `Shell::of`. Its options, range and increment come from the setting when the control gives none (#3605).
- **A choice's value is its option's index; a toggle flips; a slider's is its value.** `crates/deep-logic/src/shell/rules.rs`, `State::set`; `crates/deep-logic/src/shell/run.rs`, `Run::value`, where a slider's and a toggle's value is the setting (#3605).
- **A screen's boxes are taken from the screen as it draws.** `crates/deep-logic/src/shell/run.rs`, `Run::items` and `Run::prompted`. The shell's arrays are baked in, by `<shell ID>.<array>`, as the screen's flips, keyed copy and drivers read them, so its drivers and flips over them evaluate (#3605).
- **The shell's arrays are baked as a logic item's are.** `crates/deep-logic/src/shell/run.rs`, `Run::baked`. Each element is held from step 0, a bool as 0 or 1 (Logic `logic@1`; the column view).

## The profile record

- **The record is kept in the folder the shell's saves use, apart from any run's save.** `crates/deep-logic/src/shell/profile.rs`, `Keeper`. When the shell starts, the newest record that reads back whole and fits the shell's shape sets its arrays at step 0, named by hash in the start reply; start fresh (the call's `fresh`) starts from the shell's defaults and leaves the record. A step that changes what it keeps writes a new record, as #276's are written: by hash, under a temporary name, renamed once it reads back whole (#1050, #3605).
- **A list's type is its declared one.** `crates/deep-logic/src/shell/profile.rs`, `Keeper::arrays`. A `custom` or `volume` array is f64 even when its values are whole.

## A journey's moves

- **A relaunch journey's first launch plays its moves too.** `crates/deep-logic/src/shell/journey.rs`, `script`. Each move is made with the run's device (#3605).
- **A move ends with any transition settled.** `crates/deep-logic/src/shell/journey.rs`, `moved` (#3605).
- **A move sets a choice to the option that holds the value, and a slider to its increments above its least.** `crates/deep-logic/src/shell/journey.rs`, `moved`.
- **A move's `play: k` plays until the level's step k has run: k + 1 steps.** `crates/deep-logic/src/shell/journey.rs`, `moved`.
- **The level still loaded at a journey's end gives its track so far, too.** `crates/deep-logic/src/shell/journey.rs`, `play`.

## What the names mean

- **`Judge::new`.** `crates/deep-logic/src/circuit.rs`. The rules over `item`'s arrays, each rule's params from `rules` or the pack's defaults, the controls' values from `entries`; or what it lacks: every array they read, by name and type.
- **`Item::settings`.** `crates/deep-logic/src/piece.rs`. The shell settings the item takes, `settings: {name → default}`, read as `settings.<name>`; in `piece/checks.rs` they are held in declaration order (#3605).
- **`Settings::custom`, `Custom`, `Shell::custom`.** `crates/deep-logic/src/shell.rs`. The piece's own settings, `settings.custom`, in the order declared; each is a choice of numbers, a slider over a range, or a toggle; `Shell::custom` gives the place of setting `name` in it. `State::custom` in `shell/rules.rs` holds their values in the same order (#3605).
- **`Keeper::done_in_save`, `Plants::done_in_save`.** `crates/deep-logic/src/shell/profile.rs`, `shell/run.rs`. Planted: `done` kept in a run's save rather than the record, so a new run loses the marks (#3605).
- **`Plants::done_on_enter`.** `crates/deep-logic/src/shell/run.rs`. Planted: a level marked done when it is entered (#3605).
- **`Plants::setting_in_read_region`, `LevelRun::hides_settings`.** `crates/deep-logic/src/shell/run.rs`. Planted: a setting handed through the level's read region with no entry on its track; the setting entries the level read are left off the track it gives (#3605).
- **`LevelRun::given`.** `crates/deep-logic/src/shell/run.rs`. Each setting the level takes that the shell declares: its place in `custom` and the value its track last gave it (#3605).
- **`LevelRun::given_track`, `LevelRun::track`, `Run::tracks`.** `crates/deep-logic/src/shell/run.rs`. `{level, entries, steps}`: a load's track and the steps it ran. The track is every entry in time order, as a piece's replay reads it; `tracks` holds each load's in the order levels were left.
- **`Run::completions`.** `crates/deep-logic/src/shell/run.rs`. Each completion, `{level, step}`: the shell step at which the level's own `done` turned true (#3605).
- **`Screens::texts`.** `crates/deep-logic/src/shell/run.rs`. Each text item the document draws at `size`, with the string it shows (#3605).
- **`Keeper::open`.** `crates/deep-logic/src/shell/profile.rs`. Its reply is `{record, damaged, notices}`, as #276's start reply.
