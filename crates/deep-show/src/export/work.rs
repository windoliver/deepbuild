//! Issue #231: what an export's frames cost. Its work is counted, the same on every machine: the
//! frames it drew and hashed, the frames it held (the frame before again: neither drawn nor
//! hashed), the frames whose pixels came back from the GPU and the digests that did. Each phase's
//! busy time is timed: the phases work on different frames at once, so they don't sum to `wall`,
//! the time from the command to the file.

use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::hub::Hub;

impl Hub<'_> {
    /// The GPU device's counts, when the device is open; asking never opens it.
    fn counts(&self) -> Option<&deep_gpu::counted::Counts> {
        let gpu = self.gpu3.as_ref().and_then(Option::as_ref)?;
        Some(gpu.device().device.counts())
    }

    /// How long this process has spent preparing so far: its GPU device compiling shader modules
    /// and pipelines, and its decode worker decoding assets. A phase's busy time holds none of
    /// it: the receipt books each under `prepare`, whenever it happens.
    pub(super) fn preparing(&self) -> Duration {
        let compiling = self.counts().map_or(0, |c| c.read().compile_ns);
        Duration::from_nanos(compiling) + self.media.decoding
    }

    /// An export begins: the command its `wall` runs from, and where this process's reports of
    /// compiles and decodes stand, since the export's own are the ones made after. The command
    /// of a process's first export is the process itself, so that one's `wall` counts from the
    /// process's start.
    pub(super) fn began(&mut self) -> Began {
        let first = !std::mem::replace(&mut self.media.exported, true);
        Began {
            at: Instant::now(),
            lead: first.then(process_age).flatten().unwrap_or_default(),
            mark: Mark {
                compiles: self.counts().map_or(0, |c| c.compiled()),
                decodes: self.media.decodes.len(),
            },
        }
    }

    /// The reply's `reports`: each pipeline compile and each asset decode since `mark`, as the
    /// GPU device and the decode worker timed them; and their seconds' sum, the receipt's
    /// `prepare` (planted, `under_draw`: the decodes' alone, the compiles staying under `draw`).
    pub(super) fn reports(&self, mark: Mark, under_draw: bool) -> (Value, Duration) {
        let compiles = self
            .counts()
            .map_or_else(Vec::new, |c| c.compiles(mark.compiles));
        let decodes = &self.media.decodes[mark.decodes.min(self.media.decodes.len())..];
        let booked = compiles.iter().filter(|_| !under_draw).chain(decodes);
        let total: f64 = booked.map(|(_, s)| s).sum();
        let rows = |list: &[(String, f64)], name: &str| -> Vec<Value> {
            let row = |(what, seconds): &(String, f64)| {
                let mut row = serde_json::Map::new();
                row.insert(name.into(), json!(what));
                row.insert("seconds".into(), json!(seconds));
                Value::Object(row)
            };
            list.iter().map(row).collect()
        };
        let reports =
            json!({"compiles": rows(&compiles, "pipeline"), "decodes": rows(decodes, "asset")});
        (reports, Duration::from_secs_f64(total))
    }
}

/// How many compiles and decodes this process had reported at some moment.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Mark {
    compiles: usize,
    decodes: usize,
}

/// When an export began, and what had run before it.
#[derive(Clone, Copy, Debug)]
pub(super) struct Began {
    at: Instant,
    /// How long the process had run when its first export began; nothing for a later one.
    lead: Duration,
    pub mark: Mark,
}

impl Began {
    /// The time from the command to now.
    pub fn wall(&self) -> Duration {
        self.lead + self.at.elapsed()
    }
}

/// How long this process has run, by the system's record of its start; `None` where this build
/// reads none.
#[cfg(target_os = "macos")]
fn process_age() -> Option<Duration> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    // SAFETY: `info` is a `proc_bsdinfo` of `size` bytes, which the call fills when it returns
    // `size` and leaves zeroed otherwise.
    let info = unsafe {
        let pid = libc::getpid();
        let got = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        );
        (got == size).then(|| info.assume_init())?
    };
    let nanos = u32::try_from(info.pbi_start_tvusec * 1000).ok()?;
    let started = std::time::UNIX_EPOCH + Duration::new(info.pbi_start_tvsec, nanos);
    std::time::SystemTime::now().duration_since(started).ok()
}

#[cfg(not(target_os = "macos"))]
fn process_age() -> Option<Duration> {
    None
}

/// The export's work counters.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Work {
    /// Frames drawn, and frames hashed, in the export's own pass.
    pub draws: u64,
    pub hashes: u64,
    /// Frames that were the frame before them again.
    pub reused: u32,
    /// Frames whose pixels, or planes, were read back from the GPU through memory.
    pub frames_read_back: u64,
    /// export.fidelity's redraw: frames drawn again, and hashed again.
    pub redraws: u64,
    pub rehashes: u64,
}

impl Work {
    /// The reply's `work`. A digest is read back from the GPU for each frame hashed, in the
    /// export's pass and in export.fidelity's redraw, 32 bytes each; an export that hashes on the
    /// CPU reads none back.
    pub fn json(&self, digests: bool) -> Value {
        let read = if digests {
            self.hashes + self.rehashes
        } else {
            0
        };
        json!({"draws": self.draws, "hashes": self.hashes, "fidelity": {"draws": self.redraws, "hashes": self.rehashes},
            "frames_read_back": self.frames_read_back, "digests_read_back": read, "digest_bytes_read_back": 32 * read})
    }
}

/// Each phase's busy time.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Phases {
    pub prepare: Duration,
    pub evaluate: Duration,
    pub draw: Duration,
    pub hash: Duration,
    pub convert: Duration,
    pub handoff: Duration,
    pub encode: Duration,
    pub guards: Duration,
}

impl Phases {
    /// The eight phases' sum, which is not the wall time: the phases overlap.
    pub fn sum(&self) -> Duration {
        let phases = [self.prepare, self.evaluate, self.draw, self.hash];
        let later = [self.convert, self.handoff, self.encode, self.guards];
        phases.iter().chain(&later).sum()
    }

    /// The receipt's `timing`, in seconds, with `wall` beside the phases.
    pub fn json(&self, wall: Duration) -> Value {
        let s = |d: Duration| d.as_secs_f64();
        json!({"prepare": s(self.prepare), "evaluate": s(self.evaluate), "draw": s(self.draw), "hash": s(self.hash),
            "convert": s(self.convert), "handoff": s(self.handoff), "encode": s(self.encode), "guards": s(self.guards),
            "wall": s(wall)})
    }
}
