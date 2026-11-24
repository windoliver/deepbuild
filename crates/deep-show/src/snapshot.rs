//! Render-back's snapshots on the CPU: the painter is deep-marks-raster's, shared with the web
//! player (#172); the PNG a snapshot is written as is this host's.

use deep_canvas::document::Notice;
use deep_gpu::guard::{is_dark, BLANK_SHARE, DARK_LUMA};
pub use deep_marks_raster::*;
use serde_json::{json, Value};

/// An RGBA raster as an 8-bit RGBA PNG, its bytes the same for the same pixels.
pub fn png(rgba: Vec<u8>, size: [u16; 2]) -> Vec<u8> {
    let mut out = Vec::new();
    let image = image::RgbaImage::from_raw(u32::from(size[0]), u32::from(size[1]), rgba)
        .expect("a raster is width × height × 4 bytes");
    image
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("a PNG encodes into memory");
    out
}

/// What keeps a frame from being drawn, as the issue its reply carries (#1729): at what it names,
/// with the item when that is one.
pub fn issue(u: &Unfit) -> Value {
    let item = u.path.strip_prefix("items/");
    let item = item.and_then(|p| p.split('/').next());
    let what = match u.path.as_str() {
        "look/asset" => "the look the document names can't be resolved, and no other is drawn",
        _ => "the 3D frame can't be drawn",
    };
    json!({"code": u.code, "severity": "error", "ids": item.into_iter().collect::<Vec<_>>(),
           "path": u.path, "what": what})
}

/// #1719: a 3D snapshot that shows next to nothing, by the measure it fails and its share of the
/// pixels: its most common color over [`BLANK_SHARE`] of them, or, as the blank guard reads a dark
/// frame, at most [`DARK_LUMA`] luma.
pub struct Blank {
    measure: &'static str,
    share: f64,
}

/// The measure `rgba` fails, if it does: the most common color's, which a flat dark frame fails too.
pub fn blank(rgba: &[u8]) -> Option<Blank> {
    let pixels = rgba.as_chunks::<4>().0;
    // A color over half the pixels outlasts every other in one pass of votes.
    let (mut most, mut votes) = (*pixels.first()?, 0usize);
    for p in pixels {
        if votes == 0 {
            most = *p;
        }
        votes = if *p == most { votes + 1 } else { votes - 1 };
    }
    let share = |n: usize| n as f64 / pixels.len() as f64;
    let same = pixels.iter().filter(|p| **p == most).count();
    let dark = pixels.iter().filter(|p| is_dark([p[0], p[1], p[2]]));
    [
        ("most_common_color", share(same)),
        ("dark", share(dark.count())),
    ]
    .into_iter()
    .find(|(_, share)| *share >= BLANK_SHARE)
    .map(|(measure, share)| Blank { measure, share })
}

impl Blank {
    /// The notice a reply carries of snapshot `sha`, a contact sheet's by its view.
    pub fn notice(&self, sha: &str, view: Option<&str>) -> Value {
        let what = match self.measure {
            "dark" => format!("luma is at most {DARK_LUMA} over"),
            _ => "one color covers".to_string(),
        };
        let mut actual = json!({"measure": self.measure, "share": self.share, "sha256": sha});
        if let Some(v) = view {
            actual["view"] = json!(v);
        }
        Notice {
            code: "snapshot_blank",
            ids: Vec::new(),
            path: "snapshots".into(),
            actual,
            what: format!("{what} {:.2}% of the snapshot", self.share * 100.0),
            migration: None,
            replaced_by: None,
            close: Vec::new(),
        }
        .to_json()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `n` pixels of `a`, then as many of `b` as fill a frame of 1,000.
    fn frame(n: usize, a: [u8; 3], b: impl Fn(usize) -> [u8; 3]) -> Vec<u8> {
        let px = |k| if k < n { a } else { b(k) };
        (0..1000)
            .flat_map(|k| px(k).into_iter().chain([255]))
            .collect()
    }

    #[test]
    fn a_snapshot_of_one_color_or_all_dark_says_which_and_its_share() {
        let each = |k: usize| [200, (k % 251) as u8, 40];
        let read = |rgba: Vec<u8>| blank(&rgba).map(|b| (b.measure, b.share));
        let white = [255; 3];
        assert_eq!(
            read(frame(980, white, each)),
            Some(("most_common_color", 0.98))
        );
        assert_eq!(read(frame(979, white, each)), None);
        // Dark pixels of many colors: no one covers the frame, and the blank guard voids it.
        let dark = |k: usize| [(k % 16) as u8, (k % 13) as u8, (k % 11) as u8];
        assert_eq!(read(frame(20, white, dark)), Some(("dark", 0.98)));
        assert_eq!(read(frame(21, white, dark)), None);
    }
}
