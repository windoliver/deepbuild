//! #204: a score's synth instrument rendered offline (canvas primitives: Synth `synth@1`, As built;
//! Score `score.music@1` and `score.render@1`): one note of a pack preset rendered by the media
//! module's own preset and voice code, so a stem sounds as the live synth does. Built to wasm32 for
//! the score tool, which calls `deep_synth_note` once a note.

use deep_canvas_media::synth::preset::{Preset, BLOCK};
use deep_canvas_media::synth::voice::{Twists, Voice};
use serde_json::Value;

/// One note: `{preset, rate, gate, length, hz, vel, key}`. The preset's param `hz` takes the note's
/// pitch in Hz and `vel` its velocity; every other param its default. The voice's span ends at
/// `gate` samples, and `length` samples are rendered (gate plus the preset's tail).
pub fn note(req: &Value) -> Result<Vec<f32>, String> {
    let p = Preset::compile(&req["preset"])
        .map_err(|f| format!("the preset fails {}: {}", f.rule, f.why))?;
    let num = |k: &str| {
        req[k]
            .as_f64()
            .ok_or_else(|| format!("the note's {k} is a number"))
    };
    let rate = num("rate")? as i64;
    let gate = num("gate")?.max(0.0) as u64;
    let length = num("length")?.max(0.0) as usize;
    let vals: Vec<f64> = p
        .params
        .iter()
        .map(|q| match q.name.as_str() {
            "hz" => num("hz").unwrap_or(q.default).clamp(q.lo, q.hi),
            "vel" => num("vel").unwrap_or(q.default).clamp(q.lo, q.hi),
            _ => q.default,
        })
        .collect();
    let key = req["key"].as_u64().unwrap_or(0) as u32;
    let mut v = Voice::new(&p, rate, key, gate, Twists::default());
    let mut out = Vec::with_capacity(length + BLOCK);
    let mut block = [0.0; BLOCK];
    while out.len() < length {
        v.render(&p, &vals, &vals, 0, &mut block);
        out.extend(block.iter().map(|x| *x as f32));
    }
    out.truncate(length);
    Ok(out)
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    //! The module's calls: `note` takes one note's request as JSON and answers its samples as
    //! little-endian f32 (or, failing, the reason as UTF-8 with the high bit of the length set),
    //! in memory the caller frees.

    #[no_mangle]
    pub extern "C" fn deep_synth_alloc(len: usize) -> *mut u8 {
        let mut v = Vec::<u8>::with_capacity(len);
        let p = v.as_mut_ptr();
        std::mem::forget(v);
        p
    }

    /// # Safety
    /// `ptr` and `len` are a block `deep_synth_alloc` or a call gave.
    #[no_mangle]
    pub unsafe extern "C" fn deep_synth_free(ptr: *mut u8, len: usize) {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }

    fn give(bytes: Vec<u8>, failed: bool) -> u64 {
        let mut b = bytes.into_boxed_slice();
        let (p, n) = (b.as_mut_ptr(), b.len());
        std::mem::forget(b);
        ((p as u64) << 32) | n as u64 | if failed { 1 << 31 } else { 0 }
    }

    /// # Safety
    /// `ptr` and `len` are a block `deep_synth_alloc` gave, filled with the note's request as JSON.
    #[no_mangle]
    pub unsafe extern "C" fn deep_synth_note(ptr: *mut u8, len: usize) -> u64 {
        let bytes = Vec::from_raw_parts(ptr, len, len);
        let answer = serde_json::from_slice::<serde_json::Value>(&bytes)
            .map_err(|e| format!("the request isn't JSON: {e}"))
            .and_then(|r| crate::note(&r));
        match answer {
            Ok(samples) => give(
                samples.iter().flat_map(|x| x.to_le_bytes()).collect(),
                false,
            ),
            Err(why) => give(why.into_bytes(), true),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A note renders what the live voice renders for the same preset, pitch and span.
    #[test]
    fn a_note_is_the_live_voice() {
        let preset = deep_canvas_media::synth::tone();
        let req = json!({"preset": preset, "rate": 48_000, "gate": 4_800, "length": 20_000, "hz": 330, "key": 9});
        let got = note(&req).unwrap();
        let p = Preset::compile(&preset).unwrap();
        let mut v = Voice::new(&p, 48_000, 9, 4_800, Twists::default());
        let mut want = Vec::new();
        let mut block = [0.0; BLOCK];
        while want.len() < 20_000 {
            v.render(&p, &[330.0], &[330.0], 0, &mut block);
            want.extend(block.iter().map(|x| *x as f32));
        }
        want.truncate(20_000);
        assert_eq!(got, want);
        assert!(got.iter().any(|x| *x != 0.0));
        let other = note(&json!({"preset": preset, "rate": 48_000, "gate": 4_800, "length": 20_000, "hz": 440, "key": 9})).unwrap();
        assert_ne!(got, other);
    }
}
