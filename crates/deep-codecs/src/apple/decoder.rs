//! #157: the stream op's decoder. One VideoToolbox session is fed samples in decode order with
//! asynchronous decompression, at most `DEPTH` in flight, and each picture is kept as the decoder
//! gave it: in its own pixel format ('420v', '420f'), or 'y416' for ProRes 4444, never converted.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use super::*;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
}

/// kVTDecodeFrame_EnableAsynchronousDecompression and kVTDecodeInfo_FrameDropped.
const ASYNC: u32 = 1;
const DROPPED: u32 = 1 << 1;
/// Samples in flight at once.
const DEPTH: usize = 16;

/// A decoded picture, held until dropped.
pub struct Image(CFTypeRef);

unsafe impl Send for Image {}

impl Drop for Image {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}

impl Image {
    /// Its pixel format's four characters.
    pub fn format(&self) -> [u8; 4] {
        unsafe { CVPixelBufferGetPixelFormatType(self.0) }.to_be_bytes()
    }

    pub fn size(&self) -> (usize, usize) {
        unsafe {
            (
                CVPixelBufferGetWidth(self.0),
                CVPixelBufferGetHeight(self.0),
            )
        }
    }

    /// Its memory, locked for reading until the guard drops.
    pub fn lock(&self) -> Locked<'_> {
        unsafe {
            CVPixelBufferLockBaseAddress(self.0, 1);
            let planes = match CVPixelBufferGetPlaneCount(self.0) {
                0 => vec![(
                    CVPixelBufferGetBaseAddress(self.0),
                    CVPixelBufferGetBytesPerRow(self.0),
                )],
                n => (0..n)
                    .map(|p| {
                        (
                            CVPixelBufferGetBaseAddressOfPlane(self.0, p),
                            CVPixelBufferGetBytesPerRowOfPlane(self.0, p),
                        )
                    })
                    .collect(),
            };
            Locked {
                image: self,
                planes,
            }
        }
    }
}

/// A picture's planes while locked: each plane's base and bytes per row.
pub struct Locked<'a> {
    image: &'a Image,
    planes: Vec<(*const u8, usize)>,
}

impl Locked<'_> {
    /// The first `len` bytes of row `y` of `plane`.
    pub fn row(&self, plane: usize, y: usize, len: usize) -> &[u8] {
        let (base, stride) = self.planes[plane];
        assert!(
            len <= stride,
            "a row of {len} bytes in a stride of {stride}"
        );
        unsafe { std::slice::from_raw_parts(base.add(y * stride), len) }
    }
}

impl Drop for Locked<'_> {
    fn drop(&mut self) {
        unsafe { CVPixelBufferUnlockBaseAddress(self.image.0, 1) };
    }
}

/// A sample's picture or why it has none.
pub type Output = (usize, Result<Image, String>);

#[derive(Default)]
struct Shared {
    done: VecDeque<Output>,
    flying: usize,
}

type Slot = (Mutex<Shared>, Condvar);

extern "C" fn on_image(
    refcon: *mut c_void,
    frame: *mut c_void,
    status: OSStatus,
    flags: u32,
    image: CFTypeRef,
    _pts: CMTime,
    _duration: CMTime,
) {
    let slot = unsafe { &*(refcon as *const Slot) };
    let got = match (status, flags & DROPPED != 0 || image.is_null()) {
        (0, false) => Ok(Image(unsafe { CFRetain(image) })),
        (0, true) => Err("the decoder dropped it".to_string()),
        (st, _) => Err(format!("the decoder answered {st}")),
    };
    let mut shared = slot.0.lock().unwrap_or_else(|e| e.into_inner());
    shared.done.push_back((frame as usize, got));
    shared.flying = shared.flying.saturating_sub(1);
    slot.1.notify_all();
}

/// An open session.
pub struct Decoder {
    session: Cf,
    fd: Cf,
    slot: Box<Slot>,
}

impl Decoder {
    /// A session for a track whose sample entry is `fourcc` with configuration box `config`:
    /// H.264 and HEVC in the decoder's own format, ProRes 4444 ('ap4h') as 'y416'.
    pub fn open(
        fourcc_: [u8; 4],
        config: Option<&([u8; 4], Vec<u8>)>,
        size: (u16, u16),
    ) -> Result<Decoder, String> {
        let codec = match &fourcc_ {
            b"avc1" | b"avc3" => fourcc(b"avc1"),
            b"hvc1" | b"hev1" => fourcc(b"hvc1"),
            b"ap4h" => fourcc(b"ap4h"),
            other => return Err(format!("no decoder for {}", String::from_utf8_lossy(other))),
        };
        unsafe {
            let ext = config.map(|(kind, body)| {
                let key = cfstr(std::str::from_utf8(kind).unwrap_or("avcC"));
                let data = Cf(CFDataCreate(null(), body.as_ptr(), body.len() as isize));
                let atoms = dict(&[(key.0, data.0)]);
                dict(&[(
                    kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms,
                    atoms.0,
                )])
            });
            let mut fd: CFTypeRef = null();
            let st = CMVideoFormatDescriptionCreate(
                null(),
                codec,
                size.0 as i32,
                size.1 as i32,
                ext.as_ref().map_or(null(), |e| e.0),
                &mut fd,
            );
            if st != 0 {
                return Err(format!("CMVideoFormatDescriptionCreate: {st}"));
            }
            let fd = Cf(fd);
            let y416 = i32_number(fourcc(b"y416") as i32);
            let attrs = (codec == fourcc(b"ap4h"))
                .then(|| dict(&[(kCVPixelBufferPixelFormatTypeKey, y416.0)]));
            let slot: Box<Slot> = Box::default();
            let cb = DecodeCallback {
                callback: on_image,
                refcon: &*slot as *const Slot as *mut c_void,
            };
            let mut session: CFTypeRef = null();
            let st = VTDecompressionSessionCreate(
                null(),
                fd.0,
                null(),
                attrs.as_ref().map_or(null(), |a| a.0),
                &cb,
                &mut session,
            );
            if st != 0 {
                return Err(format!("VTDecompressionSessionCreate: {st}"));
            }
            Ok(Decoder {
                session: Cf(session),
                fd,
                slot,
            })
        }
    }

    /// Queues sample `index` (decode order) for decoding, once fewer than `DEPTH` are in flight.
    pub fn send(&mut self, index: usize, bytes: &[u8]) -> Result<(), String> {
        {
            let (lock, ready) = &*self.slot;
            let mut shared = lock.lock().unwrap_or_else(|e| e.into_inner());
            while shared.flying >= DEPTH {
                let (s, waited) = ready
                    .wait_timeout(shared, Duration::from_secs(1))
                    .unwrap_or_else(|e| e.into_inner());
                shared = s;
                // A decoder holding pictures back for reordering gives them up when asked.
                if waited.timed_out() {
                    drop(shared);
                    unsafe { VTDecompressionSessionWaitForAsynchronousFrames(self.session.0) };
                    shared = lock.lock().unwrap_or_else(|e| e.into_inner());
                }
            }
            shared.flying += 1;
        }
        unsafe {
            let b = block(bytes)?;
            let mut sample: CFTypeRef = null();
            let size = bytes.len();
            let st = CMSampleBufferCreateReady(
                null(),
                b.0,
                self.fd.0,
                1,
                0,
                null(),
                1,
                &size,
                &mut sample,
            );
            if st != 0 {
                return Err(format!("CMSampleBufferCreateReady: {st}"));
            }
            let sample = Cf(sample);
            let mut info = 0u32;
            let st = VTDecompressionSessionDecodeFrame(
                self.session.0,
                sample.0,
                ASYNC,
                index as *mut c_void,
                &mut info,
            );
            if st != 0 {
                return Err(format!("the decoder refused it: {st}"));
            }
            if info & DROPPED != 0 {
                return Err("the decoder dropped it".into());
            }
        }
        Ok(())
    }

    /// The pictures decoded since the last call, in the order they came.
    pub fn take(&mut self) -> Vec<Output> {
        let mut shared = self.slot.0.lock().unwrap_or_else(|e| e.into_inner());
        shared.done.drain(..).collect()
    }

    /// Waits for every sample sent; the pictures not yet taken.
    pub fn finish(&mut self) -> Vec<Output> {
        unsafe { VTDecompressionSessionWaitForAsynchronousFrames(self.session.0) };
        self.take()
    }
}

impl Drop for Decoder {
    /// The session stops before the slot its callback writes to is freed.
    fn drop(&mut self) {
        unsafe {
            VTDecompressionSessionWaitForAsynchronousFrames(self.session.0);
            VTDecompressionSessionInvalidate(self.session.0);
        }
    }
}
