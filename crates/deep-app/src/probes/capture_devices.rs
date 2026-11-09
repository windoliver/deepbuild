//! `--capture-devices STORE` (#498): the camera and microphone through the OS permission and the
//! held control, twice.

use std::{path::PathBuf, time::Duration};

use deep_app::capture::{Indicator, MAX_SECONDS};
use deep_app::devices::{host_now, permission, Capture, Kind};
use deep_app::trusted_input::{hid_shortcut_down, main_thread};
use gpui_kit::*;
use serde_json::{json, Value};

const TICK: Duration = Duration::from_millis(4);
/// How long a person has to hold, each time.
const WAIT: Duration = Duration::from_secs(240);

pub fn start(store: PathBuf, cx: &mut App) {
    let granted =
        json!({"camera": permission(Kind::Camera), "microphone": permission(Kind::Microphone)});
    // Read, never asked for: without both there is nothing to record and no prompt shows.
    if granted["camera"] != "granted" || granted["microphone"] != "granted" {
        println!(
            "{}",
            json!({"capture": 498, "permission": granted, "via": "os_permission + trusted control",
            "hold": "shortcut", "holds": [], "captures": []})
        );
        cx.quit();
        return;
    }
    cx.activate(true);
    cx.spawn(async move |cx| match run(&store, cx).await {
        Ok(mut line) => {
            line["permission"] = granted;
            println!("{line}");
            cx.update(|cx| cx.quit());
        }
        Err(blocked) => {
            println!("{}", json!({"capture": 498, "blocked": blocked}));
            std::process::exit(1);
        }
    })
    .detach();
}

async fn wait_for(cx: &mut AsyncApp, down: bool, limit: Duration) -> bool {
    let begun = std::time::Instant::now();
    while hid_shortcut_down() != down {
        if begun.elapsed() > limit {
            return false;
        }
        cx.background_executor().timer(TICK).await;
    }
    true
}

async fn run(store: &std::path::Path, cx: &mut AsyncApp) -> Result<Value, String> {
    let t0 = host_now();
    let ms = |s: f64| ((s - t0) * 1000.0 * 10.0).round() / 10.0;
    let (mut holds, mut captures) = (Vec::new(), Vec::new());
    for request in 1..=2 {
        if request == 2 {
            // A later request, after the release: it waits armed, keeping nothing.
            cx.background_executor().timer(Duration::from_secs(2)).await;
        }
        let requested = host_now();
        let armed = [Capture::arm(Kind::Camera)?, Capture::arm(Kind::Microphone)?];
        if request == 2 {
            cx.background_executor().timer(Duration::from_secs(3)).await;
        }
        eprintln!("deep-app: hold ⌥Space to record the camera and microphone ({request} of 2), then let go");
        if !wait_for(cx, true, WAIT).await {
            return Err("the shortcut was never held".into());
        }
        let down = host_now();
        let indicator = Indicator::titled(
            main_thread(),
            "● Camera and microphone — let go of ⌥Space to stop",
        );
        armed.iter().for_each(|c| c.start(down));
        let limit = Duration::from_secs_f64((MAX_SECONDS - (host_now() - down)).max(0.0));
        wait_for(cx, false, limit).await;
        let up = host_now();
        armed.iter().for_each(|c| c.stop(up));
        drop(indicator);
        holds.push(json!({"down_ms": ms(down), "up_ms": ms(up)}));
        for c in &armed {
            let sha = c.finish(store)?;
            let k = c.shared.lock().map_err(|_| "a callback panicked")?;
            captures.push(json!({
                "request": request,
                "source": c.kind.name(),
                "requested_ms": ms(requested),
                "period_ms": k.period.map(|p| (p * 1000.0 * 1000.0).round() / 1000.0),
                "kept_before_hold": 0,
                "delivered_before_hold": k.before_hold,
                "kept": k.kept,
                "first_ms": k.first.map(ms),
                "last_ms": k.last.map(ms),
                "asset": sha.map(|s| json!({"sha256": s, "redaction": "unknown"})),
            }));
        }
    }
    Ok(
        json!({"capture": 498, "via": "os_permission + trusted control", "hold": "shortcut",
        "holds": holds, "captures": captures}),
    )
}
