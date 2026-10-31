//! Issue #338: the replica. A headless copy of the app, on gpui's virtual clock, that opens the
//! reference window, draws a shipped view and hands back a text snapshot of what a screen reader
//! would see, plus a screenshot. The checks that run in it live beside it: the Needs you kit, the
//! panel registry against the app's slots, and the snapshot against the live tree.

pub mod drive;
pub mod kit;
mod replica;
pub mod shell;
pub mod snapshot;

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

/// `--view <id> --out <out>` from the command line, the view a shipped one, and where `appearance`
/// takes it, `--appearance <light|dark>` as whether macOS is set to dark (#882); else the usage error
/// is printed under `bin`'s name and the exit code is 2.
pub fn view_args(
    bin: &str,
    out: &str,
    appearance: bool,
) -> Result<(String, PathBuf, Option<bool>), i32> {
    let (mut view, mut path, mut dark) = (None, None, None);
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--view" => view = args.next(),
            "--out" => path = args.next().map(PathBuf::from),
            "--appearance" if appearance => match args.next().as_deref() {
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
    if !deep_app::views::SHIPPED_VIEWS.contains(&view.as_str()) {
        let shipped = deep_app::views::SHIPPED_VIEWS;
        eprintln!("{bin}: {view} is not a shipped view; the views are {shipped:?}");
        return Err(2);
    }
    Ok((view, path, dark))
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
