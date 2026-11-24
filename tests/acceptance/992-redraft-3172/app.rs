//! Issue #992, the app's side of AC2 (#992.34978db2) and AC3 (#992.45c506d1): the sidebar row the app draws for a
//! record, read in the replica (deep_replica) on gpui's virtual clock. It judges nothing: the TypeScript tests in
//! ../992 compare what it prints with `deep status`.
//!
//! A blind redraft of ../992/app.rs for #3172's criterion #3172.f7060cf1, written at base 2fb3fe996: off macOS this
//! target states INCONCLUSIVE for its platform, as its neighbours do, instead of BLOCKED. On macOS it behaves as the
//! first draft does, byte for byte in what it reads and prints. README.md here says what changed and why.
//!
//! Wired into deep-replica as the path of the existing `acceptance_992_app` `[[test]]` entry in
//! crates/deep-replica/Cargo.toml, replacing `../992/app.rs` once the owner approves the swap:
//!     [[test]]
//!     name = "acceptance_992_app"
//!     path = "../../tests/acceptance/992-redraft-3172/app.rs"
//!     harness = false
//!     test = false
//! #992's tests run it (`cargo test --locked -p deep-replica --test acceptance_992_app`, ../992/helpers.ts `appRows`)
//! with DH992_APP_CASES naming a JSON file of cases, `[{"name", "fixture"}]`, each fixture a record in the app's
//! fixture format (lines of `{"session_id", "event"}`, as `deep_app::events::Fixture` reads them) exported from a hub
//! by `events.read`, its times moved so the hub's now when it was read falls on `deep_replica::NOW`, where the replica
//! opens. With DEEP_HUB_PLANT set, the app runs as that planted program (../992/README.md: What the implementation
//! must provide, 3): `waiting-as-working`, and `waiting-first` where the app computes the reading itself. Each case
//! prints one line, `DH992 {"name","session","row","entry","glyph"}`.
//!
//! Off macOS it needs std alone (`rustc --edition 2021 --crate-type bin app.rs` builds it) and prints one line,
//! `acceptance_992_app: INCONCLUSIVE; the replica runs on macOS only, so no sidebar row was read`, and exits 1.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(rows::run());
    // Unrun is not passed: off macOS the platform can't run the app's side, so it is INCONCLUSIVE for its platform,
    // as the replica's other macOS-only targets say, and says so with a failing exit.
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_992_app: INCONCLUSIVE; the replica runs on macOS only, so no sidebar row was read");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod rows {
    use std::path::PathBuf;

    use deep_replica::Replica;
    use serde_json::{json, Value};

    /// Reads every case and prints its sidebar row; the exit code.
    pub fn run() -> i32 {
        let Ok(input) = std::env::var("DH992_APP_CASES") else {
            eprintln!("acceptance_992_app: set DH992_APP_CASES to the cases file the TypeScript tests write");
            return 2;
        };
        let text = std::fs::read_to_string(&input).unwrap_or_else(|error| panic!("{input}: {error}"));
        let cases: Value = serde_json::from_str(&text).unwrap_or_else(|error| panic!("{input}: {error}"));
        for case in cases.as_array().expect("the cases are a list") {
            let name = case["name"].as_str().expect("a case has a name");
            let fixture = PathBuf::from(case["fixture"].as_str().expect("a case has a fixture"));
            let mut replica = Replica::open(&fixture);
            let seen = replica.surfaces();
            let row = seen
                .iter()
                .find(|seen| seen.surface == "sidebar-row")
                .expect("the replica reads the sidebar row");
            let session = std::fs::read_to_string(&fixture)
                .ok()
                .and_then(|text| text.lines().next().map(str::to_owned))
                .and_then(|line| serde_json::from_str::<Value>(&line).ok())
                .and_then(|line| line["session_id"].as_str().map(str::to_owned))
                .unwrap_or_default();
            println!(
                "DH992 {}",
                json!({"name": name, "session": session, "row": row.text, "entry": row.entry, "glyph": row.glyph})
            );
        }
        0
    }
}
