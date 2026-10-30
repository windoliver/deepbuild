//! `deep-replica-canvas --out <dir>` (#806): the app's canvas panel, headless, connected to the hub the way the app
//! is, as the `app` role with the control token, from the hub's address under `HOME`. It prints `{"ready": true}`
//! once connected. Each revision the hub presents it draws in its panel, in a GPUI window on the offscreen
//! renderer, and appends one line to `<dir>/drawn.jsonl`: the document, its revision and every layer on the panel,
//! back to front, with its owner, band, outline, name and items. On stdin it takes one JSON line per call and
//! answers one line each: `{"call": "sync"}` draws what was presented so far and answers `{"drawn": {doc: rev}}`;
//! any other call is yours on the canvas (input, an ask, the window), played by the hub's canvas core, after a sync.
//! It runs until stdin ends or SIGTERM.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(panel::run());
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("deep-replica-canvas: the replica renders pixels on macOS only");
        std::process::exit(2);
    }
}

#[cfg(target_os = "macos")]
mod panel {
    use std::collections::BTreeMap;
    use std::io::{BufRead, Write};
    use std::path::PathBuf;
    use std::sync::mpsc;

    use deep_app::show::{CanvasPanel, Presentations};
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::*;
    use serde_json::{json, Value};

    pub fn run() -> i32 {
        let mut args = std::env::args().skip(1);
        let out = match (args.next().as_deref(), args.next()) {
            (Some("--out"), Some(dir)) => PathBuf::from(dir),
            _ => {
                eprintln!("usage: deep-replica-canvas --out <dir>");
                return 2;
            }
        };
        let _ = std::fs::create_dir_all(&out);
        let root = deep_app::hub::root();
        let mut hub =
            match Presentations::open(&deep_app::hub::address(), &root.join("control.token")) {
                Ok(hub) => hub,
                Err(error) => {
                    println!("{}", json!({"ready": false, "error": format!("{error:?}")}));
                    return 1;
                }
            };
        let mut cx = deep_replica::headless_context();
        let panel = CanvasPanel::new(root.join("evidence"));
        let Ok((handle, entity)) = cx.update(|cx| {
            open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(1600.), px(1200.)),
                    })),
                    focus: false,
                    show: false,
                    ..Default::default()
                },
                cx,
                |_, cx| cx.new(|_| panel),
            )
        }) else {
            println!("{}", json!({"ready": false, "error": "no window"}));
            return 1;
        };
        println!("{}", json!({"ready": true}));
        let _ = std::io::stdout().flush();

        // Lines from stdin on their own thread; between them the panel takes what the hub presents.
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            for line in std::io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let drawn_file = out.join("drawn.jsonl");
        let mut at: BTreeMap<String, u64> = BTreeMap::new();
        let sync = |hub: &mut Presentations,
                    cx: &mut HeadlessAppContext,
                    at: &mut BTreeMap<String, u64>|
         -> Result<(), String> {
            let presented = hub.take().map_err(|e| format!("{e:?}"))?;
            for p in presented {
                let line = p.drawn_json();
                at.insert(p.doc.clone(), p.rev);
                cx.update(|cx| {
                    entity.update(cx, |panel, cx| {
                        panel.present(p);
                        cx.notify();
                    })
                });
                cx.update_window(handle, |_, window, cx| window.render_frame(cx))
                    .map_err(|e| e.to_string())?;
                let mut f = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&drawn_file)
                    .map_err(|e| e.to_string())?;
                writeln!(f, "{line}").map_err(|e| e.to_string())?;
            }
            Ok(())
        };
        loop {
            match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(line) => {
                    let call: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
                    let synced = sync(&mut hub, &mut cx, &mut at);
                    let reply = match (synced, call["call"].as_str()) {
                        (Err(e), _) => json!({"ok": false, "code": "unavailable", "error": e}),
                        (Ok(()), Some("sync")) => json!({"drawn": at}),
                        (Ok(()), Some(_)) => hub
                            .user(call)
                            .unwrap_or_else(|e| json!({"ok": false, "error": format!("{e:?}")})),
                        (Ok(()), None) => json!({"ok": false, "code": "bad_input"}),
                    };
                    println!("{reply}");
                    let _ = std::io::stdout().flush();
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if sync(&mut hub, &mut cx, &mut at).is_err() {
                        return 1;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => return 0,
            }
        }
    }
}
