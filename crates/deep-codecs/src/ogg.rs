//! #503: Ogg as the decode worker reads it: the first logical stream that holds sound, its packets
//! and the granule positions that bound it, with the codec named by its first packet. Vorbis and
//! Opus are trimmed as FFmpeg trims them: the stream's first time is the granule of the page its
//! first sound packet ends on less the durations of the packets that end there; Opus skips its
//! pre-skip, and a stream whose last page is marked last ends at that page's granule.

use crate::audio::{Codec, End, Track};

/// One page: its flags, its granule, its stream and its packets' pieces.
struct Page<'a> {
    last: bool,
    granule: i64,
    serial: u32,
    lacing: &'a [u8],
    body: &'a [u8],
}

fn pages(data: &[u8]) -> Vec<Page<'_>> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(head) = data.get(at..at + 27).filter(|h| h.starts_with(b"OggS")) {
        let n = head[26] as usize;
        let Some(lacing) = data.get(at + 27..at + 27 + n) else {
            break;
        };
        let size: usize = lacing.iter().map(|l| *l as usize).sum();
        let start = at + 27 + n;
        // A page the file cuts short is no page, as FFmpeg reads it.
        let Some(body) = data.get(start..start + size) else {
            break;
        };
        out.push(Page {
            last: head[5] & 4 != 0,
            granule: i64::from_le_bytes(head[6..14].try_into().unwrap_or_default()),
            serial: u32::from_le_bytes(head[14..18].try_into().unwrap_or_default()),
            lacing,
            body,
        });
        at = start + size;
    }
    out
}

/// A logical stream's packets, each with the index of the page it ends on.
fn packets(pages: &[Page], serial: u32) -> Vec<(Vec<u8>, usize)> {
    let mut out = Vec::new();
    let mut part = Vec::new();
    for (k, p) in pages.iter().enumerate().filter(|(_, p)| p.serial == serial) {
        let mut at = 0;
        for l in p.lacing {
            let end = (at + *l as usize).min(p.body.len());
            part.extend_from_slice(&p.body[at..end]);
            at = end;
            if *l < 255 {
                out.push((std::mem::take(&mut part), k));
            }
        }
    }
    out
}

/// The first logical stream whose first packet names a codec, as a track: its header packets
/// make its configuration, and the rest are its sound. A chained file's later links, each a
/// stream in the same codec that starts after the one before it ends, follow it as FFmpeg reads
/// them, as one stream.
pub fn read(data: &[u8]) -> Option<Track> {
    let pages = pages(data);
    // Each stream's serial and the pages it starts and ends on, in the order they start.
    let mut spans: Vec<(u32, usize, usize)> = Vec::new();
    for (k, p) in pages.iter().enumerate() {
        match spans.iter_mut().find(|s| s.0 == p.serial) {
            Some(s) => s.2 = k,
            None => spans.push((p.serial, k, k)),
        }
    }
    let (at, mut first) =
        (spans.iter().enumerate()).find_map(|(i, s)| Some((i, stream(&pages, s.0)?)))?;
    let mut links = Vec::new();
    let mut end = spans[at].2;
    for s in spans.iter().skip(at + 1) {
        match stream(&pages, s.0) {
            Some(t) if s.1 > end && t.codec == first.codec => links.push(t),
            _ => break,
        }
        end = s.2;
    }
    let sum = |f: u64| links.iter().try_fold(f, |n, t| Some(n + t.frames?));
    first.frames = first.frames.and_then(sum);
    first.next = links.into_iter().rev().fold(None, |next, mut t| {
        t.next = next;
        Some(Box::new(t))
    });
    Some(first)
}

fn stream(pages: &[Page], serial: u32) -> Option<Track> {
    let mut all = packets(pages, serial);
    let first = &all.first()?.0;
    let le16 = |b: &[u8], at: usize| u16::from_le_bytes([b[at], b[at + 1]]);
    let le32 =
        |b: &[u8], at: usize| u32::from_le_bytes(b[at..at + 4].try_into().unwrap_or_default());
    let (codec, rate, channels, headers, config, pre_skip) =
        if first.starts_with(b"\x01vorbis") && first.len() >= 30 {
            let setup = all.get(2)?.0.clone();
            let config = [first.clone(), setup].concat();
            let (rate, channels) = (le32(first, 12), u32::from(first[11]));
            (Codec::Vorbis, rate, channels, 3, config, 0)
        } else if first.starts_with(b"OpusHead") && first.len() >= 19 {
            (
                Codec::Opus,
                48_000,
                u32::from(first[9]),
                2,
                first.clone(),
                u64::from(le16(first, 10)),
            )
        } else if first.starts_with(b"\x7fFLAC") && first.len() >= 51 {
            // The mapping header, then STREAMINFO's 34 bytes after its block header.
            let info = first[17..51].to_vec();
            let rate =
                (u32::from(info[10]) << 12) | (u32::from(info[11]) << 4) | u32::from(info[12] >> 4);
            let channels = u32::from((info[12] >> 1) & 7) + 1;
            let headers = u16::from_be_bytes([first[7], first[8]]);
            (Codec::Flac, rate, channels, 1 + headers as usize, info, 0)
        } else if first.starts_with(b"Speex   ") {
            return Some(Track::unsupported("speex"));
        } else {
            return None;
        };
    let sound: Vec<(Vec<u8>, usize)> = all.drain(headers.min(all.len())..).collect();
    let mut t = Track::new(codec, rate, channels, config);
    t.skip = pre_skip;
    // The stream's first time and its last granule, by FFmpeg's reading (oggparsevorbis.c,
    // oggparseopus.c): durations are what each packet decodes to, a stream not marked ended
    // isn't cut, and the probe's duration is the last granule less the pre-skip. A stream whose
    // first sound page is its last starts at the granule of the page before it.
    let last = pages.iter().rposition(|p| p.serial == serial)?;
    let end = &pages[last];
    if end.granule >= 0 {
        t.frames = Some((end.granule as u64).saturating_sub(pre_skip));
    }
    if matches!(codec, Codec::Vorbis | Codec::Opus) && end.granule >= 0 && end.last {
        if let Some(k) = sound.first().map(|p| p.1) {
            let before = pages[..k].iter().rfind(|p| p.serial == serial);
            let (first, on_first) = match k == last {
                true => (before.map_or(0, |p| p.granule), 0),
                false => (pages[k].granule, sound.iter().filter(|p| p.1 == k).count()),
            };
            t.end = End::Granule {
                first,
                on_first,
                last: end.granule,
            };
        }
    }
    t.packets = sound.into_iter().map(|p| p.0).collect();
    Some(t)
}
