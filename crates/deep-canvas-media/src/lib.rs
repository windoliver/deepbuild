//! Issue #499: the media module's own processing code (canvas primitives: Sound and video on the
//! picture's clock). Audio runs through our own code with pinned math, so output is identical for
//! the same build and CPU architecture.

pub mod analysis;
pub mod clock;
pub mod delay;
pub mod doc;
pub mod dynamics;
pub mod emitter;
pub mod fixtures;
pub mod eq;
pub mod frames;
pub mod module;
pub mod mix;
pub mod reverb;
pub mod ring;
pub mod spawn;
pub mod viewer;

/// One second in flicks.
pub const FLICKS: i64 = 705_600_000;

/// The wrong programs a proof surface plants in this module (#499 AC10): the av_unlinked check
/// comparing only `start` (the redraft of AC10's test names it `av_link_start_only`); and #500's,
/// which deep-show's bakes and spawns read: a loudness bake whose true peak is the sample peak, an
/// envelope bake whose rms is the row's peak, a spawn that ignores its cooldown, one that pans
/// from the item showing its occurrence's body, and one that starts voices at the child flick;
/// and #1818's, which the mix and deep_query read: a limiter reading sample peaks only, a
/// hard-knee compressor, a mix without latency compensation, a pitch ignoring its semitones, a
/// send always tapped post, a delay emptied at a seek, and a missing loudness target read as 0;
/// and #544's, a spawn that reads a field its logic item doesn't declare as 0.
pub const PLANTED: [&str; 15] = [
    "av_link_compares_start_only",
    "av_link_start_only",
    "sample_peak_meter",
    "envelope_reads_peak",
    "spawn_ignores_cooldown",
    "spawn_pans_from_item_origin",
    "spawn_starts_at_child_flick",
    "limiter_holds_sample_peaks",
    "compressor_hard_knee",
    "mix_without_latency_compensation",
    "pitch_ignores_semitones",
    "send_always_post",
    "delay_empties_line_at_seek",
    "loudness_target_defaults_to_zero",
    "undeclared_field_reads_zero",
];

static PLANTED_NOW: std::sync::Mutex<Option<&'static str>> = std::sync::Mutex::new(None);

/// Plants one of [`PLANTED`] for the checks that follow, or none.
pub fn plant(name: Option<&str>) {
    let found = name.and_then(|n| PLANTED.iter().find(|p| **p == n).copied());
    *PLANTED_NOW.lock().unwrap_or_else(|e| e.into_inner()) = found;
}

/// Whether `name` is planted.
pub fn planted(name: &str) -> bool {
    *PLANTED_NOW.lock().unwrap_or_else(|e| e.into_inner()) == Some(name)
}
