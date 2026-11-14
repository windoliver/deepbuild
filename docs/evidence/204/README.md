# #204 proof

The blind suites `tests/acceptance/204/` and `tests/acceptance/204-oracle/` were written from the issue, the design and
base `4a0910cf4`; the job's commit `5f64ee5ce` was cherry-picked unchanged. AC7's redraft `tests/acceptance/204-redraft-ac7/`
came from a fresh run of that job, commit `ebb971ab3`, cherry-picked unchanged (why: its `DISPUTE.md`). Each file ran
once on the change, with `--no-file-parallelism`, on macOS arm64 (Mac17,10) at a load average of 130 to 180 on 18
cores. Nothing was sent off the machine.

| Criterion | File | Result |
|---|---|---|
| AC1 `#204.47d50ee6` | `204/engine.test.ts`, `204-oracle/osc-basic-waveform.test.ts` | PASS: the engine's 0 to 4 s within −80 dB of sin 2π(60t + 15t²); `synth_holds_params_per_frame` fails in block 0. The four upstream sine cases at 44.1 kHz pass their thresholds and SNR |
| AC2 `#204.a92b7fff` | `204/seek.test.ts` | PASS 3/3: seeks to 9 s and 9 s + 37 samples at 48 and 44.1 kHz equal playing at the master and every node; `osc_phase_f32` names `tone`, `synth_grid_from_seek` names `filter` |
| AC3 `#204.0e49d0c7` | `204/logic.test.ts` | PASS 2/2: the ramp inside block 750 in the bake and live; `synth_reads_logic_per_frame` names block 750 in both |
| AC4 `#204.9195397b`, AC10 `#204.f87a60ba` | `204/pack-check.test.ts` | PASS 2/2: `howl@1` refused at `edges/2`, `wobble@1` naming `grains`, `heavy@1` naming its cost; `ring@1` refused naming `regen`, 1.05 and sample 69600; the fixed presets install |
| AC5 `#204.5aacbddd` | `204/gate.test.ts` | PASS: silent before your gesture; each strip at most −1 dBTP after it; `synth_bypasses_master` names `hot` |
| AC6 `#204.9d525978` | `204/spawn.test.ts`, `204-oracle/sample-accurate.test.ts` | PASS: 50 onsets within a sample and pitches within 1 Hz; seeks replay the voices; `spawn_synth_starts_next_block` names hit 0 (hit 1 in the port) |
| AC7 `#204.4e815a43` | `204-redraft-ac7/export.test.ts` | PASS 3/3 (the redraft). The first draft's `204/export.test.ts` fails before any export: `deep show` refuses its film's `layers` |
| AC8 `#204.0458a4e3` | `204/budgets.test.ts` | Perf-lane task test PASS. Both limits INCONCLUSIVE (thermal state "fair", load above the cores): 32 voices 5.9 to 9.0 s wall; a seek 40 to 296 ms wall. CPU time of one whole 32-voice run: 0.67 s user (0.25 s for one voice) |
| AC9 `#204.33127906` | `204/ring.test.ts` | PASS: within 20 checkpoints' bytes, 4 s apart; seeks to 30.5 and 59.9 s equal playing; `synth_ring_drops_oldest` renders the 30.5 s seek from 0 |
| AC11 `#204.2ade263b` | `204/silence.test.ts` | PASS: six nodes write exact zeros; `shaper_bias` names `shaper` only |
| AC12 `#204.ba5e9d18` | `204/tail.test.ts` | PASS: the tail is the law's, and the output is under −120 dBFS by it; `synth_tail_halved` names the preset and its level |
| AC13 `#204.cb2d85e8` | `204/spawn.test.ts` | PASS: hit B after the steal equals a fresh voice at every node; `steal_keeps_filter_state` names `filter` |
| AC14 `#204.fe8c5ca9` | `204/budgets.test.ts` | INCONCLUSIVE (as AC8): 8.2 to 21.1 s wall. CPU time of one whole install of the 50-preset pack: 2.35 s user |
| AC15 `#204.a523543e` | `204/nodes.test.ts` | PASS: the shaper and the 8-bit crush within 10⁻⁶ of their f64 laws, and seeking equals playing; `crush_7_bits` names `crush` only |

Also run once: `cargo test` of deep-canvas-media (85 unit tests), deep-synth-job (1), deep-canvas-motion's score tests and
deep-show's synth test; clippy `-D warnings --no-deps` on the four touched crates; `tests/score-synth.test.mjs` (a pack
preset's note is the wasm build's render); the #154 qualification fixture renders its pinned meta and stem hash; the
canvas kit (media PASS with its new `registries` part; core's `time_order` FAIL on `code-pack-missing.board` and
motion's catalog FAIL are main's, the first unchanged with media's registry taken out); canvas-lint, size-ratchet,
plant-lint, canvas-closures and public-text report nothing in this change's files.

A gap past the criteria, inside the Scope: `tests/acceptance/204-gaps/registry.test.ts` (implementer's) holds that an
installed pack's presets are entries of `synth.preset@1` in `deep://registries`. It failed on the host before the fix
(`expected [] to deeply equal [ …(2) ]`) and passes after it.

A demo film, exported and checked outside the suites: a car speeds from 0 to 30 m/s over 4 s, holds, brakes to 8 m/s
and holds, with an engine preset (a saw at 45 + 3 × speed Hz, a sub sine an octave below, brown noise, a lowpass that
opens with speed) and a horn strip at 6.5 s. Exported as H.264 with AAC (640 × 360, 30 fps, 10 s). In its mix, the
engine's fundamental (the sub's period) follows 22.5 + 1.5 × speed within 0.95% over 89 windows of 100 ms, reading
67.50 Hz at 30 m/s and 34.50 Hz at 8 m/s; the horn's 415 Hz is 10,000 times stronger in its window than before it;
the master peaks at −8.5 dBFS.

Not run: neighbouring suites, `node scripts/affected.mjs`, the preflight, and the perf lane's merge-base comparison.
