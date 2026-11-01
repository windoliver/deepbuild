//! The ISO base media file format (MP4, QuickTime) as the decode worker reads it: each track's
//! sample table, its edit list, its sample entry with the codec's configuration and color box, and
//! the data references that would point outside the file. Presentation follows FFmpeg's reading of
//! an edit list, which FATE's reference outputs record: a sample is presented when its composition
//! time falls inside an edit, at that time less the edit's media time plus the edit's place on the
//! timeline, and kept in the stream's own ticks.

/// One box's type and body.
struct Atom<'a> {
    kind: [u8; 4],
    body: &'a [u8],
}

/// The boxes laid end to end in `data`; a box whose size runs past the end is cut at it.
fn atoms(data: &[u8]) -> Vec<Atom<'_>> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at + 8 <= data.len() {
        let size = be32(&data[at..]) as u64;
        let kind = [data[at + 4], data[at + 5], data[at + 6], data[at + 7]];
        let (head, size) = match size {
            1 if at + 16 <= data.len() => (16, be64(&data[at + 8..])),
            0 => (8, (data.len() - at) as u64),
            n => (8, n),
        };
        if size < head as u64 {
            break;
        }
        let end = (at as u64 + size).min(data.len() as u64) as usize;
        out.push(Atom {
            kind,
            body: &data[at + head..end],
        });
        at = end;
    }
    out
}

fn child<'a>(data: &'a [u8], kind: &[u8; 4]) -> Option<&'a [u8]> {
    atoms(data)
        .into_iter()
        .find(|a| &a.kind == kind)
        .map(|a| a.body)
}

pub(crate) fn be16(b: &[u8]) -> u16 {
    u16::from_be_bytes([b[0], b[1]])
}

pub(crate) fn be32(b: &[u8]) -> u32 {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]])
}

fn be64(b: &[u8]) -> u64 {
    u64::from_be_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

/// A reader that answers `None` past the end instead of panicking.
struct Bytes<'a>(&'a [u8], usize);

impl<'a> Bytes<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.0.get(self.1..self.1 + n)?;
        self.1 += n;
        Some(s)
    }
    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }
    fn u16(&mut self) -> Option<u16> {
        Some(be16(self.take(2)?))
    }
    fn u32(&mut self) -> Option<u32> {
        Some(be32(self.take(4)?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(be64(self.take(8)?))
    }
    fn left(&self) -> usize {
        self.0.len().saturating_sub(self.1)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Video,
    Audio,
    Other,
}

/// One edit: `duration` in the movie's timescale, `media_time` in the track's (−1: empty).
#[derive(Clone, Copy, Debug)]
pub struct Edit {
    pub duration: u64,
    pub media_time: i64,
    pub rate: i32,
}

/// A `colr` box's code points: ISO/IEC 23091-2 values, and the range when it says.
#[derive(Clone, Copy, Debug, Default)]
pub struct Colr {
    pub primaries: u16,
    pub transfer: u16,
    pub matrix: u16,
    pub full_range: Option<bool>,
}

/// The first sample entry of a track.
#[derive(Clone, Debug, Default)]
pub struct Entry {
    pub fourcc: [u8; 4],
    pub width: u16,
    pub height: u16,
    pub channels: u16,
    pub sample_rate: u32,
    /// The codec's configuration box (`avcC`, `hvcC` or `esds`) and its body.
    pub config: Option<([u8; 4], Vec<u8>)>,
    pub colr: Option<Colr>,
}

#[derive(Clone, Copy, Debug)]
pub struct Sample {
    pub offset: u64,
    pub size: u32,
    pub dts: i64,
    pub cts: i64,
    pub key: bool,
}

pub struct Track {
    pub kind: Kind,
    pub timescale: u32,
    pub duration: u64,
    pub edits: Vec<Edit>,
    pub entry: Entry,
    /// In decode order.
    pub samples: Vec<Sample>,
}

pub struct Movie {
    pub timescale: u32,
    pub tracks: Vec<Track>,
    /// Every data reference that names a place outside the file.
    pub urls: Vec<String>,
}

/// The movie in `data`, or `None` when it has no `moov`.
pub fn parse(data: &[u8]) -> Option<Movie> {
    let moov = atoms(data).into_iter().find(|a| &a.kind == b"moov")?.body;
    let mut timescale = 0;
    if let Some(mvhd) = child(moov, b"mvhd") {
        let mut b = Bytes(mvhd, 0);
        let v = b.u8()?;
        b.take(3 + if v == 1 { 16 } else { 8 })?;
        timescale = b.u32()?;
    }
    let mut movie = Movie {
        timescale,
        tracks: Vec::new(),
        urls: Vec::new(),
    };
    for trak in atoms(moov).into_iter().filter(|a| &a.kind == b"trak") {
        if let Some(t) = track(trak.body, &mut movie.urls) {
            movie.tracks.push(t);
        }
    }
    Some(movie)
}

fn track(trak: &[u8], urls: &mut Vec<String>) -> Option<Track> {
    let mdia = child(trak, b"mdia")?;
    let mut b = Bytes(child(mdia, b"mdhd")?, 0);
    let v = b.u8()?;
    b.take(3 + if v == 1 { 16 } else { 8 })?;
    let timescale = b.u32()?;
    let duration = if v == 1 { b.u64()? } else { b.u32()? as u64 };
    let hdlr = child(mdia, b"hdlr")?;
    let kind = match hdlr.get(8..12) {
        Some(b"vide") => Kind::Video,
        Some(b"soun") => Kind::Audio,
        _ => Kind::Other,
    };
    let edits = child(trak, b"edts")
        .and_then(|e| child(e, b"elst"))
        .map(elst)
        .unwrap_or_default();
    let minf = child(mdia, b"minf")?;
    if let Some(dref) = child(minf, b"dinf").and_then(|d| child(d, b"dref")) {
        urls.extend(external(dref));
    }
    let stbl = child(minf, b"stbl")?;
    let entry = child(stbl, b"stsd").and_then(stsd).unwrap_or_default();
    let samples = table(stbl).unwrap_or_default();
    Some(Track {
        kind,
        timescale,
        duration,
        edits,
        entry,
        samples,
    })
}

/// An edit list's entries, as many as the box holds whatever its count says (as FFmpeg reads
/// `invalid_elst_entry_count.mov`).
fn elst(body: &[u8]) -> Vec<Edit> {
    let mut b = Bytes(body, 0);
    let Some((v, count)) = (|| Some((b.u8()?, (b.take(3)?, b.u32()?).1)))() else {
        return Vec::new();
    };
    let width = if v == 1 { 20 } else { 12 };
    let count = (count as usize).min(b.left() / width);
    (0..count)
        .filter_map(|_| {
            let (duration, media_time) = if v == 1 {
                (b.u64()?, b.u64()? as i64)
            } else {
                (b.u32()? as u64, b.u32()? as i32 as i64)
            };
            let rate = b.u32()? as i32;
            Some(Edit {
                duration,
                media_time,
                rate,
            })
        })
        .collect()
}

/// The `url ` entries of a `dref` that aren't self-contained, by the place each names.
fn external(dref: &[u8]) -> Vec<String> {
    let body = dref.get(8..).unwrap_or_default();
    atoms(body)
        .into_iter()
        .filter(|a| &a.kind == b"url " || &a.kind == b"urn ")
        .filter(|a| a.body.len() >= 4 && a.body[3] & 1 == 0)
        .map(|a| {
            let text = &a.body[4..];
            let end = text.iter().position(|c| *c == 0).unwrap_or(text.len());
            String::from_utf8_lossy(&text[..end]).into_owned()
        })
        .collect()
}

fn stsd(body: &[u8]) -> Option<Entry> {
    let e = atoms(body.get(8..)?).into_iter().next()?;
    let mut entry = Entry {
        fourcc: e.kind,
        ..Entry::default()
    };
    let rest = match &e.kind {
        b"avc1" | b"avc3" | b"hvc1" | b"hev1" | b"mp4v" | b"jpeg" | b"apcn" => {
            let mut b = Bytes(e.body, 24);
            entry.width = b.u16()?;
            entry.height = b.u16()?;
            e.body.get(78..)?
        }
        b"mp4a" | b"lpcm" | b"sowt" | b"twos" | b"alac" => {
            let mut b = Bytes(e.body, 8);
            let version = b.u16()?;
            b.take(6)?;
            entry.channels = b.u16()?;
            b.take(6)?;
            entry.sample_rate = b.u32()? >> 16;
            match version {
                1 => e.body.get(44..)?,
                2 => {
                    let mut v2 = Bytes(e.body, 32);
                    entry.sample_rate = f64::from_bits(v2.u64()?) as u32;
                    entry.channels = v2.u32()? as u16;
                    e.body.get(64..)?
                }
                _ => e.body.get(28..)?,
            }
        }
        _ => return Some(entry),
    };
    for a in atoms(rest) {
        match &a.kind {
            b"avcC" | b"hvcC" | b"esds" => entry.config = Some((a.kind, a.body.to_vec())),
            b"wave" => {
                if let Some(esds) = child(a.body, b"esds") {
                    entry.config = Some((*b"esds", esds.to_vec()));
                }
            }
            b"colr" if a.body.len() >= 10 => {
                let kind = &a.body[..4];
                if kind == b"nclx" || kind == b"nclc" {
                    entry.colr = Some(Colr {
                        primaries: be16(&a.body[4..]),
                        transfer: be16(&a.body[6..]),
                        matrix: be16(&a.body[8..]),
                        full_range: (kind == b"nclx")
                            .then(|| a.body.get(10).map(|f| f & 0x80 != 0))
                            .flatten(),
                    });
                }
            }
            _ => {}
        }
    }
    Some(entry)
}

/// The sample table, in decode order: offsets, sizes, decode and composition times, sync samples.
fn table(stbl: &[u8]) -> Option<Vec<Sample>> {
    let full = |k: &[u8; 4]| child(stbl, k).map(|b| Bytes(b, 4));
    let mut stsz = full(b"stsz")?;
    let fixed = stsz.u32()?;
    let count = stsz.u32()? as usize;
    let count = if fixed == 0 {
        count.min(stsz.left() / 4)
    } else {
        count
    };
    let sizes: Vec<u32> = (0..count)
        .map(|_| if fixed == 0 { stsz.u32() } else { Some(fixed) })
        .collect::<Option<_>>()?;
    let mut offsets = Vec::new();
    if let Some(mut b) = full(b"stco") {
        let n = b.u32()?;
        for _ in 0..n {
            offsets.push(b.u32()? as u64);
        }
    } else if let Some(mut b) = full(b"co64") {
        let n = b.u32()?;
        for _ in 0..n {
            offsets.push(b.u64()?);
        }
    }
    let mut stsc = full(b"stsc")?;
    let n = stsc.u32()?;
    let runs: Vec<(u32, u32)> = (0..n)
        .map(|_| {
            let first = stsc.u32()?;
            let per = stsc.u32()?;
            stsc.u32()?;
            Some((first, per))
        })
        .collect::<Option<_>>()?;
    let mut samples = Vec::with_capacity(count);
    let mut s = 0usize;
    for (chunk, offset) in offsets.iter().enumerate() {
        let chunk = chunk as u32 + 1;
        let per = runs
            .iter()
            .rev()
            .find(|(first, _)| *first <= chunk)
            .map_or(0, |r| r.1);
        let mut at = *offset;
        for _ in 0..per {
            let Some(size) = sizes.get(s) else { break };
            samples.push(Sample {
                offset: at,
                size: *size,
                dts: 0,
                cts: 0,
                key: true,
            });
            at += *size as u64;
            s += 1;
        }
    }
    let mut stts = full(b"stts")?;
    let n = stts.u32()?;
    let (mut t, mut i) = (0i64, 0usize);
    for _ in 0..n {
        let run = stts.u32()?;
        let delta = stts.u32()? as i64;
        for _ in 0..run {
            if let Some(s) = samples.get_mut(i) {
                s.dts = t;
            }
            t += delta;
            i += 1;
        }
    }
    let mut offsets_c = vec![0i64; samples.len()];
    if let Some(mut b) = child(stbl, b"ctts").map(|b| Bytes(b, 4)) {
        let n = b.u32()?;
        let mut i = 0usize;
        for _ in 0..n {
            let run = b.u32()?;
            // Read signed, as FFmpeg does for version 0 too.
            let off = b.u32()? as i32 as i64;
            for _ in 0..run {
                if let Some(o) = offsets_c.get_mut(i) {
                    *o = off;
                }
                i += 1;
            }
        }
    }
    for (s, off) in samples.iter_mut().zip(offsets_c) {
        s.cts = s.dts + off;
    }
    if let Some(mut b) = full(b"stss") {
        let n = b.u32()?;
        samples.iter_mut().for_each(|s| s.key = false);
        for _ in 0..n {
            if let Some(s) = samples.get_mut(b.u32()? as usize - 1) {
                s.key = true;
            }
        }
    }
    Some(samples)
}

impl Track {
    /// Each presented sample's index and its presentation time in the track's ticks, in
    /// presentation order. Without an edit list a sample is presented at its composition time;
    /// with one, at its composition time less its edit's media time plus where the edit starts.
    pub fn presented(&self, movie_timescale: u32, edits: bool) -> Vec<(usize, i64)> {
        let mut out: Vec<(usize, i64)> = Vec::new();
        if !edits || self.edits.is_empty() {
            out = (self.samples.iter().enumerate())
                .map(|(i, s)| (i, s.cts))
                .collect();
        } else {
            let mut at = 0i64;
            for e in &self.edits {
                let span = scale(e.duration, movie_timescale, self.timescale);
                if e.media_time < 0 {
                    at += span;
                    continue;
                }
                let end = if e.duration == 0 {
                    i64::MAX
                } else {
                    e.media_time + span
                };
                for (i, s) in self.samples.iter().enumerate() {
                    if s.cts >= e.media_time && s.cts < end {
                        out.push((i, s.cts - e.media_time + at));
                    }
                }
                at += span;
            }
        }
        out.sort_by_key(|(i, t)| (*t, *i));
        out
    }

    /// Where the first non-empty edit begins in media time, and where it starts on the timeline,
    /// both in the track's ticks: what an audio decoder trims its first samples by.
    pub fn first_edit(&self, movie_timescale: u32) -> (i64, i64) {
        let mut at = 0i64;
        for e in &self.edits {
            if e.media_time < 0 {
                at += scale(e.duration, movie_timescale, self.timescale);
                continue;
            }
            return (e.media_time, at);
        }
        (self.samples.first().map_or(0, |s| s.cts), 0)
    }

    /// The presented span in the track's ticks.
    pub fn span(&self, movie_timescale: u32) -> i64 {
        let edited: i64 = self
            .edits
            .iter()
            .map(|e| scale(e.duration, movie_timescale, self.timescale))
            .sum();
        if self.edits.is_empty() || edited == 0 {
            self.duration as i64
        } else {
            edited
        }
    }
}

/// `v` ticks of `from` in ticks of `to`, rounded down.
fn scale(v: u64, from: u32, to: u32) -> i64 {
    if from == 0 {
        return 0;
    }
    (v as u128 * to as u128 / from as u128) as i64
}

/// The DecoderSpecificInfo inside an `esds` body (an AudioSpecificConfig for AAC).
pub fn decoder_info(esds: &[u8]) -> Option<&[u8]> {
    let mut b = Bytes(esds, 4);
    let len = |b: &mut Bytes| -> Option<usize> {
        let mut n = 0usize;
        for _ in 0..4 {
            let c = b.u8()?;
            n = n << 7 | (c & 0x7f) as usize;
            if c & 0x80 == 0 {
                break;
            }
        }
        Some(n)
    };
    if b.u8()? != 3 {
        return None;
    }
    len(&mut b)?;
    b.take(2)?;
    let flags = b.u8()?;
    if flags & 0x80 != 0 {
        b.take(2)?;
    }
    if flags & 0x40 != 0 {
        let n = b.u8()? as usize;
        b.take(n)?;
    }
    if flags & 0x20 != 0 {
        b.take(2)?;
    }
    if b.u8()? != 4 {
        return None;
    }
    len(&mut b)?;
    b.take(13)?;
    if b.u8()? != 5 {
        return None;
    }
    let n = len(&mut b)?;
    b.take(n)
}
