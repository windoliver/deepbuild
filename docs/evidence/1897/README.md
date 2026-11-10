# #1897 evidence

Made on 2026-11-10 on an Apple M5 Max (macOS, arm64), from this branch's `deep-show`.

- `seek-against-play.json`: the ticking board of the blind suite (`tests/acceptance/1897/`, `TICK_BOARD`) at its 18
  named times. For each time, the GPU pixel hash (128 bits, 16 bytes read back) of the canonical render reached by
  playing to it and by seeking to it, and the `document.determinism` verdict row. `honest` agrees at every time and
  passes, holding on `machines: same`; `checkpoint_nearest_in_distance` (#488's planted restore) differs one flick
  before each checkpoint, first at 352,799,999 flicks, and fails naming those times.
- `record-darwin-arm64.json`, `record-darwin-x86_64.json`: `determinism` with `compare: cross_machine` on the blind
  suite's sliding board at 0, 1 s and 2 s − 1 flick. The first from the arm64 build; the second from the x86_64 build
  (`cargo build --target x86_64-apple-darwin`) run under Rosetta, which the record marks `emulated: true` (canvas
  primitives: Golden). Their Vello CPU rasters (f32 pipeline, scalar level) and evaluated data are identical, so the
  blind AC2 test, pointed at the second with `DEEP_1897_OTHER_RECORD`, passes with `machines: any`. A native x86_64
  machine's record has not been taken.

The x86_64 binary loads `libswiftCoreMedia` through `@rpath`, which an x86_64 build at the default deployment target
leaves unset; the copy that made the record had `/usr/lib/swift` added as an rpath (`install_name_tool -add_rpath`) and
was signed ad hoc. No code differs from the branch.
