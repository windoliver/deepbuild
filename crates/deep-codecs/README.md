# deep-codecs

## What it is for

The decode worker and the encode tool (#498; canvas primitives: Decode worker, Export: encode job). The decode worker is the trusted ring's host for the codecs seam: every probe, decode and proxy runs in it, a process of its own that enters a sandbox with no network and no camera or microphone before it reads a file, holds files to its caps, and refuses a file that points elsewhere (a playlist, a movie's external data reference) without opening it. It never encodes. The encode tool is another process, which runs the platform's encoder and names itself in an export's record.

A binary that links the crate starts each helper as a copy of itself with the argument `decode-worker` or `encode-tool` and hands that process to `serve`; `Helper` is the side that starts one and asks it jobs.

## Where new code goes

- `src/lib.rs`: caps, the planted wrong programs, probing, decoding, proxies, the encode job and its MP4 muxer, `serve` and `Helper`.
- `src/mp4.rs`: the ISO base media file format: sample tables, edit lists read as FFmpeg reads them, sample entries, color boxes, data references.
- `src/color.rs`: the H.264 SPS's video signal, the written rule for untagged color, and RGB conversion by the probe's matrix and range.
- `src/wav.rs`: our own WAVE reader.
- `src/audio.rs`: our own audio decoders (#503): a file's container by its first bytes, one track of packets, each
  listed codec's decoder (PCM, MP3, AAC-LC and HE-AAC, ALAC, FLAC, Opus, Vorbis), the encoder's delay and padding
  trimmed as FFmpeg trims them, integer samples to f32 as sample ÷ 2^(depth − 1), and the `unsupported_codec`
  refusal naming any other codec as ffprobe names it. MP4 audio is read by `mp4.rs` and decoded here.
- `src/flac.rs`: our own FLAC decoder, every FLAC file's: STREAMINFO and frames, samples in i64 so a 32-bit
  stream's 33-bit side channel is exact.
- `src/chunks.rs`: AIFF, AIFF-C and CAF by their chunks; ASF only to name its codec. `src/ogg.rs`: Ogg's pages, a
  chain's links and the granules Vorbis and Opus end by. `src/mkv.rs`: Matroska and WebM's first audio track and its
  DiscardPadding.
- `src/mov.rs`: the header-first MP4 and QuickTime writer for exports: video, float PCM or AAC, timecode (#501).
- `src/export.rs`: the encode tool's export jobs: `export.part`, `export.join`, `export.png` (#501).
- `src/apple.rs`: the macOS backend: VideoToolbox decode and encode, AudioToolbox AAC encode, the sandbox.
- Another platform's backend goes in its own file beside `apple.rs`, chosen by `cfg`.
- Tests: the acceptance tests in tests/acceptance/498/decode drive the crate through `deep-show run`.

## What it may import

serde_json, sha2 and image; libc on macOS. Platform frameworks are linked by name and called through their C interfaces. It imports no canvas crate and no other DeepBuild crate: the canvas, the media module and the app reach it only through a helper process.

The audio decoders (#503) are pure Rust, so the web player can build the same ones for wasm32: symphonia (only its
MP3, Vorbis and ALAC decoders), rusty_aac (AAC-LC and HE-AAC v1 and v2) and ropus (Opus, the fixed-point port of
libopus); FLAC is our own (`src/flac.rs`). The containers are read here. No platform decoder reads a listed audio
format.

## Deviations

- HEVC's own colour description (its SPS VUI) isn't read; an HEVC stream's color comes from its `colr` box, else the untagged rule.
- A proxy is raw I420 frames after a one-line header, every frame whole, so the worker makes one without an encoder.
- Audio (#503): a file with video keeps an audio stream in an unlisted codec in its probe, marked `refused`, and
  its decode refuses that stream alone; a file with no video is refused whole. Opus of more than two channels
  (channel mapping family 1) isn't decoded. CAF's ALAC keeps the packet table's valid frames, where FFmpeg also
  drops the last packet's remainder a second time. MP3 inside a WAVE file is refused naming `mp3`. An MP3 file's
  frames end at the first bytes that aren't one (FFmpeg resyncs past them). Vorbis inverse coupling follows the
  specification and FFmpeg's C code; FFmpeg's arm64 (NEON) kernel reads a magnitude of +0.0 as positive, which an
  FFmpeg-encoded stereo stream reaches, so FFmpeg's decode of one on an Apple silicon Mac differs from ours.
