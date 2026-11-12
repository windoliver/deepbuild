//! Issue #157: an export's frames reach the encode tool one at a time, as they are drawn
//! (Export: encode job: a copy through memory), so no frame is stored raw and the tool holds one
//! frame. A 4:2:0 codec gets the frame's NV12 planes, made by the one exact conversion; ProRes
//! 4444 and PNG get its BGRA8 bytes. A tool that takes no frame for 10 s stops the export, naming
//! the frame.

use std::path::PathBuf;
use std::time::Duration;

use deep_codecs::Helper;
use serde_json::{json, Value};

/// How long the tool may take to take one frame.
pub(crate) const WAIT: Duration = Duration::from_secs(10);
/// How long it may take to finish a part once its last frame is in.
const FINISH: Duration = Duration::from_secs(600);

/// One encode tool job taking its frames as they are drawn: a video part, or a PNG sequence.
pub(crate) struct Part {
    pub path: PathBuf,
    /// The next frame it takes, and the frame after its last.
    next: i64,
    end: i64,
    nv12: bool,
}

impl Part {
    /// Opens the job `ask` (its `frames`, `first` and `format` set here) for frames
    /// `first..first + n`.
    pub(crate) fn open(tool: &mut Helper, mut ask: Value, path: PathBuf, first: i64, n: i64, nv12: bool) -> Result<Part, Value> {
        ask["frames"] = json!(n);
        ask["first"] = json!(first);
        ask["out"] = json!(path);
        ask["format"] = json!(if nv12 { "nv12" } else { "bgra" });
        match tool.feed(&ask, &[], WAIT) {
            Some(r) if r.get("ready").is_some() => Ok(Part { path, next: first, end: first + n, nv12 }),
            Some(r) => Err(json!({"code": "writer_failed", "frame": first, "reply": r,
                "what": format!("the encode tool refused the part starting at frame {first}")})),
            None => Err(stalled(first)),
        }
    }

    /// Hands frame `k` (straight BGRA8 rows, `size`) to the tool; `key` asks for a key frame.
    pub(crate) fn push(&mut self, tool: &mut Helper, k: i64, bgra: &[u8], size: [u32; 2], key: bool) -> Result<(), Value> {
        debug_assert_eq!(k, self.next);
        let nv12;
        let bytes: &[u8] = if self.nv12 {
            nv12 = deep_gpu::frame_checks::nv12(bgra, size[0], size[1]);
            &nv12
        } else {
            bgra
        };
        match tool.feed(&json!({"frame": k, "bytes": bytes.len(), "key": key}), bytes, WAIT) {
            Some(r) if r["frame"] == json!(k) => {
                self.next += 1;
                Ok(())
            }
            Some(r) => Err(json!({"code": "writer_failed", "frame": k, "reply": r,
                "what": format!("the encode tool failed at frame {k}")})),
            None => Err(stalled(k)),
        }
    }

    /// The part, once its last frame is in: the tool's reply.
    pub(crate) fn finish(self, tool: &mut Helper) -> Result<Value, Value> {
        if self.next != self.end {
            return Err(json!({"code": "writer_failed", "frame": self.next,
                "what": format!("the part ended at frame {} before its last frame {}", self.next, self.end - 1)}));
        }
        match tool.feed(&json!({"end": true}), &[], FINISH) {
            Some(r) if r.get("error").is_none() && r.get("refused").is_none() => Ok(r),
            Some(r) => Err(json!({"code": "writer_failed", "frame": self.end - 1, "reply": r})),
            None => Err(stalled(self.end - 1)),
        }
    }
}

/// The issue for a tool that took no frame within its wait.
fn stalled(k: i64) -> Value {
    json!({"code": "encoder_stalled", "frame": k,
        "what": format!("the encode tool took no frame for {} s at frame {k}", WAIT.as_secs())})
}
