//! Issue #499: a video image item in the live view (canvas primitives: Image `image@1`: video
//! frames). Its frames are decoded in a decode worker of their own, a copy of this binary
//! started as `decode-worker-live` and sandboxed, near the size the item is drawn, and handed
//! over a pipe into a pooled NV12 pixel buffer per player, rewritten frame after frame,
//! tagged with the probe's matrix and range so the live shader converts them by those. The frame
//! shown at t is a pure function of t, so an item that comes back into view seeks to it.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use objc2_core_foundation::{CFDictionary, CFRetained, CFString, CFType};
use objc2_core_video::{
    kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_2020,
    kCVImageBufferYCbCrMatrix_ITU_R_601_4, kCVImageBufferYCbCrMatrix_ITU_R_709_2,
    kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferMetalCompatibilityKey,
    kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, kCVReturnSuccess, CVAttachmentMode,
    CVPixelBuffer, CVPixelBufferCreate, CVPixelBufferGetBaseAddressOfPlane,
    CVPixelBufferGetBytesPerRowOfPlane, CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags,
    CVPixelBufferUnlockBaseAddress,
};

/// What a new frame shown was: its run time, document time, source frame and planes' hash.
#[derive(Clone)]
pub struct Shown {
    pub at_ms: f64,
    pub t: i64,
    pub frame: usize,
    pub planes: Option<String>,
}

/// The logs a run reports, sized up front so a frame that logs allocates nothing.
pub struct Log {
    pub shown: Vec<Shown>,
    pub decodes: Vec<(f64, usize)>,
}

pub struct Player {
    child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
    pub out: (usize, usize),
    /// Each frame's presentation time in the stream's ticks, and its timescale.
    pub pts: Vec<i64>,
    pub timescale: i64,
    /// The pooled buffer the frame on screen samples, rewritten in place for each new frame.
    buffer: CFRetained<CVPixelBuffer>,
    scratch: Vec<u8>,
    /// The source frame on screen.
    pub showing: Option<usize>,
    /// The frame asked of the worker and not yet read.
    pending: Option<usize>,
    pub log: Log,
    /// Whether the item meets the view, and its `frames` start, in and rate.
    pub visible: bool,
    pub timing: (i64, i64, (i64, i64)),
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// An NV12 pixel buffer backed by an IOSurface, with its matrix tagged.
fn pixel_buffer(
    w: usize,
    h: usize,
    full: bool,
    matrix: u32,
) -> Result<CFRetained<CVPixelBuffer>, String> {
    let empty = CFDictionary::<CFString, CFType>::from_slices(&[], &[]);
    let yes = objc2_core_foundation::CFBoolean::new(true);
    // SAFETY: the keys are CoreVideo's own statics.
    let (surface_key, metal_key) = unsafe {
        (
            kCVPixelBufferIOSurfacePropertiesKey,
            kCVPixelBufferMetalCompatibilityKey,
        )
    };
    let attrs = CFDictionary::<CFString, CFType>::from_slices(
        &[surface_key, metal_key],
        &[empty.as_ref(), yes.as_ref()],
    );
    let format = if full {
        kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
    } else {
        kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    };
    let mut out = std::ptr::null_mut();
    // SAFETY: the attributes are a CFString-keyed dictionary and `out` is a valid pointer.
    let status = unsafe {
        CVPixelBufferCreate(
            None,
            w,
            h,
            format,
            Some(attrs.as_opaque()),
            std::ptr::NonNull::from(&mut out),
        )
    };
    if status != kCVReturnSuccess {
        return Err(format!("CVPixelBufferCreate failed: {status}"));
    }
    let out = std::ptr::NonNull::new(out).ok_or("CVPixelBufferCreate returned null")?;
    // SAFETY: a Create function hands over one reference.
    let buffer: CFRetained<CVPixelBuffer> = unsafe { CFRetained::from_raw(out) };
    // SAFETY: CoreVideo's constants live for the process.
    let tag = unsafe {
        match matrix {
            1 => kCVImageBufferYCbCrMatrix_ITU_R_601_4,
            2 => kCVImageBufferYCbCrMatrix_ITU_R_2020,
            _ => kCVImageBufferYCbCrMatrix_ITU_R_709_2,
        }
    };
    // SAFETY: as above.
    unsafe {
        buffer.set_attachment(
            kCVImageBufferYCbCrMatrixKey,
            tag.as_ref(),
            CVAttachmentMode::ShouldPropagate,
        )
    };
    Ok(buffer)
}

impl Player {
    /// A player of the video file at `path`, decoding at `size` (0 × 0: the source's).
    pub fn start(path: &Path, size: (usize, usize)) -> Result<Player, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut child = Command::new(exe)
            .arg("decode-worker-live")
            .arg(path)
            .arg(size.0.to_string())
            .arg(size.1.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        let mut stdout = child.stdout.take().ok_or("no stdout")?;
        let mut head = [0u8; 4 + 24 + 8 + 4];
        let started = stdout.read_exact(&mut head).is_ok() && &head[..4] == deep_codecs::LIVE_MAGIC;
        if !started {
            let _ = stdin.write_all(&u32::MAX.to_le_bytes());
            let _ = child.kill();
            let _ = child.wait();
            return Err("the decode worker didn't open the video".into());
        }
        let out = (u32_at(&head, 12) as usize, u32_at(&head, 16) as usize);
        let (matrix, full) = (u32_at(&head, 20), u32_at(&head, 24) == 1);
        let timescale = i64::from_le_bytes(head[28..36].try_into().unwrap_or([0; 8]));
        let n = u32_at(&head, 36) as usize;
        let mut pts = vec![0u8; n * 8];
        stdout.read_exact(&mut pts).map_err(|e| e.to_string())?;
        let pts = pts
            .as_chunks::<8>()
            .0
            .iter()
            .map(|c| i64::from_le_bytes(*c))
            .collect();
        let buffer = pixel_buffer(out.0, out.1, full, matrix)?;
        Ok(Player {
            child,
            stdin,
            stdout,
            out,
            pts,
            timescale,
            buffer,
            scratch: vec![0; out.0 * out.1 * 3 / 2],
            showing: None,
            pending: None,
            visible: true,
            timing: (0, 0, (1, 1)),
            log: Log {
                shown: Vec::with_capacity(1 << 14),
                decodes: Vec::with_capacity(1 << 14),
            },
        })
    }

    /// The buffer on screen.
    pub fn surface(&self) -> &CFRetained<CVPixelBuffer> {
        &self.buffer
    }

    /// Asks the worker for source frame `k`, unless it is already asked for.
    fn ask(&mut self, k: usize, at_ms: f64) -> bool {
        if self.pending == Some(k) {
            return true;
        }
        if self.pending.is_some() && !self.answer() {
            return false;
        }
        if self.log.decodes.len() < self.log.decodes.capacity() {
            self.log.decodes.push((at_ms, k));
        }
        let asked = self.stdin.write_all(&(k as u32).to_le_bytes()).is_ok();
        self.pending = asked.then_some(k);
        asked
    }

    /// Reads the worker's answer to the frame asked for into `scratch`.
    fn answer(&mut self) -> bool {
        self.pending = None;
        let mut head = [0u8; 8];
        self.stdout.read_exact(&mut head).is_ok()
            && self.stdout.read_exact(&mut self.scratch).is_ok()
            && u32_at(&head, 4) == 1
    }

    /// Puts source frame `k` on screen, decoding it in the worker into the buffer on screen, and
    /// asks for the frame after it, so the worker decodes that while this one shows; false when
    /// it is already there or the worker failed. Allocates nothing.
    pub fn show(&mut self, k: usize, at_ms: f64) -> bool {
        if self.showing == Some(k) || k >= self.pts.len() {
            return false;
        }
        if !self.ask(k, at_ms) || !self.answer() {
            return false;
        }
        let (w, h) = self.out;
        let buffer = &self.buffer;
        // SAFETY: locked while the planes are written; each row's bytes lie inside its plane.
        unsafe {
            CVPixelBufferLockBaseAddress(buffer, CVPixelBufferLockFlags(0));
            let mut at = 0;
            for (plane, rows) in [(0usize, h), (1, h / 2)] {
                let base = CVPixelBufferGetBaseAddressOfPlane(buffer, plane) as *mut u8;
                let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, plane);
                for row in 0..rows {
                    std::ptr::copy_nonoverlapping(
                        self.scratch.as_ptr().add(at),
                        base.add(row * stride),
                        w,
                    );
                    at += w;
                }
            }
            CVPixelBufferUnlockBaseAddress(buffer, CVPixelBufferLockFlags(0));
        }
        self.showing = Some(k);
        // The next frame decodes in the worker meanwhile; `scratch` keeps this one until it's read.
        if k + 1 < self.pts.len() {
            self.ask(k + 1, at_ms);
        }
        true
    }

    /// The SHA-256 of the frame on screen's planes in I420 order (Y, then Cb, then Cr), as the
    /// decode worker's canonical decode names them.
    pub fn planes_hash(&self) -> String {
        let (w, h) = self.out;
        let y = w * h;
        let mut i420 = Vec::with_capacity(y * 3 / 2);
        i420.extend_from_slice(&self.scratch[..y]);
        let c = &self.scratch[y..];
        i420.extend(c.iter().step_by(2));
        i420.extend(c.iter().skip(1).step_by(2));
        deep_canvas_marks::key::sha256_hex(&i420)
    }

    /// The frame whose presentation interval holds source time `src` (flicks).
    pub fn frame_at(&self, src: i64) -> usize {
        deep_canvas_media::frames::frame_at(&self.pts, self.timescale, src)
    }

    /// The source time, in flicks, frame `k + 1` starts at, if there is one.
    pub fn next_start(&self, k: usize) -> Option<i64> {
        let p = *self.pts.get(k + 1)?;
        let f = (p as i128 * deep_canvas_media::FLICKS as i128 + self.timescale as i128 - 1)
            / self.timescale.max(1) as i128;
        Some(f as i64)
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        // A frame asked ahead is read first, or the worker blocks writing it and never quits.
        if self.pending.is_some() {
            self.answer();
        }
        let _ = self.stdin.write_all(&u32::MAX.to_le_bytes());
        let _ = self.child.wait();
    }
}

/// Whether the store's file for `sha` is a movie.
pub fn is_video(store: Option<&Path>, sha: &str) -> bool {
    let Some(path) = store.map(|s| s.join(sha)) else {
        return false;
    };
    let mut head = [0u8; 12];
    std::fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut head))
        .is_ok_and(|()| &head[4..8] == b"ftyp" || &head[4..8] == b"moov")
}
