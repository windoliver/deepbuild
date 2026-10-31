//! A scenario's background jobs (issue #857): work that isn't a frame never takes a frame's time.
//! A playtest batch's replicas and a bake each check a document's session as `deep_show` would and
//! evaluate it frame after frame, 1/60 s apart and wrapping at its span, through the scheduler with
//! the pool its class sets, every thread at the platform's background priority, from before the
//! scenario's first call until its last has answered.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Barrier};

use serde_json::{json, Map, Value};

use crate::hub::{self, Hub, Planted, Scenario, Startup};
use crate::shared::FLICKS;
use crate::workers::{performance_cores, set_priority, Priority, Workers};

/// A job copy's progress: its job, its replica (a playtest's), and the frames it has evaluated.
pub type Progress = (&'static str, Option<usize>, Arc<AtomicU64>);

/// Runs `body` on this thread, at the live view's priority, with the scenario's background jobs
/// running on their own threads from before it to after it: `body` starts once every job copy
/// has checked its document and evaluated its first frame, and gets their progress.
pub fn around<T>(
    scenario: &Scenario,
    startup: &Startup,
    body: impl FnOnce(Vec<Progress>) -> T,
) -> T {
    if scenario.background.is_empty() {
        return body(Vec::new());
    }
    set_priority(Priority::Frame);
    let priority = if scenario.planted == Some(Planted::BackgroundAtLivePriority) {
        Priority::Frame
    } else {
        Priority::Background
    };
    let stop = AtomicBool::new(false);
    let copies: usize = scenario.background.iter().map(|j| j.replicas).sum();
    let started = Barrier::new(copies + 1);
    std::thread::scope(|scope| {
        let mut progress = Vec::new();
        for job in &scenario.background {
            for r in 0..job.replicas {
                let frames = Arc::new(AtomicU64::new(0));
                let replica = (job.kind == "playtest").then_some(r + 1);
                progress.push((job.kind, replica, frames.clone()));
                let (stop, started) = (&stop, &started);
                scope.spawn(move || {
                    set_priority(priority);
                    evaluate(
                        scenario,
                        startup,
                        &job.document,
                        priority,
                        &frames,
                        stop,
                        started,
                    );
                });
            }
        }
        started.wait();
        let out = body(progress);
        stop.store(true, Ordering::Relaxed);
        out
    })
}

/// One job copy: its own hub and scheduler, whose pool runs at `priority` with its class's count.
fn evaluate(
    scenario: &Scenario,
    startup: &Startup,
    document: &Value,
    priority: Priority,
    frames: &AtomicU64,
    stop: &AtomicBool,
    started: &Barrier,
) {
    let mut hub = Hub::new(scenario, startup);
    hub.sched.options.pool = Some(Arc::new(Workers {
        priority,
        performance_cores: performance_cores(),
    }));
    hub.sched.options.threads = None;
    let (Some(session), Some(doc)) = (scenario.sessions.keys().next(), scenario.docs.keys().next())
    else {
        started.wait();
        return;
    };
    let show = json!({"call": "deep_show", "session": session, "doc": doc, "document": document,
                      "include": ["issues"]});
    if let Some(call) = show.as_object().and_then(crate::call) {
        hub.call(&call);
    }
    let span = document["transport"]["span"]
        .as_str()
        .and_then(hub::flicks)
        .filter(|s| *s > 0);
    let mut k: i64 = 0;
    loop {
        let t = k * (FLICKS / 60);
        let ran = hub.job_frame(doc, span.map_or(t, |s| t % s), &Map::new());
        if ran {
            frames.fetch_add(1, Ordering::Relaxed);
        }
        if k == 0 {
            started.wait();
        }
        if !ran || stop.load(Ordering::Relaxed) {
            return;
        }
        k += 1;
    }
}
