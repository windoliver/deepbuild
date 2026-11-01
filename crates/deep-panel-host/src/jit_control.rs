//! The panel host's `run` with the switch left alone, so the JIT is on: DEEP_358_PANEL, DEEP_358_RENDERS, DEEP_358_OUT.

use std::{env::var, path::Path};

fn main() {
    let renders = var("DEEP_358_RENDERS")
        .expect("DEEP_358_RENDERS")
        .parse()
        .expect("a number of renders");
    let result = deep_panel_host::run(
        Path::new(&var("DEEP_358_PANEL").expect("DEEP_358_PANEL")),
        renders,
        Path::new(&var("DEEP_358_OUT").expect("DEEP_358_OUT")),
    );
    if let Err(error) = result {
        eprintln!("deep-panel-host-jit-control: {error}");
        std::process::exit(2);
    }
}
