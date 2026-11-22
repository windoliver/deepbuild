//! #1488: still pictures in the decode worker. A JPEG is probed and decoded here like a PNG, its
//! EXIF orientation applied so its `size` is the size it shows at and its top row lands where the
//! camera's top was. Any other still format (WebP, HEIC, a single-frame GIF, TIFF, BMP …) is read
//! by the platform's image decoder and converted at intake to a PNG, kept by its hash, with the
//! source kept and named in the asset's `made_by`; draw code and the web player know only PNG and
//! JPEG.

use std::io::Cursor;

use image::codecs::jpeg::JpegDecoder;
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, RgbaImage};
use serde_json::{json, Value};

use crate::{Format, Job, Opened, Planted};

/// The wrong program every still decoder runs when planted: it ignores the EXIF orientation.
pub const PLANT: &str = "decoder_ignores_orientation";

/// A JPEG's probe: its kind, its one stream (`size` as shown, `color`) and its decoder.
pub fn probe_jpeg(j: &Jpeg, ignores: bool) -> (&'static str, Vec<Value>, Value) {
    let s = json!({"index": 0, "type": "image", "codec": "jpeg", "time_base": [1, 1],
        "size": j.size(ignores), "color": j.color});
    (
        "image",
        vec![s],
        json!({"name": "image jpeg", "version": "0.25"}),
    )
}

/// Another still's probe: `convert: png` for what intake converts; an animation's `frames` stay
/// its own (#1489).
pub fn probe_other(o: &Other, ignores: bool) -> (&'static str, Vec<Value>, Value) {
    let size = if ignores {
        o.size
    } else {
        shown(o.size, o.orientation)
    };
    let mut s = json!({"index": 0, "type": "image", "codec": o.codec(), "time_base": [1, 1],
        "size": size});
    if o.frames > 1 {
        s["frames"] = json!(o.frames);
    } else {
        s["convert"] = json!("png");
    }
    ("image", vec![s], platform())
}

/// A `convert` job, run at intake for a still whose probe says `convert: png`: the platform's
/// decoder reads it, and it is written to `out` as a PNG. The reply is that PNG's asset, named by
/// its hash, with the source named in its `made_by` and probed in `source`.
pub(crate) fn convert(
    f: &Format,
    opened: &Opened,
    job: &Job,
    planted: &Planted,
    probed: Value,
) -> Result<Value, String> {
    let o = match f {
        Format::Other(o) if o.frames == 1 => o,
        _ => return Err("only a still in a format draw code doesn't read converts".into()),
    };
    let out = job.s("out").ok_or("a convert names its out file")?;
    let png = o.png(planted.is(PLANT))?;
    std::fs::write(out, &png).map_err(|e| e.to_string())?;
    let sha = crate::sha256(&png);
    let as_png = crate::format(&png).map_err(|r| r.to_string())?;
    let mut reply = crate::probe(&as_png, &png, &sha, planted);
    let tool = platform();
    reply["asset"]["made_by"] = json!({"tool": tool["name"], "version": tool["version"],
        "input": opened.sha, "synthetic": false});
    reply["source"] = probed["asset"].clone();
    Ok(reply)
}

/// A JPEG's header: its stored size, its EXIF orientation and its color tags.
pub struct Jpeg {
    pub stored: [u32; 2],
    pub orientation: Orientation,
    pub color: Value,
}

impl Jpeg {
    /// Its size as shown; as stored for the wrong program that `ignores` the tag.
    pub fn size(&self, ignores: bool) -> [u32; 2] {
        match ignores {
            true => self.stored,
            false => shown(self.stored, self.orientation),
        }
    }
}

/// Whether `o` turns the picture a quarter, so it shows at its stored size swapped.
fn quarter_turn(o: Orientation) -> bool {
    use Orientation::*;
    matches!(o, Rotate90 | Rotate270 | Rotate90FlipH | Rotate270FlipH)
}

/// `[w, h]` as a picture stored at that size shows under `o`.
pub fn shown(size: [u32; 2], o: Orientation) -> [u32; 2] {
    if quarter_turn(o) {
        [size[1], size[0]]
    } else {
        size
    }
}

/// A JPEG's header, read without decoding; `None` when it doesn't read.
pub fn jpeg(data: &[u8]) -> Option<Jpeg> {
    let mut d = JpegDecoder::new(Cursor::new(data)).ok()?;
    let (w, h) = d.dimensions();
    let orientation = d.orientation().unwrap_or(Orientation::NoTransforms);
    let gray = d.color_type().channel_count() == 1;
    let icc = d.icc_profile().ok().flatten();
    Some(Jpeg {
        stored: [w, h],
        orientation,
        color: jpeg_color(icc.as_deref(), gray),
    })
}

/// A JPEG's color: JFIF's YCbCr is BT.601 at full range; its primaries and transfer are those its
/// ICC profile names, or sRGB assumed and named so when it carries none.
fn jpeg_color(icc: Option<&[u8]>, gray: bool) -> Value {
    let has = |icc: &[u8], what: &[u8]| icc.windows(what.len()).any(|w| w == what);
    let named = |s: &str| {
        s.encode_utf16()
            .flat_map(u16::to_be_bytes)
            .collect::<Vec<u8>>()
    };
    let tagged = |icc: &[u8], name: &str| has(icc, name.as_bytes()) || has(icc, &named(name));
    let (primaries, transfer, assumed) = match icc {
        None => ("bt709", "srgb", json!(["primaries", "transfer"])),
        Some(icc) if tagged(icc, "Display P3") => ("p3", "srgb", json!([])),
        Some(icc) if tagged(icc, "sRGB") => ("bt709", "srgb", json!([])),
        Some(_) => ("icc", "icc", json!([])),
    };
    let matrix = if gray { "rgb" } else { "bt601" };
    json!({"primaries": primaries, "transfer": transfer, "matrix": matrix, "range": "full",
        "assumed": assumed})
}

/// A PNG or JPEG decoded to straight RGBA, its EXIF orientation applied unless `ignores`. Its size
/// passed the worker's caps by its header first.
pub fn rgba(data: &[u8], ignores: bool) -> Result<RgbaImage, String> {
    let reader = image::ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let o = match ignores {
        true => Orientation::NoTransforms,
        false => decoder.orientation().unwrap_or(Orientation::NoTransforms),
    };
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(o);
    Ok(img.into_rgba8())
}

/// A picture in another still format, as the platform's decoder reads its header.
pub struct Other {
    pub kind: String,
    pub size: [u32; 2],
    pub frames: usize,
    pub orientation: Orientation,
    #[cfg(target_os = "macos")]
    still: crate::apple::still::Still,
}

/// The first bytes of a still format draw code doesn't read: WebP, GIF, HEIF/HEIC/AVIF, TIFF and
/// BMP. Only these reach the platform's decoder.
pub fn is_other(data: &[u8]) -> bool {
    let brand = data.get(4..8) == Some(b"ftyp")
        && data.get(8..12).is_some_and(|b| {
            [
                b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1", b"avif",
            ]
            .iter()
            .any(|x| b == *x)
        });
    (data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP"))
        || data.starts_with(b"GIF87a")
        || data.starts_with(b"GIF89a")
        || data.starts_with(b"II*\0")
        || data.starts_with(b"MM\0*")
        || data.starts_with(b"BM")
        || brand
}

/// Reads `data`'s header with the platform's decoder, or refuses it as unreadable.
pub fn other(data: &[u8]) -> Result<Other, Value> {
    let unreadable = || {
        crate::refused(
            "unreadable",
            json!({"why": "the platform's decoder reads no picture"}),
        )
    };
    #[cfg(target_os = "macos")]
    {
        let still = crate::apple::still::open(data).ok_or_else(unreadable)?;
        let orientation =
            Orientation::from_exif(still.orientation).unwrap_or(Orientation::NoTransforms);
        Ok(Other {
            kind: still.kind.clone(),
            size: still.size,
            frames: still.frames,
            orientation,
            still,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = data;
        Err(unreadable())
    }
}

impl Other {
    /// Its codec as a probe names it: the type identifier's last part (`webp`, `heic`, `gif` …).
    pub fn codec(&self) -> &str {
        self.kind.rsplit('.').next().unwrap_or(&self.kind)
    }

    /// Its first frame decoded by the platform's decoder, its orientation applied unless
    /// `ignores`, and encoded as a PNG: the same bytes each time for the same source.
    pub fn png(&self, ignores: bool) -> Result<Vec<u8>, String> {
        #[cfg(target_os = "macos")]
        let px = self.still.rgba()?;
        #[cfg(not(target_os = "macos"))]
        let px: Vec<u8> = return Err("no platform image decoder here".into());
        let [w, h] = self.size;
        let mut img = DynamicImage::ImageRgba8(
            RgbaImage::from_raw(w, h, px).ok_or("the decoded picture isn't its size")?,
        );
        if !ignores {
            img.apply_orientation(self.orientation);
        }
        // The platform's decoder drew it into sRGB, so the PNG says so.
        let img = img.into_rgba8();
        let mut out = Vec::new();
        let mut png = png::Encoder::new(&mut out, img.width(), img.height());
        png.set_color(png::ColorType::Rgba);
        png.set_depth(png::BitDepth::Eight);
        png.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
        let mut writer = png.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(img.as_raw())
            .map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
        Ok(out)
    }
}

/// The platform's image decoder as an asset's `made_by` and `decoder` name it.
pub fn platform() -> Value {
    #[cfg(target_os = "macos")]
    return json!({"name": "ImageIO", "version": crate::apple::os_version()});
    #[cfg(not(target_os = "macos"))]
    json!({"name": "none", "version": "0"})
}
