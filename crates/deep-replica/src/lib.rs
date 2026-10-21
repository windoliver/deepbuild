//! Issue #338: the replica. A headless copy of the app, on gpui's virtual clock, that opens the
//! reference window, draws a shipped view and hands back a text snapshot of what a screen reader
//! would see, plus a screenshot. The checks that run in it live beside it: the Needs you kit, the
//! panel registry against the app's slots, and the snapshot against the live tree.

pub mod kit;
pub mod shell;
pub mod snapshot;

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

/// The fixture record's inbox as of its last event, on the virtual clock.
pub fn load_state() -> AppState {
    let fixture = Fixture::load(&fixture_path()).expect("the fixture record parses");
    let log_pos = fixture.last_log_pos();
    AppState {
        inbox: inbox(&fixture, log_pos),
        now: NOW,
        sessions: fixture.sessions(),
        held: Some(HELD.into()),
    }
}
