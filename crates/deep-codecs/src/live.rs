//! #499: the live view's decode worker for one video, a sandboxed copy of the binary that decodes
//! the frames the view asks for, one session kept open so playing forward decodes each frame once.

use std::io::{Read, Write};

#[cfg(target_os = "macos")]
use crate::apple;
use crate::{mp4, track_color, turn, Planted};

/// The live decode worker's header magic (#499).
pub const LIVE_MAGIC: &[u8; 4] = b"DVL1";

/// #499: the live view's decode worker for one video: sandboxed, it opens `path` and decodes the
/// frames the view asks for, one session kept open so playing forward decodes each frame once, as
/// NV12 at `out_w × out_h` (0 for the source's size) in the range the stream is tagged with.
///
/// On start it writes `DVL1`, then u32 LE source width, height, output width, height, matrix
/// (0 BT.709, 1 BT.601, 2 BT.2020), full range (0 or 1), i64 timescale, u32 frame count and
/// each frame's presentation time (i64 ticks, presentation order). Each request is a u32 frame
/// index (u32::MAX ends it); each answer is u32 index, u32 ok, then the Y plane and the CbCr
/// plane, rows top-down without padding.
pub fn serve_live(args: &[String]) -> i32 {
    let arg = |i: usize| args.get(i).cloned().unwrap_or_default();
    let (path, out_w, out_h) = (
        arg(0),
        arg(1).parse().unwrap_or(0usize),
        arg(2).parse().unwrap_or(0usize),
    );
    #[cfg(target_os = "macos")]
    if let Err(e) = apple::sandbox() {
        eprintln!("decode worker: {e}");
        return 1;
    }
    let Ok(data) = std::fs::read(&path) else {
        return 1;
    };
    let Some(m) = mp4::parse(&data) else { return 1 };
    let Some(t) = m.tracks.iter().find(|t| t.kind == mp4::Kind::Video) else {
        return 1;
    };
    let shown = t.presented(m.timescale, true);
    let color = track_color(t, &Planted::default());
    let matrix: u32 = match color["matrix"].as_str() {
        Some(m) if m.contains("601") || m.contains("470") || m.contains("smpte170") => 1,
        Some(m) if m.contains("2020") => 2,
        _ => 0,
    };
    let full = color["range"] == "full";
    // #1488: sizes as the clip shows, its track header's turn applied; frames decode as stored,
    // at the output size turned back, and are turned before they're sent.
    let turn = t.rotation;
    let (sw, sh) = turn::size(t.entry.width as usize, t.entry.height as usize, turn);
    let (ow, oh) = if out_w == 0 || out_h == 0 {
        (sw, sh)
    } else {
        (out_w & !1, out_h & !1)
    };
    let (dw, dh) = turn::size(ow, oh, turn);
    let mut out = std::io::stdout().lock();
    let mut head = LIVE_MAGIC.to_vec();
    for v in [
        sw as u32,
        sh as u32,
        ow as u32,
        oh as u32,
        matrix,
        u32::from(full),
    ] {
        head.extend(v.to_le_bytes());
    }
    head.extend(i64::from(t.timescale).to_le_bytes());
    head.extend((shown.len() as u32).to_le_bytes());
    for (_, p) in &shown {
        head.extend(p.to_le_bytes());
    }
    if out.write_all(&head).and_then(|()| out.flush()).is_err() {
        return 1;
    }
    #[cfg(target_os = "macos")]
    {
        let Some(config) = t.entry.config.as_ref() else {
            return 1;
        };
        let Ok(mut dec) = apple::LiveDecoder::new(
            t.entry.fourcc,
            config,
            (t.entry.width, t.entry.height),
            (dw, dh),
            full,
        ) else {
            return 1;
        };
        let size = ow * oh * 3 / 2;
        let blank = vec![0u8; size];
        let mut last: Option<usize> = None;
        let mut stdin = std::io::stdin().lock();
        let mut req = [0u8; 4];
        while stdin.read_exact(&mut req).is_ok() {
            let k = u32::from_le_bytes(req);
            if k == u32::MAX {
                break;
            }
            let picture = (|| {
                let s = shown.get(k as usize)?.0;
                let from = match last {
                    Some(l) if l < s => l + 1,
                    _ => (0..=s).rev().find(|i| t.samples[*i].key).unwrap_or(0),
                };
                let mut got = None;
                for i in from..=s {
                    let smp = &t.samples[i];
                    let bytes =
                        data.get(smp.offset as usize..smp.offset as usize + smp.size as usize)?;
                    for p in dec.decode(i, bytes).ok()? {
                        if p.sample == s {
                            got = Some(p.planes);
                        }
                    }
                    last = Some(i);
                }
                got.filter(|p| p.len() == size)
                    .map(|p| turn::nv12(p, dw, dh, turn))
            })();
            let ok = picture.is_some();
            let mut reply = k.to_le_bytes().to_vec();
            reply.extend(u32::from(ok).to_le_bytes());
            if out
                .write_all(&reply)
                .and_then(|()| out.write_all(picture.as_deref().unwrap_or(&blank)))
                .and_then(|()| out.flush())
                .is_err()
            {
                break;
            }
        }
    }
    0
}
