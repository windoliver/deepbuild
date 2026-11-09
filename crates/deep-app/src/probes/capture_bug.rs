//! `--capture-bug STORE` (#105): the picker, the hold, the recording and its asset.

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use deep_app::capture::{
    close_picker, keep, picked, prepare, present_picker, spool, start as record, stop, Indicator,
    Observer, Reported, Shared, MAX_SECONDS,
};
use deep_app::trusted_input::{
    capture_access, hid_shortcut_down, main_thread, request_capture_access,
};
use gpui_kit::*;
use serde_json::{json, Value};

/// The HID table is read this often while a hold is awaited or runs.
const TICK: Duration = Duration::from_millis(4);
/// How long a person has to pick and to hold, and the recording to finish.
const WAIT: Duration = Duration::from_secs(540);
const FINISH: Duration = Duration::from_secs(10);

pub fn start(store: PathBuf, cx: &mut App) {
    // The first request shows the Screen Recording prompt and reads false until granted.
    if !(capture_access() || request_capture_access()) {
        println!("{}", json!({"capture": 105, "permission": "denied"}));
        cx.quit();
        return;
    }
    let shared: Shared = Arc::new(Mutex::new(Reported::default()));
    let observer = Observer::new(shared.clone());
    present_picker(&observer);
    cx.activate(true);
    cx.spawn(async move |cx| {
        let (line, ok) = match run(&store, &shared, &observer, cx).await {
            Ok(line) => (line, true),
            Err(blocked) => (json!({"capture": 105, "blocked": blocked}), false),
        };
        println!("{line}");
        if !ok {
            std::process::exit(1);
        }
        cx.update(|cx| cx.quit());
    })
    .detach();
}

/// Waits a tick, then reads what was reported; an error anything reported ends the run.
async fn tick<T>(
    cx: &mut AsyncApp,
    shared: &Shared,
    read: impl Fn(&Reported) -> Option<T>,
) -> Result<Option<T>, String> {
    cx.background_executor().timer(TICK).await;
    let reported = shared
        .lock()
        .map_err(|_| "a callback panicked".to_string())?;
    match &reported.failed {
        Some(failed) => Err(failed.clone()),
        None => Ok(read(&reported)),
    }
}

async fn run(
    store: &std::path::Path,
    shared: &Shared,
    observer: &Observer,
    cx: &mut AsyncApp,
) -> Result<Value, String> {
    let begun = Instant::now();
    let filter = loop {
        let answer = tick(cx, shared, |r| match r.cancelled {
            true => Some(None),
            false => r.picked.clone().map(Some),
        })
        .await?;
        match answer {
            Some(Some(picked)) => break picked.0,
            Some(None) => return Err("the picker was cancelled: nothing recorded".into()),
            None if begun.elapsed() > WAIT => return Err("no pick".into()),
            None => {}
        }
    };
    close_picker(observer);
    let (source, display) = picked(&filter);
    let spool = spool();
    let _ = std::fs::remove_file(&spool);
    let (stream, _recording) = prepare(&filter, observer, &spool)?;

    // Nothing records until the HID table reads the chord down.
    while !hid_shortcut_down() {
        tick(cx, shared, |_| Some(())).await?;
        if begun.elapsed() > WAIT {
            return Err("the shortcut was never held".into());
        }
    }
    let down = Instant::now();
    let indicator = Indicator::show(main_thread());
    record(&stream, shared);
    while hid_shortcut_down() && down.elapsed().as_secs_f64() < MAX_SECONDS {
        tick(cx, shared, |_| Some(())).await?;
    }
    let held = down.elapsed();
    stop(&stream, shared);
    drop(indicator);

    let stopped = Instant::now();
    while tick(cx, shared, |r| r.finished.then_some(()))
        .await?
        .is_none()
    {
        if stopped.elapsed() > FINISH {
            return Err("the recording never finished".into());
        }
    }
    let bytes = std::fs::read(&spool).map_err(|e| format!("the recording: {e}"))?;
    let _ = std::fs::remove_file(&spool);
    let sha = keep(store, &bytes).map_err(|e| format!("the evidence store: {e}"))?;
    let (frames, first) = {
        let r = shared
            .lock()
            .map_err(|_| "a callback panicked".to_string())?;
        (r.frames, r.first_frame)
    };
    let ms = |d: Duration| (d.as_secs_f64() * 1000.0 * 10.0).round() / 10.0;
    Ok(json!({
        "capture": 105,
        "permission": "granted",
        "picker": true,
        "source": source,
        "display": display.map(|(id, main)| json!({"id": id, "main": main})),
        "frames": frames,
        "first_frame_ms": first.map(|f| ms(f.duration_since(down))),
        "held_ms": ms(held),
        "asset": {"sha256": sha, "redaction": "unknown"},
    }))
}
