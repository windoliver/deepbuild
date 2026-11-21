//! #1431: the app's footprint, read beside the gauges for what it owns (technical design: Numbers version 0 has to hold,
//! "The app's footprint"): its physical footprint, its heap, each long-lived cache's gauge and `unaccounted`, the rest
//! no one names, with the GPU device's own report beside them. GPUI's renderer counts what it holds on the device itself
//! (vendor/gpui-pre-apple's `held`), and each reading mirrors those counts into the app's gauges first.

use std::sync::Mutex;
use std::time::Instant;

use deep_canvas::gauge::{Gauge, Place};
use deep_gpu::footprint::{self, Minutes, Readers};
use gpui_kit::Window;
use serde_json::{json, Value};

/// GPUI's glyph atlas: its pages, their tiles counted in entries, at the bounds its holder declares.
static GLYPHS: Gauge = Gauge::new(
    "MetalAtlasTextures::monochrome_textures", // copy-exception: a gauge's key, read in the footprint record, never drawn
    Place::Device,
    65_536,
    256_000_000,
);
/// GPUI's sprite atlas, the images the app retains until it drops them: its pages, their tiles in entries.
static SPRITES: Gauge = Gauge::new(
    "MetalAtlasTextures::polychrome_textures", // copy-exception: a gauge's key, read in the footprint record, never drawn
    Place::Device,
    16_384,
    512_000_000,
);
/// GPUI's path targets, one window's size each.
static TARGETS: Gauge = Gauge::new(
    "MetalRenderer::path_intermediate_texture", // copy-exception: a gauge's key, read in the footprint record, never drawn
    Place::Device,
    16,
    512_000_000,
);
/// GPUI's instance buffers, in its pool and in flight.
static INSTANCES: Gauge = Gauge::new(
    "InstanceBufferPool::buffers", // copy-exception: a gauge's key, read in the footprint record, never drawn
    Place::Device,
    64,
    512_000_000,
);
/// Each window's drawables, the surfaces it presents through: at most three a window.
static DRAWABLES: Gauge = Gauge::new("CAMetalLayer::drawables", Place::Device, 48, 1_024_000_000);

/// Mirrors GPUI's own counts of what its renderer holds on the device into the app's gauges.
pub fn mirror() {
    #[cfg(target_os = "macos")]
    for (gauge, (entries, bytes)) in [&GLYPHS, &SPRITES, &TARGETS, &INSTANCES, &DRAWABLES]
        .into_iter()
        .zip(gpui_apple::held::held())
    {
        gauge.set(entries, bytes);
    }
}

/// The process's reading through `readers`, GPUI's holders mirrored first.
pub fn reading(readers: Readers) -> Value {
    mirror();
    footprint::read(readers).json()
}

/// The app's reading now.
pub fn read(_window: &Window) -> Value {
    reading(footprint::SYSTEM)
}

/// What `deep doctor` says on the app's socket to ask for its reading.
pub const ASK: &str = "footprint";

/// The app's own series: a reading each minute since it started, the last hour kept.
static SERIES: Mutex<Option<(Instant, Minutes)>> = Mutex::new(None);

/// Takes the app's reading once each whole minute since it started; the app's loop calls it every tick.
pub fn each_minute() {
    let Ok(mut series) = SERIES.lock() else {
        return;
    };
    let (start, minutes) = series.get_or_insert_with(|| (Instant::now(), Minutes::new(60)));
    let at = start.elapsed().as_secs_f64();
    if minutes.taken((at / 60.0) as u64) {
        return;
    }
    mirror();
    minutes.add(at, &footprint::read(footprint::SYSTEM));
}

/// The answer to `deep doctor`: a reading taken now, its last hour's minutes and their mean `unaccounted`, the void
/// minutes left out of it.
pub fn answer() -> String {
    let now = reading(footprint::SYSTEM);
    let (minutes, (mean, void)) = match SERIES.lock().ok().as_deref() {
        Some(Some((_, m))) => (m.json(), m.mean_unaccounted()),
        _ => (Value::Array(Vec::new()), (None, 0)),
    };
    json!({"reading": now, "minutes": minutes, "unaccounted_mean": mean, "void_minutes": void})
        .to_string()
}
