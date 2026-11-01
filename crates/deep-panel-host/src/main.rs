//! `deep-panel-host serve --panel DIR [--draw]` and `deep-panel-host run --panel DIR --renders N --out FILE`.

use std::path::Path;

use deep_panel_host::{flag, run, serve};

fn main() {
    // Before any runtime exists, and with no way back: this process never has a JIT.
    rquickjs_jit::deny_native_code();
    rquickjs_jit::limit_heap(256 << 20);
    let args: Vec<String> = std::env::args().skip(1).collect();
    let panel = flag(&args, "--panel").expect("--panel DIR");
    let result = match args.first().map(String::as_str) {
        Some("serve") => serve(Path::new(&panel), args.iter().any(|arg| arg == "--draw")),
        Some("run") => run(
            Path::new(&panel),
            flag(&args, "--renders")
                .and_then(|n| n.parse().ok())
                .expect("--renders N"),
            Path::new(&flag(&args, "--out").expect("--out FILE")),
        ),
        other => Err(format!("no command {other:?}")),
    };
    if let Err(error) = result {
        eprintln!("deep-panel-host: {error}");
        std::process::exit(2);
    }
}
