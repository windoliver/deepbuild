//! #503: Matroska and WebM as the decode worker reads them: the first audio track, its blocks'
//! frames in order, and the trims FFmpeg makes (matroskadec.c): Opus skips its OpusHead's
//! pre-skip, and a block's DiscardPadding drops that many nanoseconds from its end.

use crate::audio::{Codec, End, Pcm, Track};

const SEGMENT: u32 = 0x1853_8067;
const INFO: u32 = 0x1549_a966;
const TRACKS: u32 = 0x1654_ae6b;
const TRACK_ENTRY: u32 = 0xae;
const AUDIO: u32 = 0xe1;
const CLUSTER: u32 = 0x1f43_b675;
const BLOCK_GROUP: u32 = 0xa0;

/// An element's ID (its marker kept) and size at `at`, and where its body starts. An unknown
/// size reads as running to the end.
fn element(b: &[u8], at: usize) -> Option<(u32, u64, usize)> {
    let vint = |at: usize, keep: bool| -> Option<(u64, usize)> {
        let first = *b.get(at)?;
        let len = first.leading_zeros() as usize + 1;
        if len > 8 {
            return None;
        }
        let mut v = u64::from(first) & if keep { 0xff } else { 0xff >> len };
        for i in 1..len {
            v = v << 8 | u64::from(*b.get(at + i)?);
        }
        let unknown = !keep && v == (1u64 << (7 * len)) - 1;
        Some((if unknown { u64::MAX } else { v }, len))
    };
    let (id, n) = vint(at, true)?;
    let (size, m) = vint(at + n, false)?;
    Some((id as u32, size, at + n + m))
}

fn uint(b: &[u8]) -> u64 {
    b.iter().take(8).fold(0, |v, x| v << 8 | u64::from(*x))
}

fn float(b: &[u8]) -> f64 {
    match b.len() {
        4 => f64::from(f32::from_bits(uint(b) as u32)),
        8 => f64::from_bits(uint(b)),
        _ => 0.0,
    }
}

#[derive(Default)]
struct Entry {
    number: u64,
    kind: u64,
    codec: String,
    private: Vec<u8>,
    rate: f64,
    channels: u64,
    bits: u64,
}

#[derive(Default)]
struct State {
    tracks: Vec<Entry>,
    duration: f64,
    scale: u64,
    /// Each block's track, frames and DiscardPadding in nanoseconds.
    blocks: Vec<(u64, Vec<Vec<u8>>, i64)>,
    discard: Option<i64>,
}

/// A signed integer element's value.
fn sint(b: &[u8]) -> i64 {
    let shift = 64 - 8 * b.len().clamp(1, 8) as u32;
    ((uint(b) << shift) as i64) >> shift
}

fn walk(b: &[u8], s: &mut State, depth: u32) {
    let mut at = 0;
    while let Some((id, size, body)) = element(b, at) {
        let end = body
            .saturating_add(usize::try_from(size).unwrap_or(usize::MAX))
            .min(b.len());
        let v = b.get(body..end).unwrap_or_default();
        let master = depth < 6;
        match id {
            SEGMENT | INFO | TRACKS | CLUSTER | AUDIO if master => walk(v, s, depth + 1),
            TRACK_ENTRY if master => {
                s.tracks.push(Entry::default());
                walk(v, s, depth + 1);
            }
            BLOCK_GROUP if master => {
                let from = s.blocks.len();
                walk(v, s, depth + 1);
                if let (Some(pad), Some(block)) = (s.discard.take(), s.blocks.get_mut(from)) {
                    block.2 = pad;
                }
            }
            0xa3 | 0xa1 => s.blocks.extend(block(v)),
            0x75a2 => s.discard = Some(sint(v)),
            0x2a_d7b1 => s.scale = uint(v),
            0x4489 => s.duration = float(v),
            _ => {
                if let Some(e) = s.tracks.last_mut() {
                    match id {
                        0xd7 => e.number = uint(v),
                        0x83 => e.kind = uint(v),
                        0x86 => e.codec = String::from_utf8_lossy(v).into(),
                        0x63a2 => e.private = v.to_vec(),
                        0xb5 => e.rate = float(v),
                        0x9f => e.channels = uint(v),
                        0x6264 => e.bits = uint(v),
                        _ => {}
                    }
                }
            }
        }
        if end <= at {
            break;
        }
        at = end;
    }
}

/// A block's track number and its frames, unlaced.
fn block(b: &[u8]) -> Option<(u64, Vec<Vec<u8>>, i64)> {
    let len = b.first()?.leading_zeros() as usize + 1;
    let track = uint(b.get(..len)?) & ((1u64 << (7 * len)) - 1);
    let flags = *b.get(len + 2)?;
    let mut at = len + 3;
    let data = |at: usize| b.get(at..).unwrap_or_default();
    if flags & 6 == 0 {
        return Some((track, vec![data(at).to_vec()], 0));
    }
    let count = usize::from(*b.get(at)?) + 1;
    at += 1;
    let mut sizes = Vec::with_capacity(count);
    match flags & 6 {
        2 => {
            for _ in 1..count {
                let mut n = 0usize;
                while let Some(x) = b.get(at) {
                    at += 1;
                    n += usize::from(*x);
                    if *x < 255 {
                        break;
                    }
                }
                sizes.push(n);
            }
        }
        6 => {
            let mut last = 0i64;
            for k in 1..count {
                let l = b.get(at)?.leading_zeros() as usize + 1;
                let raw = uint(b.get(at..at + l)?) & ((1u64 << (7 * l)) - 1);
                at += l;
                last = if k == 1 {
                    raw as i64
                } else {
                    last + raw as i64 - ((1i64 << (7 * l - 1)) - 1)
                };
                sizes.push(usize::try_from(last).ok()?);
            }
        }
        _ => sizes = vec![data(at).len() / count; count - 1],
    }
    let used: usize = sizes.iter().sum();
    sizes.push(data(at).len().checked_sub(used)?);
    let mut frames = Vec::with_capacity(count);
    for n in sizes {
        frames.push(b.get(at..at + n)?.to_vec());
        at += n;
    }
    Some((track, frames, 0))
}

/// The first audio track of a Matroska or WebM file.
pub fn read(data: &[u8]) -> Option<Track> {
    let mut s = State {
        scale: 1_000_000,
        ..State::default()
    };
    walk(data, &mut s, 0);
    let e = s.tracks.iter().find(|e| e.kind == 2)?;
    let rate = e.rate as u32;
    let codec = match e.codec.as_str() {
        "A_OPUS" => Codec::Opus,
        "A_VORBIS" => Codec::Vorbis,
        "A_FLAC" => Codec::Flac,
        "A_ALAC" => Codec::Alac,
        "A_MPEG/L3" => Codec::Mp3,
        c if c.starts_with("A_AAC") => Codec::Aac,
        "A_PCM/INT/LIT" => Codec::Pcm(Pcm {
            unsigned: e.bits == 8,
            ..Pcm::int(e.bits as u16, false)
        }),
        "A_PCM/INT/BIG" => Codec::Pcm(Pcm::int(e.bits as u16, true)),
        "A_PCM/FLOAT/IEEE" => Codec::Pcm(Pcm {
            float: true,
            ..Pcm::int(e.bits as u16, false)
        }),
        other => {
            let name = match other {
                "A_MPEG/L2" => "mp2",
                "A_MPEG/L1" => "mp1",
                "A_AC3" => "ac3",
                "A_EAC3" => "eac3",
                "A_DTS" => "dts",
                "A_TRUEHD" => "truehd",
                "A_TTA1" => "tta",
                "A_WAVPACK4" => "wavpack",
                c => {
                    return Some(Track::unsupported(
                        &c.trim_start_matches("A_").to_lowercase(),
                    ))
                }
            };
            return Some(Track::unsupported(name));
        }
    };
    let config = match codec {
        // FLAC's private data is its stream marker and metadata blocks: STREAMINFO's body.
        Codec::Flac => e.private.get(8..42)?.to_vec(),
        _ => e.private.clone(),
    };
    let (rate, channels) = match codec {
        Codec::Opus => (48_000, u32::from(*config.get(9)?)),
        _ => (rate, e.channels.max(1) as u32),
    };
    let mut t = Track::new(codec, rate, channels, config);
    let mut padding = 0i64;
    for (_, frames, pad) in s.blocks.into_iter().filter(|b| b.0 == e.number) {
        t.packets.extend(frames);
        padding = pad;
    }
    if codec == Codec::Opus {
        t.skip = t
            .config
            .get(10..12)
            .map_or(0, |p| u64::from(u16::from_le_bytes([p[0], p[1]])));
    }
    // The last block's DiscardPadding, in samples at the codec's rate, rounded as FFmpeg rounds.
    if padding > 0 {
        t.end = End::Drop(
            ((i128::from(padding) * i128::from(rate) + 500_000_000) / 1_000_000_000) as u64,
        );
    }
    if s.duration > 0.0 {
        let seconds = s.duration * s.scale as f64 / 1e9;
        t.frames = Some((seconds * f64::from(rate)).round() as u64);
    }
    Some(t)
}
