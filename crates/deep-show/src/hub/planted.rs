//! Issues #670, #1163 and #305: the planted render grain and the check that opens programs.

use super::*;

/// The planted renderer's grain: a few pixels' red nudged by a xorshift seeded from the clock's
/// nanoseconds, what an honest render-back never reads (Channel and key: it can never read the
/// clock), so two runs draw two pictures (#670).
pub(crate) fn clock_noise(rgba: &mut [u8]) {
    seeded_noise(rgba, now_nanos());
}

/// #1163's [`clock_noise`] in an export, seeded from the clock once per process and by the
/// frame's time: another process draws another picture, and a frame drawn again in the same
/// export draws the same one, as #157's redraw holds every frame to.
pub(crate) fn export_noise(rgba: &mut [u8], t: i64) {
    static SEED: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    seeded_noise(rgba, *SEED.get_or_init(now_nanos) ^ t as u64);
}

fn now_nanos() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64)
}

fn seeded_noise(rgba: &mut [u8], seed: u64) {
    let mut x = seed | 1;
    let pixels = (rgba.len() / 4) as u64;
    for _ in 0..64 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        let i = (x % pixels) as usize * 4;
        rgba[i] = rgba[i].wrapping_add((x >> 56) as u8 | 1);
    }
}

/// The planted check that opens a logic program's bytes from the evidence store by its hash
/// before the document is refused: what the honest check never does (#305).
pub(super) fn read_programs(doc: &Value, evidence: &std::path::Path) {
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return;
    };
    for item in items.values() {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let program = item
            .get("params")
            .and_then(|p| p.get("program"))
            .and_then(Value::as_str);
        if let (true, Some(sha)) = (kind.starts_with("logic@"), program) {
            if sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()) {
                let _ = std::fs::read(evidence.join(&sha[..2]).join(&sha[2..]));
            }
        }
    }
}
