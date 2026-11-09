//! Issue #629: bound values on a run's assertions, on a session's return card and in a panel
//! (technical design: Bound value in panels). Each reads the value its run's report recorded for
//! one assertion, `run:<id>#<assertion>` with `select: expected | received`, resolved natively by
//! the app from the run's record entry, never from what an agent said about the run.

#[cfg(feature = "fixtures")]
use std::cell::RefCell;

use deep_canvas_marks::runs::{self, Assertion};
use serde_json::Value;

/// Where a bound value draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Surface {
    /// The session's return card.
    Card,
    /// A panel in the window.
    Panel,
}

impl Surface {
    pub fn name(self) -> &'static str {
        match self {
            Surface::Card => "card",
            Surface::Panel => "panel",
        }
    }
}

/// A run in the record: its handle, its check, and the tests its tool's report names.
#[derive(Clone, Debug)]
pub struct Run {
    pub run: String,
    pub check: String,
    pub assertions: Vec<Assertion>,
}

/// A bound value as a frame draws it: its text, or why it reads missing.
#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub surface: Surface,
    pub id: String,
    /// The run's check and the assertion the value comes from.
    pub from: String,
    pub text: String,
    pub missing: Option<Value>,
}

impl Shown {
    /// The accessibility name its node carries, which the replica finds it by.
    pub fn name(&self) -> String {
        format!("{} {}: {}", self.surface.name(), self.id, self.text)
    }
}

impl Run {
    /// A run of `check` recorded from its tool's report, as the hub records it; `None` for a
    /// report that isn't that tool's JSON report.
    pub fn from_report(run: String, check: String, tool: &str, report: &[u8]) -> Option<Run> {
        Some(Run {
            run,
            check,
            assertions: runs::assertions(tool, report)?,
        })
    }
}

#[cfg(feature = "fixtures")]
thread_local! {
    static BOUND: RefCell<Vec<Shown>> = const { RefCell::new(Vec::new()) };
}

/// Resolves each bind against the runs and keeps what the views draw. `None` for a bind that
/// isn't one: its source not a run's assertion, its select neither value, or its format refused. A replica's door,
/// in no shipped build (#1457).
#[cfg(feature = "fixtures")]
pub fn set(runs: &[Run], binds: &[(Surface, String, Value)]) -> Option<()> {
    let shown = binds
        .iter()
        .map(|(surface, id, bind)| resolve(runs, *surface, id, bind))
        .collect::<Option<Vec<_>>>()?;
    BOUND.with(|cell| *cell.borrow_mut() = shown);
    Some(())
}

/// What the views draw on `surface`: nothing in a build without the replica's door.
#[cfg(not(feature = "fixtures"))]
pub fn on(_: Surface) -> Vec<Shown> {
    Vec::new()
}

/// What the views draw on `surface`.
#[cfg(feature = "fixtures")]
pub fn on(surface: Surface) -> Vec<Shown> {
    BOUND.with(|cell| {
        cell.borrow()
            .iter()
            .filter(|b| b.surface == surface)
            .cloned()
            .collect()
    })
}

#[cfg(feature = "fixtures")]
fn resolve(runs: &[Run], surface: Surface, id: &str, bind: &Value) -> Option<Shown> {
    let source = bind.get("source")?.as_str()?;
    let (run, assertion) = runs::source(source)?;
    let assertion = assertion.as_str();
    let select = bind
        .get("select")?
        .as_str()
        .filter(|s| matches!(*s, "expected" | "received"))?;
    let unit = bind.get("format").and_then(|f| f.get("unit")?.as_str());
    let of = runs.iter().find(|r| r.run == run);
    let printed = of
        .and_then(|r| r.assertions.iter().find(|a| a.assertion == assertion))
        .and_then(|a| match select {
            "expected" => a.expected.as_deref(),
            _ => a.received.as_deref(),
        });
    let value = printed.and_then(|raw| runs::value(raw, unit));
    let missing = match (of, value) {
        (_, Some(_)) => None,
        (None, None) => Some(runs::missing("not_recorded", &run, assertion, select)),
        (Some(_), None) => Some(runs::missing("not_reported", &run, assertion, select)),
    };
    Some(Shown {
        surface,
        id: id.to_string(),
        from: format!(
            "{} · {assertion}",
            of.map_or("no run", |r| r.check.as_str())
        ),
        text: runs::text(bind, source, value, 0)?,
        missing,
    })
}
