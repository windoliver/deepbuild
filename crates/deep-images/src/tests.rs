use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use image::{ImageFormat, RgbaImage};
use sha2::{Digest, Sha256};

use super::*;

/// A fresh store folder under the system's temp folder.
fn store() -> Arc<Store> {
    static N: AtomicU64 = AtomicU64::new(0);
    let dir: PathBuf = std::env::temp_dir().join(format!(
        "deep-images-test-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    Arc::new(Store::flat(&dir))
}

/// A `w × h` PNG of one color put in `store`, by its hash.
fn put(store: &Store, w: u32, h: u32, color: [u8; 4]) -> [u8; 32] {
    let image = RgbaImage::from_pixel(w, h, image::Rgba(color));
    let mut png = std::io::Cursor::new(Vec::new());
    image.write_to(&mut png, ImageFormat::Png).unwrap();
    let bytes = png.into_inner();
    let hash: [u8; 32] = Sha256::digest(&bytes).into();
    std::fs::write(store.root.join(source::hex(&hash)), &bytes).unwrap();
    hash
}

fn key(hash: [u8; 32], size: [u32; 2], level: u8) -> Key {
    Key {
        hash,
        crop: [0, 0, size[0], size[1]],
        flip: 0,
        level,
    }
}

/// A service whose queue holds still: no worker ever starts.
fn still() -> Images {
    let images = Images::new(BUDGET, ENTRIES);
    images.lock().workers = 0;
    images
}

const R: [f64; 4] = [0.0, 0.0, 10.0, 10.0];

#[test]
fn visible_runs_before_prefetch_and_newest_first() {
    let st = store();
    let keys: Vec<Key> = (0..4)
        .map(|i| key(put(&st, 8, 8, [i * 50, 9, 9, 255]), [8, 8], 0))
        .collect();
    let images = still();
    images.show(&st, keys[0], Queue::Prefetch, R);
    images.show(&st, keys[1], Queue::Visible, R);
    images.show(&st, keys[2], Queue::Visible, R);
    images.show(&st, keys[3], Queue::Prefetch, R);
    let mut order = Vec::new();
    loop {
        let mut s = images.lock();
        let Some(k) = s.next() else { break };
        s.queued.remove(&k);
        order.push(keys.iter().position(|x| *x == k).unwrap());
    }
    assert_eq!(order, [2, 1, 3, 0]);
}

#[test]
fn a_job_past_the_bytes_in_flight_waits_while_another_runs() {
    let st = store();
    let [a, b] = [[1, 2, 3, 255], [4, 5, 6, 255]].map(|c| put(&st, 4_000, 3_000, c));
    let images = still();
    for h in [a, b] {
        images.size(&st, &h).unwrap();
        images.show(&st, key(h, [4_000, 3_000], 0), Queue::Visible, R);
    }
    let mut s = images.lock();
    // Each source holds 48 MB decoded: with one running, the second waits once what is in
    // flight would pass 200 MB with it.
    s.queued.remove(&key(a, [4_000, 3_000], 0));
    s.running.insert(key(a, [4_000, 3_000], 0));
    s.in_flight = 48_000_000;
    assert!(s.next().is_some());
    s.in_flight = 160_000_000;
    assert!(s.next().is_none());
    s.running.clear();
    assert!(s.next().is_some(), "alone, a job runs whatever it holds");
}

#[test]
fn a_missing_level_shows_the_nearest_held_and_settles_only_on_its_own() {
    let st = store();
    let h = put(&st, 64, 64, [7, 7, 7, 255]);
    let images = still();
    images.wait(&st, key(h, [64, 64], 3)).unwrap();
    let shown = images.show(&st, key(h, [64, 64], 1), Queue::Visible, R);
    assert!(matches!(shown, Shown::Nearest(l, 3) if l.size == [8, 8]));
    images.pass_ended(R);
    assert!(images.settling());
    images.wait(&st, key(h, [64, 64], 1)).unwrap();
    assert!(matches!(
        images.show(&st, key(h, [64, 64], 1), Queue::Visible, R),
        Shown::Exact(_)
    ));
    images.pass_ended(R);
    assert!(!images.settling());
}
