//! The wasm32 build's entry (issue #2012): the runner as a module with no imports, one call line in, one reply line
//! out, through its own memory. `deep_physics_alloc(len)` gives room for a call's UTF-8; `deep_physics_call(ptr, len)`
//! answers it, takes the call's room back, and returns the reply's room as `ptr << 32 | len`, which
//! `deep_physics_free(ptr, len)` gives back.

use super::Run;

fn leak(mut bytes: Vec<u8>) -> *mut u8 {
    bytes.shrink_to_fit();
    let p = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    p
}

#[no_mangle]
pub extern "C" fn deep_physics_alloc(len: usize) -> *mut u8 {
    leak(vec![0; len])
}

/// # Safety
/// `ptr` and `len` are a room `deep_physics_alloc` or `deep_physics_call` gave, not yet given back.
#[no_mangle]
pub unsafe extern "C" fn deep_physics_free(ptr: *mut u8, len: usize) {
    // SAFETY: the caller gives back a room this module leaked with exactly this length and capacity.
    drop(unsafe { Vec::from_raw_parts(ptr, len, len) });
}

/// One step of the world `time_build` built, for a page that times it on its own clock: 1, or 0 without one.
#[no_mangle]
pub extern "C" fn deep_physics_step() -> u32 {
    u32::from(super::timed_step())
}

/// Notes the step's most-tested pair, outside the timed step.
#[no_mangle]
pub extern "C" fn deep_physics_note() {
    super::timed_note();
}

/// # Safety
/// `ptr` and `len` are a room `deep_physics_alloc` gave, holding the call's UTF-8.
#[no_mangle]
pub unsafe extern "C" fn deep_physics_call(ptr: *mut u8, len: usize) -> u64 {
    // SAFETY: as `deep_physics_free`; the room is taken back here.
    let call = unsafe { Vec::from_raw_parts(ptr, len, len) };
    let reply = match (Run::new(None), std::str::from_utf8(&call)) {
        (Some(run), Ok(line)) => run.line(line),
        _ => super::BAD_INPUT.to_string(),
    };
    let n = reply.len();
    (leak(reply.into_bytes()) as u64) << 32 | n as u64
}
