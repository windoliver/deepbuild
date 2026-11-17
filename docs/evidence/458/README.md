# #458 evidence

Made on 2026-11-17 on an Apple M5 Max (macOS, arm64), from this branch after its merge of main, each file run once.

- `quick-lane.json`: the record `node scripts/parity-suite.mjs run quick` printed over the shipped suite
  (`scripts/parity-suite.json`): the 149 fixtures the kit's manifest lists, each PASS on Vello CPU with every planted
  twin FAIL. The eight seek-against-play fixtures list their `snapshot` comparison with its planted mismatch (`moved`)
  failing it; 119 fixtures fail on a planted item of an unknown kind and 17 on a planted item with a missing parent;
  the eight scenes that raise a code raise none with their calls dropped; the bell scene raises one under a planted
  call; and the four scenes the kit's own parts run fail under their planted programs (`part_runs_half`,
  `fuzzer_runs_none`, `stale_fix_never_rebases`, `accepts_agent_decisions`).
- `full-lane.json`: the record `run full` printed: the eight relation fixtures on Metal on this adapter, each with its
  planted program failing it. Seven PASS. `parity/relation/light-level.scene` reads BLOCKED by its waiver in the suite
  file: the renderer's 16-bit float linear target holds a pixel to about 1e-3 relative, and the relation asks 1e-4.
- `release-report.json`: what `report` printed over that store: the bar holds, with 157 fixtures and no failure. The
  cross and oracle lanes have no fixture yet, so they ran nothing.
- `suite-tests.txt`: the suite group's blind tests (`tests/acceptance/458/suite/`, criteria 1 to 6 and 8), 12 of 12.
- `pairs-tests.txt`: the pairs group's (`tests/acceptance/458/pairs/`, criteria 7, 9 and 11), 4 of 4: the 25 instances
  against the 25 items in the ID, normal, depth and velocity targets at 10 times, with `instanced_skips_velocity`
  failing the velocity target alone; the five pairs with no golden, with `expansion_drops_stroke` failing the recipe's
  pair at the dropped stroke's first pixel; and the generated figures, films and programs, with
  `gpu_layer_multiply_as_screen` and `rewrite_rotl_as_rotr` each failing on its seed.
- `relations-tests.txt`: the relations group's (`tests/acceptance/458/relations/`, criteria 10, 12, 13 and 14).
  `relations.test.ts` (criterion 10): 2 of 2. `translation.test.ts` (criterion 13): 2 of 2.
  `software-adapter.test.ts` (criterion 12): the seam's software adapter leg passes; the leg on a real software
  adapter through the Vulkan loader is BLOCKED on this Mac, as the test itself reads it, and is owed on Linux.
  `light-level.test.ts` (criterion 14): the planted cut fails and names `lamp-far`; the rule itself fails at 1e-4,
  which is the waiver above. That output is cut to its first and last lines.
- `rect-tests.txt`: the rect group's (`tests/acceptance/458/views/rect/`, criteria 15 and 16): 5 of 5 fail on
  `unknown call`. `view_rectangle` isn't built.

The fixture scan over the checkout (`node scripts/fixture-scan.mjs`) read 220 files and fixtures and found nothing.
