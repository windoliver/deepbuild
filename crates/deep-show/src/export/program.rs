//! Issue #518: an encode tool that is a plug-in's own program (`run {dir, entry}`, `input:
//! memory`), run as a process of its own with no network, its stdin and stdout pipes in the
//! helpers' framing: one JSON object a line, and after a line with `"bytes": n`, n raw bytes.
//! The export opens it when the encode session opens, hands it each frame by a copy through
//! memory, and never has more than `frame_delay` + 2 frames out that the tool hasn't let go of:
//! a coded frame (`{"frame": k}`) is the wake. A frame that finds that window full for 10 s stops
//! the export, naming the frame. Nothing the tool says is trusted: its delivery is read back.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::feed::{stalled, WAIT};
use super::tools::Tool;

/// How long the tool may take to say its file is whole once its last frame is in.
const FINISH: Duration = Duration::from_secs(600);

/// What the tool said, one line each.
enum Said {
    /// Its encoder is open, this long after it was asked.
    Ready(f64),
    /// Its encoder let a frame go, and with it the slot the frame was in, at this time.
    Coded(Option<usize>, Instant),
    /// `out` is whole: its last line.
    Done(Value),
    Failed(String),
    /// Its stdout closed.
    Gone,
}

/// The wrong hand-offs a test must catch.
#[derive(Clone, Copy, Default)]
pub(crate) struct Planted {
    /// A frame waits for a free slot with no deadline.
    pub waits_forever: bool,
    /// Each frame is handed over as soon as it is hashed, never waiting for a coded frame.
    pub no_window: bool,
    /// A slot's index is sent before the GPU has put the frame in the slot.
    #[cfg_attr(
        not(target_os = "macos"),
        expect(dead_code, reason = "only macOS reads it")
    )]
    pub before_hash: bool,
}

/// A ring of GPU surface slots a tool is handed once, and the slots it doesn't hold.
#[cfg(target_os = "macos")]
pub(crate) struct Slots {
    gpu: std::sync::Arc<deep_gpu::device::Device>,
    slots: Vec<deep_gpu::surface::Slot>,
    free: Vec<usize>,
    /// #231: how many frames each slot is out for (a held frame is its slot again), and the
    /// slot last handed over.
    out: Vec<usize>,
    last: Option<usize>,
    /// The ring's name in the bootstrap namespace, this export's own.
    pub(crate) name: String,
}

#[cfg(target_os = "macos")]
impl Slots {
    /// `n` slots of `size` on the export's GPU device.
    pub(crate) fn new(
        gpu: std::sync::Arc<deep_gpu::device::Device>,
        size: [u16; 2],
        n: usize,
    ) -> Result<Slots, Value> {
        let made = (0..n).map(|_| deep_gpu::surface::Slot::new(&gpu, size.map(u32::from)));
        let slots = made
            .collect::<Result<Vec<_>, _>>()
            .map_err(|why| json!({"code": "gpu_unavailable", "why": why}))?;
        static RINGS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let k = RINGS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(Slots {
            gpu,
            slots,
            free: (0..n).rev().collect(),
            out: vec![0; n],
            last: None,
            name: format!("deepbuild.encode.{}.{k}", std::process::id()),
        })
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) struct Slots {
    free: Vec<usize>,
    out: Vec<usize>,
    last: Option<usize>,
}

impl Slots {
    /// The slot the next frame goes out in: a free one, or, for a held frame, the slot last
    /// handed over again, whether the tool still holds it or has let it go.
    fn take(&mut self, again: bool) -> Option<usize> {
        let i = match again {
            true => self.last.inspect(|i| self.free.retain(|f| f != i))?,
            false => self.free.pop()?,
        };
        self.out[i] += 1;
        self.last = Some(i);
        Some(i)
    }

    /// The tool let slot `i` go for one frame: it is free once it is out for none.
    fn back(&mut self, i: usize) {
        if let Some(n) = self.out.get_mut(i).filter(|n| **n > 0) {
            *n -= 1;
            if *n == 0 {
                self.free.push(i);
            }
        }
    }
}

/// One encode job in a plug-in's program.
pub(crate) struct Session {
    tool: String,
    child: Child,
    stdin: Option<ChildStdin>,
    said: Receiver<Said>,
    window: usize,
    /// Frames handed over that the tool hasn't let go of.
    out: usize,
    /// The open's seconds, once the tool has answered it.
    opened: Option<f64>,
    planted: Planted,
    /// The ring of GPU surfaces the tool was handed, when it takes its frames that way.
    ring: Option<Slots>,
    /// #231: how long the tool has held at least one frame, since when it holds one now, and
    /// how long handing it its frames took.
    busy: Duration,
    since: Option<Instant>,
    handing: Duration,
}

fn failed(tool: &str, code: &str, what: String) -> Value {
    json!({"outcome": "failed", "code": code, "tool": tool,
        "issues": [{"code": code, "severity": "error", "tool": tool, "what": what}]})
}

/// The command a tool runs by, with no network: on macOS inside a sandbox that denies it, as the
/// decode worker's does.
fn command(argv: &[String]) -> Command {
    const SANDBOX: &str = "/usr/bin/sandbox-exec";
    if cfg!(target_os = "macos") && Path::new(SANDBOX).exists() {
        let mut c = Command::new(SANDBOX);
        c.args(["-p", "(version 1)(allow default)(deny network*)"])
            .args(argv);
        return c;
    }
    let mut c = Command::new(&argv[0]);
    c.args(&argv[1..]);
    c
}

impl Session {
    /// Starts the tool's program and asks it to open: `open` is the job as its wire gives it.
    /// It doesn't wait for the answer, so the open runs beside the export's preparing.
    pub(crate) fn start(
        tool: &Tool,
        argv: &[String],
        cwd: &Path,
        open: &Value,
        planted: Planted,
        ring: Option<Slots>,
    ) -> Result<Session, Value> {
        let id = tool.id.clone();
        // The ring's name is checked in before the tool starts, so the tool finds it.
        #[cfg(target_os = "macos")]
        let offer = match &ring {
            Some(r) => Some(
                deep_codecs::surface::Offer::new(&r.name)
                    .map_err(|why| failed(&id, "handoff_failed", why))?,
            ),
            None => None,
        };
        let unstarted = |e: std::io::Error| {
            failed(
                &id,
                "encoder_unstarted",
                format!("the encode tool {id} didn't start: {e}"),
            )
        };
        let mut child = command(argv)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(unstarted)?;
        let mut stdin = child.stdin.take().expect("piped");
        let stdout = child.stdout.take().expect("piped");
        let asked = Instant::now();
        // A tool that ends before it reads its open says so on its stdout's end.
        let _ = writeln!(stdin, "{open}").and_then(|()| stdin.flush());
        let (tx, said) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let v: Value = serde_json::from_str(&line).unwrap_or_default();
                let one = if v["ready"] == true {
                    Said::Ready(asked.elapsed().as_secs_f64())
                } else if v["done"] == true {
                    Said::Done(v)
                } else if let Some(e) = v.get("error") {
                    Said::Failed(e.as_str().map_or_else(|| e.to_string(), str::to_string))
                } else if v.get("frame").is_some() {
                    Said::Coded(v["slot"].as_u64().map(|i| i as usize), Instant::now())
                } else {
                    continue;
                };
                if tx.send(one).is_err() {
                    return;
                }
            }
            let _ = tx.send(Said::Gone);
        });
        // The slots cross once, in one Mach message, when the tool asks for them at its open.
        #[cfg(target_os = "macos")]
        if let (Some(offer), Some(r)) = (&offer, &ring) {
            let surfaces: Vec<_> = r.slots.iter().map(|s| s.surface()).collect();
            // SAFETY: each pointer is a slot's own surface, which the ring keeps alive.
            if let Err(why) = unsafe { offer.send(&surfaces, WAIT.as_millis() as u32) } {
                let _ = child.kill();
                let _ = child.wait();
                return Err(failed(&id, "handoff_failed", why));
            }
        }
        Ok(Session {
            tool: tool.id.clone(),
            child,
            stdin: Some(stdin),
            said,
            window: tool.window(),
            out: 0,
            opened: None,
            planted,
            ring,
            busy: Duration::ZERO,
            since: None,
            handing: Duration::ZERO,
        })
    }

    /// How the tool takes its frames, as the receipt says it: `surface` or `copy`.
    pub(crate) fn handoff(&self) -> &'static str {
        match self.ring {
            Some(_) => "surface",
            None => "copy",
        }
    }

    /// The open's seconds, from the ask to the tool's answer, once it has answered.
    pub(crate) fn opened(&self) -> Option<f64> {
        self.opened
    }

    /// One thing the tool said, noted; an error or its end is the job's failure.
    fn heard(&mut self, said: Said) -> Result<Option<Value>, Value> {
        match said {
            Said::Ready(seconds) => self.opened = Some(seconds),
            Said::Coded(slot, at) => {
                self.out = self.out.saturating_sub(1);
                if let Some(since) = self.since.take_if(|_| self.out == 0) {
                    self.busy += at.saturating_duration_since(since);
                }
                if let (Some(r), Some(i)) = (&mut self.ring, slot) {
                    r.back(i);
                }
            }
            Said::Done(v) => return Ok(Some(v)),
            Said::Failed(why) => {
                return Err(failed(
                    &self.tool,
                    "encoder_failed",
                    format!("the encode tool {} failed: {why}", self.tool),
                ))
            }
            Said::Gone => {
                return Err(failed(
                    &self.tool,
                    "encoder_failed",
                    format!(
                        "the encode tool {} ended before its file was whole",
                        self.tool
                    ),
                ))
            }
        }
        Ok(None)
    }

    /// Waits until `met` holds of what the tool has said, at most `wait` when given; `Ok(false)`
    /// when the wait ran out first.
    fn until(
        &mut self,
        wait: Option<Duration>,
        met: impl Fn(&Session) -> bool,
    ) -> Result<bool, Value> {
        let deadline = wait.map(|w| Instant::now() + w);
        while let Ok(said) = self.said.try_recv() {
            self.heard(said)?;
        }
        while !met(self) {
            let said = match deadline {
                Some(d) => match self
                    .said
                    .recv_timeout(d.saturating_duration_since(Instant::now()))
                {
                    Ok(s) => s,
                    Err(RecvTimeoutError::Timeout) => return Ok(false),
                    Err(RecvTimeoutError::Disconnected) => Said::Gone,
                },
                None => self.said.recv().unwrap_or(Said::Gone),
            };
            self.heard(said)?;
        }
        Ok(true)
    }

    /// Hands frame `k` to the tool once it is open and fewer than its window's frames are out;
    /// `key` asks for a key frame.
    pub(crate) fn push(&mut self, k: i64, bytes: &[u8], key: bool) -> Result<(), Value> {
        self.hand(k, bytes, key, false, None)
    }

    /// #231: hands frame `k` to a tool that takes GPU surfaces from `input`, the buffer the
    /// frame's BGRA8 rows were hashed in: a free slot takes it by a copy on the GPU, so the
    /// frame's pixels never pass through memory.
    pub(crate) fn push_from(
        &mut self,
        k: i64,
        input: &wgpu::Buffer,
        key: bool,
    ) -> Result<(), Value> {
        self.hand(k, &[], key, false, Some(input))
    }

    /// #231: hands frame `k` to the tool as the frame before it again: by GPU surface the same
    /// slot's index, which nothing is drawn into; by copy the same `bytes`.
    pub(crate) fn repeat(&mut self, k: i64, bytes: &[u8], key: bool) -> Result<(), Value> {
        self.hand(k, bytes, key, true, None)
    }

    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    fn hand(
        &mut self,
        k: i64,
        bytes: &[u8],
        key: bool,
        again: bool,
        from: Option<&wgpu::Buffer>,
    ) -> Result<(), Value> {
        if !self.until(Some(WAIT), |s| s.opened.is_some())? {
            return Err(stalled(k));
        }
        let wait = (!self.planted.waits_forever).then_some(WAIT);
        let window = self.window;
        if !self.planted.no_window && !self.until(wait, |s| s.out < window)? {
            return Err(stalled(k));
        }
        #[cfg(target_os = "macos")]
        let full = bytes;
        // By GPU surface: the frame is put in a free slot on the GPU, and the slot's index is
        // sent once that work, and the frame's hash before it, is done. Nothing else crosses.
        let at = Instant::now();
        let slot = self.ring.as_mut().and_then(|r| r.take(again));
        if self.ring.is_some() && slot.is_none() {
            return Err(stalled(k));
        }
        #[cfg(target_os = "macos")]
        if let (Some(r), Some(i), false) = (&self.ring, slot, self.planted.before_hash || again) {
            match from {
                Some(input) => r.slots[i].take(&r.gpu, input),
                None => r.slots[i].fill(&r.gpu, bytes),
            }
        }
        let (head, bytes) = match slot {
            Some(i) => (json!({"frame": k, "key": key, "slot": i}), &[][..]),
            None => (json!({"frame": k, "key": key, "bytes": bytes.len()}), bytes),
        };
        let (Some(stdin), child) = (self.stdin.as_mut(), &mut self.child) else {
            return Err(stalled(k));
        };
        // The write runs on its own thread, so a tool that stops reading is ended, by its own
        // PID, when the wait is over; its pipe then breaks and the thread ends.
        let sent = std::thread::scope(|s| {
            let (tx, rx) = mpsc::channel();
            s.spawn(move || {
                let ok = writeln!(stdin, "{head}").is_ok()
                    && stdin.write_all(bytes).is_ok()
                    && stdin.flush().is_ok();
                let _ = tx.send(ok);
            });
            let sent = match wait {
                Some(w) => rx.recv_timeout(w).ok(),
                None => rx.recv().ok(),
            };
            if sent.is_none() {
                let _ = child.kill();
            }
            sent
        });
        self.handing += at.elapsed();
        match sent {
            Some(true) => {
                if self.out == 0 {
                    self.since = Some(Instant::now());
                }
                self.out += 1;
                // Planted: the slot went out before the frame was in it. The frame is put there
                // only once the tool has let the slot go, so the tool read what it held before.
                #[cfg(target_os = "macos")]
                if let (Some(i), true) = (slot, self.planted.before_hash && !again) {
                    let _ = self.until(Some(WAIT), |s| {
                        s.ring.as_ref().is_some_and(|r| r.free.contains(&i))
                    })?;
                    if let Some(r) = &self.ring {
                        r.slots[i].fill(&r.gpu, full);
                    }
                }
                Ok(())
            }
            // A tool that closed its stdin says why on its stdout, or ends.
            Some(false) => match self.until(Some(WAIT), |_| false) {
                Err(e) => Err(e),
                Ok(_) => Err(stalled(k)),
            },
            None => Err(stalled(k)),
        }
    }

    /// Tells the tool the film has ended and waits for its file: its last line, with its own
    /// report, which nothing trusts.
    pub(crate) fn finish(mut self) -> Result<Value, Value> {
        if let Some(mut stdin) = self.stdin.take() {
            let _ = writeln!(stdin, "{}", json!({"end": true})).and_then(|()| stdin.flush());
        }
        let deadline = Instant::now() + FINISH;
        loop {
            let said = self
                .said
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap_or(Said::Gone);
            if let Some(mut done) = self.heard(said)? {
                let _ = self.child.wait();
                // #231: with its last line, the seconds the hand-off took and the tool held a
                // frame.
                if let Some(o) = done.as_object_mut() {
                    let spent = json!([self.handing.as_secs_f64(), self.busy.as_secs_f64()]);
                    o.insert("spent".into(), spent);
                }
                return Ok(done);
            }
        }
    }
}

impl Drop for Session {
    /// A job that isn't finished is stopped: the tool's stdin closes, and the process the
    /// export started is ended by its own PID and waited for.
    fn drop(&mut self) {
        drop(self.stdin.take());
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}
