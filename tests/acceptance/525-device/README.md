# #525 on this Mac's own sound output

A gap test, written by the implementer after the blind suite (`../525/`) passed. That suite plays every live lab through
#499's test audio backend on a virtual clock, so nothing in it reaches a real output device. These tests play the same
labs (`../525/helpers.ts`: The lab) out loud on the default output, in real time, and hold the same criteria there:

| Test | Criteria | What it asserts | Wrong program it fails on |
|---|---|---|---|
| 1 | `#525.bc91e6a4`, `#525.06f030c7` | the dropped ball plays 10 minutes with no underrun; no block renders before its world stepped one block past its first sample; the PCM rendered for the device hashes as `media_mix`'s over the same samples, whose first clack starts on its step's own sample (400 k) | the base: `soak` refuses a live world (`unbaked_list`) |
| 2 | `#525.bc91e6a4` | the first hit's step 20 ms late counts one underrun and the PCM still equals the replay's | `late_step_moves_voice`: renders past the late step, counts none and moves its voice |
| 3 | `#525.316e3bea` | a scripted press of `go` at 3 s is an entry no earlier than the first sample not yet written; the device's PCM equals the replay of the recorded track, the ping starts on the entry's sample and the clack within five steps of 60 past the launch | `entry_stamped_at_frame`: the entry takes the sample the device plays, so it lands before the first sample not yet written |

## The surface

`deep-show run`'s `soak` (#501), as #525 extends it for a media document whose worlds play live:

- `{"call": "soak", "media", "seconds", "presses"?: [{"at": host flicks after the play starts, "control", "value"?}]}`;
  the scenario's `delays` and `planted` as `../525/` uses them.
- The reply adds `blocks: {rendered, behind}`, `handed: {frames, sha256}` (every sample rendered from the document's
  0, interleaved f32le), `presses: [{at, control, t, unwritten}]`, `input_track` (the entries, as `media_mix`'s
  `track` takes them), `device: {buffer}` (the most frames one callback asked for) and `mixer: {cpu, played}`
  (seconds). `stats.underruns` counts stretches of short device callbacks.
- The live mixer writes 512 frames ahead of a 256-frame device buffer (about 10.7 and 5.3 ms) on a time-constraint
  thread, so a step 20 ms late can't be covered and other work on the machine doesn't starve it.

## Run them

```sh
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/525-device --testTimeout=3000000 --no-file-parallelism
```

The sound plays out loud. Real time counts only on a reference Mac on mains power, Low Power Mode off and the thermal
state nominal (`../501/helpers.ts` `referenceMacProblem`); anywhere else each test is INCONCLUSIVE, and with no output
device BLOCKED. `scripts/lanes.mjs` lists the folder as `alone`, `timed` and `slow`.
