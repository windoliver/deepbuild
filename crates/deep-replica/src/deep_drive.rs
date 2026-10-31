//! `deep-drive --out <dir>` (#124): one replica an agent drives, the process the hub's `deep_drive` tool starts per
//! launch. It prints `{"ready": true}`, then answers one JSON line per call on stdin, in order, each call the
//! `deep_drive` tool's arguments; the files it writes (screenshots, recorded frames, the trace) go under `<dir>`. It
//! exits when stdin ends. `DEEP_DRIVE_PLANT` names a planted replica, for the checks that must catch it.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(drive::run());
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("deep-drive: the replica renders pixels on macOS only");
        std::process::exit(2);
    }
}

#[cfg(target_os = "macos")]
mod drive {
    use std::io::{BufRead, Write};
    use std::path::PathBuf;

    use deep_replica::drive::{Drive, Plant};
    use serde_json::{json, Value};

    pub fn run() -> i32 {
        let mut args = std::env::args().skip(1);
        let out = match (args.next().as_deref(), args.next()) {
            (Some("--out"), Some(dir)) => PathBuf::from(dir),
            _ => {
                eprintln!("usage: deep-drive --out <dir>");
                return 2;
            }
        };
        let plant = match std::env::var("DEEP_DRIVE_PLANT")
            .ok()
            .filter(|p| !p.is_empty())
        {
            None => None,
            Some(name) => match Plant::parse(&name) {
                Some(plant) => Some(plant),
                None => {
                    println!(
                        "{}",
                        json!({"ready": false, "error": format!("no planted replica {name}")})
                    );
                    return 2;
                }
            },
        };
        let mut drive = Drive::new(out, plant);
        let mut stdout = std::io::stdout();
        let _ = writeln!(stdout, "{}", json!({"ready": true}));
        let _ = stdout.flush();
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let reply = match serde_json::from_str::<Value>(&line) {
                Ok(call) => drive.call(&call),
                Err(e) => {
                    json!({"ok": false, "t": 0, "error": {"code": "refused", "message": format!("not a JSON call: {e}")}})
                }
            };
            let _ = writeln!(stdout, "{reply}");
            let _ = stdout.flush();
        }
        0
    }
}
