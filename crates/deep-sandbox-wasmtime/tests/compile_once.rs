//! Issue #1172: a pack's check runs one program many times, and each run compiled it again; a
//! fresh canvas core's first reply waited on those compiles. A thread compiles a program once, and
//! each runner still gets its own instance.
#![cfg(not(target_arch = "wasm32"))]

use std::sync::Mutex;

use deep_sandbox_wasmtime::{compiles, Faults, Runner, Val};

static COUNTING: Mutex<()> = Mutex::new(());

fn program() -> Vec<u8> {
    wat::parse_str(
        "(module (memory (export \"memory\") 1) (global $g (export \"g\") (mut i32) (i32.const 0)))",
    )
    .expect("the program assembles")
}

#[test]
fn a_thread_compiles_a_program_once() {
    let _counting_alone = COUNTING.lock();
    let bytes = program();
    let before = compiles();
    let _first = Runner::new(&bytes, Faults::default(), true).expect("the first runner");
    let after_first = compiles();
    for _ in 0..3 {
        Runner::new(&bytes, Faults::default(), true).expect("a later runner");
    }
    assert_eq!(
        after_first - before,
        1,
        "the first runner compiles the program"
    );
    assert_eq!(
        compiles(),
        after_first,
        "a later runner compiled the program again"
    );
}

#[test]
fn runners_of_one_program_keep_their_own_state() {
    let _counting_alone = COUNTING.lock();
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
