//! The wrong programs the suites must catch (`DEEP_DRIVE_PLANT`): each lifts one of the guards that keep a replica's
//! input inside it and lets that one thing reach your Mac or your record, or draws the wrong the UI check must name.

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::Path,
    time::Duration,
};

use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plant {
    /// A click on an ask's row answers it in your hub, as you.
    AnswersYourRecord,
    /// A panel's clipboard write reaches the system pasteboard.
    WritesClipboard,
    /// #1498: ⌘C writes a text's selected graphemes in the order they are drawn, not in logical order.
    CopiesDrawnOrder,
    /// #1498: ⌘C joins the selected text items in their draw order, not in reading order.
    CopiesDrawOrder,
    /// The replica takes the front of your screen when it is acted on.
    MovesFocus,
    /// The app's notification sound plays through the OS.
    StartsSound,
    /// A page opened from ⌘K mounts without its parameter (#366 criterion 3).
    PageDropsParam,
    /// ⌘K ranks by the live app's recency file, which a replica never reads (#366 criterion 6).
    RanksByLiveRecency,
    /// Pointer actions go straight to their target's box centre, whatever would get them (#124 criterion 6).
    NoHitTest,
    /// The session row draws its label past its frame (#124 criterion 7).
    RowLabelPastFrame,
    /// The session row draws its text cut off and names only what it drew (#124 criterion 7).
    RowBranchCutOff,
    /// After each action the whole tree draws 30% of the window to the right for one step (#1427 criterion 7).
    JumpsOnAct,
    /// Before every frame it asks GPUI for, the replica notifies the window's root, so every frame draws (#1546
    /// criterion 3).
    NotifiesEveryStep,
    /// A menu takes every release as a pick or a close, drag or not (#1470 criterion 2).
    MenuReleaseAlways,
    /// A play's recorded track leaves out the run's first bot entry, which the run itself read (#184 criterion 6).
    DropsFirstBotEntry,
    /// A logic bot's play makes an entry only when its value changes, not its serial (#184 criterion 10).
    EntryOnChange,
    /// The explorer and the descender walk as if the grid had no links (#1048 criterion 4).
    IgnoresLinks,
    /// Each pointer move the replica delivers also notifies the window's root view (#1482 criterion 5).
    NotifiesRootPerMove,
    /// Every read-back of a frame fails (#1482 criterion 4).
    ReadBackFails,
    /// The report names no notified entity: the record of `App::notify` dropped (#1482 criterion 6).
    DropsNotifyRecord,
    /// The lists arm's two views notify themselves on every wheel event they get (#1482 criterion 7).
    WheelNotifiesEveryEvent,
    /// GPUI reuses a cached view as it did before it kept the view's accessibility nodes (#1482 criterion 8).
    ReuseDropsAccessibility,
    /// A play under `piece_seed: run` keeps the document's seed, so every run generates the same floors (#556
    /// criterion 3).
    KeepsDocumentSeed,
    /// #851: a game shell's pause lets the level's clock run.
    ShellPauseRunsClock,
    /// #851: a game shell leaves focus on a control that turns disabled.
    ShellFocusStaysDisabled,
    /// #851: a game shell's prompts keep the keys' glyphs whatever device wrote last.
    ShellPromptsKeepKeys,
    ShellDoneOnEnter,
    ShellDoneInSave,
    ShellSettingInReadRegion,
    /// The process's footprint read fails, as the system call does on any error (#1431 criterion 2).
    FootprintReadFails,
    /// A reader that gives 0 for a footprint read that failed (#1431 criterion 2).
    FootprintReadsZero,
    /// A 1,000,000 B buffer outside the heap that no gauge counts, made at each whole minute since launch (#1431
    /// criterion 3).
    LeaksUngaugedBuffer,
    /// The picture arm's image element asks for a frame at every vsync while it animates (#1489 criterion 3).
    PictureFrameEachVsync,
    /// A piece played alone takes its bits from the platform's secure source, not hash(the run's seed, the draw's
    /// number) (#552 criterion 5).
    AloneBitsFromSecure,
    /// A draw hashes its drawn step in place of its number (#552 criterion 5).
    DrawHashesStep,
}

impl Plant {
    pub fn parse(name: &str) -> Option<Plant> {
        match name {
            "answers-your-record" => Some(Plant::AnswersYourRecord),
            "writes-clipboard" => Some(Plant::WritesClipboard),
            "copies-drawn-order" => Some(Plant::CopiesDrawnOrder),
            "copies-draw-order" => Some(Plant::CopiesDrawOrder),
            "moves-focus" => Some(Plant::MovesFocus),
            "starts-sound" => Some(Plant::StartsSound),
            "page-drops-param" => Some(Plant::PageDropsParam),
            "ranks-by-live-recency" => Some(Plant::RanksByLiveRecency),
            "no-hit-test" => Some(Plant::NoHitTest),
            "row-label-past-frame" => Some(Plant::RowLabelPastFrame),
            "row-branch-cut-off" => Some(Plant::RowBranchCutOff),
            "jumps-on-act" => Some(Plant::JumpsOnAct),
            "notifies-every-step" => Some(Plant::NotifiesEveryStep),
            "menu-release-always" => Some(Plant::MenuReleaseAlways),
            "drops-first-bot-entry" => Some(Plant::DropsFirstBotEntry),
            "entry-on-change" => Some(Plant::EntryOnChange),
            "explorer-ignores-links" => Some(Plant::IgnoresLinks),
            "notifies-root-per-move" => Some(Plant::NotifiesRootPerMove),
            "read-back-fails" => Some(Plant::ReadBackFails),
            "drops-notify-record" => Some(Plant::DropsNotifyRecord),
            "wheel-notifies-every-event" => Some(Plant::WheelNotifiesEveryEvent),
            "reuse-drops-accessibility" => Some(Plant::ReuseDropsAccessibility),
            "keeps-document-seed" => Some(Plant::KeepsDocumentSeed),
            "pause-runs-level-clock" => Some(Plant::ShellPauseRunsClock),
            "focus-stays-on-disabled" => Some(Plant::ShellFocusStaysDisabled),
            "prompts-keep-key-glyphs" => Some(Plant::ShellPromptsKeepKeys),
            "done-on-enter" => Some(Plant::ShellDoneOnEnter),
            "done-in-save" => Some(Plant::ShellDoneInSave),
            "setting-through-reads" => Some(Plant::ShellSettingInReadRegion),
            "footprint-read-fails" => Some(Plant::FootprintReadFails),
            "footprint-reads-zero" => Some(Plant::FootprintReadsZero),
            "leaks-ungauged-buffer" => Some(Plant::LeaksUngaugedBuffer),
            "picture-frame-each-vsync" => Some(Plant::PictureFrameEachVsync),
            "alone-bits-from-secure" => Some(Plant::AloneBitsFromSecure),
            "draw-hashes-step" => Some(Plant::DrawHashesStep),
            _ => None,
        }
    }
}

/// Answers `ask` with `option` in the hub at `socket`, as the CLI does once the OS confirms you.
pub fn answer(socket: &Path, token: &str, ask: &str, option: &str) -> Result<Value, String> {
    let stream = UnixStream::connect(socket).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| e.to_string())?;
    let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let mut send = |message: Value| writeln!(writer, "{message}").map_err(|e| e.to_string());
    let mut read = |line: &mut String| -> Result<Value, String> {
        line.clear();
        reader.read_line(line).map_err(|e| e.to_string())?;
        serde_json::from_str(line).map_err(|e| e.to_string())
    };
    read(&mut line)?;
    send(json!({"v": 1, "hello": "cli", "token": token}))?;
    read(&mut line)?;
    send(
        json!({"v": 1, "id": "drive#1", "method": "ask.answer", "params": {"ask": ask, "option": option}}),
    )?;
    loop {
        let reply = read(&mut line)?;
        if reply["id"] == "drive#1" {
            return Ok(reply);
        }
    }
}

#[cfg(target_os = "macos")]
pub fn write_pasteboard(text: &str) {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    board.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString });
}

#[cfg(target_os = "macos")]
pub fn take_front() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    let mtm = MainThreadMarker::new().expect("the replica runs on the main thread");
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
    app.finishLaunching();
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
    // Activation reaches the window server from the run loop.
    let until = objc2_foundation::NSDate::dateWithTimeIntervalSinceNow(0.3);
    objc2_foundation::NSRunLoop::currentRunLoop().runUntilDate(&until);
}

#[cfg(target_os = "macos")]
pub fn play_sound() {
    use objc2_app_kit::NSSound;
    use objc2_foundation::NSString;
    if let Some(sound) = NSSound::soundNamed(&NSString::from_str("Glass")) {
        // Once started it plays until the replica exits, so the leak is there to hear, not a blip between looks.
        sound.setLoops(true);
        sound.play();
        std::mem::forget(sound);
        // Playback starts from the run loop.
        let until = objc2_foundation::NSDate::dateWithTimeIntervalSinceNow(0.5);
        objc2_foundation::NSRunLoop::currentRunLoop().runUntilDate(&until);
    }
}
