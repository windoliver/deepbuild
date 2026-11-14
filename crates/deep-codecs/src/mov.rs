//! Issue #501: an export's file, written header first: `ftyp`, `moov`, then `mdat`, as an MP4 or a
//! QuickTime movie. One video track of coded samples at a constant frame duration, an optional
//! sound track (float PCM or AAC) whose timescale is its sample rate, and an optional timecode
//! track the video track refers to. Each track's samples lie in one chunk; nothing is encoded
//! here.
//!
//! #157: `head` lays out everything before the samples, so a join streams them after it, and
//! `moov` a part's tail, written after its samples. With sound, the movie's timescale is the
//! sample rate, so the sound's edit presents exactly the PCM's samples; the video is one `stts`
//! run with no composition offsets and no edit list, so frame k is at exactly k × the frame length.

use crate::mp4::Colr;
use crate::{full_box, mp4_box, Planted};

/// The video track: coded samples in decode order, each `ticks` of `timescale` long. `config` is
/// the body of the codec's configuration box (`avcC`, `hvcC`), `keys` each sample's sync flag
/// (`None`: every sample is one).
pub struct Video<'a> {
    pub fourcc: [u8; 4],
    pub config: Option<&'a [u8]>,
    pub size: [u32; 2],
    pub timescale: u32,
    pub ticks: u32,
    pub samples: Vec<&'a [u8]>,
    pub keys: Option<Vec<bool>>,
    /// A sample, by index, that lasts two frames: the planted writer's in place of the frame it
    /// drops (#1163).
    pub held: Option<u32>,
}

/// #157: the video track as the header lays it out: everything but its samples' bytes, and the
/// colour the encoder was told.
pub struct Layout<'a> {
    pub fourcc: [u8; 4],
    pub config: Option<&'a [u8]>,
    pub size: [u32; 2],
    pub timescale: u32,
    pub ticks: u32,
    pub sizes: Vec<u32>,
    pub keys: Option<Vec<bool>>,
    pub colr: Colr,
    /// The planted muxer's composition offset on every sample, in ticks, with no edit list.
    pub shift: u32,
    /// A sample, by index, that lasts two frames (#1163's planted writer).
    pub held: Option<u32>,
}

/// BT.709 primaries, transfer and matrix, limited range: every delivery's colour.
pub const BT709: Colr = Colr {
    kind: *b"nclx",
    primaries: 1,
    transfer: 1,
    matrix: 1,
    full_range: Some(false),
};

impl Video<'_> {
    fn layout(&self) -> Layout<'_> {
        Layout {
            fourcc: self.fourcc,
            config: self.config,
            size: self.size,
            timescale: self.timescale,
            ticks: self.ticks,
            sizes: self.samples.iter().map(|s| s.len() as u32).collect(),
            keys: self.keys.clone(),
            colr: BT709,
            shift: 0,
            held: self.held,
        }
    }
}

/// Interleaved 32-bit float samples, little-endian.
pub struct Pcm<'a> {
    pub rate: u32,
    pub channels: u16,
    pub f32le: &'a [u8],
}

/// AAC packets of 1024 frames each and the encoder's MPEG-4 ES descriptor. Its edit, when it has
/// one, skips its media time (the priming) and presents its duration (the PCM's length), both in
/// samples.
pub struct Aac<'a> {
    pub rate: u32,
    pub channels: u16,
    pub descriptor: &'a [u8],
    pub packets: Vec<&'a [u8]>,
    pub edit: Option<(u32, u64)>,
}

/// The sound track: float PCM as it is, or AAC.
pub enum Audio<'a> {
    Pcm(Pcm<'a>),
    Aac(Aac<'a>),
}

impl<'a> Audio<'a> {
    fn rate(&self) -> u32 {
        match self {
            Audio::Pcm(a) => a.rate,
            Audio::Aac(a) => a.rate,
        }
    }

    /// Its bytes as `mdat` holds them: whole PCM frames, or the packets in order.
    pub fn payload(&self) -> Vec<&'a [u8]> {
        match self {
            Audio::Pcm(a) => vec![&a.f32le[..a.f32le.len() / pcm_frame(a) * pcm_frame(a)]],
            Audio::Aac(a) => a.packets.clone(),
        }
    }
}

fn pcm_frame(a: &Pcm) -> usize {
    4 * a.channels.max(1) as usize
}

/// A timecode: the first frame's number, counted at `nominal` frames a second.
pub struct Tmcd {
    pub start: u32,
    pub nominal: u8,
    pub drop: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Brand {
    Mp4,
    Mov,
}

/// The timescale and the ticks per frame of a track at `p/q` frames a second: the rate's own
/// terms, a thousandfold when `p` is under 1000. Never flicks.
pub fn timescale(p: u32, q: u32) -> (u32, u32) {
    if p >= 1000 {
        (p, q)
    } else {
        (p * 1000, q * 1000)
    }
}

/// #157: `timescale`, or the planted muxers' 600 or 1000 with the nearest whole tick per frame.
pub(crate) fn planted_timescale(p: u32, q: u32, planted: &Planted) -> (u32, u32) {
    let fixed = [
        ("muxer_timescale_600", 600u64),
        ("muxer_timescale_1000", 1000),
    ];
    match fixed.iter().find(|(name, _)| planted.is(name)) {
        Some((_, t)) => (*t as u32, ((t * q as u64 + p as u64 / 2) / p as u64) as u32),
        None => timescale(p, q),
    }
}

fn be(v: u32) -> [u8; 4] {
    v.to_be_bytes()
}

fn be16(v: u16) -> [u8; 2] {
    v.to_be_bytes()
}

fn matrix() -> Vec<u8> {
    [0x10000u32, 0, 0, 0, 0x10000, 0, 0, 0, 0x4000_0000]
        .iter()
        .flat_map(|v| be(*v))
        .collect()
}

/// One track as its boxes need it.
struct Trak {
    handler: [u8; 4],
    timescale: u32,
    /// Sample count and each sample's duration in the track's ticks.
    count: u32,
    delta: u32,
    /// A sample, by index, that lasts two deltas.
    held: Option<u32>,
    size: [u32; 2],
    volume: u16,
    /// The media information header box.
    header: Vec<u8>,
    /// The sample entry box.
    entry: Vec<u8>,
    /// Every sample's size when they are equal, else 0 and `sizes` holds each.
    fixed: u32,
    sizes: Vec<u32>,
    keys: Option<Vec<u32>>,
    /// The timecode track this one refers to.
    tref: Option<u32>,
    /// One edit: its media time and the ticks it presents.
    edit: Option<(u32, u64)>,
    /// A composition offset on every sample (the planted muxer's).
    shift: u32,
    bytes: u64,
}

impl Trak {
    fn duration(&self) -> u64 {
        (self.count as u64 + u64::from(self.held.is_some())) * self.delta as u64
    }

    /// The presented ticks: the edit's, else the whole track's.
    fn shown(&self) -> u64 {
        self.edit.map_or(self.duration(), |e| e.1)
    }
}

/// A handler box: QuickTime's carries the component type and a counted name.
fn hdlr(brand: Brand, component: &[u8; 4], kind: &[u8; 4]) -> Vec<u8> {
    let (component, name): (&[u8], &[u8]) = match brand {
        Brand::Mov => (component, b"\x09DeepBuild"),
        Brand::Mp4 => (&[0; 4], b"DeepBuild\0"),
    };
    full_box(b"hdlr", 0, &[component, kind, &[0; 12], name].concat())
}

fn video_entry(brand: Brand, v: &Layout) -> Vec<u8> {
    let alpha = &v.fourcc == b"ap4h";
    let mut e = vec![0, 0, 0, 0, 0, 0, 0, 1];
    match brand {
        // Version, revision, vendor, temporal and spatial quality.
        Brand::Mov => e.extend([&[0; 4][..], b"appl", &be(0), &be(0x3ff)].concat()),
        Brand::Mp4 => e.extend([0; 16]),
    }
    e.extend(be16(v.size[0] as u16));
    e.extend(be16(v.size[1] as u16));
    // 72 dpi both ways, no data size, one frame a sample, no compressor name.
    e.extend([0, 0x48, 0, 0, 0, 0x48, 0, 0, 0, 0, 0, 0, 0, 1]);
    e.extend([0; 32]);
    e.extend(be16(if alpha { 32 } else { 24 }));
    e.extend([0xff, 0xff]);
    if let Some(config) = v.config {
        let kind = match &v.fourcc {
            b"hvc1" | b"hev1" => b"hvcC",
            _ => b"avcC",
        };
        e.extend(mp4_box(kind, config));
    }
    // #157: the colour the encoder was told, its range in MP4's `nclx`.
    let c = v.colr;
    let tags = [be16(c.primaries), be16(c.transfer), be16(c.matrix)].concat();
    let range = u8::from(c.full_range == Some(true)) << 7;
    match brand {
        Brand::Mov => e.extend(mp4_box(b"colr", &[b"nclc", &tags[..]].concat())),
        Brand::Mp4 => e.extend(mp4_box(b"colr", &[b"nclx", &tags[..], &[range]].concat())),
    }
    mp4_box(&v.fourcc, &e)
}

/// Float PCM: QuickTime's version 2 `lpcm` description, or ISO's `fpcm` with its `pcmC`.
fn audio_entry(brand: Brand, a: &Pcm) -> Vec<u8> {
    let mut e = vec![0, 0, 0, 0, 0, 0, 0, 1];
    let frame = 4 * a.channels as u32;
    match brand {
        Brand::Mov => {
            e.extend([0, 2, 0, 0, 0, 0, 0, 0]);
            e.extend([0, 3, 0, 16, 0xff, 0xfe, 0, 0, 0, 1, 0, 0]);
            e.extend(be(72));
            e.extend((a.rate as f64).to_be_bytes());
            e.extend(be(a.channels as u32));
            e.extend(be(0x7f00_0000));
            // 32 bits a channel; float and packed, little-endian.
            for v in [32, 1 | 8, frame, 1] {
                e.extend(be(v));
            }
            mp4_box(b"lpcm", &e)
        }
        Brand::Mp4 => {
            e.extend([0; 8]);
            e.extend(be16(a.channels));
            e.extend([0, 32, 0, 0, 0, 0]);
            // A rate over 16 bits is left to the track's timescale.
            e.extend(be(if a.rate < 1 << 16 { a.rate << 16 } else { 0 }));
            // Little-endian, 32 bits a sample.
            e.extend(full_box(b"pcmC", 0, &[1, 32]));
            mp4_box(b"fpcm", &e)
        }
    }
}

/// AAC: a version 0 `mp4a` description with the encoder's descriptor in its `esds`.
fn aac_entry(a: &Aac) -> Vec<u8> {
    let mut e = vec![0, 0, 0, 0, 0, 0, 0, 1];
    e.extend([0; 8]);
    e.extend(be16(a.channels));
    e.extend([0, 16, 0, 0, 0, 0]);
    e.extend(be(if a.rate < 1 << 16 { a.rate << 16 } else { 0 }));
    e.extend(full_box(b"esds", 0, a.descriptor));
    mp4_box(b"mp4a", &e)
}

fn timecode_entry(t: &Tmcd, v: &Layout) -> Vec<u8> {
    let mut e = vec![0, 0, 0, 0, 0, 0, 0, 1];
    for x in [0, u32::from(t.drop), v.timescale, v.ticks] {
        e.extend(be(x));
    }
    e.extend([t.nominal, 0]);
    mp4_box(b"tmcd", &e)
}

fn trak(brand: Brand, t: &Trak, id: u32, movie: u32, at: u64, wide: bool) -> Vec<u8> {
    let shown = (t.shown() * movie as u64 / t.timescale.max(1) as u64) as u32;
    let tkhd = full_box(
        b"tkhd",
        3,
        &[
            &be(0)[..],
            &be(0),
            &be(id),
            &be(0),
            &be(shown),
            &[0; 12],
            &be16(t.volume),
            &[0; 2],
            &matrix(),
            &be(t.size[0] << 16),
            &be(t.size[1] << 16),
        ]
        .concat(),
    );
    let tref = t
        .tref
        .map(|to| mp4_box(b"tref", &mp4_box(b"tmcd", &be(to))))
        .unwrap_or_default();
    let edts = t
        .edit
        .map(|(media, _)| {
            let elst = [be(1), be(shown), be(media), be(0x10000)].concat();
            mp4_box(b"edts", &full_box(b"elst", 0, &elst))
        })
        .unwrap_or_default();
    let mdhd = full_box(
        b"mdhd",
        0,
        &[
            &be(0)[..],
            &be(0),
            &be(t.timescale),
            &be(t.duration() as u32),
            &[0x55, 0xc4, 0, 0],
        ]
        .concat(),
    );
    let stsd = full_box(b"stsd", 0, &[&be(1)[..], &t.entry].concat());
    let runs: Vec<[u32; 2]> = match t.held.filter(|h| *h < t.count) {
        None => vec![[t.count, t.delta]],
        Some(h) => [[h, t.delta], [1, 2 * t.delta], [t.count - h - 1, t.delta]]
            .into_iter()
            .filter(|r| r[0] > 0)
            .collect(),
    };
    let entries: Vec<u8> = runs
        .iter()
        .flat_map(|[n, d]| [be(*n), be(*d)].concat())
        .collect();
    let stts = full_box(b"stts", 0, &[&be(runs.len() as u32)[..], &entries].concat());
    let ctts = match t.shift {
        0 => Vec::new(),
        s => full_box(b"ctts", 0, &[be(1), be(t.count), be(s)].concat()),
    };
    let stss = (t.keys.as_ref())
        .map(|keys| {
            let list: Vec<u8> = keys.iter().flat_map(|k| be(*k)).collect();
            full_box(b"stss", 0, &[&be(keys.len() as u32)[..], &list].concat())
        })
        .unwrap_or_default();
    let stsc = full_box(b"stsc", 0, &[be(1), be(1), be(t.count), be(1)].concat());
    let sizes: Vec<u8> = t.sizes.iter().flat_map(|s| be(*s)).collect();
    let stsz = full_box(
        b"stsz",
        0,
        &[&be(t.fixed)[..], &be(t.count), &sizes].concat(),
    );
    let stco = match wide {
        true => full_box(b"co64", 0, &[&be(1)[..], &at.to_be_bytes()].concat()),
        false => full_box(b"stco", 0, &[be(1), be(at as u32)].concat()),
    };
    let stbl = mp4_box(
        b"stbl",
        &[stsd, stts, ctts, stss, stsc, stsz, stco].concat(),
    );
    let dref = full_box(
        b"dref",
        0,
        &[&be(1)[..], &full_box(b"url ", 1, &[])].concat(),
    );
    let data = match brand {
        Brand::Mov => hdlr(brand, b"dhlr", b"alis"),
        Brand::Mp4 => Vec::new(),
    };
    let minf = mp4_box(
        b"minf",
        &[&t.header[..], &data, &mp4_box(b"dinf", &dref), &stbl].concat(),
    );
    let mdia = mp4_box(
        b"mdia",
        &[mdhd, hdlr(brand, b"mhlr", &t.handler), minf].concat(),
    );
    mp4_box(b"trak", &[tkhd, tref, edts, mdia].concat())
}

/// `ftyp` for `brand`.
pub fn ftyp(brand: Brand) -> Vec<u8> {
    let brands: &[u8] = match brand {
        Brand::Mov => b"qt  \0\0\x02\0qt  ",
        Brand::Mp4 => b"isom\0\0\x02\0isomiso2mp41",
    };
    mp4_box(b"ftyp", brands)
}

/// The tracks of a movie of `video`, `audio` and `timecode`, and the movie's timescale: the
/// sample rate when it has sound, so the sound's edit is exact in it, else the video's.
fn tracks(
    brand: Brand,
    video: &Layout,
    audio: Option<&Audio>,
    timecode: Option<&Tmcd>,
) -> (Vec<Trak>, u32) {
    let count = video.sizes.len() as u32;
    let mut tracks = vec![Trak {
        handler: *b"vide",
        timescale: video.timescale,
        count,
        delta: video.ticks,
        held: video.held,
        size: video.size,
        volume: 0,
        header: full_box(b"vmhd", 1, &[0; 8]),
        entry: video_entry(brand, video),
        fixed: 0,
        sizes: video.sizes.clone(),
        keys: video.keys.as_ref().map(|keys| {
            (1..=count)
                .filter(|k| keys.get(*k as usize - 1) == Some(&true))
                .collect()
        }),
        tref: timecode.map(|_| 2 + u32::from(audio.is_some())),
        edit: None,
        shift: video.shift,
        bytes: video.sizes.iter().map(|s| *s as u64).sum(),
    }];
    if let Some(audio) = audio {
        let bytes = audio.payload().iter().map(|s| s.len() as u64).sum();
        let sound_track = |timescale, count, delta, entry, fixed, sizes, edit| Trak {
            handler: *b"soun",
            timescale,
            count,
            delta,
            held: None,
            size: [0; 2],
            volume: 0x100,
            header: full_box(b"smhd", 0, &[0; 4]),
            entry,
            fixed,
            sizes,
            keys: None,
            tref: None,
            edit,
            shift: 0,
            bytes,
        };
        tracks.push(match audio {
            Audio::Pcm(a) => sound_track(
                a.rate,
                (bytes / pcm_frame(a) as u64) as u32,
                1,
                audio_entry(brand, a),
                pcm_frame(a) as u32,
                Vec::new(),
                None,
            ),
            // 1024 frames a packet.
            Audio::Aac(a) => sound_track(
                a.rate,
                a.packets.len() as u32,
                1024,
                aac_entry(a),
                0,
                a.packets.iter().map(|p| p.len() as u32).collect(),
                a.edit,
            ),
        });
    }
    if let Some(t) = timecode {
        // QuickTime's base header with its timecode information; ISO's null header.
        let gmin = full_box(
            b"gmin",
            0,
            &[0, 0x40, 0x80, 0, 0x80, 0, 0x80, 0, 0, 0, 0, 0],
        );
        let tcmi = full_box(
            b"tcmi",
            0,
            &[&[0, 0, 0, 0, 0, 12, 0, 0][..], &[0xff; 6], &[0; 7]].concat(),
        );
        tracks.push(Trak {
            handler: *b"tmcd",
            timescale: video.timescale,
            count: 1,
            delta: count * video.ticks,
            held: None,
            size: [0; 2],
            volume: 0,
            header: match brand {
                Brand::Mov => mp4_box(b"gmhd", &[gmin, mp4_box(b"tmcd", &tcmi)].concat()),
                Brand::Mp4 => full_box(b"nmhd", 0, &[]),
            },
            entry: timecode_entry(t, video),
            fixed: 4,
            sizes: Vec::new(),
            keys: None,
            tref: None,
            edit: None,
            shift: 0,
            bytes: 4,
        });
    }
    (tracks, audio.map_or(video.timescale, Audio::rate))
}

/// `moov` for `tracks` in a movie of timescale `movie`: each track's samples in one chunk, the
/// first at `at` and each next one after the last.
fn moov_of(brand: Brand, tracks: &[Trak], movie: u32, mut at: u64, wide: bool) -> Vec<u8> {
    let span = (tracks.iter())
        .map(|t| t.shown() * movie as u64 / t.timescale.max(1) as u64)
        .max()
        .unwrap_or(0);
    let mut body = full_box(
        b"mvhd",
        0,
        &[
            &be(0)[..],
            &be(0),
            &be(movie),
            &be(span as u32),
            &be(0x10000),
            &[1, 0],
            &[0; 10],
            &matrix(),
            &[0; 24],
            &be(tracks.len() as u32 + 1),
        ]
        .concat(),
    );
    for (i, t) in tracks.iter().enumerate() {
        body.extend(trak(brand, t, i as u32 + 1, movie, at, wide));
        at += t.bytes;
    }
    mp4_box(b"moov", &body)
}

/// #157: a part's tail: `moov` for samples that start at `at`, its offsets 64 bits wide only when
/// they end past 4 GiB.
pub fn moov(
    brand: Brand,
    video: &Layout,
    audio: Option<&Audio>,
    timecode: Option<&Tmcd>,
    at: u64,
) -> Vec<u8> {
    let (tracks, movie) = tracks(brand, video, audio, timecode);
    let end = at + tracks.iter().map(|t| t.bytes).sum::<u64>();
    moov_of(brand, &tracks, movie, at, end > u32::MAX as u64)
}

/// #157: everything before the samples: `ftyp`, `moov`, and the header of the `mdat` that holds
/// the video samples, the sound and the timecode sample, in that order. `moov` is laid out once to
/// learn its size and once more with each chunk's final offset, which is 64 bits wide only when
/// the file passes 4 GiB.
pub fn head(
    brand: Brand,
    video: &Layout,
    audio: Option<&Audio>,
    timecode: Option<&Tmcd>,
) -> Vec<u8> {
    let (tracks, movie) = tracks(brand, video, audio, timecode);
    let mut out = ftyp(brand);
    let payload: u64 = tracks.iter().map(|t| t.bytes).sum();
    let size = |wide| moov_of(brand, &tracks, movie, 0, wide).len();
    let wide = (out.len() + size(true) + 16) as u64 + payload > u32::MAX as u64;
    let head = if wide { 16 } else { 8 };
    let data_at = (out.len() + size(wide) + head) as u64;
    out.extend(moov_of(brand, &tracks, movie, data_at, wide));
    match wide {
        true => out.extend([&be(1)[..], b"mdat", &(payload + 16).to_be_bytes()].concat()),
        false => out.extend([&be(payload as u32 + 8)[..], b"mdat"].concat()),
    }
    out
}

/// The movie's bytes: `head`, then the video samples, the sound and the timecode sample.
pub fn write(
    brand: Brand,
    video: &Video,
    audio: Option<&Audio>,
    timecode: Option<&Tmcd>,
) -> Vec<u8> {
    let mut out = head(brand, &video.layout(), audio, timecode);
    for s in &video.samples {
        out.extend_from_slice(s);
    }
    for s in audio.map(Audio::payload).unwrap_or_default() {
        out.extend_from_slice(s);
    }
    if let Some(t) = timecode {
        out.extend(be(t.start));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mp4;

    #[test]
    fn a_timescale_is_the_rates_own_terms() {
        assert_eq!(timescale(24, 1), (24000, 1000));
        assert_eq!(timescale(30000, 1001), (30000, 1001));
    }

    fn movie(brand: Brand, drop: bool) -> Vec<u8> {
        let samples: [&[u8]; 3] = [&[1; 5], &[2; 7], &[3; 11]];
        let pcm: Vec<u8> = (0..480u32).flat_map(|i| (i as f32).to_le_bytes()).collect();
        let (timescale, ticks) = timescale(24, 1);
        let video = Video {
            fourcc: *b"ap4h",
            config: None,
            size: [64, 32],
            timescale,
            ticks,
            samples: samples.to_vec(),
            keys: Some(vec![true, false, false]),
            held: None,
        };
        let audio = Audio::Pcm(Pcm {
            rate: 48000,
            channels: 2,
            f32le: &pcm,
        });
        let timecode = Tmcd {
            start: 86_400,
            nominal: 24,
            drop,
        };
        write(brand, &video, Some(&audio), Some(&timecode))
    }

    #[test]
    fn a_written_movie_reads_back_header_first() {
        for brand in [Brand::Mp4, Brand::Mov] {
            let bytes = movie(brand, false);
            let at = |kind: &[u8]| bytes.windows(4).position(|w| w == kind).unwrap();
            assert!(at(b"moov") < at(b"mdat"));
            let m = mp4::parse(&bytes).unwrap();
            let kinds: Vec<mp4::Kind> = m.tracks.iter().map(|t| t.kind).collect();
            assert_eq!(
                kinds,
                [mp4::Kind::Video, mp4::Kind::Audio, mp4::Kind::Timecode]
            );
            let v = &m.tracks[0];
            assert_eq!((v.timescale, v.duration), (24000, 3000));
            assert_eq!((v.entry.width, v.entry.height), (64, 32));
            let read: Vec<&[u8]> = (v.samples.iter())
                .map(|s| &bytes[s.offset as usize..][..s.size as usize])
                .collect();
            assert_eq!(read, [&[1u8; 5][..], &[2; 7], &[3; 11]]);
            let keys: Vec<bool> = v.samples.iter().map(|s| s.key).collect();
            assert_eq!(keys, [true, false, false]);
            assert_eq!(v.samples[2].dts, 2000);
            let a = &m.tracks[1];
            assert_eq!((a.entry.sample_rate, a.entry.channels), (48000, 2));
            assert_eq!((a.timescale, a.samples.len()), (48000, 240));
            let first = a.samples[1].offset as usize;
            assert_eq!(bytes[first..first + 4], 2f32.to_le_bytes());
            let timecode = mp4::Timecode {
                start_frame: 86_400,
                drop_frame: false,
                rate: 24,
            };
            assert_eq!(m.timecode(&bytes), Some(timecode));
        }
    }

    /// A delivery of `frames` one-byte frames at p/q, the planted program's timescale, with
    /// AAC at `rate` whose edit presents the PCM's N samples after 2,112 of priming: its movie
    /// read back, and N.
    fn delivery(p: u64, q: u64, rate: u64, frames: u64, planted: &Planted) -> (mp4::Movie, u64) {
        let n = frames * q * rate / p;
        let packets = (n + 2112).div_ceil(1024);
        let (timescale, ticks) = planted_timescale(p as u32, q as u32, planted);
        let video = Layout {
            fourcc: *b"avc1",
            config: None,
            size: [64, 32],
            timescale,
            ticks,
            sizes: vec![1; frames as usize],
            keys: None,
            colr: BT709,
            shift: if planted.is("muxer_drops_video_edit_list") {
                ticks
            } else {
                0
            },
            held: None,
        };
        let one = [0u8; 1];
        let audio = Audio::Aac(Aac {
            rate: rate as u32,
            channels: 2,
            descriptor: &[],
            packets: vec![&one[..]; packets as usize],
            edit: Some((2112, n)),
        });
        let mut bytes = head(Brand::Mp4, &video, Some(&audio), None);
        bytes.extend(vec![0; (frames + packets) as usize]);
        (mp4::parse(&bytes).unwrap(), n)
    }

    /// The first presented frame of `m` not at exactly k × q/p, if any.
    fn first_off(m: &mp4::Movie, p: u64, q: u64) -> Option<usize> {
        let v = &m.tracks[0];
        let shown = v.presented(m.timescale, true);
        (shown.iter().enumerate())
            .position(|(k, (_, t))| *t as u64 * p != k as u64 * q * v.timescale as u64)
    }

    /// #157: at each delivery rate and sample rate, frame k reads back at exactly k × q/p and the
    /// sound's edit presents exactly the PCM's N samples, its media time the priming.
    #[test]
    fn frames_and_the_sound_edit_read_back_exactly() {
        let mut wrong = Vec::new();
        for (p, q) in [(24000u64, 1001u64), (25, 1), (30000, 1001), (60, 1)] {
            for rate in [44_100u64, 48_000] {
                for frames in [1u64, 700, 701, 1440] {
                    let (m, n) = delivery(p, q, rate, frames, &Planted::default());
                    let (v, a) = (&m.tracks[0], &m.tracks[1]);
                    assert_eq!(v.presented(m.timescale, true).len() as u64, frames);
                    assert_eq!(first_off(&m, p, q), None, "{frames} at {p}/{q}");
                    let edit = (a.span(m.timescale) as u64, a.edits[0].media_time);
                    if edit != (n, 2112) {
                        wrong.push(format!("{frames} at {p}/{q}, {rate} Hz: {edit:?}, N {n}"));
                    }
                }
            }
        }
        assert!(wrong.is_empty(), "{wrong:#?}");
    }

    /// #157: the planted 600 and 1000 timescales put frame 1 off its time at 30000/1001, and the
    /// planted composition offset without an edit list presents frame 0 after zero.
    #[test]
    fn the_planted_timescales_and_offset_move_frames() {
        for (name, off) in [
            ("muxer_timescale_600", Some(1)),
            ("muxer_timescale_1000", Some(1)),
            ("muxer_drops_video_edit_list", Some(0)),
            ("none", None),
        ] {
            let (m, _) = delivery(30000, 1001, 48_000, 701, &Planted::one(name));
            assert_eq!(first_off(&m, 30000, 1001), off, "{name}");
        }
    }

    #[test]
    fn a_drop_frame_flag_reads_back() {
        let bytes = movie(Brand::Mov, true);
        let read = mp4::parse(&bytes).unwrap().timecode(&bytes).unwrap();
        assert!(read.drop_frame);
    }
}
