//! #503: our own audio decoders (canvas primitives: Decode worker, `codecs`), so every platform
//! reads WAV, AIFF, CAF, MP3, AAC-LC and HE-AAC, ALAC, FLAC, Opus (Ogg, WebM) and Vorbis (Ogg).
//! A file's container is known by its first bytes and read here (or by `mp4.rs` and `wav.rs`)
//! into one track of packets; the codec decodes them to interleaved f32, and the encoder's delay
//! and padding are trimmed as FFmpeg trims them. Integer samples become f32 as
//! sample ÷ 2^(depth − 1). A stream in any other codec is refused `unsupported_codec`, naming it
//! as ffprobe's `codec_name` does.

use serde_json::{json, Value};
use symphonia::core::codecs::audio::well_known::{
    CODEC_ID_ALAC, CODEC_ID_FLAC, CODEC_ID_MP3, CODEC_ID_VORBIS,
};
use symphonia::core::codecs::audio::{AudioCodecParameters, AudioDecoderOptions};
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::packet::Packet;

use crate::refused;

/// Linear PCM's layout: bits a sample, float or integer, byte order, and (8-bit) unsigned.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Pcm {
    pub bits: u16,
    pub float: bool,
    pub big: bool,
    pub unsigned: bool,
}

impl Pcm {
    pub fn int(bits: u16, big: bool) -> Pcm {
        Pcm {
            bits,
            float: false,
            big,
            unsigned: false,
        }
    }

    fn name(&self) -> String {
        let order = if self.big { "be" } else { "le" };
        match (self.float, self.bits) {
            (true, b) => format!("pcm_f{b}{order}"),
            (false, 8) => format!("pcm_{}8", if self.unsigned { "u" } else { "s" }),
            (false, b) => format!("pcm_s{b}{order}"),
        }
    }

    /// Every whole sample in `bytes` as f32: an integer of depth d as sample ÷ 2^(d − 1).
    pub fn f32(&self, bytes: &[u8]) -> Vec<f32> {
        let w = (self.bits / 8).max(1) as usize;
        bytes
            .chunks_exact(w)
            .map(|s| {
                let mut b = [0u8; 8];
                b[..w].copy_from_slice(s);
                if self.big {
                    b[..w].reverse();
                }
                match (self.float, w) {
                    (true, 4) => f32::from_le_bytes([b[0], b[1], b[2], b[3]]),
                    (true, _) => f64::from_le_bytes(b) as f32,
                    (false, 1) if self.unsigned => (i32::from(b[0]) - 128) as f32 / 128.0,
                    (false, _) => {
                        let v = i64::from_le_bytes(b) << (64 - 8 * w) >> (64 - 8 * w);
                        int_to_f32(v as i32, 8 * w as u32)
                    }
                }
            })
            .collect()
    }
}

/// An integer sample of `depth` bits as f32: sample ÷ 2^(depth − 1) (Decode worker).
pub fn int_to_f32(sample: i32, depth: u32) -> f32 {
    (f64::from(sample) / f64::from(1u32 << (depth.clamp(1, 32) - 1))) as f32
}

/// A codec the list holds.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Codec {
    Pcm(Pcm),
    Mp3,
    Aac,
    Alac,
    Flac,
    Opus,
    Vorbis,
}

impl Codec {
    /// ffprobe's `codec_name`.
    pub fn name(&self) -> String {
        match self {
            Codec::Pcm(p) => p.name(),
            Codec::Mp3 => "mp3".into(),
            Codec::Aac => "aac".into(),
            Codec::Alac => "alac".into(),
            Codec::Flac => "flac".into(),
            Codec::Opus => "opus".into(),
            Codec::Vorbis => "vorbis".into(),
        }
    }
}

/// How a track's end is found once its packets are decoded.
#[derive(Clone, Copy, Debug)]
pub enum End {
    /// Every frame after the skip.
    All,
    /// This many frames after the skip.
    Keep(u64),
    /// This many frames dropped from the end.
    Drop(u64),
    /// Ogg (FFmpeg's reading): the stream starts at `first`, the granule of the page its first
    /// sound packet ends on, less what the `on_first` packets ending there decode to, and ends
    /// at the granule `last`.
    Granule {
        first: i64,
        on_first: usize,
        last: i64,
    },
}

/// One audio stream of a file: its codec (or the name of one the list doesn't hold), its
/// packets and how they're trimmed.
pub struct Track {
    pub codec: Result<Codec, String>,
    pub rate: u32,
    pub channels: u32,
    /// The codec's own configuration: an AudioSpecificConfig, ALAC's cookie, FLAC's
    /// STREAMINFO, an OpusHead, or Vorbis's identification and setup headers.
    pub config: Vec<u8>,
    pub packets: Vec<Vec<u8>>,
    /// Frames dropped from the start.
    pub skip: u64,
    pub end: End,
    /// The frames the container says it presents, when it says.
    pub frames: Option<u64>,
    /// A chained Ogg file's next link, decoded after this one as the same stream.
    pub next: Option<Box<Track>>,
}

impl Track {
    pub fn new(codec: Codec, rate: u32, channels: u32, config: Vec<u8>) -> Track {
        Track {
            codec: Ok(codec),
            rate,
            channels,
            config,
            packets: Vec::new(),
            skip: 0,
            end: End::All,
            frames: None,
            next: None,
        }
    }

    pub fn unsupported(name: &str) -> Track {
        Track {
            codec: Err(name.to_string()),
            ..Track::new(Codec::Mp3, 0, 0, Vec::new())
        }
    }
}

/// An MPEG-4 ES descriptor (an `esds` box's body after its version and flags): the
/// DecoderConfigDescriptor's object type and its DecoderSpecificInfo.
pub fn esds(b: &[u8]) -> Option<(u8, &[u8])> {
    let mut at = 0;
    let descriptor = |tag: u8, at: &mut usize| -> Option<usize> {
        (*b.get(*at)? == tag).then_some(())?;
        *at += 1;
        let mut len = 0usize;
        for _ in 0..4 {
            let x = *b.get(*at)?;
            *at += 1;
            len = len << 7 | usize::from(x & 0x7f);
            if x & 0x80 == 0 {
                break;
            }
        }
        Some(len)
    };
    descriptor(3, &mut at)?;
    let flags = *b.get(at + 2)?;
    at += 3 + if flags & 0x80 != 0 { 2 } else { 0 };
    if flags & 0x40 != 0 {
        at += 1 + usize::from(*b.get(at)?);
    }
    at += if flags & 0x20 != 0 { 2 } else { 0 };
    descriptor(4, &mut at)?;
    let object = *b.get(at)?;
    at += 13;
    let info = match descriptor(5, &mut at) {
        Some(n) => b.get(at..at + n)?,
        None => &[],
    };
    Some((object, info))
}

/// An MP4 or QuickTime audio sample entry's codec and the configuration its decoder takes.
pub fn mp4_codec(
    fourcc: &[u8; 4],
    config: Option<&([u8; 4], Vec<u8>)>,
) -> (Result<Codec, String>, Vec<u8>) {
    let body = config.map(|c| c.1.as_slice()).unwrap_or_default();
    let pcm = |bits, float, big| {
        Ok(Codec::Pcm(Pcm {
            float,
            ..Pcm::int(bits, big)
        }))
    };
    let name = |n: &str| Err(n.to_string());
    let codec = match fourcc {
        b"mp4a" => match esds(body.get(4..).unwrap_or_default()) {
            Some((0x40 | 0x66..=0x68, info)) => return (Ok(Codec::Aac), info.to_vec()),
            Some((0x69 | 0x6b, _)) => Ok(Codec::Mp3),
            Some((0xa5, _)) => name("ac3"),
            Some((0xa6, _)) => name("eac3"),
            Some((0xa9, _)) => name("dts"),
            Some((0xdd, _)) => name("vorbis"),
            Some((other, _)) => Err(format!("mp4a object type {other:#04x}")),
            None => Ok(Codec::Aac),
        },
        // ALAC's box and FLAC's are full boxes; OpusHead is dOps in little-endian with its magic.
        b"alac" => return (Ok(Codec::Alac), body.get(4..).unwrap_or_default().to_vec()),
        b"fLaC" => {
            return (
                Ok(Codec::Flac),
                body.get(8..42).unwrap_or_default().to_vec(),
            )
        }
        b"Opus" => {
            let mut head = b"OpusHead\x01".to_vec();
            head.push(*body.get(1).unwrap_or(&2));
            for (at, n) in [(2, 2), (4, 4), (8, 2)] {
                head.extend(body.get(at..at + n).unwrap_or(&[0; 4][..n]).iter().rev());
            }
            head.push(*body.get(10).unwrap_or(&0));
            return (Ok(Codec::Opus), head);
        }
        b".mp3" => Ok(Codec::Mp3),
        // #502: float PCM as an export writes it, little-endian whatever its fourcc says.
        b"fpcm" | b"lpcm" => pcm(32, true, false),
        b"sowt" => pcm(16, false, false),
        b"twos" => pcm(16, false, true),
        b"in24" => pcm(24, false, true),
        b"in32" => pcm(32, false, true),
        b"fl32" => pcm(32, true, true),
        b"fl64" => pcm(64, true, true),
        b"ac-3" => name("ac3"),
        b"ec-3" => name("eac3"),
        b"alaw" => name("pcm_alaw"),
        b"ulaw" => name("pcm_mulaw"),
        b"ima4" => name("adpcm_ima_qt"),
        b"samr" => name("amr_nb"),
        b"sawb" => name("amr_wb"),
        b"dtsc" | b"dtsh" | b"dtsl" => name("dts"),
        b".mp2" => name("mp2"),
        other => Err(String::from_utf8_lossy(other).trim().to_lowercase()),
    };
    (codec, Vec::new())
}

/// The refusal of a stream in a codec the list doesn't hold, naming it.
pub fn unsupported(name: &str) -> Value {
    refused("unsupported_codec", json!({"codec": name}))
}

/// What follows an ID3v2 tag at the start of `data`, or all of it.
fn after_id3(data: &[u8]) -> &[u8] {
    match data {
        [b'I', b'D', b'3', _, _, flags, a, b, c, d, ..] => {
            let size = [a, b, c, d]
                .iter()
                .fold(0usize, |s, x| s << 7 | (**x & 0x7f) as usize);
            let footer = if flags & 0x10 != 0 { 10 } else { 0 };
            data.get(10 + size + footer..).unwrap_or_default()
        }
        _ => data,
    }
}

/// An MPEG audio frame header at the start of `b`: its layer (1 to 3) and length in bytes.
fn mpeg_frame(b: &[u8]) -> Option<(u8, usize)> {
    let h = u32::from_be_bytes(b.get(..4)?.try_into().ok()?);
    let (version, layer, rate_i, bitrate_i) = (
        (h >> 19) & 3,
        4 - ((h >> 17) & 3) as u8,
        (h >> 10) & 3,
        (h >> 12) & 15,
    );
    if h >> 21 != 0x7ff
        || version == 1
        || layer == 4
        || rate_i == 3
        || bitrate_i == 0
        || bitrate_i == 15
    {
        return None;
    }
    let v1 = version == 3;
    const KBPS: [[u16; 14]; 5] = [
        [
            32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448,
        ],
        [
            32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384,
        ],
        [
            32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
        ],
        [
            32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256,
        ],
        [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    ];
    let row = match (v1, layer) {
        (true, l) => l as usize - 1,
        (false, 1) => 3,
        _ => 4,
    };
    let kbps = u32::from(KBPS[row][bitrate_i as usize - 1]) * 1000;
    let rate = [44_100u32, 48_000, 32_000][rate_i as usize] >> [2, 0, 1, 0][version as usize];
    let pad = (h >> 9) & 1;
    let len = match layer {
        1 => (12 * kbps / rate + pad) * 4,
        3 if !v1 => 72 * kbps / rate + pad,
        _ => 144 * kbps / rate + pad,
    };
    Some((layer, len as usize))
}

/// An ADTS frame header at the start of `b`: its length in bytes.
fn adts_frame(b: &[u8]) -> Option<usize> {
    let ok = b.len() >= 7 && b[0] == 0xff && b[1] & 0xf6 == 0xf0;
    let len =
        ((usize::from(b.get(3)? & 3)) << 11) | (usize::from(b[4]) << 3) | usize::from(b[5] >> 5);
    (ok && len >= 7).then_some(len)
}

/// A frame header at `b`'s start whose next frame starts where it ends, or at the end.
fn synced(b: &[u8], frame: impl Fn(&[u8]) -> Option<usize>) -> bool {
    frame(b).is_some_and(|n| n <= b.len() && (n == b.len() || frame(&b[n..]).is_some()))
}

/// The audio file in `data`, by its first bytes: one track, a refusal naming its codec, or
/// `None` when it isn't an audio container this module reads.
pub fn read(data: &[u8]) -> Option<Result<Track, Value>> {
    let track = match data {
        [b'F', b'O', b'R', b'M', _, _, _, _, b'A', b'I', b'F', ..] => crate::chunks::aiff(data),
        [b'c', b'a', b'f', b'f', ..] => crate::chunks::caf(data),
        [b'O', b'g', b'g', b'S', ..] => crate::ogg::read(data),
        [0x1a, 0x45, 0xdf, 0xa3, ..] => crate::mkv::read(data),
        [0x0b, 0x77, _, _, _, b, ..] => {
            Some(Track::unsupported(if b >> 3 > 10 { "eac3" } else { "ac3" }))
        }
        [0x7f, 0xfe, 0x80, 0x01, ..] => Some(Track::unsupported("dts")),
        _ if data.starts_with(b"#!AMR-WB\n") => Some(Track::unsupported("amr_wb")),
        _ if data.starts_with(b"#!AMR\n") => Some(Track::unsupported("amr_nb")),
        _ if data.starts_with(&[0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]) => {
            crate::chunks::asf(data)
        }
        _ => {
            let body = after_id3(data);
            if body.starts_with(b"fLaC") {
                symphonia_read(body, true)
            } else if synced(body, |b| mpeg_frame(b).map(|f| f.1)) {
                match mpeg_frame(body).map(|f| f.0) {
                    Some(3) => symphonia_read(body, false),
                    Some(l) => Some(Track::unsupported(if l == 2 { "mp2" } else { "mp1" })),
                    None => None,
                }
            } else if synced(body, adts_frame) {
                adts(body)
            } else {
                return None;
            }
        }
    };
    Some(match track {
        Some(t) => match &t.codec {
            Err(name) => Err(unsupported(name)),
            Ok(_) => Ok(t),
        },
        None => Err(refused(
            "unreadable",
            json!({"why": "an audio file its container can't hold"}),
        )),
    })
}

/// ADTS frames, each a packet with its header; nothing is trimmed (FFmpeg's reading).
fn adts(data: &[u8]) -> Option<Track> {
    let mut t = Track::new(Codec::Aac, 0, 0, Vec::new());
    let mut at = 0;
    while let Some(n) = data.get(at..).and_then(adts_frame) {
        t.packets.push(data.get(at..at + n)?.to_vec());
        at += n;
    }
    let first = t.packets.first()?;
    let (rate_i, channels) = (
        (first[2] >> 2) & 15,
        ((first[2] & 1) << 2) | (first[3] >> 6),
    );
    t.rate = *[
        96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
    ]
    .get(rate_i as usize)?;
    t.channels = u32::from(channels);
    t.frames = Some(t.packets.len() as u64 * 1024);
    Some(t)
}

/// An AAC stream's output rate and channel count, and the frames a packet gives, from its
/// first packet that decodes: SBR doubles the rate, and FFmpeg's decoder (and ours) gives a
/// mono stream with SBR as stereo, since it may carry parametric stereo.
pub fn aac_shape(config: &[u8], packets: &[Vec<u8>]) -> Option<(u32, u32, u64)> {
    let mut dec = match config.is_empty() {
        true => rusty_aac::AacDecoder::new(),
        false => rusty_aac::AacDecoder::with_config_bytes(config).ok()?,
    };
    packets.iter().take(8).find_map(|p| {
        let f = dec.decode(p, None).ok()?;
        Some((f.sample_rate, u32::from(f.channels), f.frames() as u64))
    })
}

/// A native FLAC or MP3 file through symphonia's reader: its packets, and for MP3 the LAME
/// tag's delay and padding, which it reads as FFmpeg does (delay + 529, padding − 529).
fn symphonia_read(data: &[u8], flac: bool) -> Option<Track> {
    let mss = MediaSourceStream::new(Box::new(std::io::Cursor::new(data)), Default::default());
    let mut r: Box<dyn FormatReader> = if flac {
        Box::new(
            symphonia::default::formats::FlacReader::try_new(mss, FormatOptions::default()).ok()?,
        )
    } else {
        Box::new(
            symphonia::default::formats::MpaReader::try_new(mss, FormatOptions::default()).ok()?,
        )
    };
    let track = r.tracks().first()?.clone();
    let p = track.codec_params.as_ref()?.audio()?.clone();
    let codec = if flac { Codec::Flac } else { Codec::Mp3 };
    let channels = p.channels.as_ref().map_or(0, |c| c.count() as u32);
    let mut t = Track::new(
        codec,
        p.sample_rate?,
        channels,
        p.extra_data.as_deref().unwrap_or_default().to_vec(),
    );
    let mut trimmed = 0;
    while let Ok(Some(pk)) = r.next_packet() {
        t.skip += pk.trim_start.get();
        trimmed += pk.trim_end.get();
        t.packets.push(pk.data.to_vec());
    }
    t.end = End::Drop(trimmed);
    // Without a Xing count, an MP3's frames are its packets' (1,152 frames each, 576 below 32 kHz).
    let per = if t.rate >= 32_000 { 1152 } else { 576 };
    t.frames = track
        .num_frames
        .or((!flac).then_some(t.packets.len() as u64 * per));
    Some(t)
}

/// The decoded samples of a track, before trimming: interleaved f32 at the decoder's own rate
/// and channel count, and the frames each packet gave.
pub struct Decoded {
    pub samples: Vec<f32>,
    pub rate: u32,
    pub channels: u32,
    pub counts: Vec<u64>,
}

/// Decodes every packet of `t`; a packet that doesn't decode stops it, naming the packet.
pub fn decode(t: &Track) -> Result<Decoded, String> {
    let codec = t.codec.clone().map_err(|n| format!("no decoder for {n}"))?;
    let mut d = Decoded {
        samples: Vec::new(),
        rate: t.rate,
        channels: t.channels.max(1),
        counts: Vec::with_capacity(t.packets.len()),
    };
    fn push(d: &mut Decoded, s: &[f32], ch: u32) {
        d.channels = ch.max(1);
        d.counts.push((s.len() / ch.max(1) as usize) as u64);
        d.samples.extend_from_slice(s);
    }
    match codec {
        Codec::Pcm(p) => {
            for pk in &t.packets {
                push(&mut d, &p.f32(pk), t.channels);
            }
        }
        Codec::Aac => {
            let mut dec = match t.config.is_empty() {
                true => rusty_aac::AacDecoder::new(),
                false => rusty_aac::AacDecoder::with_config_bytes(&t.config)
                    .map_err(|e| e.to_string())?,
            };
            for (i, pk) in t.packets.iter().enumerate() {
                match dec.decode(pk, None) {
                    Ok(f) => {
                        d.rate = f.sample_rate;
                        push(&mut d, &f.samples, u32::from(f.channels));
                    }
                    Err(rusty_aac::Error::Again) => d.counts.push(0),
                    Err(e) => return Err(format!("AAC packet {i}: {e}")),
                }
            }
        }
        Codec::Opus => {
            let head = &t.config;
            if head.get(18).is_some_and(|family| *family != 0) {
                return Err("an Opus stream of more than two channels".into());
            }
            let stereo = head.get(9).is_some_and(|c| *c >= 2);
            let channels = if stereo {
                ropus::Channels::Stereo
            } else {
                ropus::Channels::Mono
            };
            let mut dec = ropus::Decoder::new(48_000, channels).map_err(|e| format!("{e:?}"))?;
            let gain = head
                .get(16..18)
                .map_or(0, |g| i16::from_le_bytes([g[0], g[1]]));
            if gain != 0 {
                dec.set_gain(i32::from(gain))
                    .map_err(|e| format!("{e:?}"))?;
            }
            let ch = if stereo { 2 } else { 1 };
            let mut pcm = vec![0i16; 5760 * ch];
            for (i, pk) in t.packets.iter().enumerate() {
                let n = dec
                    .decode(pk, &mut pcm, ropus::DecodeMode::Normal)
                    .map_err(|e| format!("Opus packet {i}: {e:?}"))?;
                let f: Vec<f32> = pcm[..n * ch]
                    .iter()
                    .map(|s| int_to_f32(i32::from(*s), 16))
                    .collect();
                push(&mut d, &f, ch as u32);
            }
            d.rate = 48_000;
        }
        Codec::Mp3 | Codec::Flac | Codec::Alac | Codec::Vorbis => {
            let id = match codec {
                Codec::Mp3 => CODEC_ID_MP3,
                Codec::Flac => CODEC_ID_FLAC,
                Codec::Alac => CODEC_ID_ALAC,
                _ => CODEC_ID_VORBIS,
            };
            let mut params = AudioCodecParameters::new();
            params
                .for_codec(id)
                .with_sample_rate(t.rate)
                .with_extra_data(t.config.clone().into());
            // Gapless decoding only drops the first Vorbis packet's output, as FFmpeg's decoder
            // does; every trim is made below.
            let mut dec = symphonia::default::get_codecs()
                .make_audio_decoder(
                    &params,
                    &AudioDecoderOptions::default().gapless(codec == Codec::Vorbis),
                )
                .map_err(|e| e.to_string())?;
            let int = matches!(codec, Codec::Flac | Codec::Alac);
            let (mut ints, mut floats) = (Vec::<i32>::new(), Vec::<f32>::new());
            for (i, pk) in t.packets.iter().enumerate() {
                let p = Packet::new(0, 0i64.into(), 0u64.into(), pk.clone());
                let buf = dec
                    .decode(&p)
                    .map_err(|e| format!("{} packet {i}: {e}", codec.name()))?;
                d.rate = buf.spec().rate();
                let ch = buf.spec().channels().count() as u32;
                // FLAC and ALAC give their integers shifted to 32 bits.
                if int {
                    buf.copy_to_vec_interleaved(&mut ints);
                    floats.clear();
                    floats.extend(ints.iter().map(|s| int_to_f32(*s, 32)));
                } else {
                    buf.copy_to_vec_interleaved(&mut floats);
                }
                push(&mut d, &floats, ch);
            }
        }
    }
    Ok(d)
}

/// `t` decoded and trimmed, then each link chained after it: the samples, rate and channels.
pub fn decode_trimmed(t: &Track) -> Result<(Vec<f32>, u32, u32), String> {
    let (mut samples, rate, channels) = trimmed(t)?;
    let mut link = t.next.as_deref();
    while let Some(l) = link {
        let (more, r, c) = trimmed(l)?;
        if (r, c) != (rate, channels) {
            return Err(format!(
                "a chained link at {r} Hz in {c} channels after {rate} Hz in {channels}"
            ));
        }
        samples.extend(more);
        link = l.next.as_deref();
    }
    Ok((samples, rate, channels))
}

fn trimmed(t: &Track) -> Result<(Vec<f32>, u32, u32), String> {
    let d = decode(t)?;
    let ch = d.channels as usize;
    let total = (d.samples.len() / ch) as u64;
    let skip = t.skip.min(total);
    let keep = match t.end {
        End::All => total - skip,
        End::Keep(n) => n,
        End::Drop(n) => (total - skip).saturating_sub(n),
        End::Granule {
            first,
            on_first,
            last,
        } => {
            let start = first - d.counts.iter().take(on_first).sum::<u64>() as i64;
            (last - start - skip as i64).max(0) as u64
        }
    }
    .min(total - skip);
    let mut s = d.samples;
    s.truncate(((skip + keep) as usize) * ch);
    s.drain(..skip as usize * ch);
    Ok((s, d.rate, d.channels))
}

/// The probe's stream for an audio file: its codec, rate, channels and duration in frames at
/// that rate (an AAC stream's as its decoder gives them).
pub fn probe(t: &Track) -> Value {
    let name = t.codec.as_ref().map_or_else(|n| n.clone(), Codec::name);
    let (mut rate, mut channels, mut frames) = (t.rate, t.channels, t.frames);
    if let Ok(Codec::Aac) = t.codec {
        if let Some((r, c, per)) = aac_shape(&t.config, &t.packets) {
            (rate, channels, frames) = (r, c, Some(t.packets.len() as u64 * per));
        }
    }
    let mut s = json!({"index": 0, "type": "audio", "codec": name, "time_base": [1, rate],
        "sample_rate": rate, "channels": channels});
    if let Some(f) = frames {
        s["duration"] = json!([f, rate]);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(id: &[u8], body: &[u8]) -> Vec<u8> {
        [id, &(body.len() as u32).to_be_bytes(), body].concat()
    }

    /// A Matroska element with an 8-byte size.
    fn el(id: &[u8], body: &[u8]) -> Vec<u8> {
        [id, &[1], &(body.len() as u64).to_be_bytes()[1..], body].concat()
    }

    /// One Ogg page of whole packets.
    fn page(flags: u8, granule: i64, packets: &[&[u8]]) -> Vec<u8> {
        let mut lacing = Vec::new();
        for p in packets {
            lacing.extend(std::iter::repeat_n(255, p.len() / 255));
            lacing.push((p.len() % 255) as u8);
        }
        let head = [
            b"OggS\0".as_slice(),
            &[flags],
            &granule.to_le_bytes(),
            &[0; 12],
        ]
        .concat();
        [head, vec![lacing.len() as u8], lacing, packets.concat()].concat()
    }

    fn opus_head() -> Vec<u8> {
        let rate = 48_000u32.to_le_bytes();
        [
            b"OpusHead\x01\x02".as_slice(),
            &312u16.to_le_bytes(),
            &rate,
            &[0, 0, 0],
        ]
        .concat()
    }

    fn matroska(codec: &[u8], private: &[u8]) -> Vec<u8> {
        let rate = el(&[0xb5], &48_000f64.to_be_bytes());
        let audio = el(&[0xe1], &[rate, el(&[0x9f], &[2])].concat());
        let entry = [
            el(&[0xd7], &[1]),
            el(&[0x83], &[2]),
            el(&[0x86], codec),
            el(&[0x63, 0xa2], private),
            audio,
        ];
        let tracks = el(&[0x16, 0x54, 0xae, 0x6b], &el(&[0xae], &entry.concat()));
        let block = el(&[0xa3], &[0x81, 0, 0, 0x80, 0xf8]);
        let cluster = el(
            &[0x1f, 0x43, 0xb6, 0x75],
            &[el(&[0xe7], &[0]), block].concat(),
        );
        let segment = el(&[0x18, 0x53, 0x80, 0x67], &[tracks, cluster].concat());
        [el(&[0x1a, 0x45, 0xdf, 0xa3], &[]), segment].concat()
    }

    /// FLAC's CRCs: `width` bits, MSB first, from zero.
    fn crc(bytes: &[u8], width: u32, poly: u32) -> u32 {
        let mask = (1u32 << width) - 1;
        bytes.iter().fold(0, |mut c, b| {
            c ^= u32::from(*b) << (width - 8);
            for _ in 0..8 {
                c = if c >> (width - 1) & 1 == 1 {
                    (c << 1) ^ poly
                } else {
                    c << 1
                } & mask;
            }
            c
        })
    }

    /// Two MPEG audio frames of `layer` (MPEG-1, 44.1 kHz, bitrate index 9).
    fn mpeg(layer: u8) -> Vec<u8> {
        let head = [0xff, 0xf8 | ((4 - layer) << 1) | 1, 0x90, 0];
        let len = mpeg_frame(&head).expect("a frame header").1;
        [&head[..], &vec![0; len - 4]].concat().repeat(2)
    }

    /// One small file of each container, in a listed codec, then in unlisted ones.
    fn files() -> Vec<(&'static str, Vec<u8>)> {
        let rate_8000 = [0x40, 0x0b, 0xfa, 0, 0, 0, 0, 0, 0, 0];
        let head = [
            1u16.to_be_bytes(),
            [0, 0],
            2u16.to_be_bytes(),
            16u16.to_be_bytes(),
        ]
        .concat();
        let comm = |extra: &[u8]| [&head[..], &rate_8000, extra].concat();
        let ssnd = [&[0u8; 8][..], &[0x80, 0, 0, 1]].concat();
        let aiff = |kind: &[u8], comm: Vec<u8>| {
            let body = [kind, &chunk(b"COMM", &comm), &chunk(b"SSND", &ssnd)].concat();
            chunk(b"FORM", &body)
        };
        let caf_chunk = |id: &[u8], b: &[u8]| [id, &(b.len() as u64).to_be_bytes(), b].concat();
        let caf = |format: &[u8]| {
            let words = [2u32, 2, 1, 1, 16].map(u32::to_be_bytes).concat();
            let rate = 8000f64.to_bits().to_be_bytes();
            let desc = caf_chunk(b"desc", &[&rate[..], format, &words].concat());
            let data = caf_chunk(b"data", &[0, 0, 0, 0, 0, 0x80, 1, 0]);
            [b"caff\0\x01\0\0".as_slice(), &desc, &data].concat()
        };
        // STREAMINFO (192-frame blocks, 44.1 kHz, two channels of 16 bits, 192 frames), then one
        // frame of two constant subframes, with its header's CRC-8 and its CRC-16.
        let shape = (44_100u64 << 44) | (1 << 41) | (15 << 36) | 192;
        let blocks = [0, 0xc0, 0, 0xc0, 0, 0, 0, 0, 0, 0];
        let info = [&blocks[..], &shape.to_be_bytes(), &[0; 16]].concat();
        let mut frame = vec![0xff, 0xf8, 0x10, 0x10, 0];
        frame.push(crc(&frame, 8, 0x07) as u8);
        frame.extend([0; 6]);
        frame.extend_from_slice(&(crc(&frame, 16, 0x8005) as u16).to_be_bytes());
        let flac = [b"fLaC\x80\0\0\x22".as_slice(), &info, &frame].concat();
        let adts = [0xff, 0xf1, 0x50, 0x80, 0x01, 0x1f, 0xfc, 0].repeat(2);
        let ogg = [
            page(2, 0, &[&opus_head()]),
            page(0, 0, &[b"OpusTags"]),
            page(4, 648, &[&[0xf8]]),
        ]
        .concat();
        let wav = |tag: u16| {
            let le = |id: &[u8], b: &[u8]| [id, &(b.len() as u32).to_le_bytes(), b].concat();
            let rates = [8000u32.to_le_bytes(), 8000u32.to_le_bytes()].concat();
            let fmt = [&tag.to_le_bytes()[..], &[1, 0], &rates, &[1, 0, 8, 0]].concat();
            let body = [le(b"fmt ", &fmt), le(b"data", &[0xd5, 0x55])].concat();
            [b"RIFF\0\0\0\0WAVE".as_slice(), &body].concat()
        };
        vec![
            ("pcm_s16be", aiff(b"AIFF", comm(&[]))),
            ("pcm_s16le", aiff(b"AIFC", comm(b"sowt\0"))),
            ("pcm_s16le", caf(b"lpcm")),
            ("opus", ogg),
            ("flac", flac),
            ("mp3", mpeg(3)),
            ("aac", adts),
            ("opus", matroska(b"A_OPUS", &opus_head())),
            // Unlisted codecs, each refused by its name.
            ("pcm_mulaw", aiff(b"AIFC", comm(b"ulaw\0"))),
            ("adpcm_ima_qt", caf(b"ima4")),
            ("mp2", mpeg(2)),
            ("ac3", [0x0b, 0x77, 0, 0, 0x14, 0x40, 0].repeat(4)),
            ("ac3", matroska(b"A_AC3", &[])),
            ("pcm_alaw", wav(6)),
        ]
    }

    #[test]
    fn each_container_is_known_by_its_first_bytes() {
        // The WAVE file is lib.rs's to read; the others are this module's.
        for (name, bytes) in files().into_iter().filter(|f| !f.1.starts_with(b"RIFF")) {
            let got = match read(&bytes) {
                Some(Ok(t)) => t.codec.map(|c| c.name()).unwrap_or_default(),
                Some(Err(r)) => r["refused"]["codec"].as_str().unwrap_or("?").to_string(),
                None => "(not known)".into(),
            };
            assert_eq!(got, name, "a file of {name} read as {got}");
        }
    }

    #[test]
    fn a_stream_in_an_unlisted_codec_is_refused_naming_it_in_probe_and_decode() {
        let dir = std::env::temp_dir().join(format!("deep-codecs-unlisted-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a scratch folder");
        for (k, (name, bytes)) in files().into_iter().enumerate().skip(8) {
            let path = dir.join(k.to_string());
            std::fs::write(&path, bytes).expect("a fixture");
            for op in ["probe", "decode"] {
                let job = json!({"op": op, "path": path, "out": dir.join("out")});
                let job = job.as_object().expect("a job");
                let (reply, _) = crate::run(job, &crate::Caps::default(), &Default::default());
                let want = json!({"refused": {"code": "unsupported_codec", "codec": name}});
                assert_eq!(reply, want, "{op} of {name}");
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn integer_samples_become_f32_as_sample_over_two_to_the_depth_less_one() {
        let one = |d: i32| 2f32.powi(-(d - 1));
        let unsigned = Pcm {
            unsigned: true,
            ..Pcm::int(8, false)
        };
        assert_eq!(unsigned.f32(&[0, 129]), [-1.0, one(8)]);
        assert_eq!(Pcm::int(8, true).f32(&[0x80, 1]), [-1.0, one(8)]);
        assert_eq!(Pcm::int(16, false).f32(&[0, 0x80, 1, 0]), [-1.0, one(16)]);
        assert_eq!(
            Pcm::int(24, true).f32(&[0x80, 0, 0, 0, 0, 1]),
            [-1.0, one(24)]
        );
        let s32 = [0, 0, 0, 0x80, 1, 0, 0, 0];
        assert_eq!(Pcm::int(32, false).f32(&s32), [-1.0, one(32)]);
        // FLAC's and ALAC's samples arrive shifted to 32 bits; Opus's are 16-bit.
        assert_eq!(int_to_f32(1 << 8, 32), one(24));
        assert_eq!(int_to_f32(-1 << 15, 16), -1.0);
    }
}
