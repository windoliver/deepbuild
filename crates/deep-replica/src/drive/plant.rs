//! The wrong programs criterion 2's fixture must catch (`DEEP_DRIVE_PLANT`): each lifts one of the guards that keep a
//! replica's input inside it, and lets that one thing reach your Mac or your record.

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
    /// The replica takes the front of your screen when it is acted on.
    MovesFocus,
    /// The app's notification sound plays through the OS.
    StartsSound,
}

impl Plant {
    pub fn parse(name: &str) -> Option<Plant> {
        match name {
            "answers-your-record" => Some(Plant::AnswersYourRecord),
            "writes-clipboard" => Some(Plant::WritesClipboard),
            "moves-focus" => Some(Plant::MovesFocus),
            "starts-sound" => Some(Plant::StartsSound),
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
    }
}
