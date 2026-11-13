# deep-codecs

## What it is for

The decode worker and the encode tool (#498; canvas primitives: Decode worker, Export: encode job). The decode worker is the trusted ring's host for the codecs seam: every probe, decode and proxy runs in it, a process of its own that enters a sandbox with no network and no camera or microphone before it reads a file, holds files to its caps, and refuses a file that points elsewhere (a playlist, a movie's external data reference) without opening it. It never encodes. The encode tool is another process, which runs the platform's encoder and names itself in an export's record.

A binary that links the crate starts each helper as a copy of itself with the argument `decode-worker` or `encode-tool` and hands that process to `serve`; `Helper` is the side that starts one and asks it jobs.

## Where new code goes

- `src/lib.rs`: caps, the planted wrong programs, probing, decoding, proxies, the encode job and its MP4 muxer, `serve` and `Helper`.
- `src/pipe.rs`: the helpers' framing, a JSON line then the raw bytes it names, and `Helper::feed`, `hear` and `take` (#157).
- `src/stream.rs`: the decode worker's `stream` op: a delivery's boxes, edits, times and sound, then each frame's luma or BGRA in presentation order (#157).
- `src/mp4.rs`: the ISO base media file format: sample tables, edit lists read as FFmpeg reads them, sample entries, color boxes, data references, and a file's top-level boxes read without its samples.
- `src/color.rs`: the H.264 SPS's video signal, the written rule for untagged color, RGB conversion by the probe's matrix and range, the export's fixed-point NV12 and the colour probe pattern.
- `src/wav.rs`: our own WAVE reader.
- `src/mov.rs`: the header-first MP4 and QuickTime writer for exports: video, float PCM or AAC, timecode (#501); `head` before streamed samples, `moov` after a part's (#157).
- `src/export.rs`: the encode tool's export jobs: `export.part`, `export.join`, `export.png` (#501), their frames from files or over the pipe (#157).
- `src/apple.rs`: the macOS backend: VideoToolbox decode, AudioToolbox AAC decode and encode, the sandbox.
- `src/apple/encoder.rs`: the streaming VideoToolbox encoder (H.264, HEVC, ProRes 4444) fed a frame at a time from its own pool (#157).
- `src/apple/decoder.rs`: the stream op's asynchronous VideoToolbox decoder, pictures in the decoder's own format (#157).
- Another platform's backend goes in its own file beside `apple.rs`, chosen by `cfg`.
- Tests: the acceptance tests in tests/acceptance/498/decode drive the crate through `deep-show run`.

## What it may import

serde_json, sha2 and image; libc on macOS. Platform frameworks are linked by name and called through their C interfaces. It imports no canvas crate and no other DeepBuild crate: the canvas, the media module and the app reach it only through a helper process.

## Deviations

- HEVC's own colour description (its SPS VUI) isn't read; an HEVC stream's color comes from its `colr` box, else the untagged rule.
- A proxy is raw I420 frames after a one-line header, every frame whole, so the worker makes one without an encoder.
- H.264 and HEVC sessions run in real time: otherwise the hardware encoder's bytes change with the load other sessions put on it, and equal frames would not give equal parts.
