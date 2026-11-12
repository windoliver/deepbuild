# #1468 screenshots

Each picture shows a terminal session that `script` recorded byte for byte while it ran [`../shots.sh`](../shots.sh), then redacted as below. Each was drawn from the committed recording next to it by [`../term_png.py`](../term_png.py), with this machine's DejaVu Sans Mono and Pillow. Redrawing one with its title below gives the same pixels:
- `e2e-base`: `#1468 e2e on main 1abbcf086, the PR's merge base (no fix)`
- `e2e-fix`: `#1468 e2e on 7f35ecd72 (with the fix)`
- `acceptance-base`: `#1468 blind acceptance suite on main 1abbcf086, the PR's merge base (no fix)`
- `acceptance-fix`: `#1468 blind acceptance suite on 7f35ecd72 (with the fix)`

- **What's recorded.** `shots.sh` prints each command before it runs it, and its exit code after. Each picture's header prints the commit and `git status` of the tree it ran in. The base has no copy of these scripts, so `shots.sh` and `e2e.py` came from the fix tree for both runs, as each `$ python3` line shows.
- **The logs.** The `.typescript.txt` next to each picture is that recording. In it, the home folder is written `~` and the scratch folder `<scratchpad>`.
- **Load.** A wait loop outside `shots.sh` started each recording only once the one-minute load was under 6 on this 20-core Linux aarch64 machine. Each header prints the load at the start, and the recordings ran one after another.

**The two trees:**
- **Base:** main `1abbcf086`, the PR's merge base, in a separate clone.
  - The suite needs `tests/acceptance/1468/` and its `[[test]]` entry in `crates/deep-motion/Cargo.toml`. They are the only changes there, and each base picture's `git status` lists them.
  - `target` is a link to that clone's build folder. Each tree runs its own build: the test binary has the same name in both, but they are different files in different folders.
- **Fix:** commit `7f35ecd72`, as printed, with a clean `git status`. The commit that adds these pictures is its child and changes only `docs/evidence/1468/shots/`.

| Picture | What it shows |
|---|---|
| [`e2e-base.png`](e2e-base.png) | **Requests.** Each binary gets two documents written to one process: one holding 1,000,000 parens, then one holding a single paren. The pack rule's second document is a second pack, `shallowrule`, because one id installs only once. **Result.** `deep-motion eval` (driver) and `deep-show run` (pack rule) both die by signal 6 (stack overflow), and neither reply comes. `e2e.py` then exits 1. |
| [`e2e-fix.png`](e2e-fix.png) | **Requests.** The same requests, on binaries built at `7f35ecd72`. **Refusals.** The driver is refused at `drivers/deep/expr`, and the pack rule at `recipes/deeprule.probe@1/rules/0/expr`; each "nests past the cap of 64 levels". **After.** The same process then answers the second document: the driver with `"ok": true`, the pack with `"outcome": "installed"`. Each binary exits 0. `e2e.py` exits 2, because the field binary isn't built (below). `deep-show run` puts each call's outcome inside an envelope whose own `"ok": true` means the line was read. |
| [`acceptance-base.png`](acceptance-base.png) | **The suite.** The blind suite (`tests/acceptance/1468/`) on the base: 4 pass, 10 fail, 1 ignored. **Failures.** Every AC1, AC3 and AC4 child dies by signal 6. AC2's depth-65 cases all parse. Each AC1 and AC3 failure prints its line twice: once as the test prints it, once as its panic message. **Passes.** The 4 that pass are the two planted parsers, depth 64, and the shallow control. **Planted runs.** Two more commands run the planted parser (no cap) alone in the suite's child, on 1,000,000 `(` and on the 10,000-term tower; each dies by signal 6. |
| [`acceptance-fix.png`](acceptance-fix.png) | **The suite.** 14 pass, 1 ignored. **Times.** Each AC1 and AC3 line shows the child's refusal, "nests past the cap of 64 levels", and its `ms`: 0.06 to 2.6 ms. That figure is timed inside the child, from the parser call to the dropped result. It leaves out starting the process and building the string. **Planted runs.** The planted parser still dies by signal 6. That death is what the planted tests check, and the red `[exit 101]` under each of those runs is the expected result. |

The ignored test, `child`, is the suite's child process. The other tests start it themselves with `DEEP_1468_CHILD` set (`depth.rs`), and alone it does nothing.

## What these pictures don't show

- **The field binary.** `deep-canvas-render` doesn't build at either commit on this machine.
  - **Why.** `gpui-pre-wgpu` 0.3.9, from crates.io, doesn't cover the `PrimitiveBatch::Chrome` variant that main's vendored `gpui-pre` added. It did build at an earlier main, as [`../e2e.txt`](../e2e.txt) shows.
  - **In the pictures.** Each e2e picture shows that build failing, cut by `grep` to the error's first lines, and the field case reads `BLOCKED`.
  - **What stands in.** In these pictures, the field is covered only by the suite's `ac4_a_field…` test, which fails on the base and passes on the fix. It builds the text item's animator and calls `deep_canvas_marks::animator::amounts` in a child process, then asks the same process for a shallow field. It doesn't load the document through a binary. An earlier run, at an earlier main where the binary built, shows `deep-canvas-render` refusing at `items/words/params/animators/0/selectors/0/field/expr` ([`../e2e.txt`](../e2e.txt)).
- **AC2's values.** AC2 shows only as verdicts: depth 64 and depth 65 read `ok` on the fix, and the base shows the six depth-65 constructs parsing. The pictures don't show the depth-64 values or the refusal's text. The test (`depth.rs`) runs depth 64 on a `1 << 20`-byte thread, requires `cfg!(debug_assertions)`, and requires depth 65's refusal to name the cap. The pictures do show `[unoptimized + debuginfo]`.
- **Build warnings.** The build step shows only each diagnostic's first line, through `grep`. The warnings are main's, the same at both commits, in crates this PR doesn't touch.
- **Cut values.**
  - Every value `e2e.py` cuts to fit the screen says so where it's cut: long strings (here the driver's `call` and the pack's `actual`), lists past 6 items, and `frames`, `texts` and `glyphs` (here only `frames`).
  - 64-hex hashes show their first 12 characters.
  - stderr is shown only on a crash, and then only its last 2 lines; the picture says so.
  - The core cuts an issue's `actual` to 8,192 characters before `deep-show` prints the pack refusal (`Issue::to_json` in `crates/deep-canvas/src/document/mod.rs`), and `e2e.py` cuts it again.
- **The refusal's hint.** The pack refusal carries `out_of_range`'s generic hint, "Give the field a value of its type inside its range". On main every recipe rule refusal over `out_of_range` carries that hint, and a rule naming a missing module is refused as `module_missing`. This change doesn't touch either.
- **Checking the hashes.** The sha256 lines hash the copies the e2e ran: each binary is copied right after its build into a fresh `mktemp` folder.
  - A later `cargo test` relinks `target/debug/deep-motion` to a build with the test's features.
  - The hashed binary stays in `target/debug/deps/` under its own name.
  - The hashes can be checked only on this machine.
- **Colours.** `term_png.py` colours each line by matching words in it, not by the test's verdict.
