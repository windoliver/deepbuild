//! Issue #1172: a pack's check runs one program many times, and each run compiled it again; a
//! fresh canvas core's first reply waited on those compiles. A thread compiles a program once, and
//! each runner still gets its own instance.
#![cfg(not(target_arch = "wasm32"))]

use std::time::Instant;

use deep_sandbox_wasmtime::{Faults, Runner, Val};

/// A program with enough functions that compiling it takes a measurable time.
fn program() -> Vec<u8> {
    let mut wat = String::from(
        "(module (memory (export \"memory\") 1) (global $g (export \"g\") (mut i32) (i32.const 0))",
    );
    for i in 0..2000 {
        wat.push_str(&format!(
            "(func (export \"f{i}\") (param i32) (result i32) local.get 0 i32.const {i} i32.add i32.const 3 i32.mul local.get 0 i32.xor)"
        ));
    }
    wat.push(')');
    wat::parse_str(&wat).expect("the program assembles")
}

#[test]
fn a_thread_compiles_a_program_once() {
    let bytes = program();
    let t = Instant::now();
    let first = Runner::new(&bytes, Faults::default(), true).expect("the first runner");
    let first_s = t.elapsed().as_secs_f64();
    let mut later = Vec::new();
    for _ in 0..3 {
        let t = Instant::now();
        let _again = Runner::new(&bytes, Faults::default(), true).expect("a later runner");
        later.push(t.elapsed().as_secs_f64());
    }
    drop(first);
    let fastest = later.iter().cloned().fold(f64::INFINITY, f64::min);
    println!("first runner {first_s:.3} s, later runners {later:.3?} s");
    // A ratio, not a time, so a loaded machine slows both sides alike.
    assert!(
        fastest < first_s / 4.0,
        "a later runner took {fastest:.3} s against the first's {first_s:.3} s: it compiled the program again"
    );
}

#[test]
fn runners_of_one_program_keep_their_own_state() {
    let bytes = program();
    let mut a = Runner::new(&bytes, Faults::default(), true).expect("runner a");
    let mut b = Runner::new(&bytes, Faults::default(), true).expect("runner b");
    a.set("g", Val::I32(7)).expect("a sets its global");
    a.write("memory", 0, &[9, 9, 9])
        .expect("a writes its memory");
    assert!(
        matches!(b.global("g"), Some(Val::I32(0))),
        "b's global moved with a's"
    );
    assert_eq!(
        &b.memory("memory").expect("b's memory")[..3],
        &[0, 0, 0],
        "b's memory holds a's bytes"
    );
    assert!(
        matches!(a.global("g"), Some(Val::I32(7))),
        "a's global didn't keep its value"
    );
}
