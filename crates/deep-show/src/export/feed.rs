//! Issue #157: an export's frames reach the encode tool one at a time, as they are drawn
//! (Export: encode job: a copy through memory), so no frame is stored raw and the tool holds one
//! frame. A 4:2:0 codec gets the frame's NV12 planes, made by the one exact conversion; ProRes
//! 4444 and PNG get its BGRA8 bytes. A tool that takes no frame for 10 s stops the export, naming
//! the frame. This is the build's own tools' wire (#518): each frame is answered before the next
//! is sent, so the tool never holds more than one; a plug-in's tool speaks `program.rs`'s.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
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
    /// The frames' size it was opened for.
    pub size: [u16; 2],
    /// #518: the open's seconds as the tool timed it, once the tool has answered its open.
    pub opened: Option<f64>,
    /// Set when the job is dropped unfinished: the tool still waits for its frames, so the run
    /// ends that process before it asks the tool anything else.
    unfinished: Arc<AtomicBool>,
    done: bool,
}

impl Drop for Part {
    fn drop(&mut self) {
        if !self.done {
            self.unfinished.store(true, Ordering::Relaxed);
        }
    }
}

impl Part {
    /// Asks the tool to open the job `ask` (its `frames`, `first` and `format` set here) for
    /// frames `first..first + n`, without waiting for its answer (#518): the open runs beside
    /// the export's preparing, and [`Part::push`] hears its answer before the first frame.
    pub(crate) fn open(
        tool: &mut Helper,
        mut ask: Value,
        path: PathBuf,
        first: i64,
        n: i64,
        nv12: bool,
        unfinished: Arc<AtomicBool>,
    ) -> Result<Part, Value> {
        ask["frames"] = json!(n);
        ask["first"] = json!(first);
        ask["out"] = json!(path);
        ask["format"] = json!(if nv12 { "nv12" } else { "bgra" });
        let size = [0, 1].map(|i| ask["size"][i].as_u64().unwrap_or(0) as u16);
        if !tool.send(&ask) {
            return Err(stalled(first));
        }
        Ok(Part {
            path,
            next: first,
            end: first + n,
            size,
            opened: None,
            unfinished,
            done: false,
        })
    }

    /// The tool's answer to its open, heard once: its encoder is open.
    fn ready(&mut self, tool: &mut Helper) -> Result<(), Value> {
        if self.opened.is_some() {
            return Ok(());
        }
        match tool.hear_within(WAIT) {
            Some(r) if r.get("ready").is_some() => {
                self.opened = Some(r["ready"]["open_seconds"].as_f64().unwrap_or(0.0));
                Ok(())
            }
            Some(r) => Err(
                json!({"outcome": "failed", "code": "writer_failed", "frame": self.next, "reply": r,
                "what": format!("the encode tool refused the part starting at frame {}", self.next)}),
            ),
            None => Err(stalled(self.next)),
        }
    }

    /// Hands frame `k` to the tool as `bytes`, its NV12 planes or its straight BGRA8 rows as
    /// it was opened for; `key` asks for a key frame.
    pub(crate) fn push(
        &mut self,
        tool: &mut Helper,
        k: i64,
        bytes: &[u8],
        key: bool,
    ) -> Result<(), Value> {
        debug_assert_eq!(k, self.next);
        self.ready(tool)?;
        match tool.feed(
            &json!({"frame": k, "bytes": bytes.len(), "key": key}),
            bytes,
            WAIT,
        ) {
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
    pub(crate) fn finish(mut self, tool: &mut Helper) -> Result<Value, Value> {
        if self.next != self.end {
            return Err(json!({"code": "writer_failed", "frame": self.next,
                "what": format!("the part ended at frame {} before its last frame {}", self.next, self.end - 1)}));
        }
        self.ready(tool)?;
        // Answered or not, the tool is past this job: it waits for no more of its frames.
        self.done = true;
        match tool.feed(&json!({"end": true}), &[], FINISH) {
            Some(r) if r.get("error").is_none() && r.get("refused").is_none() => Ok(r),
            Some(r) => Err(json!({"code": "writer_failed", "frame": self.end - 1, "reply": r})),
            None => Err(stalled(self.end - 1)),
        }
    }
}

/// The export stopped at frame `k`, which the tool took nothing of within its wait: the frame
/// that found no free slot.
pub(crate) fn stalled(k: i64) -> Value {
    super::stopped(
        k,
        "encoder_stalled",
        &format!(
            "the encode tool let no frame go for {} s, so frame {k} found no free slot",
            WAIT.as_secs()
        ),
    )
}
