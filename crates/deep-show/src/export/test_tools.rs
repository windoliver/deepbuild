//! Issue #518: the native test encode tools of the `test-encode-tools` build (the #518
//! acceptance README: The native test tools). Each is this binary run as `test-encode-tool
//! <plan>`, speaking `program.rs`'s wire, and encodes only for an export whose brief pins it.
//!
//! The AV1 writers take the conversion pass's NV12 planes by copy and encode them with rav1e
//! into a video part the export joins with its sound: `av1` tags it BT.709 limited range and
//! keeps every frame; `av1_drops` leaves out every frame whose index is a positive multiple of
//! 100; `av1_bt601` writes the tags nclx 6-6-6.
//!
//! The PNG sequence writers (macOS) take the export's ring of GPU surface slots once at their
//! open, and for each frame read the slot's BGRA8 rows, hash them with BLAKE3, write the frame's
//! PNG as they take the frame and return the slot; their report is the hashes they read, in
//! order. `frames` does only that; `red_before` first writes a 16 × 16 square of opaque red into
//! the slot's top-left corner; `red_after` writes it once the frame is encoded, before it
//! returns the slot; `keeps` returns no slot after frame 500.

use std::io::{BufRead, Write};
use std::path::Path;

use serde_json::{json, Value};

fn say(v: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}").and_then(|()| out.flush());
}

/// The next message on stdin: its line, and the raw bytes its `bytes` counts.
fn next(input: &mut impl BufRead) -> Option<(Value, Vec<u8>)> {
    let mut line = String::new();
    if input.read_line(&mut line).ok()? == 0 {
        return None;
    }
    let v: Value = serde_json::from_str(&line).ok()?;
    let mut bytes = vec![0; v["bytes"].as_u64().unwrap_or(0) as usize];
    input.read_exact(&mut bytes).ok()?;
    Some((v, bytes))
}

/// Runs one job; the process's exit code.
pub(crate) fn run(args: &[String]) -> i32 {
    let plan = args.first().map_or("frames", String::as_str);
    let mut input = std::io::stdin().lock();
    let Some((open, _)) = next(&mut input) else {
        return 1;
    };
    let done = match plan.starts_with("av1") {
        true => av1(plan, &open, &mut input),
        false => surface(plan, &open, &mut input),
    };
    match done {
        Ok(report) => {
            say(json!({"done": true, "report": report}));
            0
        }
        Err(why) => {
            say(json!({"error": why}));
            1
        }
    }
}

/// An AV1 part at the job's `out`: the frames it kept, each a key frame or not, in an MP4.
fn av1(plan: &str, open: &Value, input: &mut impl BufRead) -> Result<Value, String> {
    use deep_codecs::{mov, mp4::Colr};
    use rav1e::prelude::*;
    let at = |v: &Value, i: usize| v[i].as_u64().unwrap_or(0);
    let (w, h) = (at(&open["size"], 0) as usize, at(&open["size"], 1) as usize);
    let (p, q) = (
        at(&open["frame_rate"], 0),
        at(&open["frame_rate"], 1).max(1),
    );
    let mut enc = EncoderConfig::with_speed_preset(10);
    (enc.width, enc.height, enc.bit_depth) = (w, h, 8);
    enc.chroma_sampling = ChromaSampling::Cs420;
    enc.time_base = Rational::new(q, p.max(1));
    enc.low_latency = true;
    enc.quantizer = 60;
    enc.max_key_frame_interval = 2 * p.max(1) / q;
    enc.pixel_range = PixelRange::Limited;
    enc.color_description = Some(ColorDescription {
        color_primaries: ColorPrimaries::BT709,
        transfer_characteristics: TransferCharacteristics::BT709,
        matrix_coefficients: MatrixCoefficients::BT709,
    });
    let config = Config::new().with_encoder_config(enc).with_threads(4);
    let mut ctx: Context<u8> = config.new_context().map_err(|e| e.to_string())?;
    say(json!({"ready": true}));
    let (mut samples, mut keys) = (Vec::new(), Vec::new());
    // Every coded frame the encoder has ready: its temporal unit without the delimiter, which
    // an MP4 sample leaves out.
    let mut drain = |ctx: &mut Context<u8>| loop {
        match ctx.receive_packet() {
            Ok(packet) => {
                keys.push(packet.frame_type == FrameType::KEY);
                let unit = packet.data;
                samples.push(match unit.starts_with(&[0x12, 0]) {
                    true => unit[2..].to_vec(),
                    false => unit,
                });
            }
            Err(EncoderStatus::Encoded) => {}
            Err(_) => break,
        }
    };
    while let Some((v, nv12)) = next(input) {
        if v["end"] == true {
            break;
        }
        let k = v["frame"].as_i64().ok_or("a frame names its index")?;
        let kept = plan != "av1_drops" || k <= 0 || k % 100 != 0;
        if kept {
            if nv12.len() != w * h * 3 / 2 {
                return Err(format!("frame {k} isn't its NV12 planes"));
            }
            let (y, cbcr) = nv12.split_at(w * h);
            let (cb, cr): (Vec<u8>, Vec<u8>) = cbcr.chunks_exact(2).map(|c| (c[0], c[1])).unzip();
            let mut frame = ctx.new_frame();
            frame.planes[0].copy_from_raw_u8(y, w, 1);
            frame.planes[1].copy_from_raw_u8(&cb, w / 2, 1);
            frame.planes[2].copy_from_raw_u8(&cr, w / 2, 1);
            ctx.send_frame(frame).map_err(|e| e.to_string())?;
            drain(&mut ctx);
        }
        say(json!({"frame": k}));
    }
    ctx.flush();
    drain(&mut ctx);
    let (timescale, ticks) = mov::timescale(p as u32, q as u32);
    let record = ctx.container_sequence_header();
    let tags = if plan == "av1_bt601" { 6 } else { 1 };
    let layout = mov::Layout {
        fourcc: *b"av01",
        config: Some(&record),
        size: [w as u32, h as u32],
        timescale,
        ticks,
        sizes: samples.iter().map(|s| s.len() as u32).collect(),
        keys: Some(keys),
        colr: Colr {
            primaries: tags,
            transfer: tags,
            matrix: tags,
            ..mov::BT709
        },
        shift: 0,
        held: None,
    };
    let mut file = mov::head(mov::Brand::Mp4, &layout, None, None);
    samples.iter().for_each(|s| file.extend_from_slice(s));
    let out = Path::new(open["out"].as_str().unwrap_or_default());
    std::fs::write(out, file).map_err(|e| format!("{} couldn't be written: {e}", out.display()))?;
    Ok(json!({"frames": samples.len()}))
}

#[cfg(not(target_os = "macos"))]
fn surface(_: &str, _: &Value, _: &mut impl BufRead) -> Result<Value, String> {
    Err("a slot is a GPU surface, which this platform's tools don't take".into())
}

/// A PNG sequence in the folder at the job's `out`, read from the ring's slots.
#[cfg(target_os = "macos")]
fn surface(plan: &str, open: &Value, input: &mut impl BufRead) -> Result<Value, String> {
    /// How long the tool waits for the export's ring at its open, in ms.
    const RING_MS: u32 = 10_000;
    /// The last frame whose slot the `keeps` plan returns.
    const KEPT_AFTER: i64 = 500;
    const SQUARE: usize = 16;
    let size = [0, 1].map(|i| open["size"][i].as_u64().unwrap_or(0) as u16);
    let out = Path::new(open["out"].as_str().unwrap_or_default());
    let ring =
        deep_codecs::surface::Ring::take(open["ring"].as_str().unwrap_or_default(), RING_MS)?;
    std::fs::create_dir_all(out).map_err(|e| format!("{} can't be made: {e}", out.display()))?;
    say(json!({"ready": true}));
    // Opaque red, BGRA8.
    let red = [0u8, 0, 255, 255].repeat(SQUARE * SQUARE);
    let mut hashes = Vec::new();
    while let Some((v, _)) = next(input) {
        if v["end"] == true {
            break;
        }
        let (Some(k), Some(i)) = (v["frame"].as_i64(), v["slot"].as_u64()) else {
            return Err("a frame names its slot".into());
        };
        let i = i as usize;
        if plan == "red_before" {
            ring.write(i, &red, [SQUARE, SQUARE]);
        }
        let mut px = ring.read(i).ok_or(format!("the ring has no slot {i}"))?;
        hashes.push(super::hex(blake3::hash(&px).as_bytes()));
        for p in px.as_chunks_mut::<4>().0 {
            p.swap(0, 2);
        }
        let file = out.join(format!("{k:06}.png"));
        std::fs::write(&file, crate::snapshot::png(px, size))
            .map_err(|e| format!("{} couldn't be written: {e}", file.display()))?;
        if plan == "red_after" {
            ring.write(i, &red, [SQUARE, SQUARE]);
        }
        if plan == "keeps" && k > KEPT_AFTER {
            continue;
        }
        say(json!({"frame": k, "slot": i}));
    }
    Ok(json!({"frames": hashes}))
}
