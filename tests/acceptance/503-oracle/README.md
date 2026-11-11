# Acceptance tests for #503, Oracle lane: FFmpeg's FATE recipes and one upstream engine's WAV cases, run on our decoders

Written first, blind, from issue #503 (`gh issue view 503 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/503.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the upstream files that page
vendors (read from `doneright/oracles/vendor/…` at that ref; FFmpeg's `tests/tiny_psnr.c`, `tests/fate-run.sh`,
`tests/audiogen.c` and `tests/Makefile`, which it doesn't vendor, from GitHub at the pinned commit), the #503 suite's
surface (`tests/acceptance/503/`) and the base commit `014344430`, by a job that never saw an implementation; none
exists at the base, and no other worktree, branch or PR was read. #136's rule applies: a linked test counts only when
run against our output, so every recipe here runs its sample through the decode worker (`deep-show run`'s
`media_decode`). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding).

Scope: criterion 4, `#503.89909452`, the one criterion the page links upstream tests to. Criteria 1, 2, 3 and 5 have
none and stay with `tests/acceptance/503/`, as does criterion 4's own proof on files made at test time.

## Sources

| Upstream, pinned | Files and lines | Use | License |
|---|---|---|---|
| FFmpeg `24e860f6d3c4f2ebae65ed7649e2a8860d512879` | `tests/fate/aac.mak` 2–3, 10–11, 42–43, 50–51, 58–59, 192–193 and 202 (sbr_i-ps_i.mp4), 379–380 (oneoff, FUZZ 2) | run on our code | LGPL-2.1-or-later |
| the same | `tests/fate/mp3.mak` 2–3, 14–15, 22–23, 33–35 (oneoff, f32, FUZZ 18) | run on our code | the same |
| the same | `tests/fate/opus.mak` 17–25, 28, 34 (stddev, s16, FUZZ 3, CMP_TARGET per vector; hybrid's `_v2.dec`) | run on our code | the same |
| the same | `tests/fate/vorbis.mak` 10–11, 34–35, 54–55, 58–60, 102 (oneoff, FUZZ 1, 2 for moog) | run on our code | the same |
| the same | `tests/fate/matroska.mak` 216 (opus remux, codec delay), 220 (Ogg Opus remux); `tests/ref/fate/matroska-opus-remux` (`initial_padding=312`, the first packet's 312 skip samples) | port | the same |
| the same | `tests/fate/ogg-opus.mak` 2–3 (chained-meta); `tests/fate/ogg-vorbis.mak` 2–3 (chained-meta), 15 (ts-offset) | port | the same |
| the same | `tests/fate/flac.mak` 1–25 and its CMP/FUZZ lines (enc_dec_pcm, oneoff, FUZZ 0) | run on our code | the same |
| the same | `tests/fate/alac.mak` 1–20 (enc_dec_pcm, oneoff, FUZZ 0) | run on our code | the same |
| the same | `tests/fate/lossless-audio.mak` 1–2; `tests/ref/fate/lossless-alac` (MD5 `d0beb768…`) | run on our code | the same |
| the same | `tests/fate/caf.mak` 1–2; `tests/ref/fate/caf-demux` (`CRC=0xd0d7195c`) | run on our code | the same |
| the same | `tests/fate/lavf-audio.mak` 1, 4, 10, 27, 31; `tests/ref/lavf/aiff`, `wav`, `caf` (`CRC=0x3a1da17e`) | run on our code | the same |
| the same, not vendored by the page | `tests/tiny_psnr.c` (run_psnr: MAXDIFF, stddev, the WAV header skip, f32 scaled by 2^24), `tests/fate-run.sh` (do_tiny_psnr, oneoff, stddev, compare, pcm, enc_dec_pcm, lavf_audio; defaults FUZZ 1, CMP_TARGET 0, SIZE_TOLERANCE 0), `tests/audiogen.c` (int_cos and the first second), `tests/Makefile` (AREF) | formula, re-expressed in `helpers.ts` with the LGPL notice | the same |
| one upstream engine, `ed1daf0bf0` | `tests/scene/test_audio_stream_wav.cpp`, its test cases (lines 163–181, 209–211) | port of the cases, no code | MIT (no code copied, so no notice carried) |

Vendored unchanged in `fixtures/fate/`: the twelve `.mak` files and the six reference files above, at their paths
under FFmpeg's `tests/`, with `COPYING.LGPLv2.1` (from the same commit, as #498's lane vendors it) and a `NOTICE`. No
upstream code is copied: tiny_psnr's comparison, swresample's float-to-s16 rounding, the crc muxer's Adler-32 and
audiogen's integer cosine are re-expressed in `helpers.ts`, named after their upstream functions, with FFmpeg's notice.
They were checked against the local FFmpeg when this lane was written: its own decodes of the samples meet each recipe's
bound under this comparison (aac 2, opus testvector02's stddev 191.12 and 05's 108.33, mp3 3, vorbis 1); this suite's
s16 conversion equals FFmpeg's `-f s16le` sample for sample; the lossless references read back from FFmpeg's FLAC round
trips; and the synthetic second has the lavf references' CRC itself.

## Pinned samples

Fetched on first use from `https://fate-suite.ffmpeg.org/<sample>` into `~/Library/Caches/deepbuild/fate-suite/` (or
`DEEP_FATE_SAMPLES`), as #498's lane fetches, and checked against `fixtures/samples.json`. Never committed.

| Sample | Bytes | SHA-256 |
|---|---|---|
| aac/al04_44.mp4 | 69,537 | e98388671459a44e499e3ddbfb93ffb9bc027bb4a434dbba9ee9a918600dfebf |
| aac/al04_44.s16 | 727,040 | 1c4a9035d5863e0be61aea7fdb3171d2820274e21aac37225cb5dfc5555f3758 |
| aac/al05_44.mp4 | 122,175 | cb322e5b75b3ef3a5e421f030521ed81028dc73d565f5250df3928b86c389de4 |
| aac/al05_44.s16 | 1,310,720 | 75810beda6069fa7fdef1c23887d580f570bb3e5d79cbae05b2b4edd47640b3c |
| aac/al_sbr_cm_48_2.mp4 | 199,678 | 7e7c0390c950eda21775d1a193e05ee703257bed85602884e7d30a8b3c65be90 |
| aac/al_sbr_hq_cm_48_2.s16 | 6,176,768 | 30e39d88a75e0193d1f3a2cf1c4f15e151f96a86d27dd975ac0508a9871af264 |
| aac/al_sbr_sr_48_2_fsaac48.mp4 | 162,872 | d0b286c5f9bdb47ee1722ab64775cc507de27744c6a21143ce41fc7410cdbceb |
| aac/al_sbr_hq_sr_48_2_fsaac48.s16 | 4,702,208 | 701c77b384ec8261dea54ef65632e3db7405366f73c70d1bb7827e993240c8a0 |
| aac/al_sbr_ps_06_new.mp4 | 56,598 | 19d241d01cc3490a133ade50f3dec58d2872ada855cf0d0f954102e774cd9841 |
| aac/al_sbr_ps_06_ur.s16 | 1,736,704 | 740ea4371031c220c6df7d86c7cf3a412d20e032da420f918c601a438c57bdb7 |
| aac/CT_DecoderCheck/sbr_i-ps_i.mp4 | 32,992 | dcd2e94da030f048938c412f6f2025468628fbf33e6e3dcf427e443bd163d2bd |
| aac/CT_DecoderCheck/aacPlusv2.wav | 1,384,492 | c2763d5223dc0a356bb6efbf87d0f9dd1917158647e2988d638b1d159d2c7acf |
| mp3-conformance/compl.bit | 41,495 | 3b93f3675821a5af4826abcff7097fa2e42efcc46154e02c992995f7e31dbc8e |
| mp3-conformance/compl.f32 | 999,936 | f17b6744a4c01ab08c56c2eea9857e203291183dd6a2626ee6971cc19dc75fe7 |
| mp3-conformance/he_48khz.bit | 63,840 | dd0383075710570648b8961f3cd0ce692f07a679b265fc4997e50883b3958299 |
| mp3-conformance/he_48khz.f32 | 686,592 | 4d45689d81d8240bd488fb7328089e56c5bcbf5c605f03634433432664ca428f |
| mp3-conformance/si.bit | 24,659 | 4f3382de1d9265013d42249ff108023d4a90ecf3c0136489d199243a90a5d0f9 |
| mp3-conformance/si.f32 | 539,136 | c4d0bbd800f592272134bf9399c80a730e4b502eab3c2a772a150007916c7781 |
| opus/testvector01.mka | 674,867 | cb4a114f280a67508fe789fd2e5c24b97dc1937b54bcedb15d7a362d7fc56911 |
| opus/testvector01.dec | 5,660,160 | 917a3b81d0ad24b0c75a07e60d8bc043023895a9a7b4b662e68f840ceff700ef |
| opus/testvector02.mka | 76,944 | 307991e828e9a2b0a5e5382fdca8c759131634aa8727da5ff22c7ba25c1ae3e1 |
| opus/testvector02.dec | 4,805,760 | 4ad3b7aeaea242acc96cafebee69edb0914abc2e46c0c884f812ce10bbee4dbc |
| opus/testvector05.mka | 152,917 | 43ab4d88d711caa22d105f5e6b5cc3d8a9d2e7a5a213354e57c166c3ce3ff088 |
| opus/testvector05_v2.dec | 5,216,640 | 21a63bd7b9eefc228cf18c312f9fbe144e02a8d696306cb93575ece97e05ea0f |
| opus/testvector11.mka | 361,382 | c31956a638851fcd99d9d3112f138af3daa3eb151248553e8e5421bba954a6cc |
| opus/testvector11.dec | 5,763,840 | fc31d697a1b7f5d28ff439cd1882bbeda80412232ef1aefea069c849356dce5f |
| vorbis/1.0.1-test_small.ogg | 100,000 | 1eef411505a81a7b4e2e6bcc382844479fa51db88f2d03ed8e638682b0786e4e |
| vorbis/1.0.1-test_small.pcm | 1,305,344 | 8f0ea9c7c57054d34d772208a25788f590822c940eb632c8a50330a0a5cc8c3e |
| vorbis/highrate-test_small.ogg | 100,000 | 9974ea9a70159b6157ff8c157ca6969183037a8e6ccdc4f0d84e4a8aa607e923 |
| vorbis/highrate-test_small.pcm | 719,616 | 5185883afc59c900ee6913b4a8bba9605083333e2b2f5063329a8060a39c22f5 |
| vorbis/mono_small.ogg | 100,000 | 67565c74021eb0a6b68bd20bbef431ff76a0bd7d8c4865702b6d6408860f54cd |
| vorbis/mono_small.pcm | 749,184 | 500e1981161127ec4aff1bd38423846176331f7323b5d10a52f41d7889a4a8e1 |
| vorbis/moog_small.ogg | 100,000 | 25778a973824fcf488c751ecbc2fdbc594e8655666802e1f7d319c11c2814461 |
| vorbis/moog_small.pcm | 1,185,024 | cd182f4bfc5400749be9f6d1607827448e80ad0bcf9a12c22cae7663961d6310 |
| mkv/codec_delay_opus.mkv | 9,585 | 19a9e97d1c8628ddfa34b01aee965e85c335176543096de0ea184edbabc58352 |
| ogg/intro-partial.opus | 10,250 | 16a82ea372996d382350228562c8c9bdf8fad5ce5490023d0668a572aef4ae60 |
| ogg-opus/chained-meta.ogg | 3,299 | 14ef86e6d37476d4008ec33722c406136f261bb76dfb8fad5ddb8d6f64cdbd6c |
| ogg-vorbis/chained-meta.ogg | 7,151 | 9a664f79d0a201b8733a26a3a178a14f3c07c2f116f4e87738f692a69f187804 |
| ogg-vorbis/tos.ogg | 40,295 | 2e9e3aa9b7212698c6dbc0ebc64a48bd3d7c69a0bb71699a08e74bb1785216c1 |
| audio-reference/luckynight_2ch_44kHz_s16.wav | 1,675,846 | 88c1ccc7d381ad0ee3b4f395c7efab8ed4da9f6cf6b07b076dc53e6cc0effcd4 |
| audio-reference/divertimenti_2ch_96kHz_s24.wav | 11,520,080 | 1b3b5a0b235ccdeaf2bce3873aa455cfffd6f0d18e96733fa2ea228ff15c82dd |
| audio-reference/drums_2ch_44kHz_s32_wastedbits.wav | 353,166 | 23354519596a0a04a48a38072e9dd39be17e339e7901e5c38bbfc9efaca1779a |
| audio-reference/chorusnoise_2ch_44kHz_s16.wav | 372,914 | 2a8741e61424045b5f908f8bee19e44a89cf33e22e38236b4d5dd5b32d5bbe1b |
| lossless-audio/inside.m4a | 1,375,593 | 882dd6d3636175459564df1be2c17719bf0df3d5842ff3a03c59f8a32774bf0b |
| caf/caf-pcm16.caf | 41,598 | fc175563cca1d9c9cff8e6dbcf510f5e2e7f3cb18ee66407edd3623b4c7b20f9 |

## Run

```sh
npm ci                      # once, if node_modules is missing
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/503-oracle --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/503-oracle/tsconfig.json   # type-check (exits 0)
```

Each file builds `deep-show` once (`cargo build --locked --bin deep-show --no-default-features --features full`, the
#503 suite's build) and decodes through its worker; the FLAC, ALAC and lavf files are made by the local FFmpeg (PATH,
`/opt/homebrew/bin`, `/usr/local/bin`, or `DEEP_FFMPEG` and `DEEP_FFPROBE`). **`scripts/lanes.mjs` needs
`'tests/acceptance/503-oracle/'` in its `alone` list**; this job writes only its folders, and the implementer makes the
edit. Every `it` passes a 3,600,000 ms timeout; temporary folders are removed after each test.

## Criteria to tests

Every test is criterion 4's, `AC4 #503.89909452`.

| File (tests) | Recipes | Judged |
|---|---|---|
| `lossy.test.ts` (4) | aac.mak: al04_44, al05_44 (AAC-LC), al_sbr_hq_cm_48_2, al_sbr_hq_sr_48_2_fsaac48 (HE-AAC), al_sbr_ps_06_ur, ct-sbr_i-ps_i.mp4 (HE-AAC v2); mp3.mak: conf-compl, conf-he_48khz, conf-si; opus.mak: testvector01, 02, 05, 11; vorbis.mak: vorbis-1, 7, 12, 13 | the worker's decode, as the recipe's command writes it (s16le, or f32le after `atrim` for MP3), against the recipe's reference by tiny_psnr: oneoff MAXDIFF ≤ FUZZ, or stddev ≤ CMP_TARGET + FUZZ; sizes within SIZE_TOLERANCE (0) |
| `containers.test.ts` (1) | matroska.mak opus-remux and ogg-opus-remux, ogg-opus.mak chained-meta, ogg-vorbis.mak chained-meta and ts-offset | the vendored reference's 312 samples of codec delay read by FFmpeg's probe of the same file; then each sample through the worker: FFmpeg's decode's rate, channels and length, sample for sample within −90 dBFS |
| `lossless.test.ts` (2) | flac.mak (10 recipes), alac.mak (8); lossless-audio.mak lossless-alac, caf.mak caf-demux, lavf-audio.mak aiff, wav, caf | each round trip's decode at the source's PCM hash (FUZZ 0); inside.m4a's s16le MD5, caf-pcm16.caf's big-endian s16 CRC and the three lavf files' CRCs equal to the vendored references |
| `wav-engine.test.ts` (1) | the upstream engine's WAV cases | each file's rate, channels, length and PCM hash read back as written |

## How a recipe maps onto our output

- **The decode** is `media_decode`'s audio stream, f32 interleaved. A recipe's `pcm` writes FFmpeg's decode as s16le;
  ours is converted the same way (x × 2^15 to the nearest integer, clipped; a tie goes up, as this Mac's FFmpeg writes
  it, checked against FFmpeg's own output). MP3's recipes write f32le after `atrim=end_sample=N`, so ours is cut to N
  frames before the comparison; FFmpeg's `-auto_conversion_filters` changes nothing else for these mono and stereo
  streams.
- **oneoff** holds MAXDIFF (s16 units, or for f32 the largest difference × 2^24, truncated, tiny_psnr's scale) within
  FUZZ of CMP_TARGET (0); **stddev** holds the stddev. For stddev ours is held to the bound's upper side, CMP_TARGET +
  FUZZ: the targets are FFmpeg's own distance from the RFC test vectors' reference decodes (191 for testvector02, 108
  for 05), and a decoder nearer the reference can't be failed for being nearer. The size check is the recipe's.
- **enc_dec_pcm** (flac.mak, alac.mak) encodes the recipe's source with its options and compares the decode with the
  source at FUZZ 0: here the local FFmpeg encodes with the same options (`-c flac` / `-c alac` into `flac` / `mov`), the
  worker decodes, and the decode's PCM hash must be the source's integers ÷ 2^(depth − 1) as f32 (the Decode worker's
  rule; for the 32-bit drums file, rounded to f32 as the rule gives).
- **md5** and **crc** recipes hash the decoded samples in the recipe's output form: inside.m4a as s16le (MD5), caf's
  `-c copy` packets as the file's big-endian s16 (the crc muxer's Adler-32 from 1), lavf_audio's decode as s16le.
- **lavf_audio** encodes one second of FATE's `asynth1.sw` read as mono (`-f s16le` with no `-ac`), so its input is the
  file's first 44,100 values; this lane writes that second (audiogen's first section, re-expressed), checks it has the
  references' CRC itself, writes each container with the recipe's codec (`pcm_s16be` AIFF, `pcm_s16le` WAV,
  `pcm_s16be` CAF), and holds the worker's decode to the same CRC.
- **The Matroska and Ogg recipes** print demuxer facts (packets, skip samples, initial padding, stream tags), which the
  worker doesn't answer; what they protect is in the decoded sound, so each sample is held as criterion 4 holds a lossy
  file: FFmpeg's decode's length and, sample for sample, within −90 dBFS. The chained-meta references
  (`ogg-*-chained-meta.txt`) aren't vendored by the page and aren't read.
- **The upstream engine's WAV cases**: 440 Hz on the first channel and 261.63 Hz on the second over each format's full
  range, mono and stereo, 8 and 16 bits, one second at 44.1 kHz; 38,000 frames at 38 kHz; an empty 8-bit file. Written
  here with a plain 44-byte header; read back by the worker.

## Legs that read BLOCKED

- Off macOS: BLOCKED (criterion 4 decodes "in the worker on macOS").
- A sample that can't be fetched or doesn't match its pin: BLOCKED with the one unblock ask: let this Mac reach
  `https://fate-suite.ffmpeg.org/` once, or put the pinned samples under `DEEP_FATE_SAMPLES`.
- The local FFmpeg missing, or unable to make a FLAC, ALAC or lavf file: BLOCKED (`brew install ffmpeg`).

## Left out, and why

aac.mak's ER, LD/ELD and USAC (xHE-AAC) streams and its `_reorder` multichannel references (not AAC-LC or HE-AAC, or
5.1 whose channel order the design doesn't fix), the fixed-point decoder's duplicates (the same streams), the encoder
recipes (they judge FFmpeg's encoders), LATM and ADTS raw streams; mp3.mak's header tests (a test binary of FFmpeg's);
opus.mak's other vectors and `tron.6ch.tinypkts` (six channels, CMP_SHIFT), and its encoder test; vorbis.mak's other
files and `6.ogg` (six channels); matroska.mak's video and subtitle recipes; ogg-vorbis.mak's probe-only recipes (bear,
seek, libvorbis encodes); caf.mak's remux recipes (container metadata of FFmpeg's muxer); lavf-audio.mak's other
containers (not listed formats). Each left-out recipe is either not a listed format or judges FFmpeg's own muxer,
encoder or probe rather than a decode.
