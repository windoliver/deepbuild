# #935 proof

These are the blind suite's proof files: `tests/acceptance/935/` and `tests/acceptance/935-oracle/`, written from the issue, the design and base `74d867d2`. The job's commit `0cbd7f33` was cherry-picked unchanged as `01b0dfa5`. Each file ran once, with `--no-file-parallelism`, on macOS arm64 with Node 24.22.2, against the implementation commit `1c210043`. AC5 ran again after its refusal also covered a shared document's patches.

All 7 tests passed: AC1 to AC5 one each, and the Oracle lane's two. The model host ran on 127.0.0.1:8719 with its pinned weights. Nothing was sent off the machine and no paid model was called.

The fixtures are made at test time, and their truth is how the test built them:

- **The bed:** 16 bars of 4/4 at 100 BPM, 1,843,200 samples, at −23 LUFS. It is the sum of three stems, drums, bass and pad, each with whole cycles over the region and its drum tails wrapped to the start.
- **The coin pickup:** 12 takes, 3 levels × 4 round robins, at −28, −22 and −16 LUFS.
- **The loudness test set:** EBU Tech 3341/3342, fetched by hash and never redistributed.

| Proof | File | Reading |
|---|---|---|
| The tracker's tempo | `ac1-tracker.json` | `beat-this@1.1.0` reads the clean bed at 100.000 BPM and the bed generated at 96 BPM at 95.996 |
| The clean bed with no record | `ac1-no-record.json` | BLOCKED, naming `beat-this@1.1.0` and the PCM's hash, with no issue |
| AC1's readings | `ac1-gen.json` | The clean bed with its record and stems: PASS, no issue. The 96 BPM bed: FAIL, `audio.gen.tempo` measured 95.996, declared 100. The 38.2 s region: FAIL, `audio.gen.bars` 15.9167 bars of 2.4 s |
| The seam's measures | `ac2-gen.json` | Clean join: step 0.0039 against a 99th percentile of 0.0939, flux 162 against 236. The bed cut 10 ms: `audio.gen.seam` at sample 1842720, step 0.251 against 0.094 (and `audio.gen.bars`, 15.9958 bars) |
| Stems | `ac3-gen.json` | Clean residual −171.8 dBFS. Drums 1 ms late: `audio.gen.stems` names `drums` at −27.50 dBFS |
| Takes | `ac4-gen.json` | The 12 clean takes: PASS, closest pair 3.96 dB apart. One file 12 times: 66 `audio.gen.same` pairs, by hash. The take at +0.4 dBTP: `audio.gen.peak` names `variants/2/takes/1` |
| The refused item | `ac5-real.json` | On a film at revision 0, the strips naming the BLOCKED bed and the hot take are refused with `audio.gen.unpassed` naming each asset. The strip naming a clean take applies as revision 1 |
| AC5's plant | `ac5-planted.json` | `unpassed_on_fail_only` lets the BLOCKED bed's strip through; the judgment fails, naming the bed's asset |
| Oracle: integrated loudness | `oracle-TEST_GLOBAL_LOUDNESS.json` | Signals 1 to 5 read −22.95 to −23.01 LUFS (−32.96 for signal 2's −33 target). Tech 3342 signals 5 and 6 read −22.99 and −23.00. Each is read from audio.gen's own `audio.gen.level` issue |
| Oracle: true peak | `oracle-TEST_MAX_TRUE_PEAK.json` | Signals 15 to 18, lifted 5.8 dB, read −0.20 to −0.19 dBTP; 19 reads +3.01; 20 to 23 read −0.13 to −0.10. Each is read from `audio.gen.peak` |
