//! #157: the encode tool's streaming encoder. One VideoToolbox session is fed a frame at a time,
//! each frame copied into a buffer from the session's own pool, and each coded sample goes to the
//! caller's sink as soon as the encoder gives it, so a shard of any length holds one frame.

use std::collections::VecDeque;
use std::sync::Mutex;

use super::*;
use crate::mp4::Colr;

#[link(name = "VideoToolbox", kind = "framework")]
extern "C" {
    static kVTCompressionPropertyKey_Quality: CFTypeRef;
    static kVTCompressionPropertyKey_AverageBitRate: CFTypeRef;
    static kVTCompressionPropertyKey_DataRateLimits: CFTypeRef;
    static kVTCompressionPropertyKey_ExpectedFrameRate: CFTypeRef;
    static kVTCompressionPropertyKey_RealTime: CFTypeRef;
    fn VTCompressionSessionGetPixelBufferPool(s: CFTypeRef) -> CFTypeRef;
}

#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    static kCVImageBufferColorPrimaries_SMPTE_C: CFTypeRef;
    static kCVImageBufferYCbCrMatrix_ITU_R_601_4: CFTypeRef;
    fn CVPixelBufferPoolCreatePixelBuffer(
        a: CFTypeRef,
        pool: CFTypeRef,
        out: *mut CFTypeRef,
    ) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFTypeArrayCallBacks: c_void;
    fn CFArrayCreate(
        a: CFTypeRef,
        values: *const CFTypeRef,
        n: isize,
        cb: *const c_void,
    ) -> CFTypeRef;
}

/// kVTEncodeInfo_FrameDropped.
const DROPPED: u32 = 1 << 1;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Codec {
    H264,
    Hevc,
    ProRes4444,
}

impl Codec {
    /// The sample entry's type.
    pub fn fourcc(self) -> [u8; 4] {
        match self {
            Codec::H264 => *b"avc1",
            Codec::Hevc => *b"hvc1",
            Codec::ProRes4444 => *b"ap4h",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Codec::H264 => "VideoToolbox H.264",
            Codec::Hevc => "VideoToolbox HEVC",
            Codec::ProRes4444 => "VideoToolbox ProRes 4444",
        }
    }
}

/// What a session is made with. `colr` is the colour it is told and the muxer writes: ISO/IEC
/// 23091-2 code points, full range only for the planted encoder.
pub struct Settings {
    pub codec: Codec,
    pub size: [u32; 2],
    pub rate: [u32; 2],
    pub timescale: u32,
    /// kVTCompressionPropertyKey_Quality, 0 to 1; `None` leaves the encoder's own.
    pub quality: Option<f64>,
    /// The planted starved encoder's average bit rate, also its hard limit per second.
    pub bitrate: Option<u32>,
    pub key_interval: Option<u32>,
    pub colr: Colr,
}

impl Settings {
    /// The source buffers' pixel format: NV12 in the range the colour names, or BGRA.
    fn pixel_format(&self) -> [u8; 4] {
        match (self.codec, self.colr.full_range == Some(true)) {
            (Codec::ProRes4444, _) => *b"BGRA",
            (_, true) => *b"420f",
            (_, false) => *b"420v",
        }
    }

    /// One frame's bytes as the encoder takes it: NV12 (the Y plane, then Cb and Cr interleaved
    /// at half size) or BGRA, rows top-down without padding.
    pub fn frame_bytes(&self) -> usize {
        let (w, h) = (self.size[0] as usize, self.size[1] as usize);
        match self.codec {
            Codec::ProRes4444 => w * h * 4,
            _ => w * h * 3 / 2,
        }
    }
}

#[derive(Default)]
struct Out {
    coded: VecDeque<Coded>,
    config: Option<Vec<u8>>,
    error: Option<String>,
}

extern "C" fn on_sample(
    refcon: *mut c_void,
    _frame: *mut c_void,
    status: OSStatus,
    flags: u32,
    sample: CFTypeRef,
) {
    let out = unsafe { &*(refcon as *const Mutex<Out>) };
    let mut out = out.lock().unwrap_or_else(|e| e.into_inner());
    if status != 0 || sample.is_null() || flags & DROPPED != 0 {
        out.error
            .get_or_insert(format!("the encoder answered {status} (flags {flags})"));
        return;
    }
    unsafe {
        let data = CMSampleBufferGetDataBuffer(sample);
        let len = CMBlockBufferGetDataLength(data);
        let mut bytes = vec![0u8; len];
        CMBlockBufferCopyDataBytes(data, 0, len, bytes.as_mut_ptr() as *mut c_void);
        let mut key = true;
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, false);
        if !attachments.is_null() && CFArrayGetCount(attachments) > 0 {
            let a = CFArrayGetValueAtIndex(attachments, 0);
            let not_sync = CFDictionaryGetValue(a, kCMSampleAttachmentKey_NotSync);
            key = not_sync.is_null() || !CFBooleanGetValue(not_sync);
        }
        if out.config.is_none() {
            let fd = CMSampleBufferGetFormatDescription(sample);
            let atoms = CMFormatDescriptionGetExtension(
                fd,
                kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms,
            );
            for name in ["avcC", "hvcC"] {
                let k = cfstr(name);
                let d = match atoms.is_null() {
                    true => null(),
                    false => CFDictionaryGetValue(atoms, k.0),
                };
                if !d.is_null() {
                    let p = CFDataGetBytePtr(d);
                    out.config =
                        Some(std::slice::from_raw_parts(p, CFDataGetLength(d) as usize).to_vec());
                }
            }
        }
        out.coded.push_back(Coded { bytes, key });
    }
}

/// What a finished session leaves: the codec configuration box's body (`avcC`, `hvcC`) and
/// whether it ran on the hardware.
pub struct Finished {
    pub config: Option<Vec<u8>>,
    pub hardware: bool,
}

/// A coded sample's sink: it takes each one in decode order.
type Sink<'a> = Box<dyn FnMut(Coded) -> Result<(), String> + 'a>;

/// An open session.
pub struct Encoder<'a> {
    session: Cf,
    pool: CFTypeRef,
    out: Box<Mutex<Out>>,
    sink: Sink<'a>,
    size: [usize; 2],
    bgra: bool,
    timescale: i32,
    force: Cf,
}

impl<'a> Encoder<'a> {
    /// A session for `s`, its every property set, each coded sample going to `sink`. A property
    /// the encoder refuses fails it, naming the property.
    pub fn open(
        s: &Settings,
        sink: impl FnMut(Coded) -> Result<(), String> + 'a,
    ) -> Result<Encoder<'a>, String> {
        let out = Box::new(Mutex::new(Out::default()));
        let (w, h) = (s.size[0] as i32, s.size[1] as i32);
        let format = i32_number(fourcc(&s.pixel_format()) as i32);
        let (width, height) = (i32_number(w), i32_number(h));
        let mut enc = unsafe {
            let attrs = dict(&[
                (kCVPixelBufferPixelFormatTypeKey, format.0),
                (kCVPixelBufferWidthKey, width.0),
                (kCVPixelBufferHeightKey, height.0),
            ]);
            let mut session: CFTypeRef = null();
            let st = VTCompressionSessionCreate(
                null(),
                w,
                h,
                fourcc(&s.codec.fourcc()),
                null(),
                attrs.0,
                null(),
                on_sample,
                &*out as *const Mutex<Out> as *mut c_void,
                &mut session,
            );
            if st != 0 {
                return Err(format!("VTCompressionSessionCreate: {st}"));
            }
            Encoder {
                session: Cf(session),
                pool: null(),
                out,
                sink: Box::new(sink),
                size: [w as usize, h as usize],
                bgra: s.codec == Codec::ProRes4444,
                timescale: s.timescale as i32,
                force: dict(&[(kVTEncodeFrameOptionKey_ForceKeyFrame, kCFBooleanTrue)]),
            }
        };
        unsafe {
            let primaries = match s.colr.primaries {
                6 => kCVImageBufferColorPrimaries_SMPTE_C,
                _ => kCVImageBufferColorPrimaries_ITU_R_709_2,
            };
            let matrix = match s.colr.matrix {
                6 => kCVImageBufferYCbCrMatrix_ITU_R_601_4,
                _ => kCVImageBufferYCbCrMatrix_ITU_R_709_2,
            };
            // The values made here live until every property is set.
            let fps = f64_number(s.rate[0] as f64 / s.rate[1].max(1) as f64);
            let quality = s.quality.map(f64_number);
            let bitrate = s.bitrate.map(|b| i32_number(b as i32));
            let (bytes, second) = (s.bitrate.map(|b| i32_number(b as i32 / 8)), f64_number(1.0));
            let limits = bytes.as_ref().map(|b| {
                let pair = [b.0, second.0];
                Cf(CFArrayCreate(
                    null(),
                    pair.as_ptr(),
                    2,
                    &kCFTypeArrayCallBacks,
                ))
            });
            let keys = s.key_interval.map(|n| i32_number(n.max(1) as i32));
            let mut props = vec![
                (
                    "ColorPrimaries",
                    kVTCompressionPropertyKey_ColorPrimaries,
                    primaries,
                ),
                (
                    "TransferFunction",
                    kVTCompressionPropertyKey_TransferFunction,
                    kCVImageBufferTransferFunction_ITU_R_709_2,
                ),
                ("YCbCrMatrix", kVTCompressionPropertyKey_YCbCrMatrix, matrix),
            ];
            if s.codec == Codec::ProRes4444 {
                props.push((
                    "AlphaChannelMode",
                    kVTCompressionPropertyKey_AlphaChannelMode,
                    kVTAlphaChannelMode_StraightAlpha,
                ));
            } else {
                props.extend([
                    (
                        "AllowFrameReordering",
                        kVTCompressionPropertyKey_AllowFrameReordering,
                        kCFBooleanFalse,
                    ),
                    // Real time, so the hardware encoder's choices don't follow its load: equal
                    // frames give equal bytes while other sessions run (not so when false).
                    (
                        "RealTime",
                        kVTCompressionPropertyKey_RealTime,
                        kCFBooleanTrue,
                    ),
                    (
                        "ExpectedFrameRate",
                        kVTCompressionPropertyKey_ExpectedFrameRate,
                        fps.0,
                    ),
                ]);
                let optional = [
                    ("Quality", kVTCompressionPropertyKey_Quality, &quality),
                    (
                        "AverageBitRate",
                        kVTCompressionPropertyKey_AverageBitRate,
                        &bitrate,
                    ),
                    (
                        "DataRateLimits",
                        kVTCompressionPropertyKey_DataRateLimits,
                        &limits,
                    ),
                    (
                        "MaxKeyFrameInterval",
                        kVTCompressionPropertyKey_MaxKeyFrameInterval,
                        &keys,
                    ),
                ];
                for (name, key, value) in optional {
                    if let Some(v) = value {
                        props.push((name, key, v.0));
                    }
                }
            }
            for (name, key, value) in props {
                let st = VTSessionSetProperty(enc.session.0, key, value);
                if st != 0 {
                    return Err(format!("the encoder refused {name}: {st}"));
                }
            }
            enc.pool = VTCompressionSessionGetPixelBufferPool(enc.session.0);
        }
        if enc.pool.is_null() {
            return Err("the encoder gave no pixel buffer pool".into());
        }
        Ok(enc)
    }

    /// Encodes one frame presented at `pts` ticks, a key frame when `key`; the samples the
    /// encoder has given by then go to the sink.
    pub fn push(&mut self, frame: &[u8], pts: i64, key: bool) -> Result<(), String> {
        let [w, h] = self.size;
        let planes: &[(usize, usize)] = match self.bgra {
            true => &[(w * 4, h)],
            false => &[(w, h), (w, h / 2)],
        };
        let bytes: usize = planes.iter().map(|(row, rows)| row * rows).sum();
        if frame.len() != bytes {
            return Err(format!("a frame of {} bytes, not {bytes}", frame.len()));
        }
        unsafe {
            let mut pb: CFTypeRef = null();
            let st = CVPixelBufferPoolCreatePixelBuffer(null(), self.pool, &mut pb);
            if st != 0 {
                return Err(format!("CVPixelBufferPoolCreatePixelBuffer: {st}"));
            }
            let pb = Cf(pb);
            CVPixelBufferLockBaseAddress(pb.0, 0);
            let mut at = 0;
            for (p, (row, rows)) in planes.iter().enumerate() {
                let (base, stride) = match self.bgra {
                    true => (
                        CVPixelBufferGetBaseAddress(pb.0) as *mut u8,
                        CVPixelBufferGetBytesPerRow(pb.0),
                    ),
                    false => (
                        CVPixelBufferGetBaseAddressOfPlane(pb.0, p) as *mut u8,
                        CVPixelBufferGetBytesPerRowOfPlane(pb.0, p),
                    ),
                };
                for y in 0..*rows {
                    let src = &frame[at..at + row];
                    std::ptr::copy_nonoverlapping(src.as_ptr(), base.add(y * stride), *row);
                    at += row;
                }
            }
            CVPixelBufferUnlockBaseAddress(pb.0, 0);
            let t = CMTime {
                value: pts,
                timescale: self.timescale,
                flags: VALID,
                epoch: 0,
            };
            let props = if key { self.force.0 } else { null() };
            let st = VTCompressionSessionEncodeFrame(
                self.session.0,
                pb.0,
                t,
                INVALID,
                props,
                null_mut(),
                null_mut(),
            );
            if st != 0 {
                return Err(format!("VTCompressionSessionEncodeFrame: {st}"));
            }
        }
        self.drain()
    }

    /// Hands every sample given so far to the sink, or the encoder's error.
    fn drain(&mut self) -> Result<(), String> {
        loop {
            let next = {
                let mut out = self.out.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(e) = out.error.take() {
                    return Err(e);
                }
                out.coded.pop_front()
            };
            match next {
                Some(c) => (self.sink)(c)?,
                None => return Ok(()),
            }
        }
    }

    /// Waits for every frame pushed, hands the rest to the sink and closes the session.
    pub fn finish(mut self) -> Result<Finished, String> {
        let st = unsafe { VTCompressionSessionCompleteFrames(self.session.0, INVALID) };
        if st != 0 {
            return Err(format!("VTCompressionSessionCompleteFrames: {st}"));
        }
        self.drain()?;
        let hardware = unsafe {
            let mut hw: CFTypeRef = null();
            VTSessionCopyProperty(
                self.session.0,
                kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder,
                null(),
                &mut hw,
            );
            let on = !hw.is_null() && CFBooleanGetValue(hw);
            if !hw.is_null() {
                CFRelease(hw);
            }
            on
        };
        let config = (self.out.lock().unwrap_or_else(|e| e.into_inner()).config).take();
        Ok(Finished { config, hardware })
    }
}

impl Drop for Encoder<'_> {
    /// The session stops before the sample queue its callback writes to is freed.
    fn drop(&mut self) {
        unsafe { VTCompressionSessionInvalidate(self.session.0) };
    }
}

fn f64_number(v: f64) -> Cf {
    Cf(unsafe { CFNumberCreate(null(), 6, &v as *const f64 as *const c_void) })
}

/// I420 planes (Y, then Cb, then Cr) as NV12: the Y plane, then Cb and Cr interleaved.
fn nv12_of_i420(planes: &[u8], w: usize, h: usize) -> Vec<u8> {
    let (y, chroma) = planes.split_at(w * h);
    let (cb, cr) = chroma.split_at(chroma.len() / 2);
    let mut out = y.to_vec();
    out.extend(cb.iter().zip(cr).flat_map(|(b, r)| [*b, *r]));
    out
}

/// What the platform's H.264 encoder made of `frames` (I420, `w` × `h`, presented at `pts` ticks
/// of `timescale`), a key frame every `gop` when given: each frame, the stream's `avcC`, and
/// whether it ran on the hardware. The legacy `encode` op's, through the streaming encoder.
pub fn encode_h264(
    frames: &[Vec<u8>],
    w: usize,
    h: usize,
    pts: &[i64],
    timescale: i32,
    gop: Option<u32>,
) -> Result<(Vec<Coded>, Vec<u8>, bool), String> {
    let step = pts.windows(2).next().map_or(1, |p| p[1] - p[0]).max(1);
    let settings = Settings {
        codec: Codec::H264,
        size: [w as u32, h as u32],
        rate: [timescale as u32, step as u32],
        timescale: timescale as u32,
        quality: None,
        bitrate: None,
        key_interval: gop,
        colr: Colr {
            primaries: 1,
            transfer: 1,
            matrix: 1,
            full_range: Some(false),
            ..Colr::default()
        },
    };
    let mut coded = Vec::new();
    let mut enc = Encoder::open(&settings, |c| {
        coded.push(c);
        Ok(())
    })?;
    for (i, planes) in frames.iter().enumerate() {
        let key = gop.is_some_and(|g| (i as u32).is_multiple_of(g.max(1)));
        enc.push(&nv12_of_i420(planes, w, h), pts[i], key)?;
    }
    let done = enc.finish()?;
    Ok((
        coded,
        done.config.ok_or("the encoder gave no avcC")?,
        done.hardware,
    ))
}
