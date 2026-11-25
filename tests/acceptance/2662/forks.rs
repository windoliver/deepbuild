//! #2662.a74c0d37 (AC2, the forks) and #2662.393785f9 (AC3): two forks of one item (`World::fork`,
//! which gives each fork a fresh instance) each keep their own memory, fuel, memory limit and
//! trap. The checks are forks_common.rs's; here the logic module as shipped must show no problem.
//! forks_planted.rs runs the same checks on the planted runner that shares one store between two
//! forks, which must fail them, naming the fork.
//!
//! AC3's three limits: fuel (an endless loop spends the step's fuel: trap `fuel`), the memory
//! limit (the program's memory can't grow past it: trap `grow`) and a trap of its own
//! (`unreachable`). One fork is run to the limit and traps; the other steps on, each of its steps
//! leaving the hash, fuel and pages a straight run of the item leaves.

mod common;
mod forks_common;

use deep_logic::Planted;

const FORKS: &str = "#2662.a74c0d37";
const LIMITS: &str = "#2662.393785f9";

#[test]
fn ac2_two_forks_of_one_item_each_keep_their_own_memory() {
    let problems = forks_common::memories(Planted::default());
    assert!(problems.is_empty(), "{FORKS}: two forks of one item share no memory: {problems:?}");
}

#[test]
fn ac3_a_fork_run_to_its_fuel_traps_and_the_other_steps_on() {
    let problems = forks_common::limits(Planted::default(), 1.0, "fuel");
    assert!(problems.is_empty(), "{LIMITS}: two forks of one item each keep their own fuel: {problems:?}");
}

#[test]
fn ac3_a_fork_run_to_its_memory_limit_traps_and_the_other_steps_on() {
    let problems = forks_common::limits(Planted::default(), 2.0, "grow");
    assert!(problems.is_empty(), "{LIMITS}: two forks of one item each keep their own memory limit: {problems:?}");
}

#[test]
fn ac3_a_fork_that_traps_stays_failed_and_the_other_steps_on() {
    let problems = forks_common::limits(Planted::default(), 3.0, "unreachable");
    assert!(problems.is_empty(), "{LIMITS}: two forks of one item each keep their own trap: {problems:?}");
}
