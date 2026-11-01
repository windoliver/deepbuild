//! The codecs seam's macOS backend: the platform's own decoders and encoder through VideoToolbox,
//! CoreMedia and AudioToolbox. Video decodes to 8-bit 4:2:0 planes (I420), AAC to f32, and the
//! encode tool's H.264 frames come out of the platform's encoder, which reports whether it ran on
//! the hardware.

#![allow(non_upper_case_globals, non_snake_case, clippy::upper_case_acronyms)]

use std::ffi::c_void;
use std::ptr::null;
use std::ptr::null_mut;

type CFTypeRef = *const c_void;
type OSStatus = i32;

#[repr(C)]
#[derive(Clone, Copy)]
struct CMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}

const VALID: u32 = 1;
const INVALID: CMTime = CMTime {
    value: 0,
    timescale: 0,
    flags: 0,
    epoch: 0,
};

#[repr(C)]
struct CMSampleTimingInfo {
    duration: CMTime,
    pts: CMTime,
    dts: CMTime,
}

#[repr(C)]
struct DecodeCallback {
    callback: extern "C" fn(*mut c_void, *mut c_void, OSStatus, u32, CFTypeRef, CMTime, CMTime),
    refcon: *mut c_void,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct ASBD {
    sample_rate: f64,
    format: u32,
    flags: u32,
    bytes_per_packet: u32,
    frames_per_packet: u32,
    bytes_per_frame: u32,
    channels: u32,
    bits: u32,
    reserved: u32,
}

#[repr(C)]
struct PacketDescription {
    start: i64,
    variable_frames: u32,
    size: u32,
}

#[repr(C)]
struct Buffer {
    channels: u32,
    size: u32,
    data: *mut c_void,
}

#[repr(C)]
struct BufferList {
    count: u32,
    buffers: [Buffer; 1],
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
    static kCFBooleanFalse: CFTypeRef;
    fn CFRelease(cf: CFTypeRef);
    fn CFDataCreate(a: CFTypeRef, bytes: *const u8, len: isize) -> CFTypeRef;
    fn CFDataGetLength(d: CFTypeRef) -> isize;
    fn CFDataGetBytePtr(d: CFTypeRef) -> *const u8;
    fn CFStringCreateWithCString(a: CFTypeRef, s: *const u8, enc: u32) -> CFTypeRef;
    fn CFNumberCreate(a: CFTypeRef, kind: isize, v: *const c_void) -> CFTypeRef;
    fn CFDictionaryCreate(
        a: CFTypeRef,
        keys: *const CFTypeRef,
        values: *const CFTypeRef,
        n: isize,
        kcb: *const c_void,
        vcb: *const c_void,
    ) -> CFTypeRef;
    fn CFDictionaryGetValue(d: CFTypeRef, k: CFTypeRef) -> CFTypeRef;
    fn CFArrayGetCount(a: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(a: CFTypeRef, i: isize) -> CFTypeRef;
    fn CFBooleanGetValue(b: CFTypeRef) -> bool;
}

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    static kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms: CFTypeRef;
    static kCMSampleAttachmentKey_NotSync: CFTypeRef;
    fn CMVideoFormatDescriptionCreate(
        a: CFTypeRef,
        codec: u32,
        w: i32,
        h: i32,
        ext: CFTypeRef,
        out: *mut CFTypeRef,
    ) -> OSStatus;
    fn CMBlockBufferCreateWithMemoryBlock(
        a: CFTypeRef,
        block: *mut c_void,
        len: usize,
        block_alloc: CFTypeRef,
        source: *const c_void,
        offset: usize,
        data_len: usize,
        flags: u32,
        out: *mut CFTypeRef,
    ) -> OSStatus;
    fn CMBlockBufferReplaceDataBytes(
        src: *const c_void,
        b: CFTypeRef,
        off: usize,
        len: usize,
    ) -> OSStatus;
    fn CMBlockBufferGetDataLength(b: CFTypeRef) -> usize;
    fn CMBlockBufferCopyDataBytes(
        b: CFTypeRef,
        off: usize,
        len: usize,
        dst: *mut c_void,
    ) -> OSStatus;
    fn CMSampleBufferCreateReady(
        a: CFTypeRef,
        data: CFTypeRef,
        fd: CFTypeRef,
        n: isize,
        nt: isize,
        timing: *const CMSampleTimingInfo,
        ns: isize,
        sizes: *const usize,
        out: *mut CFTypeRef,
    ) -> OSStatus;
    fn CMSampleBufferGetDataBuffer(s: CFTypeRef) -> CFTypeRef;
    fn CMSampleBufferGetFormatDescription(s: CFTypeRef) -> CFTypeRef;
    fn CMSampleBufferGetSampleAttachmentsArray(s: CFTypeRef, create: bool) -> CFTypeRef;
    fn CMFormatDescriptionGetExtension(fd: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
}

#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    static kCVPixelBufferPixelFormatTypeKey: CFTypeRef;
    fn CVPixelBufferLockBaseAddress(p: CFTypeRef, flags: u64) -> i32;
    fn CVPixelBufferUnlockBaseAddress(p: CFTypeRef, flags: u64) -> i32;
    fn CVPixelBufferGetPlaneCount(p: CFTypeRef) -> usize;
    fn CVPixelBufferGetBaseAddressOfPlane(p: CFTypeRef, i: usize) -> *const u8;
    fn CVPixelBufferGetBytesPerRowOfPlane(p: CFTypeRef, i: usize) -> usize;
    fn CVPixelBufferGetWidthOfPlane(p: CFTypeRef, i: usize) -> usize;
    fn CVPixelBufferGetHeightOfPlane(p: CFTypeRef, i: usize) -> usize;
    fn CVPixelBufferGetWidth(p: CFTypeRef) -> usize;
    fn CVPixelBufferGetHeight(p: CFTypeRef) -> usize;
    fn CVPixelBufferCreate(
        a: CFTypeRef,
        w: usize,
        h: usize,
        format: u32,
        attrs: CFTypeRef,
        out: *mut CFTypeRef,
    ) -> i32;
}

#[link(name = "VideoToolbox", kind = "framework")]
extern "C" {
    static kVTCompressionPropertyKey_AllowFrameReordering: CFTypeRef;
    static kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder: CFTypeRef;
    fn VTDecompressionSessionCreate(
        a: CFTypeRef,
        fd: CFTypeRef,
        spec: CFTypeRef,
        attrs: CFTypeRef,
        cb: *const DecodeCallback,
        out: *mut CFTypeRef,
    ) -> OSStatus;
    fn VTDecompressionSessionDecodeFrame(
        s: CFTypeRef,
        sample: CFTypeRef,
        flags: u32,
        refcon: *mut c_void,
        info: *mut u32,
    ) -> OSStatus;
    fn VTDecompressionSessionWaitForAsynchronousFrames(s: CFTypeRef) -> OSStatus;
    fn VTDecompressionSessionInvalidate(s: CFTypeRef);
    fn VTCompressionSessionCreate(
        a: CFTypeRef,
        w: i32,
        h: i32,
        codec: u32,
        spec: CFTypeRef,
        attrs: CFTypeRef,
        data_alloc: CFTypeRef,
        cb: extern "C" fn(*mut c_void, *mut c_void, OSStatus, u32, CFTypeRef),
        refcon: *mut c_void,
        out: *mut CFTypeRef,
    ) -> OSStatus;
    fn VTSessionSetProperty(s: CFTypeRef, key: CFTypeRef, value: CFTypeRef) -> OSStatus;
    fn VTSessionCopyProperty(
        s: CFTypeRef,
        key: CFTypeRef,
        a: CFTypeRef,
        out: *mut CFTypeRef,
    ) -> OSStatus;
    fn VTCompressionSessionEncodeFrame(
        s: CFTypeRef,
        image: CFTypeRef,
        pts: CMTime,
        duration: CMTime,
        props: CFTypeRef,
        refcon: *mut c_void,
        info: *mut u32,
    ) -> OSStatus;
    fn VTCompressionSessionCompleteFrames(s: CFTypeRef, until: CMTime) -> OSStatus;
    fn VTCompressionSessionInvalidate(s: CFTypeRef);
}

#[link(name = "AudioToolbox", kind = "framework")]
extern "C" {
    fn AudioConverterNew(from: *const ASBD, to: *const ASBD, out: *mut *mut c_void) -> OSStatus;
    fn AudioConverterSetProperty(
        c: *mut c_void,
        id: u32,
        size: u32,
        data: *const c_void,
    ) -> OSStatus;
    fn AudioConverterFillComplexBuffer(
        c: *mut c_void,
        input: extern "C" fn(
            *mut c_void,
            *mut u32,
            *mut BufferList,
            *mut *mut PacketDescription,
            *mut c_void,
        ) -> OSStatus,
        user: *mut c_void,
        packets: *mut u32,
        out: *mut BufferList,
        descs: *mut PacketDescription,
    ) -> OSStatus;
    fn AudioConverterDispose(c: *mut c_void) -> OSStatus;
}

const fn fourcc(s: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*s)
}

/// A CFString that releases itself.
struct Cf(CFTypeRef);

impl Drop for Cf {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}

fn cfstr(s: &str) -> Cf {
    let c = format!("{s}\0");
    Cf(unsafe { CFStringCreateWithCString(null(), c.as_ptr(), 0x0800_0100) })
}

fn dict(pairs: &[(CFTypeRef, CFTypeRef)]) -> Cf {
    let keys: Vec<CFTypeRef> = pairs.iter().map(|p| p.0).collect();
    let values: Vec<CFTypeRef> = pairs.iter().map(|p| p.1).collect();
    Cf(unsafe {
        CFDictionaryCreate(
            null(),
            keys.as_ptr(),
            values.as_ptr(),
            pairs.len() as isize,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks,
        )
    })
}

fn i32_number(v: i32) -> Cf {
    Cf(unsafe { CFNumberCreate(null(), 3, &v as *const i32 as *const c_void) })
}

/// A block buffer holding a copy of `bytes`.
fn block(bytes: &[u8]) -> Result<Cf, String> {
    let mut b: CFTypeRef = null();
    let st = unsafe {
        CMBlockBufferCreateWithMemoryBlock(
            null(),
            null_mut(),
            bytes.len(),
            null(),
            null(),
            0,
            bytes.len(),
            0,
            &mut b,
        )
    };
    if st != 0 {
        return Err(format!("CMBlockBufferCreateWithMemoryBlock: {st}"));
    }
    let b = Cf(b);
    let st = unsafe {
        CMBlockBufferReplaceDataBytes(bytes.as_ptr() as *const c_void, b.0, 0, bytes.len())
    };
    if st != 0 {
        return Err(format!("CMBlockBufferReplaceDataBytes: {st}"));
    }
    Ok(b)
}

/// One decoded picture: its sample index and its I420 planes.
pub struct Picture {
    pub sample: usize,
    pub width: usize,
    pub height: usize,
    pub planes: Vec<u8>,
}

struct Decoded {
    pictures: Vec<Picture>,
    error: Option<String>,
}

extern "C" fn on_picture(
    refcon: *mut c_void,
    frame: *mut c_void,
    status: OSStatus,
    _flags: u32,
    image: CFTypeRef,
    _pts: CMTime,
    _duration: CMTime,
) {
    let out = unsafe { &mut *(refcon as *mut Decoded) };
    if status != 0 || image.is_null() {
        out.error
            .get_or_insert(format!("the decoder answered {status}"));
        return;
    }
    unsafe {
        CVPixelBufferLockBaseAddress(image, 1);
        let (w, h) = (CVPixelBufferGetWidth(image), CVPixelBufferGetHeight(image));
        let mut planes = Vec::with_capacity(w * h * 3 / 2);
        for p in 0..CVPixelBufferGetPlaneCount(image) {
            let base = CVPixelBufferGetBaseAddressOfPlane(image, p);
            let stride = CVPixelBufferGetBytesPerRowOfPlane(image, p);
            let pw = CVPixelBufferGetWidthOfPlane(image, p);
            for row in 0..CVPixelBufferGetHeightOfPlane(image, p) {
                planes.extend_from_slice(std::slice::from_raw_parts(base.add(row * stride), pw));
            }
        }
        CVPixelBufferUnlockBaseAddress(image, 1);
        out.pictures.push(Picture {
            sample: frame as usize,
            width: w,
            height: h,
            planes,
        });
    }
}

/// Decodes `samples` (index, bytes), in decode order, of a stream whose sample entry is
/// `fourcc` with configuration box `config`, by the platform's decoder: each picture as I420.
pub fn decode_video(
    fourcc_: [u8; 4],
    config: &([u8; 4], Vec<u8>),
    size: (u16, u16),
    samples: &[(usize, Vec<u8>)],
) -> Result<Vec<Picture>, String> {
    let codec = match &fourcc_ {
        b"avc1" | b"avc3" => fourcc(b"avc1"),
        b"hvc1" | b"hev1" => fourcc(b"hvc1"),
        b"mp4v" => fourcc(b"mp4v"),
        other => return Err(format!("no decoder for {}", String::from_utf8_lossy(other))),
    };
    unsafe {
        let key = cfstr(std::str::from_utf8(&config.0).unwrap_or("avcC"));
        let data = Cf(CFDataCreate(
            null(),
            config.1.as_ptr(),
            config.1.len() as isize,
        ));
        let atoms = dict(&[(key.0, data.0)]);
        let ext = dict(&[(
            kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms,
            atoms.0,
        )]);
        let mut fd: CFTypeRef = null();
        let st = CMVideoFormatDescriptionCreate(
            null(),
            codec,
            size.0 as i32,
            size.1 as i32,
            ext.0,
            &mut fd,
        );
        if st != 0 {
            return Err(format!("CMVideoFormatDescriptionCreate: {st}"));
        }
        let fd = Cf(fd);
        let y420 = i32_number(fourcc(b"y420") as i32);
        let attrs = dict(&[(kCVPixelBufferPixelFormatTypeKey, y420.0)]);
        let mut out = Box::new(Decoded {
            pictures: Vec::new(),
            error: None,
        });
        let cb = DecodeCallback {
            callback: on_picture,
            refcon: &mut *out as *mut Decoded as *mut c_void,
        };
        let mut session: CFTypeRef = null();
        let st = VTDecompressionSessionCreate(null(), fd.0, null(), attrs.0, &cb, &mut session);
        if st != 0 {
            return Err(format!("VTDecompressionSessionCreate: {st}"));
        }
        let session = Cf(session);
        for (index, bytes) in samples {
            let b = block(bytes)?;
            let mut sample: CFTypeRef = null();
            let size = bytes.len();
            let st =
                CMSampleBufferCreateReady(null(), b.0, fd.0, 1, 0, null(), 1, &size, &mut sample);
            if st != 0 {
                return Err(format!("CMSampleBufferCreateReady: {st}"));
            }
            let sample = Cf(sample);
            let mut info = 0u32;
            VTDecompressionSessionDecodeFrame(
                session.0,
                sample.0,
                0,
                *index as *mut c_void,
                &mut info,
            );
        }
        VTDecompressionSessionWaitForAsynchronousFrames(session.0);
        VTDecompressionSessionInvalidate(session.0);
        drop(session);
        if out.pictures.is_empty() {
            return Err(out
                .error
                .take()
                .unwrap_or_else(|| "no picture decoded".into()));
        }
        Ok(std::mem::take(&mut out.pictures))
    }
}

struct Feed<'a> {
    packets: &'a [Vec<u8>],
    next: usize,
    desc: PacketDescription,
}

extern "C" fn feed(
    _c: *mut c_void,
    n: *mut u32,
    list: *mut BufferList,
    descs: *mut *mut PacketDescription,
    user: *mut c_void,
) -> OSStatus {
    let f = unsafe { &mut *(user as *mut Feed) };
    unsafe {
        let Some(p) = f.packets.get(f.next) else {
            *n = 0;
            return 0;
        };
        f.next += 1;
        (*list).buffers[0].data = p.as_ptr() as *mut c_void;
        (*list).buffers[0].size = p.len() as u32;
        f.desc = PacketDescription {
            start: 0,
            variable_frames: 0,
            size: p.len() as u32,
        };
        if !descs.is_null() {
            *descs = &mut f.desc;
        }
        *n = 1;
    }
    0
}

/// Decodes AAC `packets` (the stream's `esds` body as its cookie) to interleaved f32, every
/// output sample kept: trimming priming is the caller's, by the edit list.
pub fn decode_aac(
    esds: &[u8],
    rate: u32,
    channels: u32,
    packets: &[Vec<u8>],
) -> Result<Vec<f32>, String> {
    let from = ASBD {
        sample_rate: rate as f64,
        format: fourcc(b"aac "),
        frames_per_packet: 1024,
        channels,
        ..ASBD::default()
    };
    let to = ASBD {
        sample_rate: rate as f64,
        format: fourcc(b"lpcm"),
        flags: 1 | 8,
        bytes_per_packet: 4 * channels,
        frames_per_packet: 1,
        bytes_per_frame: 4 * channels,
        channels,
        bits: 32,
        reserved: 0,
    };
    unsafe {
        let mut conv: *mut c_void = null_mut();
        let st = AudioConverterNew(&from, &to, &mut conv);
        if st != 0 {
            return Err(format!("AudioConverterNew: {st}"));
        }
        let cookie = esds.get(4..).unwrap_or_default();
        AudioConverterSetProperty(
            conv,
            fourcc(b"dmgc"),
            cookie.len() as u32,
            cookie.as_ptr() as *const c_void,
        );
        let mut f = Feed {
            packets,
            next: 0,
            desc: PacketDescription {
                start: 0,
                variable_frames: 0,
                size: 0,
            },
        };
        let mut out = Vec::new();
        let mut chunk = vec![0f32; 4096 * channels as usize];
        loop {
            let mut frames = 4096u32;
            let mut list = BufferList {
                count: 1,
                buffers: [Buffer {
                    channels,
                    size: (chunk.len() * 4) as u32,
                    data: chunk.as_mut_ptr() as *mut c_void,
                }],
            };
            let st = AudioConverterFillComplexBuffer(
                conv,
                feed,
                &mut f as *mut Feed as *mut c_void,
                &mut frames,
                &mut list,
                null_mut(),
            );
            out.extend_from_slice(&chunk[..frames as usize * channels as usize]);
            if st != 0 || frames == 0 {
                break;
            }
        }
        AudioConverterDispose(conv);
        Ok(out)
    }
}

/// One encoded frame: its bytes in AVCC form and whether it is a sync sample.
pub struct Coded {
    pub bytes: Vec<u8>,
    pub key: bool,
}

struct Encoded {
    frames: Vec<Coded>,
    avcc: Option<Vec<u8>>,
    error: Option<String>,
}

extern "C" fn on_coded(
    refcon: *mut c_void,
    _frame: *mut c_void,
    status: OSStatus,
    _flags: u32,
    sample: CFTypeRef,
) {
    let out = unsafe { &mut *(refcon as *mut Encoded) };
    if status != 0 || sample.is_null() {
        out.error
            .get_or_insert(format!("the encoder answered {status}"));
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
        if out.avcc.is_none() {
            let fd = CMSampleBufferGetFormatDescription(sample);
            let atoms = CMFormatDescriptionGetExtension(
                fd,
                kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms,
            );
            let k = cfstr("avcC");
            if !atoms.is_null() {
                let d = CFDictionaryGetValue(atoms, k.0);
                if !d.is_null() {
                    let p = CFDataGetBytePtr(d);
                    out.avcc =
                        Some(std::slice::from_raw_parts(p, CFDataGetLength(d) as usize).to_vec());
                }
            }
        }
        out.frames.push(Coded { bytes, key });
    }
}

/// What the platform's H.264 encoder made of `frames` (I420, `w` × `h`, presented at `pts` ticks
/// of `timescale`): each frame, the stream's `avcC`, and whether it ran on the hardware.
pub fn encode_h264(
    frames: &[Vec<u8>],
    w: usize,
    h: usize,
    pts: &[i64],
    timescale: i32,
) -> Result<(Vec<Coded>, Vec<u8>, bool), String> {
    unsafe {
        let mut out = Box::new(Encoded {
            frames: Vec::new(),
            avcc: None,
            error: None,
        });
        let mut session: CFTypeRef = null();
        let st = VTCompressionSessionCreate(
            null(),
            w as i32,
            h as i32,
            fourcc(b"avc1"),
            null(),
            null(),
            null(),
            on_coded,
            &mut *out as *mut Encoded as *mut c_void,
            &mut session,
        );
        if st != 0 {
            return Err(format!("VTCompressionSessionCreate: {st}"));
        }
        let session = Cf(session);
        VTSessionSetProperty(
            session.0,
            kVTCompressionPropertyKey_AllowFrameReordering,
            kCFBooleanFalse,
        );
        for (i, planes) in frames.iter().enumerate() {
            let mut pb: CFTypeRef = null();
            if CVPixelBufferCreate(null(), w, h, fourcc(b"y420"), null(), &mut pb) != 0 {
                return Err("CVPixelBufferCreate failed".into());
            }
            let pb = Cf(pb);
            CVPixelBufferLockBaseAddress(pb.0, 0);
            let mut at = 0usize;
            for p in 0..CVPixelBufferGetPlaneCount(pb.0) {
                let base = CVPixelBufferGetBaseAddressOfPlane(pb.0, p) as *mut u8;
                let stride = CVPixelBufferGetBytesPerRowOfPlane(pb.0, p);
                let pw = CVPixelBufferGetWidthOfPlane(pb.0, p);
                for row in 0..CVPixelBufferGetHeightOfPlane(pb.0, p) {
                    let src = &planes[at..at + pw];
                    std::ptr::copy_nonoverlapping(src.as_ptr(), base.add(row * stride), pw);
                    at += pw;
                }
            }
            CVPixelBufferUnlockBaseAddress(pb.0, 0);
            let t = CMTime {
                value: pts[i],
                timescale,
                flags: VALID,
                epoch: 0,
            };
            let st = VTCompressionSessionEncodeFrame(
                session.0,
                pb.0,
                t,
                INVALID,
                null(),
                null_mut(),
                null_mut(),
            );
            if st != 0 {
                return Err(format!("VTCompressionSessionEncodeFrame: {st}"));
            }
        }
        VTCompressionSessionCompleteFrames(session.0, INVALID);
        let mut hw: CFTypeRef = null();
        VTSessionCopyProperty(
            session.0,
            kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder,
            null(),
            &mut hw,
        );
        let hardware = !hw.is_null() && CFBooleanGetValue(hw);
        if !hw.is_null() {
            CFRelease(hw);
        }
        VTCompressionSessionInvalidate(session.0);
        if let Some(e) = out.error.take() {
            return Err(e);
        }
        let avcc = out.avcc.take().ok_or("the encoder gave no avcC")?;
        Ok((std::mem::take(&mut out.frames), avcc, hardware))
    }
}

/// This Mac's macOS version, which names the platform's codecs.
pub fn os_version() -> String {
    let mut buf = [0u8; 64];
    let mut len = buf.len();
    let name = b"kern.osproductversion\0";
    let st = unsafe {
        libc::sysctlbyname(
            name.as_ptr() as *const libc::c_char,
            buf.as_mut_ptr() as *mut c_void,
            &mut len,
            null_mut(),
            0,
        )
    };
    if st != 0 {
        return "unknown".into();
    }
    String::from_utf8_lossy(&buf[..len.saturating_sub(1)]).into_owned()
}

/// Enters the worker's sandbox: no network and no camera or microphone, for the rest of the
/// process's life.
pub fn sandbox() -> Result<(), String> {
    extern "C" {
        fn sandbox_init(
            profile: *const libc::c_char,
            flags: u64,
            err: *mut *mut libc::c_char,
        ) -> i32;
    }
    let profile = b"(version 1)\n(allow default)\n(deny network*)\n(deny device-camera)\n(deny device-microphone)\n\0";
    let mut err: *mut libc::c_char = null_mut();
    let st = unsafe { sandbox_init(profile.as_ptr() as *const libc::c_char, 0, &mut err) };
    if st != 0 {
        let why = if err.is_null() {
            String::new()
        } else {
            unsafe { std::ffi::CStr::from_ptr(err) }
                .to_string_lossy()
                .into_owned()
        };
        return Err(format!("sandbox_init: {why}"));
    }
    Ok(())
}
