# rust-gpu: findings (whole-project audit, Nov 9)

Checkout read: `the checkout` at 06fd33cd.
Nothing was compiled or run (brief). Every finding is from reading the code, its callers and its tests.
Paths are relative to the checkout root.

Status: finished, with most of the area not read. The area is about 62,000 lines of Rust and WGSL; I read about
13,000 line by line (all of deep-codecs and deep-gpu's sources, most of deep-text, the small files and shaders of
the rest) and checked the remainder only by search. The coverage table at the end says file by file what was read,
skimmed or not read. An attempt to split the area across part readers was refused (the session's sub-agent limit
was already reached), so nothing here comes from another agent. Treat the unread files as unaudited, not as clean.

Findings keep the number they got in reading order. Worst first:

| rank | id | kind | confidence | one line |
|---|---|---|---|---|
| 1 | RUST-GPU-2 | broken | SURE (dev) | `stts`/`ctts` run counts from a file hang the decode worker and the app waiting on it: crates/deep-codecs/src/mp4.rs:364-393 |
| 2 | RUST-GPU-1 | broken | SURE | a 64-bit box size panics `mp4::atoms`; the dead worker fails every later job: crates/deep-codecs/src/mp4.rs:29 |
| 3 | RUST-GPU-13 | broken | LIKELY | the glyph atlas drops variable-font coordinates: small text at weights other than 400/500/600 draws at the default weight: crates/deep-text/src/atlas.rs:147-156, :295-303 |
| 4 | RUST-GPU-9 | broken | SURE | off macOS the copy handoff never writes its read-back: every slot is zeros: crates/deep-gpu/src/surface.rs:107, :184-187 |
| 5 | RUST-GPU-14 | broken | LIKELY | the live view opens a video by its raw `asset` string before the hash check, and never checks the file against it: crates/deep-marks-render/src/macos.rs:1280, :1610-1624 |
| 6 | RUST-GPU-3 | broken | LIKELY | a fixed-size `stsz` count is trusted for a 16 GiB list; a real PCM `.mov` costs about 1 GB to probe: crates/deep-codecs/src/mp4.rs:308-341 |
| 7 | RUST-GPU-6 | inefficient | LIKELY | the encode job reads every raw frame into memory first (7 GB for 76 s of 1080p30): crates/deep-codecs/src/lib.rs:658-665 |
| 8 | RUST-GPU-4 | inefficient | SURE | the table probe's key check is quadratic inside a 16 MB cap: crates/deep-codecs/src/table.rs:123 |
| 9 | RUST-GPU-11 | broken | SURE | the structural WGSL's one test passes with nothing run when no GPU opens: crates/deep-gpu/src/structural.rs:435-437 |
| 10 | RUST-GPU-10 | broken | LIKELY | `linear_texture` gives wgpu a Metal texture without the usage, sample count or layers its descriptor claims: crates/deep-gpu/src/memory.rs:116-177 |
| 11 | RUST-GPU-15 | broken | SURE | `Player::start` leaves an unreaped worker on two error paths: crates/deep-marks-render/src/video.rs:155, :160 |
| 12 | RUST-GPU-5 | broken | SURE (dev) | plain `+`/`-` on file values panic the worker in dev builds: crates/deep-codecs/src/mp4.rs:360, :401, :430; lib.rs:539, :576, :1118 |
| 13 | RUST-GPU-16 | broken | LIKELY | a 64-byte non-ASCII asset hash panics the table inliner: crates/deep-marks-vello/src/tables.rs:58-59 |
| 14 | RUST-GPU-7 | broken | QUESTION | `decode_aac` returns a converter failure as a short success: crates/deep-codecs/src/apple.rs:685-699 |
| 15 | RUST-GPU-8 | inconsistent | QUESTION | `transcode`, `table` and the live worker skip the caps and the external-reference refusal: crates/deep-codecs/src/lib.rs:900-911, :1043 |
| 16 | RUST-GPU-12 | broken | QUESTION | the adapter pick can prefer an adapter that lacks the required feature: crates/deep-gpu/src/seam.rs:358-360 |

Counts: 16 findings (13 broken, 2 inefficient, 1 inconsistent, 0 unneeded); 7 SURE, 6 LIKELY, 3 QUESTION. About
40 one-line nits follow each crate's findings, most of them READMEs behind their code. Nothing unneeded was
found by the searches I ran over all ten crates: every shader and font is loaded, every dependency and feature
is used, the one `#[allow(dead_code)]` (crates/deep-effects-render/src/docops.rs:1688) keeps buffers alive beside
their bind groups, and no leftover `doneright` name exists. I did not sweep `pub` items for users; that check is
still owed for this area.

## deep-codecs (read in full: every file)

No prior report covers this crate. The decode worker's whole job is to take hostile files, so these come first.

### RUST-GPU-1  A 64-bit box size makes `mp4::atoms` panic, which kills the decode worker for the rest of the session
- kind: broken
- confidence: SURE
- where: crates/deep-codecs/src/mp4.rs:21-33 (`atoms`); reached from `format` (lib.rs:135) for every file that is not WAV, PNG or a playlist, and from `serve_live` (lib.rs:1046); caller that never recovers: crates/deep-show/src/media.rs:167-185 (`slot` keeps the dead `Helper`).
- evidence:
  ```rust
  1 if at + 16 <= data.len() => (16, be64(&data[at + 8..])),
  ...
  if size < head as u64 { break; }
  let end = (at as u64 + size).min(data.len() as u64) as usize;
  out.push(Atom { kind, body: &data[at + head..end] });
  ```
  `size` is a u64 straight from the file. The workspace sets no `overflow-checks` (root Cargo.toml has only `opt-level` lines), so dev builds panic on the add and release builds wrap.
- failure: a file of one 8-byte box followed by `00 00 00 01 6D 6F 6F 76 FF FF FF FF FF FF FF FF` (a `moov` whose 64-bit size is 2^64 − 1) at `at = 8`. Dev: "attempt to add with overflow". Release: `8 + (2^64 − 1)` wraps to 7, so `end = 7` and `&data[24..7]` panics "slice index starts at 24 but ends at 7". (Any 64-bit size above `2^64 − 1 − at` does it.) Either way the worker process dies instead of replying `refused: unreadable`; `Helper::ask` then answers "the decode_worker process … ended" for this job and for every later job, because deep-show keeps the dead helper in its slot.
- fix: mp4.rs:29
  old: `let end = (at as u64 + size).min(data.len() as u64) as usize;`
  new: `let end = (at as u64).saturating_add(size).min(data.len() as u64) as usize;`
  (`end` is then `data.len()`, which is ≥ `at + head` by the loop test and the `1 if at + 16 <= data.len()` guard.)
- verify: no test covers it (mp4.rs has no test module; tests/acceptance/498/decode feeds FATE samples and caps only). A unit test `mp4::parse(&[0,0,0,8,b'f',b'r',b'e',b'e', 0,0,0,1,b'm',b'o',b'o',b'v', 0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF])` panics before, returns `Some` after.
- risk: none; no well-formed box reaches the saturated branch.

### RUST-GPU-2  A sample table's run counts are looped to the full u32 from the file: a small `stts` or `ctts` hangs the worker, and the app waiting on it
- kind: broken
- confidence: SURE for a dev build (deep-codecs has no `opt-level` override in the root Cargo.toml, so the loop runs as written); LIKELY for a release build, where LLVM may or may not fold the tail that writes nothing
- where: crates/deep-codecs/src/mp4.rs:364-377 (`stts`), :379-393 (`ctts`)
- evidence:
  ```rust
  for _ in 0..n {
      let run = stts.u32()?;
      let delta = stts.u32()? as i64;
      for _ in 0..run {
          if let Some(s) = samples.get_mut(i) { s.dts = t; }
          t += delta;
          i += 1;
      }
  }
  ```
  `n` is bounded by the box (each entry is read with `?`), `run` is not. `t` and `i` have no reader after the loops; `ctts` has the same shape with `offsets_c.get_mut(i)`.
- failure: a `moov` with an empty `stsz`/`stsc` and an `stts` of 8,000 entries `(run = 0xFFFFFFFF, delta = 0)` (64 KB) spins 3.4 × 10^13 iterations that write nothing. The worker never answers; `Helper::ask` (lib.rs:1193) blocks in `read_line` with no timeout, so the caller hangs too. The caps do not help: `over_caps` runs after `format` has parsed.
- fix: stop at the last sample (same values written for every real sample):
  mp4.rs:370-376
  old:
  ```rust
          for _ in 0..run {
              if let Some(s) = samples.get_mut(i) {
                  s.dts = t;
              }
              t += delta;
              i += 1;
          }
  ```
  new:
  ```rust
          for _ in 0..run {
              let Some(s) = samples.get_mut(i) else { break };
              s.dts = t;
              t += delta;
              i += 1;
          }
  ```
  mp4.rs:386-391
  old:
  ```rust
              for _ in 0..run {
                  if let Some(o) = offsets_c.get_mut(i) {
                      *o = off;
                  }
                  i += 1;
              }
  ```
  new:
  ```rust
              for _ in 0..run {
                  let Some(o) = offsets_c.get_mut(i) else { break };
                  *o = off;
                  i += 1;
              }
  ```
- verify: tests/acceptance/498/decode/fate.test.ts must stay green (same dts/cts). New unit test: a table with one sample and `stts = [(0xFFFFFFFF, 0)] × 4` returns at once.
- risk: none; once `i` is past the last sample neither loop can change a sample.

### RUST-GPU-3  A fixed-size `stsz` count is trusted for two allocations: a 100-byte `moov` asks for 16 GiB, and a real PCM `.mov` costs about 1 GB to probe
- kind: broken
- confidence: LIKELY (the hostile case is certain from the code; the fix below is partial and the full one needs a bound the owner picks)
- where: crates/deep-codecs/src/mp4.rs:308-318, :341, :351-362
- evidence:
  ```rust
  let count = stsz.u32()? as usize;
  let count = if fixed == 0 { count.min(stsz.left() / 4) } else { count };
  let sizes: Vec<u32> = (0..count).map(|_| if fixed == 0 { stsz.u32() } else { Some(fixed) }).collect::<Option<_>>()?;
  ...
  let mut samples = Vec::with_capacity(count);
  ```
  Only the `fixed == 0` branch is held to the box's length.
- failure: `stsz` with `sample_size = 1`, `sample_count = 0xFFFFFFFF`: `sizes` writes 16 GiB, then `with_capacity` asks for 4.29e9 × 32 B = 137 GB and aborts. Not hostile: a camera `.mov` with `sowt`/`lpcm`/`twos` audio (kinds `stsd` lists at mp4.rs:258) has one sample per PCM frame; 10 minutes of 48 kHz is 28.8 M samples → 115 MB of `sizes` plus 921 MB of `Sample`s, for a track `audio()` then refuses ("no decoder for sowt", lib.rs:584).
- fix (partial, exact; removes the 16 GiB list and the up-front reservation):
  old (mp4.rs:316-318):
  ```rust
      let sizes: Vec<u32> = (0..count)
          .map(|_| if fixed == 0 { stsz.u32() } else { Some(fixed) })
          .collect::<Option<_>>()?;
  ```
  new:
  ```rust
      // A fixed size has no list; `count` alone bounds it.
      let sizes: Vec<u32> = match fixed {
          0 => (0..count).map(|_| stsz.u32()).collect::<Option<_>>()?,
          _ => Vec::new(),
      };
      let size_of = |s: usize| match fixed {
          0 => sizes.get(s).copied(),
          _ => (s < count).then_some(fixed),
      };
  ```
  mp4.rs:341 `Vec::with_capacity(count)` → `Vec::new()`; mp4.rs:352 `let Some(size) = sizes.get(s) else { break };` → `let Some(size) = size_of(s) else { break };` and the two `*size` below it → `size`.
  Still open after this: one chunk whose `stsc` says `samples_per_chunk = 0xFFFFFFFF` with that count pushes 4.29e9 samples. That needs a cap on samples per track (the caps struct has none) or a run-length table for fixed-size tracks: owner's call.
- verify: fate.test.ts (the FATE samples with fixed-size audio must give the same probe). New unit test: the 100-byte `moov` above returns without allocating gigabytes.
- risk: low; same samples in the same order. No test pins the allocation.

### RUST-GPU-4  The table probe's key-uniqueness check is quadratic: a table inside the 16 MB cap can take the worker minutes to hours
- kind: inefficient
- confidence: SURE
- where: crates/deep-codecs/src/table.rs:117-125; call path `run` op `table` (lib.rs:904-910) → `table::probe`
- evidence:
  ```rust
  let keys: Vec<&Value> = cells[key].as_array().into_iter().flatten().map(|c| &c["raw"]).collect();
  if keys.iter().enumerate().any(|(i, k)| keys[..i].contains(k)) {
  ```
  Every row's key is compared with every earlier row's. `MAX_BYTES` is 16 MB (table.rs:9); a two-column table of 16-byte rows is 1 M rows → 5 × 10^11 string compares in the worker, with the caller blocked in `Helper::ask`.
- fix: table.rs:123
  old: `if keys.iter().enumerate().any(|(i, k)| keys[..i].contains(k)) {`
  new:
  ```rust
  let mut seen = std::collections::HashSet::new();
  if !keys.iter().all(|k| seen.insert(k.as_str())) {
  ```
  Every `raw` is a JSON string (table.rs:112 builds it from a `String`), so `as_str()` equality is the `Value` equality used today.
- verify: table.rs test `a_crlf_table_keeps_raw_cells_and_their_ranges`; tests/acceptance/397 (key_not_unique). Timing: a 200,000-row CSV probes in well under a second after.
- risk: none.

### RUST-GPU-5  Crafted table values panic the worker in dev builds: `stss` sample number 0, chunk offsets near 2^64, an edit's media time near 2^63
- kind: broken
- confidence: SURE for dev builds (overflow checks on), harmless in release (they wrap into a miss)
- where: crates/deep-codecs/src/mp4.rs:401 (`b.u32()? as usize - 1`), :360 (`at += *size as u64`), :430 (`e.media_time + span`), :434 (`s.cts - e.media_time + at`); crates/deep-codecs/src/lib.rs:539 and :1118 (`s.offset as usize + s.size as usize`), :576 (`(s.offset + s.size as u64) as usize`)
- evidence: each adds or subtracts two numbers read from the file with plain `+`/`-`. `stss` entry 0 → `0usize - 1`. A `co64` offset of `0xFFFFFFFFFFFFFFF0` plus a 32-byte sample → `at += size` overflows.
- failure: same outcome as RUST-GPU-1 (worker dies, later jobs fail) under any build with overflow checks, which is what `cargo build` and `cargo test` produce here.
- fix: mp4.rs:401 `samples.get_mut(b.u32()? as usize - 1)` → `(b.u32()? as usize).checked_sub(1).and_then(|k| samples.get_mut(k))`; mp4.rs:360 `at += *size as u64;` → `at = at.saturating_add(*size as u64);`; mp4.rs:430 `e.media_time + span` → `e.media_time.saturating_add(span)`; mp4.rs:434 `s.cts - e.media_time + at` → `(s.cts - e.media_time).saturating_add(at)` (the subtraction cannot overflow: this line runs only when `s.cts >= e.media_time >= 0`); lib.rs:539 and :1118 `s.offset as usize + s.size as usize` → `(s.offset as usize).saturating_add(s.size as usize)`; lib.rs:576 `(s.offset + s.size as u64) as usize` → `s.offset.saturating_add(s.size as u64) as usize`. A saturated range end is past the file, so `data.get` misses exactly as the wrapped value does today.
- verify: fate.test.ts unchanged; a unit test with `stss = [0]` no longer panics under `cargo test`.
- risk: none.

### RUST-GPU-6  The encode job reads every raw frame into memory before it encodes the first
- kind: inefficient
- confidence: LIKELY
- where: crates/deep-codecs/src/lib.rs:658-665 (`encode`), crates/deep-codecs/src/apple.rs:762-846 (`encode_h264(frames: &[Vec<u8>], …)`); callers crates/deep-gpu-layer/src/film.rs:617-620 and deep-show's export (media.rs `ENCODE_TOOL`)
- evidence: `let frames: Vec<Vec<u8>> = …map(|p| std::fs::read(…))…collect()` then the encoder loop walks the vector. An I420 1080p frame is 3.1 MB.
- failure: a 76 s 1080p30 export (the hero video's length) holds 2,280 × 3.1 MB = 7.1 GB in the encode tool; 60 s at 60 fps is 11 GB. `mux_h264` then also holds every coded frame twice (`coded` and `mdat_body`).
- fix: pass the paths down and read one frame inside the loop: `encode_h264(frames: &[&str], …)` with `let planes = std::fs::read(path).map_err(|e| e.to_string())?;` at apple.rs:808, and build `frames` at lib.rs:658 as `Vec<&str>` (a non-string entry becomes `""` and fails at the read, as today). About 10 lines; not compiled here.
- verify: tests/acceptance/149 (`export`) and tests/acceptance/499 (proxy encode) unchanged; peak RSS of the encode tool on a 300-frame export.
- risk: low. Error order changes: an unreadable frame file now fails after earlier frames were encoded rather than before any; the reply is the same `error`.

### RUST-GPU-7  `decode_aac` returns a converter failure as a short, successful decode
- kind: broken
- confidence: QUESTION (a FATE sample may end on a non-zero status today; I could not run them)
- where: crates/deep-codecs/src/apple.rs:685-699; also :658-663 (`AudioConverterSetProperty`'s status dropped)
- evidence:
  ```rust
  let st = AudioConverterFillComplexBuffer(…);
  out.extend_from_slice(&chunk[..frames as usize * channels as usize]);
  if st != 0 || frames == 0 { break; }
  …
  Ok(out)
  ```
  `feed` reports end of input with `*n = 0` and status 0, so a non-zero `st` is always the converter failing.
- failure: a corrupt AAC packet mid-stream: the decode reply lists the audio stream with fewer `samples` and no `error`; a cookie the converter rejects decodes with the wrong configuration or to nothing, also as success.
- fix: after the loop's call, `if st != 0 { AudioConverterDispose(conv); return Err(format!("AudioConverterFillComplexBuffer: {st}")); }`, and check `AudioConverterSetProperty`'s status the same way.
- verify: tests/acceptance/498/decode/fate.test.ts (every AAC sample must still decode).
- risk: a stream that today ends on a benign non-zero status would start failing; that is why this is a QUESTION.

### RUST-GPU-8  `transcode` and `table` jobs, and the live worker, skip the caps and the external-reference refusal the crate's doc promises for every file
- kind: inconsistent
- confidence: QUESTION
- where: crates/deep-codecs/src/lib.rs:900-911 (both return before `format`/`points_at`/`over_caps` at :912-926); lib.rs:1043-1046 (`serve_live`: `std::fs::read` with no `open`, no caps, no `points_at`); doc at lib.rs:1-6 and README "holds files to its caps, and refuses a file that points elsewhere"
- evidence: `open` checks `max_bytes` only. `max_pixels` is checked only in `over_caps`, which a `transcode` never reaches: an 11,000 × 11,000 PNG map (121 MP against the 33 MP cap) decodes to 484 MB, plus its clone and mip chain in `maps::rgba8` (maps.rs:263). `serve_live` reads a file of any size and decodes a movie whose `dref` names an outside URL.
- failure: a cap the run set (`--caps`) is silently not applied to material maps or live video.
- fix: owner's call on whether caps cover these. If yes: in `map_job`, refuse when the PNG header's `w × h` (as `format` reads it) is over `caps.max_pixels`; in `serve_live`, take the caps and run `open` + `points_at` + `over_caps` before decoding.
- verify: tests/acceptance/498/decode/caps.test.ts covers probe/decode only.
- risk: a large map that loads today would be refused.

Nits (deep-codecs):
- README.md "What it may import: serde_json, sha2 and image; libc on macOS" omits `basisu_c_sys` (Cargo.toml:19, used by maps.rs:111); "Where new code goes" omits `src/maps.rs` and `src/table.rs`. Inconsistent, SURE; fix the two README lines.
- apple.rs has 21 `unsafe` blocks and no `// SAFETY:` comment; deep-gpu, deep-marks-render and deep-show comment each one. The two that carry a real invariant: `on_picture`/`on_coded` deref `refcon` as `&mut` (sound only because decode is synchronous and `VTCompressionSessionCompleteFrames` is awaited before `out` is read), and `encode_h264`'s early `return Err` inside the frame loop (apple.rs:811, :844) releases the session without `VTCompressionSessionInvalidate` while frames may still be in flight to `on_coded`, whose `refcon` box is freed right after. QUESTION: invalidate before those returns.
- lib.rs:664/672: `encode` builds `pts` with `filter_map(Value::as_i64)`, so a non-integer time shortens `pts` and `pts[i]` (apple.rs:828) panics; `size[0]` (lib.rs:685) panics on `"size": []`. Jobs come from our own side, so low.
- lib.rs:1053: `m.contains("470") || m.contains("smpte170")` can never match: `color::matrix` (color.rs:180-188) only returns `rgb`, `bt709`, `bt601`, `bt2020`. And matrix `rgb` falls through to 0 (BT.709).
- lib.rs:711: `mp4_box` writes `(body.len() + 8) as u32`; an `mdat` over 4 GiB wraps silently (and `stco` is 32-bit). Unreachable while RUST-GPU-6 stands.
- maps.rs:127, :149: `(info.width * info.height * 4) as usize` multiplies in u32; a KTX2 of 32,768² or more overflows. `rgba8` (maps.rs:267-275) has the same u32 products but the image crate's 512 MiB default limit keeps PNG/JPEG below it.
- maps.rs:263: `let mut data = top.clone();` copies the top level only to keep reading `top`; pushing each level into `data` and reading the previous level back out of it would avoid one full-size copy per map.
- table.rs:47: a row holding one quoted empty cell (`""`) is dropped as blank; table.rs:104-115: two header cells with the same name give two `columns` and one `cells` entry.
- sha2 is "0.10" here and in nine other crates, "0.11" only in crates/deep-gpu-layer/Cargo.toml:74: two copies of the hash crate in that binary. See the Cargo section.

## deep-gpu (read in full: every src file and structural.wgsl; tests/noop.rs not read, only searched for skips)

The prior report 09 read view, render, encode, upload, cache, alloc, memory, device for speed and proposed nothing but M2 (unbounded `raised`/`failures`) and the empty second submit. Not repeated.

### RUST-GPU-9  Off macOS the copy handoff never writes its read-back anywhere: every slot shows and reads as zeros
- kind: broken
- confidence: SURE (from the code; it only bites on Linux, which Cargo.toml:30-32 targets for #70)
- where: crates/deep-gpu/src/surface.rs:30 (`pub type Shown = std::sync::Arc<Vec<u8>>`), :107, :184-187, :200-201; doc at :1-4 and :81 ("The copy through memory, which every platform has")
- evidence:
  ```rust
  #[cfg(not(target_os = "macos"))]
  let shown = std::sync::Arc::new(vec![0; (size[0] * size[1] * 4) as usize]);
  ...
  #[cfg(not(target_os = "macos"))]
  {
      let _ = (row, padded, &data);
  }
  ...
  #[cfg(not(target_os = "macos"))]
  return self.shown.to_vec();
  ```
  `finish` maps the read-back and drops it; `shown` is an immutable `Arc<Vec<u8>>` that nothing can write. `git diff origin/main...origin/worktree-github-issue-70-9b235c -- crates/deep-gpu` is empty, so the open Linux branch does not change this.
- failure: on Linux `Path::Copy` (the only path there: `allocate` refuses `ZeroCopy` at :53) renders, reads back, and hands GPUI and `View::read` a buffer of zeros. The blank guard then blocks every comparison (`guard::is_blank`), or a view shows black.
- fix: `Shown` needs interior mutability off macOS. Smallest: surface.rs:30 `pub type Shown = std::sync::Arc<std::sync::Mutex<Vec<u8>>>;`, :107 wrap the vec in `Mutex::new`, :184-187 copy rows as the macOS arm does (`let mut dst = self.shown.lock().unwrap_or_else(|e| e.into_inner()); for (y, src) in data.chunks_exact(padded).take(self.size[1] as usize).enumerate() { dst[y * row..(y + 1) * row].copy_from_slice(&src[..row]); }`), :201 `self.shown.lock()…clone()`. `view::identity` (view.rs:56) keeps working (`Arc::as_ptr`). Not compiled here; whoever lands #70 should own it.
- verify: crates/deep-gpu/tests/noop.rs runs on the noop backend, where the read-back holds nothing, so it cannot see this. On a Linux box: tests/acceptance/377's copy-path capture is non-blank after, blank before.
- risk: `Shown` is `pub`. `rg 'surface::\{?[A-Za-z, ]*Shown' crates --glob '*.rs'` finds three users: crates/deep-gpu/src/view.rs:17, crates/deep-show/src/efficiency.rs:274 and crates/deep-app/src/probes/color_check.rs:7. The last two must be checked for how they read the non-macOS alias (I did not read them; they are outside this area).

### RUST-GPU-10  `memory::linear_texture` hands wgpu a Metal texture that is not the one its descriptor describes, under a SAFETY comment that says it is
- kind: broken
- confidence: LIKELY
- where: crates/deep-gpu/src/memory.rs:112-121 (guards), :141-151 (raw texture: `ShaderRead | RenderTarget`, one sample, 2D), :157-177 (`// SAFETY: \`raw\` is the texture \`desc\` describes`); the one caller crates/deep-gpu-layer/src/groups.rs:495-510
- evidence: the function is a safe `pub fn` taking any `TextureDescriptor`. It checks only backend, `mip_level_count == 1` and `format == Rgba16Float`. It never reads `desc.usage`, `desc.sample_count`, `desc.dimension` or `desc.size.depth_or_array_layers`, yet passes `desc` to `create_texture_from_hal`. The caller's descriptor asks for `RENDER_ATTACHMENT | TEXTURE_BINDING | STORAGE_BINDING`; the Metal texture is created without `MTLTextureUsage::ShaderWrite`.
- failure: wgpu believes the texture may be bound as a writable storage texture; the first pass that binds it so (the mip chain's compute path uses storage writes; today it only runs when `levels > 1`, where `linear_texture` already returned `None`) writes to a Metal texture not created for shader writes: a Metal validation abort in a debug layer, undefined results without one. A future caller with `sample_count: 4` or an array gets a wgpu/Metal mismatch the same way.
- fix: make the function refuse what it does not build, and build what it is asked:
  memory.rs:116-119
  old:
  ```rust
      if device.backend != Backend::Gpu
          || desc.mip_level_count != 1
          || desc.format != wgpu::TextureFormat::Rgba16Float
      {
  ```
  new:
  ```rust
      if device.backend != Backend::Gpu
          || desc.mip_level_count != 1
          || desc.sample_count != 1
          || desc.dimension != wgpu::TextureDimension::D2
          || desc.size.depth_or_array_layers != 1
          || desc.format != wgpu::TextureFormat::Rgba16Float
      {
  ```
  memory.rs:149
  old: `d.setUsage(MTLTextureUsage::ShaderRead | MTLTextureUsage::RenderTarget);`
  new:
  ```rust
              let mut usage = MTLTextureUsage::ShaderRead | MTLTextureUsage::RenderTarget;
              if desc.usage.contains(wgpu::TextureUsages::STORAGE_BINDING) {
                  usage |= MTLTextureUsage::ShaderWrite;
              }
              d.setUsage(usage);
  ```
  Also memory.rs:130 (`unsafe { device.device.as_hal… }`) is the file's one `unsafe` without a SAFETY line; add `// SAFETY: only reads the raw device.` as at :18.
- verify: tests/acceptance/149-redraft-ac10/target-bytes.test.ts (reads a collection target's held bytes) unchanged. `allocatedSize` for the buffer does not depend on the texture's usage.
- risk: low. Whether Metal accepts `ShaderWrite` on a buffer-backed linear texture on every Mac is not something I could check; if it refuses, `newTextureWithDescriptor…` returns `None` and the caller falls back to `create_texture`, which is the documented fallback.

### RUST-GPU-11  The one test of the structural WGSL passes with nothing run when no GPU opens
- kind: broken (a check that can pass with nothing run; AGENTS.md invariant 2)
- confidence: SURE
- where: crates/deep-gpu/src/structural.rs:433-437
- evidence:
  ```rust
  #[test]
  fn scan_compact_sort_match_the_cpu() {
      let Ok(gpu) = Gpu::open(Backend::Gpu) else {
          return;
      };
  ```
  It is the only place scan, compact and sort are compared with a CPU reference at their edge counts (1, 1000, 1024, 1025, 1,000,003, 2^20). `rg -n 'Gpu::open\(Backend::Gpu\)' crates/deep-gpu` shows the sibling `timings` test unwraps instead and is `#[ignore]`.
- failure: on a machine where the seam refuses (no adapter, or an adapter without BC: `seam::missing`), `cargo test -p deep-gpu` reports this test `ok`.
- fix: structural.rs:435-437
  old:
  ```rust
          let Ok(gpu) = Gpu::open(Backend::Gpu) else {
              return;
          };
  ```
  new:
  ```rust
          // No device is BLOCKED, never a pass: the test fails and says why.
          let gpu = Gpu::open(Backend::Gpu).expect("BLOCKED: no GPU device to run the structural steps on");
  ```
- verify: on this Mac the test still passes; with `DEEP`-less no-GPU sandboxing it now fails with the BLOCKED line.
- risk: the noop lane (`cargo test -p deep-gpu` on a GPU-less box, README "Tests") would turn red for this one test. If that lane must stay green without a GPU, mark the test `#[ignore = "needs a GPU"]` and have preflight run it with `--ignored` instead. Owner's pick between the two; either removes the silent pass.

### RUST-GPU-12  The adapter pick counts features, so an adapter missing the tier's required feature can beat one that has it, and startup is then refused
- kind: broken
- confidence: QUESTION (needs a machine with two adapters that differ in BC; none of the owner's Macs do)
- where: crates/deep-gpu/src/seam.rs:325-374 (`pick`), crates/deep-gpu/src/device.rs:161-175
- evidence: `better` compares `(granted.len(), adapter.memory)`. `granted` mixes required and gated rows. `Gpu::start` then refuses with `missing_feature` if the picked device lacks `texture_compression_bc`.
- failure: adapter A reports `timestamps` + `depth_clip_control` (2 granted, no BC), adapter B reports only `texture_compression_bc` (1). A is picked; startup is refused although B satisfies the tier.
- fix: rank required rows first: `let key = (required_granted, granted.len(), adapter.memory)` where `required_granted = TABLE.iter().filter(|r| r.required && granted.contains(&r.feature)).count()`.
- verify: tests/acceptance/140/gpu/adapters.test.ts (test-seam builds, `--adapters`) pins the pick order; a new case with the two adapters above.
- risk: adapters.test.ts may pin "most features wins" with exactly such a pair; I did not read it.

Nits (deep-gpu):
- ring.rs:198 comment: "shows the newest ready slot, if it's newer than the one on screen". `latch` (ring.rs:201-224) never compares with the on-screen frame. With `View::hold_next`/`release` (view.rs:474-484) frame 1 can turn ready after frame 2 is on screen and is then shown, going backwards. Either the comment or the code is wrong; QUESTION for whoever owns #378's latency fixture.
- README.md "Where new code goes" lists every module but `structural.rs` (611 lines + structural.wgsl, #483).
- seam.rs:40 `TIER = "metal-apple"` and seam.rs:12-17 `BACKEND.name` = `"wgpu"` off macOS: on Linux (Cargo.toml:30-32, Vulkan) the tier, its required BC row and the backend name are still the macOS ones. Belongs to #70.
- seam.rs:191: a quirk row's `match.driver` that is not a string is read as "any driver", while `vendor`/`device` of the wrong type are refused (seam.rs:159-166). The table is empty today (quirks.json).
- alloc.rs:25-30 `outside` does not restore its counter if `f` unwinds; only matters under a caught panic.
- surface.rs:118-120 `unsafe impl Send for Copy` is unconditional; off macOS `Copy` is already `Send` and the comment's pixel buffer does not exist there.
- surface.rs:257-266, :273-282: `CVPixelBufferLockBaseAddress`'s status is dropped; on failure the base address is null and `from_raw_parts(_mut)` over it is undefined. The SAFETY lines say "locked while the slice lives", which holds only when the lock succeeded.
- upload.rs:53-56 pads a tail to 4 bytes with zeros and writes past `data.len()`; correct only when the target buffer was created rounded up to 4. Callers' concern, noted because `queue` takes any buffer.
- view.rs:450-459 `wait_done` returns `true` when the copy path's `finish` failed and the slot was abandoned (`collect` clears `in_flight` first); a caller that reads the slot next reads the previous frame.

## deep-text, deep-text-gpui, deep-text-render

Read in full: deep-text `lib.rs`, `atlas.rs`, `cache.rs`, `shape.rs`, `fonts.rs`, `outlines.rs`, Cargo.toml, README. Read in part: deep-text-gpui `lib.rs` (the atlas placement, lines 150-210 and 420-570). Not read: deep-text `main.rs`, `unicode.rs`, `tests/shape.rs`; deep-text-render. Prior report 08 covers F4 (frame set), F12 (double key), F13 (path reserve); not repeated.

### RUST-GPU-13  The glyph atlas ignores a variable font's coordinates: small text at any weight but 400, 500 or 600 rasters at the face's default weight, and all weights share one atlas entry
- kind: broken
- confidence: LIKELY (certain from the code that the coordinates never reach the raster or its key; the pixels were not run)
- where: crates/deep-text/src/atlas.rs:147-156 (`Key`: blob, index, glyph, size64, phase), :242-273 (`glyph_at`), :295-303 (`ctx.glyph_run(…).font_size(…).hint(false).fill_glyphs(…)`, no `.normalized_coords`); callers crates/deep-text-gpui/src/lib.rs:495 and :506, crates/deep-canvas-scene3d/src/label.rs:200 and :211, crates/deep-gpu-layer/src/status.rs:308. The sibling that does it right: crates/deep-marks-render/src/raster.rs:257-264 and :273-282 (`.normalized_coords(coords)`), and deep-text-gpui's own path branch (`OutlineKey.coords`, lib.rs:159-165, :450).
- evidence: `Glyph.coords` (crates/deep-text/src/shape.rs:95-97) says "the face's normalized variation coordinates … outlines and rasters read the glyph at them". `crates/deep-canvas-marks/src/scene.rs:800` routes every weight that has no static Inter face to "Inter Variable" (`fonts::family_at`, crates/deep-text/src/fonts.rs:162-175). In deep-text-gpui's `place`, a glyph above `OUTLINE_ABOVE` device px goes through `self.outline(glyph, scale)`, keyed and drawn with `glyph.coords`; one at or below it goes to `self.atlas.glyph_at(&glyph.font, glyph.id, device, [px, py])`, which has no coordinate parameter.
- failure: a `text@1` with `weight: 700` at 13 u in a live GPUI writer layer (or a 3D label, or the status marks): shaped on Inter Variable at wght 700, so its advances are bold's; every glyph is rasterized at the default instance, so it draws regular-weight glyphs spaced for bold. A weight-300 and a weight-800 label of the same size also share atlas entries, so whichever drew first is what both show. The CPU raster (`deep-marks render`, what the #496 suite compares: tests/acceptance/496/variable-weight.test.ts uses `raster` at 112 u) draws it right, so the live view and the export disagree.
- fix: carry the coordinates into the key and the raster, keeping today's two entry points for static faces.
  atlas.rs `Key`: add `coords: std::sync::Arc<[i16]>,` after `glyph`.
  atlas.rs:236-248: keep `glyph` and `glyph_at` as thin wrappers and add
  ```rust
      /// [`Atlas::glyph_at`] at a variable face's normalized coordinates (#496; empty for a static face).
      pub fn glyph_with(
          &mut self,
          font: &FontData,
          glyph: u32,
          coords: &std::sync::Arc<[i16]>,
          device_size: f32,
          phase: [u8; 2],
      ) -> Option<Placed> { /* today's glyph_at body, with `coords: coords.clone()` in the key and passed to rasterize */ }
  ```
  with `glyph_at(font, glyph, size, phase)` = `self.glyph_with(font, glyph, &Arc::from([]), size, phase)`.
  atlas.rs:295-297: insert `.normalized_coords(coords)` after `.font_size(device_size)` (the same call raster.rs:264 makes; its argument there is `&[i16]`).
  Callers: deep-text-gpui lib.rs:495 → `.glyph_with(&glyph.font, glyph.id, &glyph.coords, MAX_DEVICE_SIZE, [0, 0])`, :506 → `.glyph_with(&glyph.font, glyph.id, &glyph.coords, device, [px, py])`; label.rs:200 and :211 and status.rs:308 the same with `&g.coords`.
- verify: none exists. Smallest new test, in crates/deep-text/tests/shape.rs beside the atlas tests: shape "M" at weight 900 on `family_at("Inter", 900)`, place its glyph through the atlas, and assert the placed `w` differs from the same glyph placed with empty coordinates (fails today: the function cannot tell them apart).
- risk: an atlas key grows by an `Arc` (a pointer and a count for static faces: `Arc::from([])`). Goldens of GPUI-path text at non-static weights would change; I found none (tests/acceptance/390 and 1480 use the static weights), but did not read every fixture.

Nits (text):
- crates/deep-text/src/shape.rs:123 and :372-376: `Fit.numerals` is documented as `"tabular"` for a bound value but is computed from `spec.tabular`; a caller that sets `bound` without `tabular` reads `proportional`.
- crates/deep-text/src/atlas.rs:268-270: once `full` is set, `glyph_at` returns `None` for every new glyph until `make_room`, even when a later `tick` let `reserve` evict a page and place it: the glyph is then written to a page and to its change ring but not remembered, so it rasterizes again on every call. Both callers call `make_room` (deep-text-gpui lib.rs:472, scene3d label.rs:113), so it is not reachable today.
- crates/deep-text/src/fonts.rs:24: "(`font: body | mono`)" omits `math` (added by #417, same file).

## deep-effects-render

Read in full: Cargo.toml, README, `lib.rs`, `fill.wgsl`, `mips.wgsl`, `planted.wgsl`, `particles.wgsl`, `mips.rs`, `glow.rs`, `planted.rs`, and `frame.rs` lines 270-600 (the sparks draw). Not read: `docops.rs` (1,869), `reference.rs` (605), `runner.rs` (470), `uniformity.rs` (274), `chrome.rs` (245), `compile.rs` (216), the rest of `frame.rs`. No finding above nit level in what was read: the sparks uniform is 48 floats in the order `Draw` declares (frame.rs:421-443 against particles.wgsl:10-22), each auto-layout bind group is built from the pipeline that uses it (frame.rs:452-498), the additive blend keeps destination alpha, OKLab's two matrices and their inverses are the published ones, and the half-size puff's depth test reads reversed Z as the full-size pass does.

Nits (effects):
- README.md "No tests here" while Cargo.toml:26-28 declares `[[test]] acceptance_1312` (tests/acceptance/1312/operator.rs); "Where new code goes" names five of the ten source files (no `docops.rs`, `mips.rs`, `chrome.rs`, `planted.rs`, `uniformity.rs`); "What it may import" omits deep-canvas-motion (Cargo.toml:16).
- fill.wgsl:8 `@workgroup_size(4, 4, 4)` is used for 2D targets too (mips.rs:124-125 swaps only the dimension and swizzle), so every texel of a 2D compute output is stored four times a frame, once per `z`. Add `|| g.z > 0u` to the 2D variant's early return (a fifth `replace` in mips.rs:122-126) or dispatch 2D fills with a (4, 4, 1) module.
- mips.rs:46-49: any format but `Rgba16Float` takes the `rgba8unorm` pipeline, though `Fills` (mips.rs:116) also makes `r32uint` and `r32float` outputs; a mipped output in one of those would fail bind-group validation instead of being refused. mips.rs:149 `self.pipes[&(format.to_string(), dim3)]` panics on a format outside the four.
- reference.rs:153 `slice.get_mapped_range().expect("mapped")` after a `map_async` whose result is dropped: a lost device panics the reference run instead of reporting it.

## deep-marks-render, deep-marks-vello, deep-marks-gpui

Read in full: deep-marks-render `asset.rs`, `video.rs`, Cargo.toml, README; deep-marks-vello `tables.rs`, Cargo.toml, README; deep-marks-gpui (all). Read in part: deep-marks-render `macos.rs` 1236-1285 and 1596-1640 (where videos start), `lib.rs` 1108-1126 and 1206-1219. Not read: deep-marks-render `lib.rs`, `macos.rs`, `raster.rs`, `gpu.rs`, `graphs.rs`, `layer.rs`, `place.rs`, `status.rs`, `formulas.rs`, `tests/`; deep-marks-vello `lib.rs` (1,021 lines: the paints, sRGB tables and scopes the task asked about). Prior report 08 covers their speed.

### RUST-GPU-14  The live view opens and plays a video by whatever its `asset` string names, before the frame build checks that the string is a hash, and never checks the file against it
- kind: broken
- confidence: LIKELY (the order is certain from the code; whether an earlier document check refuses the item first I could not establish)
- where: crates/deep-marks-render/src/macos.rs:1280 (`Self::videos(…)` runs) then :1283 (`scene::frame_planted`, where crates/deep-canvas-marks/src/scene.rs:4862 refuses an `asset` that is not 64 hex digits); crates/deep-marks-render/src/macos.rs:1607-1627; crates/deep-marks-render/src/video.rs:128-139 and :288-296; the rule it breaks: crates/deep-marks-render/src/asset.rs:1-3 ("read from the request's content-addressed store by their sha256 and checked against that hash … A document never names a path") and asset.rs:14-24 (`read` compares `sha256_hex(&bytes)` with the name)
- evidence:
  ```rust
  item.pointer("/params/asset").and_then(Value::as_str)        // macos.rs:1610, the raw string
  … !crate::video::is_video(session.store.as_deref(), sha)      // store.join(sha), opens and reads 12 bytes
  … crate::video::Player::start(&store.join(sha), (side(2), side(3)))
  ```
  `Path::join` with an absolute path replaces the base, and `..` walks out of it. `Player::start` hands the path to the decode worker; nothing hashes the file.
- failure: an `image@1` item with `frames` and `"asset": "~/Movies/private.mov"` (or `"../../x.mp4"`): the live view starts a decode worker on that file and holds a player for it; the frame build then refuses the item, but the worker has already opened and probed the file. With a well-formed hash the wrong bytes under that name (a damaged store) play unchecked, where an image would be `asset_mismatch`.
- fix: refuse a name that is not a hash before touching the disk. macos.rs:1614
  old: `if item["kind"] != "image@1" || !crate::video::is_video(session.store.as_deref(), sha) {`
  new:
  ```rust
              let hashed = sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit());
              if item["kind"] != "image@1"
                  || !hashed
                  || !crate::video::is_video(session.store.as_deref(), sha)
              {
  ```
  (The item then reaches `frame_planted`, which refuses it with the same error as today.) Checking a video's bytes against its hash is a separate decision: hashing a multi-gigabyte file on the UI side costs time; the worker could report the hash in its header.
- verify: tests/acceptance/499 (live video) unchanged. New: a session whose image item names an absolute path to a real `.mp4` answers `asset` refused and `ps` shows no `decode-worker-live` child.
- risk: none for documents whose assets are hashes.

### RUST-GPU-15  `video::Player::start` drops its worker without waiting on two error paths: one unreaped process per failed start
- kind: broken
- confidence: SURE (mechanics); LIKELY (how often it is reached)
- where: crates/deep-marks-render/src/video.rs:155 (`stdout.read_exact(&mut pts).map_err(…)?`) and :160 (`pixel_buffer(out.0, out.1, full, matrix)?`); the path that does it right: :144-149 (`child.kill(); child.wait()`); caller crates/deep-marks-render/src/macos.rs:1624-1627
- evidence: after `spawn` the `child` lives in a local. Both `?` return with it dropped; `std::process::Child`'s drop neither kills nor waits. The worker ends when its stdin closes, and stays a zombie until this process exits.
- failure: a video whose first sample entry the parser does not size (mp4.rs:251-276 sets width and height only for `avc1|avc3|hvc1|hev1|mp4v|jpeg|apcn`; an `av01`, `vp09` or `apch` track reads 0 × 0) in an item with no `box`: the worker writes a header with output size 0 × 0, `pixel_buffer(0, 0, …)` fails, `start` returns `Err`, the caller answers `asset_undecodable`. Each retry of the frame leaves another zombie.
- fix: video.rs:154-160, reap before returning:
  ```rust
          let mut pts = vec![0u8; n * 8];
          let made = stdout
              .read_exact(&mut pts)
              .map_err(|e| e.to_string())
              .and_then(|()| pixel_buffer(out.0, out.1, full, matrix));
          let buffer = match made {
              Ok(b) => b,
              Err(e) => {
                  let _ = stdin.write_all(&u32::MAX.to_le_bytes());
                  let _ = child.kill();
                  let _ = child.wait();
                  return Err(e);
              }
          };
          let pts = pts.chunks_exact(8)…collect();
  ```
- verify: tests/acceptance/499 unchanged; `ps -o stat= -p <child>` after a failed start shows no `Z`.
- risk: none.

### RUST-GPU-16  A 64-byte asset hash that is not ASCII panics the table inliner
- kind: broken
- confidence: LIKELY (callers may check the document first; `tables` itself is `pub` and takes any document)
- where: crates/deep-marks-vello/src/tables.rs:53-60; callers crates/deep-marks-render/src/asset.rs:64-66 (from lib.rs:587) and crates/deep-show/src/hub.rs:1373
- evidence:
  ```rust
  let file = evidence
      .filter(|_| hash.len() == 64)
      .and_then(|e| std::fs::read(e.join(&hash[..2]).join(&hash[2..])).ok())
  ```
  `hash` is `assets[asset]["sha256"]` from the document. `len()` counts bytes; `&hash[..2]` panics when byte 2 is inside a character.
- failure: `"sha256": "€" + 61 hex digits` (3 + 61 = 64 bytes): "byte index 2 is not a char boundary". A 64-byte name beginning `..` followed by `/…` also makes `join` read outside the store (the result is only compared with the hash, so nothing leaks).
- fix: tables.rs:58
  old: `.filter(|_| hash.len() == 64)`
  new: `.filter(|_| hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()))`
  (A bad name then gives `asset_missing`, as a short one does today.)
- verify: tests/acceptance/397 and 1162 unchanged; a unit test with the name above returns `Err(asset_missing)` instead of panicking.
- risk: none.

Nits (marks):
- crates/deep-codecs/src/lib.rs:1059-1063 with crates/deep-marks-render/src/video.rs:221-238: at the source's own size (`out_w == 0`) the output size is not made even, the worker expects `ow * oh * 3 / 2` bytes, and the host copies `h / 2` chroma rows of `w` bytes; a source with an odd width or height then fails every frame on the length test (lib.rs:1126). Rare (4:2:0 encoders refuse odd sizes); `& !1` on the source branch would make it uniform.
- crates/deep-marks-render/src/video.rs:288-296 `is_video` knows a movie only by `ftyp` or `moov` in its first box; a QuickTime file that starts with `wide`, `free` or `mdat` is taken for an image and refused as undecodable.
- crates/deep-marks-vello/README.md: "What it may import: deep-canvas, deep-canvas-marks and vello_cpu only" and "No … app crate"; Cargo.toml:18 adds serde_json and `src/tables.rs` reads the evidence store from disk (`std::fs::read`). "Where new code goes" names only `src/lib.rs`.
- crates/deep-marks-vello/Cargo.toml:9-12 and README still call the binary's home "deep-canvas-render's `raster`"; the binary is `deep-canvas-render` in crates/deep-marks-render (README says so in passing). A kept name, not a stale one, but the Cargo comment gives no path.

## deep-gpu-layer

This crate is 33,700 lines and I read only part of it. Read in full: Cargo.toml, README.md, build.rs, `scene.wgsl`, `tick.wgsl`, `burn.wgsl`, `testgpu.wgsl`, `effects.wgsl`, `indexed_up.wgsl`, `textures.rs`, `tone.rs`. Read in part: `main.rs` 840-905, `scene.rs` 263-285 (the record behind `scene.wgsl`), `indexed.rs` 29-58, `groups.rs` 495-530, `frames.rs` 425-450, `plugin.rs` 18-40 and 255-275. Checked by search over the whole crate: every `.wgsl` is `include_str!`-ed (all ten are), every `cfg(feature = …)` names a declared feature (all do), every `unwrap`/`expect` on a device, file, process or channel result (four sites: `worker.rs:153`, `interp_suite/mod.rs:620`, `textures.rs:210`, `levels.rs:179`, all in proof-only paths), every `unsafe` (each carries a SAFETY line), `#[allow(dead_code)]` (none), old `doneright` names (none in the whole area), every dependency against a use (all used; `gpui-pre-apple` is used as `gpui_apple`).

What I checked and found sound: `scene.rs`'s `Gpu` record is 64 bytes in the order and alignment of `scene.wgsl`'s `Region` (two `vec4<u32>` at 32 and 48); `indexed.rs`'s `Prim` and `Params` match `indexed_up.wgsl` field for field; `effects.wgsl` reuses bindings 0 and 1 across entry points that never share a pipeline; `sharpen` clamps colour to alpha, so it stays premultiplied.

Nits (deep-gpu-layer):
- README.md "Tests: the acceptance suites drive the binary; the one unit module is in `src/plugin.rs`." There are six `#[cfg(test)]` modules (`drawn.rs:1455`, `indexed.rs:722`, `timing.rs:292`, `warm.rs:262`, `plugin.rs:398`, `status.rs:666`) and `tests/ambient_class.rs`. Inconsistent, SURE; reword to "unit modules sit beside the code they test (`rg 'cfg\(test\)' src`); `tests/ambient_class.rs` …".
- README.md "Deviations" lists `src/main.rs`'s allocator as "the crate's one `unsafe impl`" and nothing else; the crate also has `unsafe` in `validation.rs:44-56` (`dup`/`dup2` on fd 2), `view3d.rs:137-139` (`proc_pidinfo`) and `fixtures.rs:122` (`create_shader_module_trusted` with `ShaderRuntimeChecks::unchecked()`), which the README's deviation list should name as it names the allocator.
- Three counting global allocators exist for the same job: `crates/deep-gpu-layer/src/main.rs:817` (behind `test-meter`), `crates/deep-marks-render/src/lib.rs:1190` (`pub struct Counting`) and `crates/deep-text-render/src/main.rs:59`. The last has no SAFETY comment (its two siblings do) and is not behind a feature. Not merged here: each binary needs its own `#[global_allocator]`, but the struct could be one.
- Cargo.toml:74 `sha2 = "0.11"`; the other ten crates that use sha2 (deep-codecs, deep-canvas, deep-canvas-marks, deep-show, …) pin "0.10", and deep-gpu-layer links several of them, so the binary carries two sha2 versions. No comment says why. Aligning to "0.10" needs a compile to confirm the 0.11 API is not relied on (`rg 'sha2::' crates/deep-gpu-layer/src`).
- textures.rs:200-208: with no `store`, each `mesh.asset@1` import writes its images to `$TMPDIR/deep-gpu-images-<pid>/` and nothing removes the folder (`rg 'deep-gpu-images' crates` finds only this line; `film.rs:624` and `plugin.rs:343,383` do remove theirs). Every run of an acceptance test that imports a glTF without a store leaves its textures behind.
- tone.rs:28 `(size[0] * size[1] * 16) as usize` multiplies in u32: a `size` over 16,384² panics a dev build and wraps a release one. Use `size[0] as usize * size[1] as usize * 16`.
- testgpu.wgsl:1-2 says the file holds `test.burn`'s fragment; that lives in `burn.wgsl`.
- textures.rs:103-116 keeps a decode worker that has died (`app.made.decoder` stays `Some`), as deep-show does (RUST-GPU-1): one bad map fails every later map of the run with "process … ended".

## Cargo manifests and READMEs across the area (all ten Cargo.toml read; READMEs read for eight, not deep-text-gpui or deep-text-render)

Every dependency is used and every feature gate names a declared feature. What disagrees:
- sha2: "0.11" in crates/deep-gpu-layer/Cargo.toml:74 against "0.10" everywhere else (above).
- image: `["png", "jpeg"]` in deep-codecs and deep-marks-render, `["png"]` in deep-gpu-layer; consistent with what each decodes.
- READMEs behind their code: deep-codecs (basisu_c_sys, `maps.rs`, `table.rs`), deep-gpu (`structural.rs`), deep-effects-render (the `[[test]]`, five source files, deep-canvas-motion), deep-marks-vello (serde_json, `tables.rs`, disk reads), deep-gpu-layer (unit modules, `unsafe` list). Each is listed under its crate above.
- deep-text: fonts and licenses agree. Eleven faces in `fonts/`, eleven `include_bytes!` in `src/fonts.rs`; seven families, seven `LICENSE-*.txt`.

## Coverage

"Searched" means the file was covered only by the area-wide searches (shader loads, feature gates, `unsafe`, `unwrap`/`expect` on device, file and process results, `#[allow(dead_code)]`, old names, dependency use, tests that return early). It was not read, and a bug that needs reading to see is not ruled out there.

| crate | read in full | read in part | not read (searched only) |
|---|---|---|---|
| deep-codecs (3.5k) | Cargo.toml, README, `lib.rs`, `mp4.rs`, `wav.rs`, `table.rs`, `maps.rs`, `color.rs`, `apple.rs` | | |
| deep-gpu (5.4k) | Cargo.toml, README, build.rs, `lib.rs`, `alloc.rs`, `cache.rs`, `compile.rs`, `device.rs`, `encode.rs`, `guard.rs`, `memory.rs`, `meter.rs`, `quirks.json`, `render.rs`, `ring.rs`, `seam.rs`, `structural.rs`, `structural.wgsl`, `surface.rs`, `upload.rs`, `view.rs` | | `tests/noop.rs` |
| deep-text (2.2k) | Cargo.toml, README, `lib.rs`, `atlas.rs`, `cache.rs`, `shape.rs`, `outlines.rs`; fonts and licenses counted against `fonts.rs` | `fonts.rs` (all but the face table's rows) | `main.rs`, `unicode.rs`, `tests/shape.rs` |
| deep-text-gpui (0.9k) | Cargo.toml | `lib.rs` 150-210, 420-570 | README, rest of `lib.rs` |
| deep-text-render (0.7k) | Cargo.toml | `main.rs` 55-75 | README, rest of `main.rs`, `tests/frame.rs` |
| deep-effects-render (5.4k) | Cargo.toml, README, `lib.rs`, `fill.wgsl`, `mips.wgsl`, `planted.wgsl`, `particles.wgsl`, `mips.rs`, `glow.rs`, `planted.rs` | `frame.rs` 270-620, `docops.rs` 1680-1700 | `docops.rs`, `reference.rs`, `runner.rs`, `uniformity.rs`, `chrome.rs`, `compile.rs`, rest of `frame.rs` |
| deep-marks-render (8.9k) | Cargo.toml, README, `asset.rs`, `video.rs` | `macos.rs` 1236-1285, 1548-1640; `lib.rs` 1108-1126, 1186-1219; `raster.rs` 700-712 | `lib.rs`, `macos.rs`, `raster.rs`, `gpu.rs`, `graphs.rs`, `layer.rs`, `place.rs`, `status.rs`, `formulas.rs`, `main.rs`, `spike/vello_gpu_2d.json` (first 1.5 KB seen; loaded at `gpu.rs:31`), all of `tests/` |
| deep-marks-vello (1.2k) | Cargo.toml, README, `tables.rs` | | `lib.rs` (paints, sRGB stops, scopes) |
| deep-marks-gpui (0.2k) | Cargo.toml, README, `lib.rs` | | |
| deep-gpu-layer (33.7k) | Cargo.toml, README, build.rs, `scene.wgsl`, `tick.wgsl`, `burn.wgsl`, `testgpu.wgsl`, `effects.wgsl`, `indexed_up.wgsl`, `groups.wgsl`, `textures.rs`, `tone.rs` | `main.rs` 803-905; `scene.rs` 263-285; `indexed.rs` 29-58; `groups.rs` 495-530; `frames.rs` 425-450; `plugin.rs` 18-40, 255-275; `validation.rs`, `view3d.rs`, `fixtures.rs` at their `unsafe` sites | everything else: `live.rs`, `liveview.rs`, `view3d.rs`, `session3.rs`, `host.rs`, `window.rs`, `worker.rs`, `lod.rs`, `simplify.rs`, `levels.rs`, `warm.rs`, `seam.rs`, `status.rs`, `drawn.rs`, `drawn.wgsl`, `effects.rs`, `groups.rs`, `indexed.rs`, `indexed.wgsl`, `marks2d.rs`, `paintfx.rs`, `paintfx.wgsl`, `print2d.rs`, `blur.rs`, `film.rs`, `flat.rs`, `columns.rs`, `opframe.rs`, `interp_suite/*`, `steps_ref.rs`, `calibrate.rs`, `golden.rs`, `parity.rs`, `fixtures.rs`, `frames.rs`, `testgpu.rs`, `timing.rs`, `conformance.rs`, `compile.rs`, `compare.rs`, `reference.rs`, `faults.rs`, `allocations.rs`, `guard.rs`, `tests/ambient_class.rs` |

What that leaves unchecked from the task's own list, plainly:
- Shader against Rust layouts were checked for `scene.wgsl`, `indexed_up.wgsl`, `structural.wgsl`, `particles.wgsl`, `fill.wgsl`, `mips.wgsl`, `planted.wgsl` only. Not checked: `drawn.wgsl` (695 lines) against `drawn.rs`, `paintfx.wgsl` against `paintfx.rs`, `indexed.wgsl` against `indexed.rs`'s compute side, `groups.wgsl`'s `Mix` against the bytes `groups.rs` writes, `testgpu.wgsl` against `testgpu.rs`.
- Colour space and premultiplied alpha: checked in `groups.wgsl`, `effects.wgsl`, `particles.wgsl`, `guard.rs`, deep-codecs. Not checked: deep-marks-vello's sRGB stops and tables, deep-marks-render's raster and PNG output, deep-gpu-layer's 2D compositor.
- Row pitch: read in `surface.rs`; elsewhere checked by search (`rg 'bytes_per_row: '` over deep-gpu-layer, deep-effects-render, deep-marks-render). Every buffer copy rounds its row to 256 (`print2d.rs:194`, `opframe.rs:87`, `fixtures.rs:201`, `gpu.rs:407`, `reference.rs:124`; `paintfx.rs:218` rounds the width to 16 texels of 16 bytes). The four unpadded rows (`testgpu.rs:338`, `opframe.rs:503`, `drawn.rs:313`, `reference.rs:287`) are `queue.write_texture`, which has no alignment rule. No finding. Also read after the first pass: deep-marks-vello `lib.rs` 760-790 and 925-952 (an image's premultiply and a luminance mask's un-premultiply, both guarded against zero alpha).
- Per-frame resources in the live loop (`live.rs`, `liveview.rs`), the proof suites' pass-with-nothing-run risk (`interp_suite`, `golden.rs`, `parity.rs`, `calibrate.rs`, `conformance.rs`, `compare.rs`), and unused `pub` items: not examined.
- Tests were cut first, as the task allowed: no test file in the area was read; I only searched them for early returns and platform gates.
