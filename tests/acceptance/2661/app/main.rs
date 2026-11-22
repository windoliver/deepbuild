//! #2661's acceptance tests on the app's library (README): AC1, AC2, AC3 and AC5, one test each, in one test binary
//! with a counting allocator (`alloc.rs`). Wired into deep-app by a `[[test]]` entry (`acceptance_2661`); run with
//! `cargo test --locked -p deep-app --test acceptance_2661 --no-fail-fast`.

#[path = "../../1141/app/bulk.rs"]
mod bulk;

mod ac1_fold;
mod ac2_agents;
mod ac3_terminal;
mod ac5_sidebar;
mod alloc;
mod hub;
mod window;

#[global_allocator]
static COUNTING: alloc::Counting = alloc::Counting;

/// A home of the test's own, so nothing the app reads or writes under `~/.deepbuild` is this Mac's: its hub, its
/// settings or its setup.
pub fn quiet_home() {
    static HOME: std::sync::Once = std::sync::Once::new();
    HOME.call_once(|| {
        let home = std::path::PathBuf::from(format!("/tmp/da2661-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).expect("the test's home");
        std::env::set_var("HOME", &home);
    });
}
