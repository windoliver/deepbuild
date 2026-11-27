//! What the Metal device holds, listed by the device itself: every texture and buffer it makes
//! is kept by weak reference, so a reading lists what is alive with its label, its shape and its
//! `allocatedSize`. Adapted from #2189's tracer (docs/evidence/2189/alloctrace.rs), which listed
//! label and size; this one also reads each texture's own descriptor back.
#![allow(unsafe_code)]

use std::ffi::{c_char, c_void, CStr};
use std::sync::atomic::{AtomicI64, AtomicPtr, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;

use serde_json::{json, Value};

type Id = *mut c_void;
type Sel = *const c_void;
type Imp = *const c_void;

#[link(name = "objc")]
unsafe extern "C" {
    fn object_getClass(obj: Id) -> *mut c_void;
    fn class_getInstanceMethod(cls: *mut c_void, sel: Sel) -> *mut c_void;
    fn method_setImplementation(m: *mut c_void, imp: Imp) -> Imp;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_msgSend();
    fn objc_initWeak(location: *mut Id, obj: Id) -> Id;
    fn objc_loadWeakRetained(location: *mut Id) -> Id;
    fn objc_retain(obj: Id) -> Id;
    fn objc_release(obj: Id);
}

struct Rec {
    weak: Box<Id>,
    kind: &'static str,
    /// Its place among everything the device made, and the frame being drawn when it was made
    /// (−1 before the first).
    seq: u64,
    frame: i64,
}
// SAFETY: the weak slot is only read through the runtime's own weak-reference calls.
unsafe impl Send for Rec {}

static RECS: Mutex<Vec<Rec>> = Mutex::new(Vec::new());
static SEQ: AtomicU64 = AtomicU64::new(0);
static FRAME: AtomicI64 = AtomicI64::new(-1);
static TEX: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static TEX_IOS: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static BUF: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static BUF_BYTES: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
/// The length of the buffers [`keep`] asked for, 0 for none, and those made since, retained.
static KEEP: AtomicUsize = AtomicUsize::new(0);
static KEPT: Mutex<Vec<usize>> = Mutex::new(Vec::new());

fn sel(name: &CStr) -> Sel {
    unsafe { sel_registerName(name.as_ptr()) }
}

fn record(obj: Id, kind: &'static str) {
    if obj.is_null() {
        return;
    }
    let mut weak: Box<Id> = Box::new(std::ptr::null_mut());
    unsafe { objc_initWeak(&mut *weak, obj) };
    let rec = Rec {
        weak,
        kind,
        seq: SEQ.fetch_add(1, Ordering::SeqCst),
        frame: FRAME.load(Ordering::SeqCst),
    };
    RECS.lock().unwrap_or_else(|e| e.into_inner()).push(rec);
}

extern "C" fn tex(this: Id, s: Sel, desc: Id) -> Id {
    let f: extern "C" fn(Id, Sel, Id) -> Id =
        unsafe { std::mem::transmute(TEX.load(Ordering::SeqCst)) };
    let o = f(this, s, desc);
    record(o, "texture");
    o
}
extern "C" fn tex_ios(this: Id, s: Sel, desc: Id, ios: *mut c_void, plane: usize) -> Id {
    let f: extern "C" fn(Id, Sel, Id, *mut c_void, usize) -> Id =
        unsafe { std::mem::transmute(TEX_IOS.load(Ordering::SeqCst)) };
    let o = f(this, s, desc, ios, plane);
    record(o, "texture");
    o
}
extern "C" fn buf(this: Id, s: Sel, len: usize, opts: usize) -> Id {
    let f: extern "C" fn(Id, Sel, usize, usize) -> Id =
        unsafe { std::mem::transmute(BUF.load(Ordering::SeqCst)) };
    let o = f(this, s, len, opts);
    record(o, "buffer");
    // A buffer's length is what was asked, or that rounded up to the device's alignment.
    let want = KEEP.load(Ordering::SeqCst);
    if !o.is_null() && want != 0 && len >= want && len < want + 256 {
        unsafe { objc_retain(o) };
        KEPT.lock().unwrap_or_else(|e| e.into_inner()).push(o as usize);
    }
    o
}
extern "C" fn buf_bytes(this: Id, s: Sel, bytes: *const c_void, len: usize, opts: usize) -> Id {
    let f: extern "C" fn(Id, Sel, *const c_void, usize, usize) -> Id =
        unsafe { std::mem::transmute(BUF_BYTES.load(Ordering::SeqCst)) };
    let o = f(this, s, bytes, len, opts);
    record(o, "buffer");
    o
}

/// Swaps the four calls a Metal device makes a texture or a buffer with, on the class of `raw`
/// (the device), for ones that also keep a weak reference to what they return. The names of the
/// calls it could not find, which then go unlisted.
pub fn install(raw: *const c_void) -> Vec<&'static str> {
    let mut missing = Vec::new();
    unsafe {
        let cls = object_getClass(raw.cast_mut());
        let mut hook = |name: &'static CStr, imp: Imp, slot: &AtomicPtr<c_void>| {
            let m = class_getInstanceMethod(cls, sel(name));
            if m.is_null() {
                missing.push(name.to_str().unwrap_or("?"));
                return;
            }
            let old = method_setImplementation(m, imp);
            slot.store(old.cast_mut(), Ordering::SeqCst);
        };
        hook(c"newTextureWithDescriptor:", tex as Imp, &TEX);
        hook(
            c"newTextureWithDescriptor:iosurface:plane:",
            tex_ios as Imp,
            &TEX_IOS,
        );
        hook(c"newBufferWithLength:options:", buf as Imp, &BUF);
        hook(
            c"newBufferWithBytes:length:options:",
            buf_bytes as Imp,
            &BUF_BYTES,
        );
    }
    missing
}

/// From now on every buffer of `len` bytes the device makes stays alive until [`kept`] takes it:
/// a read-back's buffer, which the renderer lets go of as soon as it has read it.
pub fn keep(len: usize) {
    KEEP.store(len, Ordering::SeqCst);
}

/// The bytes the device left in each buffer kept since the last call, in the order they were
/// made; the buffers are let go. A buffer the CPU can't read gives no bytes.
pub fn kept() -> Vec<Vec<u8>> {
    let objects = std::mem::take(&mut *KEPT.lock().unwrap_or_else(|e| e.into_inner()));
    let read = |o: usize| unsafe {
        let o = o as Id;
        let contents: extern "C" fn(Id, Sel) -> *const u8 =
            std::mem::transmute(objc_msgSend as *const ());
        let at = contents(o, sel(c"contents"));
        let len = number(o, c"length") as usize;
        let bytes = if at.is_null() {
            Vec::new()
        } else {
            std::slice::from_raw_parts(at, len).to_vec()
        };
        objc_release(o);
        bytes
    };
    objects.into_iter().map(read).collect()
}

/// The frame being drawn, which everything made from now on is listed under.
pub fn frame(k: i64) {
    FRAME.store(k, Ordering::SeqCst);
}

fn label(obj: Id) -> Option<String> {
    unsafe {
        let send: extern "C" fn(Id, Sel) -> Id = std::mem::transmute(objc_msgSend as *const ());
        let ns = send(obj, sel(c"label"));
        if ns.is_null() {
            return None;
        }
        let utf8: extern "C" fn(Id, Sel) -> *const c_char =
            std::mem::transmute(objc_msgSend as *const ());
        let p = utf8(ns, sel(c"UTF8String"));
        (!p.is_null()).then(|| CStr::from_ptr(p).to_string_lossy().into_owned())
    }
}

fn number(obj: Id, name: &CStr) -> u64 {
    unsafe {
        let send: extern "C" fn(Id, Sel) -> usize = std::mem::transmute(objc_msgSend as *const ());
        send(obj, sel(name)) as u64
    }
}

/// Everything the device made that is alive now, in the order it was made: a texture with its
/// width, height, depth, array length, mip levels, sample count and Metal's own numbers for its
/// pixel format, usage, storage mode and type; a buffer with its length; each with the bytes the
/// device reports for it (`allocatedSize`).
pub fn live() -> Vec<Value> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut recs = RECS.lock().unwrap_or_else(|e| e.into_inner());
    recs.retain_mut(|r| unsafe {
        let o = objc_loadWeakRetained(&mut *r.weak);
        if o.is_null() {
            return false;
        }
        if seen.insert(o as usize) {
            let mut row = json!({
                "kind": r.kind, "seq": r.seq, "made_in_frame": r.frame, "label": label(o),
                "bytes": number(o, c"allocatedSize"),
            });
            if r.kind == "texture" {
                for (key, name) in [
                    ("width", c"width"),
                    ("height", c"height"),
                    ("depth", c"depth"),
                    ("array_length", c"arrayLength"),
                    ("mip_levels", c"mipmapLevelCount"),
                    ("sample_count", c"sampleCount"),
                    ("mtl_pixel_format", c"pixelFormat"),
                    ("mtl_usage", c"usage"),
                    ("mtl_storage_mode", c"storageMode"),
                    ("mtl_texture_type", c"textureType"),
                ] {
                    row[key] = json!(number(o, name));
                }
            } else {
                row["length"] = json!(number(o, c"length"));
            }
            out.push(row);
        }
        objc_release(o);
        true
    });
    out
}
