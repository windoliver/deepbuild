//! A picture's source: read from the content store by its sha256 and checked against it, its size
//! read from its header alone, and its pixels decoded inside the decode caps (Image `image@1`,
//! Asset).

use std::fs::File;
use std::io::{BufReader, Cursor, Write};
use std::path::{Path, PathBuf};

use image::{ImageError, ImageReader, RgbaImage};
use sha2::{Digest, Sha256};

/// The most one decode may hold, B: a picture whose full size passes it is refused by its header.
pub const DECODE_CAP: u64 = 64 << 20;

/// The longest side a decode takes, px: Vello's pixmaps and GPUI's sprites take a 16-bit side.
pub const SIDE: u32 = u16::MAX as u32;

/// A content store: files named by their sha256, flat (`<sha>`) or split (`<aa>/<62 hex>`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Store {
    pub root: PathBuf,
    pub split: bool,
}

/// Why a picture can't be drawn: the code a refusal carries, and whether it names the crop rather
/// than the asset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Refused {
    pub code: &'static str,
    pub on_crop: bool,
}

pub(crate) const fn refused(code: &'static str) -> Refused {
    Refused {
        code,
        on_crop: false,
    }
}

/// The hash a document names, if it is 64 lowercase hex digits.
pub fn hash_of(name: &str) -> Option<[u8; 32]> {
    let b = name.as_bytes();
    if b.len() != 64 || !b.iter().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f')) {
        return None;
    }
    let digit = |c: u8| if c <= b'9' { c - b'0' } else { c - b'a' + 10 };
    Some(std::array::from_fn(|i| {
        digit(b[2 * i]) << 4 | digit(b[2 * i + 1])
    }))
}

pub(crate) fn hex(hash: &[u8; 32]) -> String {
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

impl Store {
    pub fn flat(root: &Path) -> Store {
        Store {
            root: root.to_path_buf(),
            split: false,
        }
    }

    pub fn split(root: &Path) -> Store {
        Store {
            root: root.to_path_buf(),
            split: true,
        }
    }

    fn path(&self, hash: &[u8; 32]) -> PathBuf {
        let h = hex(hash);
        if self.split {
            self.root.join(&h[..2]).join(&h[2..])
        } else {
            self.root.join(h)
        }
    }

    /// The bytes named `hash`, checked against it: `asset_missing` when the store hasn't them,
    /// `asset_mismatch` when they don't hash to their name.
    pub fn read(&self, hash: &[u8; 32]) -> Result<Vec<u8>, Refused> {
        let bytes = std::fs::read(self.path(hash)).map_err(|_| refused("asset_missing"))?;
        if <[u8; 32]>::from(Sha256::digest(&bytes)) != *hash {
            return Err(refused("asset_mismatch"));
        }
        Ok(bytes)
    }

    /// Whether the file named `hash` is there and hashes to its name, read in pieces so nothing
    /// as large as the file is allocated.
    fn verify(&self, hash: &[u8; 32]) -> Result<(), Refused> {
        use std::io::Read;
        let mut file = File::open(self.path(hash)).map_err(|_| refused("asset_missing"))?;
        let mut digest = Sha256::new();
        let mut piece = [0u8; 16 << 10];
        loop {
            match file.read(&mut piece) {
                Ok(0) => break,
                Ok(n) => digest.update(&piece[..n]),
                Err(_) => return Err(refused("asset_missing")),
            }
        }
        if <[u8; 32]>::from(digest.finalize()) != *hash {
            return Err(refused("asset_mismatch"));
        }
        Ok(())
    }

    /// Writes `bytes` under `hash` whole or not at all; a file already there is left alone.
    pub(crate) fn write(&self, hash: &[u8; 32], bytes: &[u8]) -> std::io::Result<()> {
        let path = self.path(hash);
        if path.exists() {
            return Ok(());
        }
        Self::put(&path, bytes)
    }

    /// Writes `bytes` at `path` whole or not at all, through a temporary file and a rename.
    pub(crate) fn put(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let temp = path.with_file_name(format!(".{name}.{}.tmp", std::process::id()));
        let mut file = File::create(&temp)?;
        file.write_all(bytes)?;
        drop(file);
        std::fs::rename(&temp, path)
    }

    pub(crate) fn file(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }
}

fn undecodable(_: ImageError) -> Refused {
    refused("asset_undecodable")
}

/// Whether a picture of `size` px fits one decode: each side within the cap, and its RGBA within
/// what a decode may hold.
pub(crate) fn fits(size: [u32; 2]) -> bool {
    size[0] <= SIDE && size[1] <= SIDE && u64::from(size[0]) * u64::from(size[1]) * 4 <= DECODE_CAP
}

/// The size `hash`'s header gives, read without decoding (PNG and JPEG): `over_budget` when the
/// picture couldn't be decoded within the caps. The header is read before the bytes are checked,
/// so no refusal rests on it alone: one is made only after the checked read, which names a missing
/// or mismatched file first, and pixels only ever come from checked bytes (Asset). With
/// `decodes_first` (#1485's wrong program) the whole picture is decoded before the cap is applied.
pub(crate) fn header(
    store: &Store,
    hash: &[u8; 32],
    decodes_first: bool,
) -> Result<[u32; 2], Refused> {
    let size = if decodes_first {
        let bytes = store.read(hash)?;
        let rgba = image::load_from_memory(&bytes)
            .map_err(undecodable)?
            .to_rgba8();
        [rgba.width(), rgba.height()]
    } else {
        let read = File::open(store.path(hash))
            .map_err(|_| refused("asset_missing"))
            .and_then(|file| {
                ImageReader::new(BufReader::new(file))
                    .with_guessed_format()
                    .map_err(|e| undecodable(ImageError::IoError(e)))?
                    .into_dimensions()
                    .map_err(undecodable)
            });
        match read {
            Ok((w, h)) => [w, h],
            Err(r) => {
                store.verify(hash)?;
                return Err(r);
            }
        }
    };
    if !fits(size) {
        store.verify(hash)?;
        return Err(refused("over_budget"));
    }
    Ok(size)
}

/// `bytes` decoded to straight RGBA within the caps.
pub(crate) fn decode(bytes: &[u8]) -> Result<RgbaImage, Refused> {
    let reader = || ImageReader::new(Cursor::new(bytes)).with_guessed_format();
    let (w, h) = reader()
        .map_err(|e| undecodable(ImageError::IoError(e)))?
        .into_dimensions()
        .map_err(undecodable)?;
    if !fits([w, h]) {
        return Err(refused("over_budget"));
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(SIDE);
    limits.max_image_height = Some(SIDE);
    limits.max_alloc = Some(DECODE_CAP);
    let mut decoder = reader().map_err(|e| undecodable(ImageError::IoError(e)))?;
    decoder.limits(limits);
    let decoded = decoder.decode().map_err(|e| match e {
        ImageError::Limits(_) => refused("over_budget"),
        e => undecodable(e),
    })?;
    Ok(decoded.into_rgba8())
}

/// A crop in image px (`[x, y, w, h]`) as whole pixels inside a picture of `size`, or the whole
/// picture with none; `None` when nothing of the picture is left.
pub fn crop_px(crop: Option<[f64; 4]>, size: [u32; 2]) -> Option<[u32; 4]> {
    let Some([x, y, w, h]) = crop else {
        return Some([0, 0, size[0], size[1]]);
    };
    let (x, y) = (x.max(0.0) as u32, y.max(0.0) as u32);
    let w = (w.max(1.0) as u32).min(size[0].saturating_sub(x));
    let h = (h.max(1.0) as u32).min(size[1].saturating_sub(y));
    (w > 0 && h > 0).then_some([x, y, w, h])
}

/// `rgba` flipped as an atlas cell draws it: a quarter turn (4) first, then across (1), then
/// down (2).
pub(crate) fn flipped(mut rgba: RgbaImage, flip: u8) -> RgbaImage {
    use image::imageops::{flip_horizontal, flip_vertical, rotate90};
    if flip & 4 != 0 {
        rgba = flip_horizontal(&rotate90(&rgba));
    }
    if flip & 1 != 0 {
        rgba = flip_horizontal(&rgba);
    }
    if flip & 2 != 0 {
        rgba = flip_vertical(&rgba);
    }
    rgba
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hash_is_64_lowercase_hex_digits() {
        let h = "ab".repeat(32);
        assert_eq!(hash_of(&h), Some([0xab; 32]));
        assert_eq!(hex(&[0xab; 32]), h);
        assert_eq!(hash_of(&"AB".repeat(32)), None);
        assert_eq!(hash_of("../etc/passwd"), None);
        assert_eq!(hash_of(&"ab".repeat(31)), None);
    }

    #[test]
    fn a_crop_keeps_whole_pixels_inside_the_picture() {
        assert_eq!(crop_px(None, [10, 6]), Some([0, 0, 10, 6]));
        assert_eq!(
            crop_px(Some([2.7, 1.0, 100.0, 2.5]), [10, 6]),
            Some([2, 1, 8, 2])
        );
        assert_eq!(crop_px(Some([12.0, 0.0, 4.0, 4.0]), [10, 6]), None);
    }
}
