//! One instance of the build's canvas: a scheduler with its own content-key cache and a document
//! session, on a thread of its own, so whatever a module keeps outside its writes (a static a
//! planted module leaves a value in) starts empty, as it would in a new process. The kit's
//! comparisons are between instances: a live one and a clean rebuild, a warm one and a cold one,
//! one order and another.

use std::collections::BTreeMap;
use std::path::PathBuf;

use deep_canvas::registry::Sealed;
use deep_canvas::schedule::{
    default_view, NodeReport, OpIssue, Options, Planted, Scheduler, Session, Target, Tokens,
};
use serde_json::Value;

/// One node as the kit compares it: its operator, item, key and result.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Node {
    pub operator: String,
    pub module: String,
    pub item: Option<String>,
    pub key: String,
    pub result: String,
}

impl Node {
    fn of(n: NodeReport) -> Node {
        Node {
            operator: n.operator,
            module: n.module,
            item: n.item,
            key: n.key,
            result: n.result,
        }
    }

    /// `operator` on `item`, or the operator alone per document.
    pub fn place(&self) -> String {
        match &self.item {
            Some(i) => format!("{}@{i}", self.operator),
            None => self.operator.clone(),
        }
    }
}

/// What an evaluation left: its nodes, by place, and the operators' issues.
#[derive(Clone, Debug, Default)]
pub struct Evaluated {
    pub nodes: BTreeMap<String, Node>,
    pub issues: Vec<OpIssue>,
    /// An operator panicked.
    pub panicked: bool,
}

impl Evaluated {
    pub fn of_session(session: &Session, s: &Scheduler<'_>) -> Evaluated {
        let issues = session.report.issues.clone();
        let panicked =
            issues.iter().any(|i| i.code == "operator_panic") || session.frozen().is_some();
        Evaluated {
            nodes: session
                .nodes(s)
                .into_iter()
                .map(Node::of)
                .map(|n| (n.place(), n))
                .collect(),
            issues,
            panicked,
        }
    }
}

/// How an instance schedules: the shuffle seed and the planted scheduler.
#[derive(Clone, Debug, Default)]
pub struct How {
    pub shuffle: Option<u32>,
    pub planted: Planted,
}

impl How {
    pub fn options(&self) -> Options {
        Options {
            access_log: true,
            shuffle: self.shuffle,
            planted: self.planted.clone(),
            timing: None,
            pool: None,
            threads: None,
        }
    }
}

/// Runs `f` on a new thread, as a new instance, and returns what it returns.
pub fn fresh<T: Send>(f: impl FnOnce() -> T + Send) -> T {
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .stack_size(64 << 20)
            .spawn_scoped(scope, f)
            .expect("a kit instance's thread starts")
            .join()
            .unwrap_or_else(|e| std::panic::resume_unwind(e))
    })
}

/// A session over `doc`, loaded, with the look's tokens and the record's readings.
pub fn session(
    s: &mut Scheduler<'_>,
    doc: &Value,
    look: &Tokens,
    readings: &BTreeMap<String, Value>,
) -> Session {
    let mut session = Session::new(0, look.clone());
    session.set_readings(readings.clone());
    session.load(s, doc);
    session
}

/// The document's own view, at `t`.
pub fn view(doc: &Value) -> [Value; 6] {
    default_view(doc)
}

/// A clean evaluation of `doc` at each of `times` on a new instance, perturbed as `perturb`
/// says, after one evaluation that warms the instance as a process's first frame would.
pub fn clean_at(
    sealed: &Sealed,
    how: &How,
    doc: &Value,
    look: &Tokens,
    readings: &BTreeMap<String, Value>,
    times: &[i64],
    perturb: Option<Target>,
) -> Vec<Evaluated> {
    fresh(|| {
        let mut s = Scheduler::new(sealed, how.options());
        let session = session(&mut s, doc, look, readings);
        let v = view(doc);
        let _ = session.clean(&mut s, times.first().copied().unwrap_or(0), &v, None);
        times
            .iter()
            .map(|&t| {
                let scratch = session.clean(&mut s, t, &v, perturb.clone());
                Evaluated::of_session(&scratch, &s)
            })
            .collect()
    })
}

/// A warm instance: one session that plays `times` in the order given, each its own frame.
pub fn warm_at(
    sealed: &Sealed,
    how: &How,
    doc: &Value,
    look: &Tokens,
    readings: &BTreeMap<String, Value>,
    times: &[i64],
) -> Vec<Evaluated> {
    fresh(|| {
        let mut s = Scheduler::new(sealed, how.options());
        let mut session = session(&mut s, doc, look, readings);
        let v = view(doc);
        times
            .iter()
            .map(|&t| {
                session.frame(&mut s, t, &v);
                Evaluated::of_session(&session, &s)
            })
            .collect()
    })
}

/// Draws an instance's frames on Vello CPU: one renderer per thread.
pub struct Painter {
    renderer: crate::snapshot::Renderer,
    evidence: PathBuf,
    ground: [u8; 3],
}

impl Painter {
    pub fn new(evidence: PathBuf, ground: [u8; 3]) -> Painter {
        Painter {
            renderer: crate::snapshot::Renderer::new(),
            evidence,
            ground,
        }
    }

    /// The session's last frame as marks2d drew it, at `size` px, as RGBA; or the code it
    /// can't be drawn with.
    pub fn pixels(
        &mut self,
        s: &Scheduler<'_>,
        session: &Session,
        size: [u16; 2],
    ) -> Result<Vec<u8>, String> {
        let drawing =
            crate::frames::drawing_of(s, session).ok_or_else(|| "no_drawing".to_string())?;
        let drawn = self
            .renderer
            .prepare_drawing(&drawing, &self.evidence)
            .map_err(|u| u.code.to_string())?;
        Ok(self.renderer.raster(&drawn, size, Some(self.ground)))
    }
}

/// A document's size fit within `max` px on its longer side.
pub fn fit(doc: &Value, max: f64) -> [u16; 2] {
    let w = doc["size"][0].as_f64().unwrap_or(320.0).max(1.0);
    let h = doc["size"][1].as_f64().unwrap_or(200.0).max(1.0);
    let k = (max / w.max(h)).min(1.0);
    [
        (w * k).round().max(1.0) as u16,
        (h * k).round().max(1.0) as u16,
    ]
}

/// The record's readings a fixture's bound values read: handle → its reading.
pub fn readings(record: Option<&Value>) -> BTreeMap<String, Value> {
    record
        .and_then(Value::as_object)
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default()
}

/// How many threads a part spreads its cases over.
pub fn threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8)
}

/// Runs `f` on each index in `0..n` across threads, each thread with its own state from
/// `state`, and returns the results in index order.
pub fn spread<S, T: Send>(
    n: usize,
    state: impl Fn() -> S + Sync,
    f: impl Fn(&mut S, usize) -> T + Sync,
) -> Vec<T> {
    let k = threads().min(n.max(1));
    let chunks: Vec<Vec<(usize, T)>> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..k)
            .map(|t| {
                let (state, f) = (&state, &f);
                std::thread::Builder::new()
                    .stack_size(64 << 20)
                    .spawn_scoped(scope, move || {
                        let mut s = state();
                        (0..n)
                            .filter(|i| i % k == t)
                            .map(|i| (i, f(&mut s, i)))
                            .collect::<Vec<_>>()
                    })
                    .expect("a kit thread starts")
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or_else(|e| std::panic::resume_unwind(e)))
            .collect()
    });
    let mut all: Vec<(usize, T)> = chunks.into_iter().flatten().collect();
    all.sort_by_key(|(i, _)| *i);
    all.into_iter().map(|(_, t)| t).collect()
}

/// The first place two evaluations differ, by key or result, among nodes outside `skip`.
pub fn first_difference(
    a: &Evaluated,
    b: &Evaluated,
    skip: &dyn Fn(&Node) -> bool,
) -> Option<String> {
    for (place, n) in &a.nodes {
        if skip(n) {
            continue;
        }
        match b.nodes.get(place) {
            Some(m) if m.key == n.key && m.result == n.result => {}
            _ => return Some(place.clone()),
        }
    }
    b.nodes
        .keys()
        .find(|p| !a.nodes.contains_key(*p) && !skip(&b.nodes[*p]))
        .cloned()
}
