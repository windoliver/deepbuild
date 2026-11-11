//! Issue #856: shaping off the UI thread. A text whose shaping the cost model estimates past 1 ms
//! is handed to the render worker's shaper here, which shapes it into the shaped-run cache; until
//! its [`Pending`] is ready the caller draws the text's last run and reports the frame settling
//! (canvas primitives: Text `text@1`; Render worker).
//!
//! Issue #140: it lives with the host, not in deep-text, so the canvas's text crate starts no
//! thread and builds for wasm32 with threads off.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;

use deep_text::shape::{Shaper, Span, Spec};

/// A text handed to the worker: ready once its run is in the shaped-run cache.
#[derive(Clone, Debug)]
pub struct Pending(Arc<AtomicBool>);

impl Pending {
    pub fn ready(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

struct Job {
    text: String,
    /// #417: the spec's fallback families and language, which the spec borrows.
    fallback: Vec<&'static str>,
    lang: Option<String>,
    /// #1964: the spec's styled spans, which it borrows.
    spans: Vec<Span>,
    spec: Spec<'static>,
    done: Arc<AtomicBool>,
}

static WORKER: LazyLock<Mutex<Sender<Job>>> = LazyLock::new(|| {
    let (send, jobs) = mpsc::channel::<Job>();
    thread::Builder::new()
        .name("deep-text shaper".into())
        .spawn(move || {
            let mut shaper = Shaper::new();
            for job in jobs {
                shaper.shape(&Spec {
                    text: &job.text,
                    fallback: &job.fallback,
                    lang: job.lang.as_deref(),
                    spans: &job.spans,
                    ..job.spec
                });
                job.done.store(true, Ordering::Release);
            }
        })
        .expect("the shaping worker starts");
    Mutex::new(send)
});

/// Shapes `spec` on the worker; its run lands in the shaped-run cache.
pub fn shape_later(spec: &Spec<'_>) -> Pending {
    let done = Arc::new(AtomicBool::new(false));
    // Every family is a bundled face's, so the worker holds each by the face's own name.
    let bundled = |name: &str| {
        deep_text::FACES
            .iter()
            .find(|f| f.family == name)
            .map_or("", |f| f.family)
    };
    let job = Job {
        text: spec.text.to_owned(),
        fallback: spec.fallback.iter().map(|f| bundled(f)).collect(),
        lang: spec.lang.map(str::to_owned),
        spans: spec.spans.to_vec(),
        spec: Spec {
            text: "",
            family: bundled(spec.family),
            fallback: &[],
            lang: None,
            size: spec.size,
            weight: spec.weight,
            line_height: spec.line_height,
            width: spec.width,
            max_lines: spec.max_lines,
            align: spec.align,
            bound: spec.bound,
            tabular: spec.tabular,
            mask: spec.mask,
            spans: &[],
        },
        done: done.clone(),
    };
    let sent = WORKER.lock().unwrap_or_else(|e| e.into_inner()).send(job);
    // A worker that is gone leaves nothing pending: the text shapes where it is drawn.
    if sent.is_err() {
        done.store(true, Ordering::Release);
    }
    Pending(done)
}
