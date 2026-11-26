//! #2662.a74c0d37 (AC2): "a planted runner that shares one store between two forks fails, naming
//! the fork whose memory changed", and the same planted runner under #2662.393785f9 (AC3)'s check.
//! The planted logic module is `Planted { forks_share_store: true, .. }` (README: Surfaces): the
//! forks made from one world run each item on one store, so a step of either writes the other's
//! memory and globals. forks_common.rs's checks, which forks.rs passes on the logic module as
//! shipped, must fail on it.

mod common;
mod forks_common;

use deep_logic::Planted;

const FORKS: &str = "#2662.a74c0d37";
const LIMITS: &str = "#2662.393785f9";

fn planted() -> Planted {
    Planted { forks_share_store: true, ..Planted::default() }
}

#[test]
fn ac2_planted_forks_share_store_fails_naming_the_fork_whose_memory_changed() {
    let problems = forks_common::memories(planted());
    eprintln!("{FORKS}: planted forks_share_store fails with: {problems:?}");
    assert!(
        problems.iter().any(|p| p.starts_with("fork B's memory changed while fork A stepped")),
        "{FORKS}: the planted runner that shares one store between two forks fails, naming fork B, whose memory changed while fork A stepped; its problems: {problems:?}"
    );
}

#[test]
fn ac3_planted_forks_share_store_fails_the_fork_that_steps_on() {
    let problems = forks_common::limits(planted(), 1.0, "fuel");
    eprintln!("{LIMITS}: planted forks_share_store fails with: {problems:?}");
    assert!(
        problems.iter().any(|p| p.starts_with("fork B's step ")),
        "{LIMITS}: on the planted runner that shares one store between two forks, the fork that steps on doesn't step as a straight run does; its problems: {problems:?}"
    );
}
