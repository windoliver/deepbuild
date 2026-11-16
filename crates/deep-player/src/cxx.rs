//! C++'s allocation operators for the 3D module's mesh simplifier (meshopt, compiled for wasm32),
//! which wasm32-unknown-unknown has no C++ runtime to give: each block comes from Rust's allocator
//! with its length kept before it, so `delete` without a size frees it whole.

use std::alloc::{alloc, dealloc, Layout};

/// The bytes kept before each block: its whole length, at C++'s strictest alignment.
const HEAD: usize = 16;

unsafe fn new(size: usize) -> *mut u8 {
    let Ok(layout) = Layout::from_size_align(size + HEAD, HEAD) else {
        std::process::abort();
    };
    // SAFETY: the layout's size is at least HEAD, never zero.
    let base = unsafe { alloc(layout) };
    if base.is_null() {
        std::process::abort();
    }
    // SAFETY: the block holds HEAD bytes before what the caller gets, aligned for a usize.
    unsafe {
        (base as *mut usize).write(size + HEAD);
        base.add(HEAD)
    }
}

unsafe fn delete(p: *mut u8) {
    if p.is_null() {
        return;
    }
    // SAFETY: `p` came from `new`, which kept the block's whole length HEAD bytes before it.
    unsafe {
        let base = p.sub(HEAD);
        let len = (base as *const usize).read();
        dealloc(base, Layout::from_size_align_unchecked(len, HEAD));
    }
}

/// `operator new(size_t)`.
#[no_mangle]
pub unsafe extern "C" fn _Znwm(size: usize) -> *mut u8 {
    unsafe { new(size) }
}

/// `operator new[](size_t)`.
#[no_mangle]
pub unsafe extern "C" fn _Znam(size: usize) -> *mut u8 {
    unsafe { new(size) }
}

/// `operator delete(void*)`.
#[no_mangle]
pub unsafe extern "C" fn _ZdlPv(p: *mut u8) {
    unsafe { delete(p) }
}

/// `operator delete[](void*)`.
#[no_mangle]
pub unsafe extern "C" fn _ZdaPv(p: *mut u8) {
    unsafe { delete(p) }
}

/// `operator delete(void*, size_t)`.
#[no_mangle]
pub unsafe extern "C" fn _ZdlPvm(p: *mut u8, _: usize) {
    unsafe { delete(p) }
}

/// `operator delete[](void*, size_t)`.
#[no_mangle]
pub unsafe extern "C" fn _ZdaPvm(p: *mut u8, _: usize) {
    unsafe { delete(p) }
}
