//! `--capture-seam` (#140): a capture starts only through the system picker, and the system's
//! own indicator shows while it records.

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use deep_app::capture::{
    admit, close_picker, picked, prepare, present_picker, spool, start as record, stop,
    system_indicator, Observer, Reported, Shared, Source, BACKEND,
};
use deep_app::trusted_input::{capture_access, request_capture_access};
use gpui_kit::*;
use serde_json::{json, Value};

const TICK: Duration = Duration::from_millis(50);
/// How long a person has to answer the picker, how long the pick records, and how long the
/// recording has to finish.
const WAIT: Duration = Duration::from_secs(540);
const RECORD: Duration = Duration::from_secs(3);
const FINISH: Duration = Duration::from_secs(10);

pub fn start(cx: &mut App) {
    let granted = capture_access() || request_capture_access();
    let main = objc2_core_graphics::CGMainDisplayID();
    let outcome = match admit(Source::Display(main)) {
        Ok(_) => "started",
        Err(_) => "refused",
    };
    // Nothing was started, so no frame came; the indicator is read from the window server.
    let mut line = json!({
        "capture": 140,
        "backend": {"name": BACKEND.0, "version": BACKEND.1},
        "permission": if granted { "granted" } else { "denied" },
        "direct": {"outcome": outcome, "frames": 0, "indicator": {"system": system_indicator()}},
        "picker": false,
    });
    if !granted {
        println!("{line}");
        cx.quit();
        return;
    }
    let shared: Shared = Arc::new(Mutex::new(Reported::default()));
    let observer = Observer::new(shared.clone());
    present_picker(&observer);
    cx.activate(true);
    cx.spawn(async move |cx| {
        match run(&shared, &observer, cx).await {
            Ok(seen) => {
                for (k, v) in seen.as_object().into_iter().flatten() {
                    line[k] = v.clone();
                }
                println!("{line}");
            }
            Err(blocked) => {
                line["blocked"] = json!(blocked);
                println!("{line}");
                std::process::exit(1);
            }
        }
        cx.update(|cx| cx.quit());
    })
    .detach();
}

async fn tick(cx: &mut AsyncApp, shared: &Shared) -> Result<Reported, String> {
    cx.background_executor().timer(TICK).await;
    let r = shared
        .lock()
        .map_err(|_| "a callback panicked".to_string())?;
    match &r.failed {
        Some(failed) => Err(failed.clone()),
        None => Ok(Reported {
            picked: r.picked.clone(),
            cancelled: r.cancelled,
            failed: None,
            frames: r.frames,
            first_frame: r.first_frame,
            finished: r.finished,
        }),
    }
}

async fn run(shared: &Shared, observer: &Observer, cx: &mut AsyncApp) -> Result<Value, String> {
    let begun = Instant::now();
    let choice = loop {
        let r = tick(cx, shared).await?;
        if r.cancelled {
            return Err("the picker was cancelled: nothing recorded".into());
        }
        if let Some(p) = r.picked {
            break p;
        }
        if begun.elapsed() > WAIT {
            return Err("no pick".into());
        }
    };
    close_picker(observer);
    let as_json = |(kind, display): (&str, Option<(u32, bool)>)| json!({"kind": kind, "id": display.map(|(id, _)| id)});
    let chosen = as_json(picked(&choice.0));
    let filter = admit(Source::Picked(choice)).map_err(str::to_string)?.0;
    let spool = spool();
    let _ = std::fs::remove_file(&spool);
    let (stream, _recording) = prepare(&filter, observer, &spool)?;
    record(&stream, shared);
    let started = Instant::now();
    let mut indicator = false;
    while started.elapsed() < RECORD {
        let r = tick(cx, shared).await?;
        // Read while frames arrive, so it is the recording the indicator shows.
        if r.frames > 0 {
            indicator |= system_indicator();
        }
    }
    stop(&stream, shared);
    let stopped = Instant::now();
    let frames = loop {
        let r = tick(cx, shared).await?;
        if r.finished || stopped.elapsed() > FINISH {
            break r.frames;
        }
    };
    let _ = std::fs::remove_file(&spool);
    Ok(json!({
        "picker": true,
        "picked": chosen,
        "recorded": as_json(picked(&filter)),
        "frames": frames,
        "indicator": {"system": indicator},
    }))
}
