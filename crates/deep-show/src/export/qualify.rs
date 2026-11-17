//! Issue #518: `encode_qualify`, the encode job kind's qualification run on one tool (Export:
//! encode job). The export kinds' fixture film, a dark side panel and a bar that moves a pixel a
//! frame over a stereo tone, is exported through the tool, and its delivery, read back from its own bytes in a fresh
//! decode worker apart from the tool, must pass export.fidelity, export.color and the sync rule.
//! Nothing the tool says counts. A codec the decode worker can't decode here is BLOCKED.

use serde_json::{json, Value};

use super::Job;
use crate::hub::Hub;

/// The qualification's document ID: no revision is made under it.
const DOC: &str = "qualify:encode";
const FLICKS: i64 = deep_canvas::grammar::FLICKS_PER_SECOND;
/// The fixture film: 48 frames of 160 × 90 at 24 a second, 2 s of 48 kHz stereo.
const FRAMES: i64 = 48;
const RATE: i64 = 24;
const HZ: u32 = 48_000;

/// The fixture film's tone as a float WAV: 440 Hz left and 660 Hz right at −14 dBFS.
fn tone() -> Vec<u8> {
    let frames = (FRAMES * i64::from(HZ) / RATE) as u32;
    let mut wav = Vec::with_capacity(44 + frames as usize * 8);
    wav.extend(b"RIFF");
    wav.extend((36 + frames * 8).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend(3u16.to_le_bytes());
    wav.extend(2u16.to_le_bytes());
    wav.extend(HZ.to_le_bytes());
    wav.extend((HZ * 8).to_le_bytes());
    wav.extend(8u16.to_le_bytes());
    wav.extend(32u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend((frames * 8).to_le_bytes());
    for i in 0..frames {
        for hz in [440.0, 660.0] {
            let x = 0.2 * (std::f64::consts::TAU * hz * f64::from(i) / f64::from(HZ)).sin();
            wav.extend((x as f32).to_le_bytes());
        }
    }
    wav
}

/// The fixture film, its tone named by `sound`, the tone's SHA-256 in the evidence store.
fn fixture(sound: &str) -> Value {
    let span = FRAMES * FLICKS / RATE;
    // Each item on the kit's own writer layer, as a presented document's items are on theirs.
    let rect = |id: &str, r: [i64; 4], role: &str, order: &str| json!({"id": id, "kind": "rect@1", "layer": "kit", "name": id, "order": order, "params": {"box": r, "paint": {"fill": {"role": role}}}});
    json!({
        "format": 1, "id": "qualify-encode", "profile": "film", "title": "Encode qualification",
        "description": "A bar crossing a ground over a tone.", "size": [160, 90], "camera": "cam",
        "layers": {"kit": {"writer": "kit", "title": "Kit", "order": "a0"}},
        "transport": {"span": span, "frame_rate": [RATE, 1], "sample_rate": HZ},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "layer": "kit", "name": "cam", "order": "a0",
                "params": {"projection": "orthographic", "target": [80, 45, 0], "view_width": 160}},
            "back": rect("back", [0, 0, 160, 90], "muted", "a1"),
            "side": rect("side", [0, 0, 64, 90], "ink", "a2"),
            "bar": rect("bar", [64, 0, 12, 90], "accent", "a3"),
        },
        "channels": {"bar": {"target": "items/bar/params/box/0", "type": "f32",
            "keys": {"k0": {"t": 0, "value": 64, "interp": "linear"}, "k1": {"t": span, "value": 64 + FRAMES, "interp": "linear"}}}},
        "assets": {"sound": {"sha256": sound, "license": {"id": "CC0-1.0", "shareable": true, "credit": "The qualification's tone."}}},
        "strips": {"sound": {"track": 1, "src": sound, "start": 0, "in": 0, "out": span, "rate": 1}},
    })
}

impl Hub<'_> {
    /// `encode_qualify`: the kind's qualification of the tool `id`, `qualified`, `failed` with
    /// what its delivery failed, or `blocked` naming the codec that can't be judged here.
    pub fn encode_qualify(&mut self, id: &str) -> Value {
        let Some(tool) = self.encode_tools().into_iter().find(|t| t.id == id) else {
            return json!({"outcome": "refused", "code": "unknown_tool", "tool": id});
        };
        let Ok(sound) = crate::evidence::put(&self.scenario.evidence, &tone()) else {
            return json!({"outcome": "refused", "code": "evidence_unwritable"});
        };
        let dir = std::env::temp_dir().join(format!(
            "deep-qualify-{}-{}",
            std::process::id(),
            self.media.exports
        ));
        let _ = std::fs::create_dir_all(&dir);
        let mut issues = Vec::new();
        let mut blocked = None;
        // Every codec the tool registers, each its own delivery.
        for codec in &tool.codecs {
            // An MP4's sound is AAC; a QuickTime movie's and a sequence's film keep PCM.
            let mp4 = !matches!(codec.as_str(), "png_seq" | "prores_4444");
            let job = Job {
                doc: DOC.into(),
                codec: codec.clone(),
                audio_codec: if mp4 { "aac" } else { "pcm" }.into(),
                alpha: codec == "prores_4444",
                out: dir.join(codec).to_string_lossy().into_owned(),
                tool: Some(tool.id.clone()),
                pins: vec![tool.id.clone()],
                ..Job::default()
            };
            let reply = self.export_doc(&job, fixture(&sound));
            match reply["outcome"].as_str() {
                Some("exported") => {}
                Some("blocked") => blocked = Some(reply["codec"].clone()),
                _ => issues.push(json!({"codec": codec, "outcome": reply["outcome"], "code": reply["code"], "issues": reply["issues"]})),
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
        match (blocked, issues.is_empty()) {
            (Some(codec), _) => {
                json!({"outcome": "blocked", "state": "BLOCKED", "tool": id, "codec": codec})
            }
            (None, true) => json!({"outcome": "qualified", "tool": id, "codecs": tool.codecs}),
            (None, false) => json!({"outcome": "failed", "tool": id, "issues": issues}),
        }
    }
}
