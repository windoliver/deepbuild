# #458 evidence

Made on 2026-11-16 on an Apple M5 Max (macOS, arm64), from this branch's `deep-show`.

- `quick-lane.json`: the record `node scripts/parity-suite.mjs run quick` printed over the shipped suite
  (`scripts/parity-suite.json`): the 149 fixtures the kit's manifest lists, each PASS on Vello CPU with every planted
  twin FAIL. The eight seek-against-play fixtures list their `snapshot` comparison with its planted mismatch (`moved`)
  failing it; 119 fixtures fail on a planted item of an unknown kind and 17 on a planted item with a missing parent;
  the eight scenes that raise a code raise none with their calls dropped; the bell scene raises one under a planted
  call; and the four scenes the kit's own parts run fail under their planted programs (`part_runs_half`,
  `fuzzer_runs_none`, `stale_fix_never_rebases`, `accepts_agent_decisions`). The run took 2 min 32 s under a load
  average over 400.
- `suite-tests.txt`: the suite group's blind tests (`tests/acceptance/458/suite/`, criteria 1 to 6 and 8) on this
  branch, 12 of 12.
- `pairs-tests.txt`: the pairs group's blind tests (`tests/acceptance/458/pairs/`, criteria 7, 9 and 11) on this
  branch, each file run once: the 25 instances against the 25 items in the ID, normal, depth and velocity targets at
  10 times, with `instanced_skips_velocity` failing the velocity target alone; the five pairs with no golden, with
  `expansion_drops_stroke` failing the recipe's pair at the dropped stroke's first pixel; and the generated figures,
  films and programs, with `gpu_layer_multiply_as_screen` and `rewrite_rotl_as_rotr` each failing on its seed.

The fixture scan over the checkout (`node scripts/fixture-scan.mjs`) read 206 files and fixtures and found nothing.
