use std::path::PathBuf;

use image::{AnimationDecoder as _, RgbaImage};

use super::{animated_png, write_png};

#[test]
fn a_recording_plays_its_frames_in_order_at_its_rate() {
    let dir = std::env::temp_dir().join(format!("deep-drive-apng-{}", std::process::id()));
    let frames: Vec<PathBuf> = [[255, 0, 0, 255], [0, 0, 255, 255]]
        .iter()
        .enumerate()
        .map(|(i, color)| {
            let path = dir.join(format!("{i}.png"));
            write_png(&path, &RgbaImage::from_pixel(3, 2, image::Rgba(*color))).ok();
            path
        })
        .collect();
    let bytes = animated_png(&frames, 30).expect("the frames assemble");
    let decoder = image::codecs::png::PngDecoder::new(std::io::Cursor::new(bytes))
        .and_then(|d| d.apng())
        .expect("an animated PNG");
    let played: Vec<_> = decoder
        .into_frames()
        .collect_frames()
        .expect("its frames decode");
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(played.len(), 2);
    assert_eq!(played[0].buffer().get_pixel(0, 0).0, [255, 0, 0, 255]);
    assert_eq!(played[1].buffer().get_pixel(2, 1).0, [0, 0, 255, 255]);
    let (ms, per) = played[1].delay().numer_denom_ms();
    assert_eq!(
        ms * 30,
        per * 1000,
        "each frame shows for a 30th of a second"
    );
}
