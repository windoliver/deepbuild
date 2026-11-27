//! #499: the live view's decode worker for one video, a sandboxed copy of the binary that decodes
//! the frames the view asks for, one session kept open so playing forward decodes each frame once.

use std::io::{Read, Write};

#[cfg(target_os = "macos")]
use crate::apple;
use crate::{mp4, track_color, turn, Planted};

/// The live decode worker's header magic (#499).
pub const LIVE_MAGIC: &[u8; 4] = b"DVL1";

/// #3467: the most pictures kept ahead of their turn, as many as a stream's own order may need.
#[cfg(target_os = "macos")]
const AHEAD: usize = 16;

/// #3467: whether the picture of a sample decoded for request `k` is kept for its own turn: it
/// is presented after `k`, and fewer than `AHEAD` pictures are held.
#[cfg(target_os = "macos")]
fn kept_ahead(place: usize, k: usize, held: usize) -> bool {
    place > k && held < AHEAD
}

/// #499: the live view's decode worker for one video: sandboxed, it opens `path` and decodes the
/// frames the view asks for, one session kept open so playing forward decodes each frame once, as
/// NV12 at `out_w × out_h` (0 for the source's size) in the range the stream is tagged with.
///
/// On start it writes `DVL1`, then u32 LE source width, height, output width, height, matrix
/// (0 BT.709, 1 BT.601, 2 BT.2020), full range (0 or 1), i64 timescale, u32 frame count and
/// each frame's presentation time (i64 ticks, presentation order). Each request is a u32 frame
/// index (u32::MAX ends it); each answer is u32 index, u32 ok, u32 samples decoded for it, u64
/// frame bytes the worker holds, then the Y plane and the CbCr plane, rows top-down without
/// padding.
///
/// #3467: a request past the last sample decoded starts at the later of the sample after it and
/// the last key frame at or before the one asked for, and one behind it at that key frame. A
/// picture decoded before its turn is kept, at most 16 of them, until it is shown or a jump
/// leaves it behind, so a stream stored out of presentation order decodes each sample once too.
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
        // #3467: each sample's place in presentation order, and the pictures decoded before
        // their turn, by sample.
        let mut place = vec![0usize; t.samples.len()];
        for (k, (s, _)) in shown.iter().enumerate() {
            place[*s] = k;
        }
        let mut last: Option<usize> = None;
        let mut ahead: Vec<(usize, Vec<u8>)> = Vec::new();
        // #3467's planted workers, by the name a test's `session` gives: the merge base's start
        // rule, or every request started at a key frame, each with nothing kept ahead; a
        // picture kept for another sample answered in place of the one asked for; and every
        // picture decoded held until the worker ends.
        let plant = arg(3);
        let base_rule = plant == "keeps_base_start_rule";
        let every_key = plant == "starts_every_request_at_key_frame";
        let any_kept = plant == "answers_picture_kept_for_another";
        let hoards = plant == "keeps_every_picture";
        let mut hoard: Vec<Vec<u8>> = Vec::new();
        let mut stdin = std::io::stdin().lock();
        let mut req = [0u8; 4];
        while stdin.read_exact(&mut req).is_ok() {
            let k = u32::from_le_bytes(req);
            if k == u32::MAX {
                break;
            }
            let mut samples = 0u32;
            let picture = (|| {
                let s = shown.get(k as usize)?.0;
                ahead.retain(|(i, _)| place[*i] >= k as usize);
                if let Some(at) = ahead.iter().position(|(i, _)| *i == s) {
                    return Some(ahead.swap_remove(at).1);
                }
                let key = (0..=s).rev().find(|i| t.samples[*i].key).unwrap_or(0);
                let from = match last {
                    Some(l) if l < s && base_rule => l + 1,
                    Some(l) if l < s && !every_key => (l + 1).max(key),
                    _ => key,
                };
                if last.is_none_or(|l| from != l + 1) {
                    ahead.clear();
                }
                let mut got = None;
                for (i, smp) in t.samples.iter().enumerate().take(s + 1).skip(from) {
                    let bytes =
                        data.get(smp.offset as usize..smp.offset as usize + smp.size as usize)?;
                    let early = kept_ahead(place[i], k as usize, ahead.len());
                    let early = early && !base_rule && !every_key;
                    samples += 1;
                    for p in dec.decode(i, bytes, i == s || early || hoards).ok()? {
                        if hoards {
                            hoard.push(p.planes.clone());
                        }
                        if p.sample == s {
                            got = Some(p.planes);
                        } else if early {
                            ahead.push((p.sample, p.planes));
                        }
                    }
                    last = Some(i);
                }
                got
            })();
            let soonest = ahead.iter().min_by_key(|(i, _)| place[*i]);
            let picture = match soonest.filter(|_| any_kept) {
                Some((_, kept)) => Some(kept.clone()),
                None => picture,
            };
            let picture = picture
                .filter(|p| p.len() == size)
                .map(|p| turn::nv12(p, dw, dh, turn));
            let ok = picture.is_some();
            // The decoded pictures held now: those kept and the one answered.
            let held = ahead.iter().map(|(_, p)| p.len()).sum::<usize>()
                + hoard.iter().map(Vec::len).sum::<usize>()
                + picture.as_ref().map_or(0, Vec::len);
            let mut reply = k.to_le_bytes().to_vec();
            reply.extend(u32::from(ok).to_le_bytes());
            reply.extend(samples.to_le_bytes());
            reply.extend((held as u64).to_le_bytes());
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// #3467: a picture is kept ahead only while its turn is still to come and under 16 are held.
    #[test]
    fn at_most_16_pictures_are_kept_ahead_of_their_turn() {
        assert!(kept_ahead(7, 6, 15));
        assert!(!kept_ahead(7, 6, 16));
        assert!(!kept_ahead(6, 6, 0));
        assert!(!kept_ahead(5, 6, 0));
    }

    /// #3467: a picture the worker doesn't keep is decoded and never copied out of the decoder's
    /// buffer; the next one, kept, is its own sample's at the output size.
    #[test]
    fn a_picture_not_kept_is_not_copied() {
        let (w, h) = (64usize, 64usize);
        let frames: Vec<Vec<u8>> = (0..3u8).map(|k| vec![40 + 60 * k; w * h * 3 / 2]).collect();
        let (coded, avcc, _) = apple::encode_h264(&frames, w, h, &[0, 1, 2], 30, None).unwrap();
        let config = (*b"avcC", avcc);
        let mut dec = apple::LiveDecoder::new(*b"avc1", &config, (64, 64), (w, h), false).unwrap();
        assert!(dec.decode(0, &coded[0].bytes, false).unwrap().is_empty());
        let kept = dec.decode(1, &coded[1].bytes, true).unwrap();
        let sizes: Vec<(usize, usize)> = kept.iter().map(|p| (p.sample, p.planes.len())).collect();
        assert_eq!(sizes, [(1, w * h * 3 / 2)]);
    }
}
