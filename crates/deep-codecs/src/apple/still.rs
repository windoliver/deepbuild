//! #1488: a still picture in a format the draw code doesn't read (WebP, HEIC, a single-frame GIF,
//! TIFF, BMP …) decoded by the platform's image decoder (ImageIO), in the decode worker, to
//! straight RGBA in sRGB, its EXIF orientation applied by the caller. Its size and frame count are
//! read from its header first, so a picture past the caps is refused before anything is decoded.

use super::*;

type CGImageSourceRef = CFTypeRef;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFNumberGetValue(n: CFTypeRef, kind: isize, out: *mut c_void) -> bool;
    fn CFStringGetCString(s: CFTypeRef, buf: *mut u8, len: isize, enc: u32) -> bool;
}

#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    static kCGImagePropertyPixelWidth: CFTypeRef;
    static kCGImagePropertyPixelHeight: CFTypeRef;
    static kCGImagePropertyOrientation: CFTypeRef;
    fn CGImageSourceCreateWithData(data: CFTypeRef, options: CFTypeRef) -> CGImageSourceRef;
    fn CGImageSourceGetType(src: CGImageSourceRef) -> CFTypeRef;
    fn CGImageSourceGetCount(src: CGImageSourceRef) -> usize;
    fn CGImageSourceCopyPropertiesAtIndex(
        src: CGImageSourceRef,
        index: usize,
        options: CFTypeRef,
    ) -> CFTypeRef;
    fn CGImageSourceCreateImageAtIndex(
        src: CGImageSourceRef,
        index: usize,
        options: CFTypeRef,
    ) -> CFTypeRef;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    static kCGColorSpaceSRGB: CFTypeRef;
    fn CGColorSpaceCreateWithName(name: CFTypeRef) -> CFTypeRef;
    fn CGBitmapContextCreate(
        data: *mut c_void,
        w: usize,
        h: usize,
        bits: usize,
        row: usize,
        space: CFTypeRef,
        info: u32,
    ) -> CFTypeRef;
    fn CGContextDrawImage(ctx: CFTypeRef, rect: CGRect, image: CFTypeRef);
    fn CGImageGetWidth(image: CFTypeRef) -> usize;
    fn CGImageGetHeight(image: CFTypeRef) -> usize;
}

/// kCFNumberSInt64Type and kCFStringEncodingUTF8.
const SINT64: isize = 4;
const UTF8: u32 = 0x0800_0100;
/// kCGImageAlphaPremultipliedLast with kCGBitmapByteOrder32Big: R, G, B, A in memory.
const RGBA_PREMULTIPLIED: u32 = 1 | (4 << 12);

/// Releases a Core Foundation object when dropped; null holds nothing.
struct Owned(CFTypeRef);

impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}

/// A picture the platform's decoder reads, by its header: its format's type identifier (such as
/// `org.webmproject.webp`), its stored size, its frame count and its EXIF orientation (1 to 8).
pub struct Still {
    source: Owned,
    _data: Owned,
    pub kind: String,
    pub size: [u32; 2],
    pub frames: usize,
    pub orientation: u8,
}

fn number(dict: CFTypeRef, key: CFTypeRef) -> Option<i64> {
    let n = unsafe { CFDictionaryGetValue(dict, key) };
    let mut v = 0i64;
    (!n.is_null() && unsafe { CFNumberGetValue(n, SINT64, &mut v as *mut i64 as *mut c_void) })
        .then_some(v)
}

/// Reads `data`'s header with the platform's decoder; `None` when it reads no picture there.
pub fn open(data: &[u8]) -> Option<Still> {
    let cf = Owned(unsafe { CFDataCreate(null(), data.as_ptr(), data.len() as isize) });
    if cf.0.is_null() {
        return None;
    }
    let source = Owned(unsafe { CGImageSourceCreateWithData(cf.0, null()) });
    if source.0.is_null() {
        return None;
    }
    let frames = unsafe { CGImageSourceGetCount(source.0) };
    let kind = unsafe { CGImageSourceGetType(source.0) };
    let mut name = [0u8; 128];
    if frames == 0
        || kind.is_null()
        || !unsafe { CFStringGetCString(kind, name.as_mut_ptr(), name.len() as isize, UTF8) }
    {
        return None;
    }
    let props = Owned(unsafe { CGImageSourceCopyPropertiesAtIndex(source.0, 0, null()) });
    if props.0.is_null() {
        return None;
    }
    let side = |key| number(props.0, key).and_then(|v| u32::try_from(v).ok());
    let size = [
        side(unsafe { kCGImagePropertyPixelWidth })?,
        side(unsafe { kCGImagePropertyPixelHeight })?,
    ];
    let orientation = number(props.0, unsafe { kCGImagePropertyOrientation })
        .and_then(|o| u8::try_from(o).ok())
        .filter(|o| (1..=8).contains(o))
        .unwrap_or(1);
    let end = name.iter().position(|b| *b == 0).unwrap_or(name.len());
    Some(Still {
        source,
        _data: cf,
        kind: String::from_utf8_lossy(&name[..end]).into_owned(),
        size,
        frames,
        orientation,
    })
}

impl Still {
    /// The first frame as stored (orientation not applied), straight RGBA8 in sRGB, row by row.
    pub fn rgba(&self) -> Result<Vec<u8>, String> {
        let image = Owned(unsafe { CGImageSourceCreateImageAtIndex(self.source.0, 0, null()) });
        if image.0.is_null() {
            return Err("the platform's decoder made no picture".into());
        }
        let (w, h) = unsafe { (CGImageGetWidth(image.0), CGImageGetHeight(image.0)) };
        if [w, h] != [self.size[0] as usize, self.size[1] as usize] {
            return Err(format!(
                "the picture decoded at {w} × {h}, not the header's {} × {}",
                self.size[0], self.size[1]
            ));
        }
        let mut px = vec![0u8; w * h * 4];
        let space = Owned(unsafe { CGColorSpaceCreateWithName(kCGColorSpaceSRGB) });
        let ctx = Owned(unsafe {
            CGBitmapContextCreate(
                px.as_mut_ptr() as *mut c_void,
                w,
                h,
                8,
                w * 4,
                space.0,
                RGBA_PREMULTIPLIED,
            )
        });
        if ctx.0.is_null() {
            return Err("no bitmap context for the picture".into());
        }
        let rect = CGRect {
            x: 0.0,
            y: 0.0,
            w: w as f64,
            h: h as f64,
        };
        unsafe { CGContextDrawImage(ctx.0, rect, image.0) };
        drop(ctx);
        // A bitmap context holds premultiplied alpha; a PNG holds it straight.
        for p in px.as_chunks_mut::<4>().0 {
            let a = u32::from(p[3]);
            if a != 0 && a != 255 {
                for c in &mut p[..3] {
                    *c = ((u32::from(*c) * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
        Ok(px)
    }
}
