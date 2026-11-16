//! Render-back's snapshots on the CPU: the painter is deep-marks-raster's, shared with the web
//! player (#172); the PNG a snapshot is written as is this host's.

pub use deep_marks_raster::*;

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

