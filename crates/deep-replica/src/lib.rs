//! Issue #338: the replica. A headless copy of the app, on gpui's virtual clock, that opens the
//! reference window, draws a shipped view and hands back a text snapshot of what a screen reader
//! would see, plus a screenshot. The checks that run in it live beside it: the Needs you kit, the
//! panel registry against the app's slots, and the snapshot against the live tree.

// A release build refuses the planted programs' feature (#1408).
#[cfg(all(feature = "env-plants", not(debug_assertions)))]
compile_error!("the env-plants feature is for test builds only, never a release build");

pub mod drive;
pub mod kit;
mod replica;
pub mod shell;
pub mod snapshot;
pub mod terminal;

pub use deep_app::notify::{Notifier, Sound, NOTIFY_AFTER};
pub use replica::{
    Approve, CardSeen, Client, Confirmation, Input, Killed, On, Phase, Planted, Posted, Replica,
    Seen, Slot, Source, Step,
};

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use deep_app::{
    events::{inbox, Fixture},
    views::AppState,
};
use gpui_kit::{assets::Assets, HeadlessAppContext};

/// The virtual clock's time, in ms since the epoch: every open ask's deadline comes after it.
pub const NOW: u64 = 1_800_000_000_000;
/// The ask held for a message its agent hasn't read; the hub records no event for a hold yet.
pub const HELD: &str = "ask:01MCBKEP00AF27SH36Z7R1YMBQ";
/// The reference window, in points, at 2×.
pub const WINDOW: (f32, f32) = (1512., 982.);
pub const SCALE: f32 = 2.;
/// The line the replica prints once the shell's first frame is drawn; a launch is timed from the
/// process's spawn to this line, so the screenshot and the files it writes afterwards don't count.
pub const FIRST_FRAME: &str = "deep-replica: first frame drawn";

/// The headless app: GPUI's own text system for the chrome, the kit's assets and the offscreen
/// renderer, with the kit and the app initialized.
pub fn headless_context() -> HeadlessAppContext {
    let mut cx = HeadlessAppContext::with_platform(
        gpui_kit::platform::current_platform(true).text_system(),
        Arc::new(Assets),
        gpui_kit::platform::current_headless_renderer,
    );
    cx.update(|cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
    });
    cx
}

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn fixture_path() -> PathBuf {
    repo_root().join("docs/spikes/338/fixtures/needs-you.events.jsonl")
}

/// A panel's directory under `crates/deep-app/panels/`.
pub fn panel_dir(name: &str) -> PathBuf {
    repo_root().join("crates/deep-app/panels").join(name)
}

/// The view name `--first-screen` stands for: the app's first screen, Home, drawn for the HOME it runs with.
pub const FIRST_SCREEN: &str = "first-screen";

/// The replica's view of the look's 16 terminal colors on the terminal's background (#1003).
pub const TERMINAL_COLORS: &str = "terminal-colors";

/// `--view <id> --out <out>` from the command line, the view a shipped one (or `--first-screen`), and where `replica`
/// takes them, `--appearance <light|dark>` as whether macOS is set to dark (#882) and `--bound <file>`, the runs and
/// bound values to draw (#629); else the usage error is printed under `bin`'s name and the exit code is 2. The replica
/// also takes the `terminal-colors` view, and `--selected-row <n>` and `--focused-row <n>`, the sidebar rows it opens
/// selected and focused (#1003).
pub fn view_args(bin: &str, out: &str, replica: bool) -> Result<ViewArgs, i32> {
    let (mut view, mut path, mut dark, mut bound) = (None, None, None, None);
    let (mut selected, mut focused) = (None, None);
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            row @ ("--selected-row" | "--focused-row") if replica => {
                let Some(n) = args.next().and_then(|n| n.parse::<usize>().ok()) else {
                    eprintln!("{bin}: {row} is a row's index from 0");
                    return Err(2);
                };
                *(if row == "--selected-row" {
                    &mut selected
                } else {
                    &mut focused
                }) = Some(n);
            }
            "--view" => view = args.next(),
            // #1002: the app's first screen as a launch shows it for this HOME, over its own record, not the fixture.
            "--first-screen" => view = Some(FIRST_SCREEN.to_owned()),
            "--out" => path = args.next().map(PathBuf::from),
            "--bound" if replica => bound = args.next().map(PathBuf::from),
            "--appearance" if replica => match args.next().as_deref() {
                Some("light") => dark = Some(false),
                Some("dark") => dark = Some(true),
                other => {
                    eprintln!("{bin}: --appearance is light or dark, not {other:?}");
                    return Err(2);
                }
            },
            other => {
                eprintln!("{bin}: unknown argument {other}");
                return Err(2);
            }
        }
    }
    let (Some(view), Some(path)) = (view, path) else {
        eprintln!("usage: {bin} --view <id> --out <{out}>");
        return Err(2);
    };
    let extra = replica && view == TERMINAL_COLORS;
    if view != FIRST_SCREEN && !extra && !deep_app::views::SHIPPED_VIEWS.contains(&view.as_str()) {
        let shipped = deep_app::views::SHIPPED_VIEWS;
        eprintln!("{bin}: {view} is not a shipped view; the views are {shipped:?}");
        return Err(2);
    }
    deep_app::views::start_sidebar(selected, focused);
    Ok((view, path, dark, bound))
}

/// What `view_args` reads: the view, where to write, the appearance and the bound values' file.
pub type ViewArgs = (String, PathBuf, Option<bool>, Option<PathBuf>);

/// Issue #629: `--bound <file>`, `{"runs": [{run, check, tool, report}], "card": [{id, bind}], "panel": [{id,
/// bind}]}`: each run recorded from its tool's report, as the hub records it, and each bound value resolved by the
/// app from those runs, on the session's return card or in a panel.
pub fn load_bound(path: &Path) -> Result<(), String> {
    use deep_app::bound::{self, Run, Surface};
    use serde_json::Value;
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let input: Value =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    let field = |v: &Value, k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(format!("--bound: no {k}"))
    };
    let mut runs = Vec::new();
    for r in input
        .get("runs")
        .and_then(Value::as_array)
        .ok_or("--bound: no runs")?
    {
        let report =
            std::fs::read(field(r, "report")?).map_err(|e| format!("--bound: report: {e}"))?;
        let run = Run::from_report(
            field(r, "run")?,
            field(r, "check")?,
            &field(r, "tool")?,
            &report,
        )
        .ok_or("--bound: the report isn't its tool's JSON report")?;
        runs.push(run);
    }
    let mut binds = Vec::new();
    for (surface, key) in [(Surface::Card, "card"), (Surface::Panel, "panel")] {
        for b in input
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            binds.push((
                surface,
                field(b, "id")?,
                b.get("bind").cloned().ok_or("--bound: no bind")?,
            ));
        }
    }
    bound::set(&runs, &binds)
        .ok_or_else(|| "--bound: a bind isn't a run's expected or received value".to_owned())
}

/// Issue #629: every bound value drawn, `{"bound": [{surface, id, text, missing, bounds}]}`, its bounds its node's in
/// the screenshot's device pixels.
pub fn bound_listing(snapshot: &snapshot::Snapshot) -> serde_json::Value {
    use deep_app::bound::{on, Surface};
    let nodes = snapshot.flatten();
    let listed: Vec<serde_json::Value> = [Surface::Card, Surface::Panel]
        .into_iter()
        .flat_map(on)
        .map(|b| {
            let name = b.name();
            let bounds = nodes.iter().find(|n| n.name.as_deref() == Some(name.as_str())).map(|n| n.bounds);
            serde_json::json!({"surface": b.surface.name(), "id": b.id, "text": b.text, "missing": b.missing, "bounds": bounds})
        })
        .collect();
    serde_json::json!({ "bound": listed })
}

/// The fixture record's inbox as of its last event, on the virtual clock.
pub fn load_state() -> AppState {
    let fixture = Fixture::load(&fixture_path()).expect("the fixture record parses");
    let log_pos = fixture.last_log_pos();
    // Every view reads the record through the one reader; the replica's holds the fixture.
    deep_app::record::install_local(fixture.events());
    AppState {
        inbox: inbox(&fixture, log_pos),
        now: NOW,
        sessions: fixture.sessions(),
        held: Some(HELD.into()),
    }
}
