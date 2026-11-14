//! #503: AIFF, AIFF-C and CAF, read by their chunks, and ASF read only far enough to name its
//! first audio codec. Sound in these is PCM, or ALAC or AAC in CAF; every other codec is named.

use crate::audio::{Codec, End, Pcm, Track};

fn be16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn be64(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

/// The four-character code as ffprobe would name a codec it has no other name for.
fn fourcc_name(c: &[u8]) -> String {
    String::from_utf8_lossy(c).trim().to_lowercase()
}

/// An AIFF or AIFF-C file: COMM's layout and frame count, SSND's samples.
pub fn aiff(data: &[u8]) -> Option<Track> {
    let aifc = data.get(8..12)? == b"AIFC";
    let (mut comm, mut ssnd) = (None, None);
    let mut at = 12;
    while let (Some(id), Some(size)) = (data.get(at..at + 4), be32(data, at + 4)) {
        let body = data.get(at + 8..(at + 8 + size as usize).min(data.len()))?;
        match id {
            b"COMM" => comm = Some(body),
            b"SSND" => ssnd = Some(body.get(8 + be32(body, 0)? as usize..)?),
            _ => {}
        }
        at += 8 + size as usize + size as usize % 2;
    }
    let comm = comm?;
    let (channels, frames, bits) = (be16(comm, 0)?, be32(comm, 2)?, be16(comm, 6)?);
    // An 80-bit extended float: the rate's whole part.
    let (exp, mant) = (i32::from(be16(comm, 8)? & 0x7fff), be64(comm, 10)?);
    let rate = mant
        .checked_shr((16383 + 63 - exp).clamp(0, 64) as u32)
        .unwrap_or(0) as u32;
    let bytes = bits.div_ceil(8);
    let pcm = |big: bool| Pcm::int(bytes * 8, big);
    let codec = match if aifc { comm.get(18..22)? } else { b"NONE" } {
        b"NONE" | b"twos" => Codec::Pcm(pcm(true)),
        b"sowt" if bytes > 1 => Codec::Pcm(pcm(false)),
        b"fl32" | b"FL32" => Codec::Pcm(Pcm {
            float: true,
            ..Pcm::int(32, true)
        }),
        b"fl64" | b"FL64" => Codec::Pcm(Pcm {
            float: true,
            ..Pcm::int(64, true)
        }),
        b"raw " => Codec::Pcm(Pcm {
            unsigned: true,
            ..Pcm::int(8, false)
        }),
        b"alaw" | b"ALAW" => return Some(Track::unsupported("pcm_alaw")),
        b"ulaw" | b"ULAW" => return Some(Track::unsupported("pcm_mulaw")),
        b"ima4" => return Some(Track::unsupported("adpcm_ima_qt")),
        b"MAC3" | b"MAC6" => return Some(Track::unsupported(&fourcc_name(&comm[18..22]))),
        b"GSM " => return Some(Track::unsupported("gsm")),
        b"QDM2" => return Some(Track::unsupported("qdm2")),
        other => return Some(Track::unsupported(&fourcc_name(other))),
    };
    let Codec::Pcm(p) = codec else { return None };
    let width = usize::from(p.bits / 8) * usize::from(channels);
    let ssnd = ssnd.unwrap_or_default();
    let mut t = Track::new(codec, rate, u32::from(channels), Vec::new());
    t.packets =
        vec![ssnd[..(frames as usize * width).min(ssnd.len() / width.max(1) * width)].to_vec()];
    t.frames = Some((t.packets[0].len() / width.max(1)) as u64);
    Some(t)
}

/// A CAF file: `desc`, `kuki`, `pakt` and `data`. ALAC keeps the packet table's valid frames;
/// AAC is left untrimmed, as FFmpeg leaves it.
pub fn caf(data: &[u8]) -> Option<Track> {
    let (mut desc, mut kuki, mut pakt, mut body) = (None, Vec::new(), None, None);
    let mut at = 8;
    while let (Some(id), Some(size)) = (data.get(at..at + 4), be64(data, at + 4)) {
        let end = if size == u64::MAX {
            data.len()
        } else {
            (at + 12).saturating_add(size as usize).min(data.len())
        };
        let chunk = data.get(at + 12..end)?;
        match id {
            b"desc" => desc = Some(chunk),
            b"kuki" => kuki = chunk.to_vec(),
            b"pakt" => pakt = Some(chunk),
            b"data" => body = chunk.get(4..),
            _ => {}
        }
        at = end;
    }
    let d = desc?;
    let rate = f64::from_bits(be64(d, 0)?) as u32;
    let (format, flags) = (d.get(8..12)?, be32(d, 12)?);
    let (per_bytes, per_frames, channels, bits) =
        (be32(d, 16)?, be32(d, 20)?, be32(d, 24)?, be32(d, 28)?);
    let codec = match format {
        b"lpcm" => Codec::Pcm(Pcm {
            float: flags & 1 != 0,
            ..Pcm::int(bits as u16, flags & 2 == 0)
        }),
        b"alac" => Codec::Alac,
        b"aac " => Codec::Aac,
        b".mp3" => Codec::Mp3,
        b".mp2" => return Some(Track::unsupported("mp2")),
        b".mp1" => return Some(Track::unsupported("mp1")),
        b"alaw" => return Some(Track::unsupported("pcm_alaw")),
        b"ulaw" => return Some(Track::unsupported("pcm_mulaw")),
        b"ima4" => return Some(Track::unsupported("adpcm_ima_qt")),
        b"ac-3" => return Some(Track::unsupported("ac3")),
        b"samr" => return Some(Track::unsupported("amr_nb")),
        b"opus" => return Some(Track::unsupported("opus")),
        other => return Some(Track::unsupported(&fourcc_name(other))),
    };
    let body = body?;
    let config = match codec {
        Codec::Aac => crate::audio::esds(kuki.get(4..).unwrap_or(&kuki)).map(|e| e.1.to_vec())?,
        _ => kuki,
    };
    let mut t = Track::new(codec, rate, channels, config);
    if let Codec::Pcm(p) = codec {
        let width = usize::from(p.bits / 8) * channels as usize;
        t.packets = vec![body[..body.len() / width.max(1) * width].to_vec()];
        t.frames = Some((body.len() / width.max(1)) as u64);
        return Some(t);
    }
    // Packets: fixed size and length, or each size (and length) a varint in the packet table.
    let pakt = pakt.unwrap_or_default();
    let mut b = pakt.get(24..).unwrap_or_default();
    let mut varint = || {
        let mut v = 0u64;
        while let Some((x, rest)) = b.split_first() {
            b = rest;
            v = v << 7 | u64::from(x & 0x7f);
            if x & 0x80 == 0 {
                return Some(v);
            }
        }
        None
    };
    let mut at = 0usize;
    for _ in 0..be64(pakt, 0).unwrap_or(0) {
        let size = if per_bytes > 0 {
            u64::from(per_bytes)
        } else {
            varint()?
        };
        if per_frames == 0 {
            varint()?;
        }
        t.packets
            .push(body.get(at..at.checked_add(size as usize)?)?.to_vec());
        at += size as usize;
    }
    if codec == Codec::Alac {
        t.frames = be64(pakt, 8);
        t.end = t.frames.map_or(End::All, End::Keep);
    }
    Some(t)
}

/// An ASF (WMA) file: its first audio stream's codec, named from its WAVEFORMATEX tag.
pub fn asf(data: &[u8]) -> Option<Track> {
    // The Stream Properties Object, then the audio media GUID, at its type-specific data.
    const PROPS: [u8; 4] = [0x91, 0x07, 0xdc, 0xb7];
    const AUDIO: [u8; 4] = [0x40, 0x9e, 0x69, 0xf8];
    let at = data
        .windows(4)
        .enumerate()
        .find(|(i, w)| *w == PROPS && data.get(i + 24..i + 28) == Some(&AUDIO))?
        .0;
    let tag = u16::from_le_bytes(data.get(at + 78..at + 80)?.try_into().ok()?);
    Some(Track::unsupported(crate::wav::tag_name(tag).as_str()))
}
