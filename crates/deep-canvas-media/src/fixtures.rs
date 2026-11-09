//! The media module's own fixtures.

use serde_json::{json, Value};

/// A board whose noise bed plays into a bus with a reverb: the carried-state part seeks from the
/// reverb's checkpoints, its tail among them.
pub fn reverb_board() -> Value {
    json!({
        "format": 1, "profile": "board", "title": "A room",
        "description": "A click train played into a bus whose reverb keeps ringing, for the media module's carried state.",
        "size": [320, 200],
        "requires": {"modules": {"media": "^1"}},
        "transport": {"span": "3s"},
        "items": {
            "room": {"id": "room", "kind": "rect@1", "name": "Room", "order": "a0",
                     "params": {"box": [20, 20, 280, 160], "paint": {"fill": {"role": "muted"}}}}
        },
        "strips": {"clicks": {"track": 0, "src": {"synth": "clicks"}, "start": 0, "in": 0, "out": 2_116_800_000_i64, "bus": "room"}},
        "buses": {"room": {"processors": ["verb"], "out": "master", "layout": "stereo"}},
        "processors": {"verb": {"kind": "reverb", "ir": {"decay": 0.4, "size": 0.05, "damping": 0.5}, "mix": 0.5, "checkpoint_every": 1}}
    })
}
