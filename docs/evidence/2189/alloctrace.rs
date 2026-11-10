//! #2189's tracer, kept as evidence and not built into deep-gpu: every Metal texture and buffer
//! the device makes, held by weak reference, so a reading at the peak lists what is alive by label
//! with its `allocatedSize`. To use it, copy it to crates/deep-gpu-layer/src/, declare
//! `mod alloctrace;` in main.rs, call `install` with the raw MTLDevice at the start of
//! envelope.rs's `play`, take `live()` whenever `memory::allocated` passes the peak, and `print`
//! that snapshot at the end of `play`.
#![allow(unsafe_code, clippy::all)]

use std::collections::BTreeMap;
use std::ffi::{c_char, c_void, CStr};
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::Mutex;

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
    fn objc_release(obj: Id);
}

struct Rec {
    weak: Box<Id>,
    kind: &'static str,
}
unsafe impl Send for Rec {}

static RECS: Mutex<Vec<Rec>> = Mutex::new(Vec::new());
static TEX: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static TEX_IOS: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static BUF: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
static BUF_BYTES: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

fn sel(name: &CStr) -> Sel {
    unsafe { sel_registerName(name.as_ptr()) }
}

fn record(obj: Id, kind: &'static str) {
    if obj.is_null() {
        return;
    }
    let mut weak: Box<Id> = Box::new(std::ptr::null_mut());
    unsafe { objc_initWeak(&mut *weak, obj) };
    RECS.lock().unwrap().push(Rec { weak, kind });
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
    record(o, "iosurface");
    o
}
extern "C" fn buf(this: Id, s: Sel, len: usize, opts: usize) -> Id {
    let f: extern "C" fn(Id, Sel, usize, usize) -> Id =
        unsafe { std::mem::transmute(BUF.load(Ordering::SeqCst)) };
    let o = f(this, s, len, opts);
    record(o, "buffer");
    o
}
extern "C" fn buf_bytes(this: Id, s: Sel, bytes: *const c_void, len: usize, opts: usize) -> Id {
    let f: extern "C" fn(Id, Sel, *const c_void, usize, usize) -> Id =
        unsafe { std::mem::transmute(BUF_BYTES.load(Ordering::SeqCst)) };
    let o = f(this, s, bytes, len, opts);
    record(o, "buffer");
    o
}

/// Installs the hooks on `raw`'s class, once.
pub fn install(raw: Id) {
    static DONE: std::sync::Once = std::sync::Once::new();
    DONE.call_once(|| unsafe {
        let cls = object_getClass(raw);
        let hook = |name: &CStr, imp: Imp, slot: &AtomicPtr<c_void>| {
            let m = class_getInstanceMethod(cls, sel(name));
            if m.is_null() {
                eprintln!("alloctrace: no {name:?}");
                return;
            }
            let old = method_setImplementation(m, imp);
            slot.store(old as *mut c_void, Ordering::SeqCst);
        };
        hook(c"newTextureWithDescriptor:", tex as Imp, &TEX);
        hook(c"newTextureWithDescriptor:iosurface:plane:", tex_ios as Imp, &TEX_IOS);
        hook(c"newBufferWithLength:options:", buf as Imp, &BUF);
        hook(c"newBufferWithBytes:length:options:", buf_bytes as Imp, &BUF_BYTES);
    });
}

fn label(obj: Id) -> String {
    unsafe {
        let send: extern "C" fn(Id, Sel) -> Id = std::mem::transmute(objc_msgSend as *const ());
        let ns = send(obj, sel(c"label"));
        if ns.is_null() {
            return "(none)".into();
        }
        let utf8: extern "C" fn(Id, Sel) -> *const c_char =
            std::mem::transmute(objc_msgSend as *const ());
        let p = utf8(ns, sel(c"UTF8String"));
        if p.is_null() {
            "(none)".into()
        } else {
            CStr::from_ptr(p).to_string_lossy().into_owned()
        }
    }
}

fn size(obj: Id) -> u64 {
    unsafe {
        let send: extern "C" fn(Id, Sel) -> usize = std::mem::transmute(objc_msgSend as *const ());
        send(obj, sel(c"allocatedSize")) as u64
    }
}

/// What is alive now: (kind, label) → (count, bytes).
pub fn live() -> BTreeMap<(String, String), (u64, u64)> {
    let mut out = BTreeMap::new();
    let mut seen = std::collections::HashSet::new();
    let mut recs = RECS.lock().unwrap();
    recs.retain_mut(|r| unsafe {
        let o = objc_loadWeakRetained(&mut *r.weak);
        if o.is_null() {
            return false;
        }
        if seen.insert(o as usize) {
            let e = out
                .entry((r.kind.to_string(), label(o)))
                .or_insert((0u64, 0u64));
            e.0 += 1;
            e.1 += size(o);
        }
        objc_release(o);
        true
    });
    out
}

pub fn print(title: &str, total: Option<u64>, live: &BTreeMap<(String, String), (u64, u64)>) {
    let sum: u64 = live.values().map(|v| v.1).sum();
    eprintln!(
        "== alloctrace {title}: device {:.1} MB, live resources {:.1} MB",
        total.unwrap_or(0) as f64 / 1e6,
        sum as f64 / 1e6
    );
    let mut rows: Vec<_> = live.iter().collect();
    rows.sort_by(|a, b| b.1 .1.cmp(&a.1 .1));
    for ((kind, label), (n, b)) in rows {
        eprintln!("{:>10.2} MB  {:>5}  {:<9} {}", *b as f64 / 1e6, n, kind, label);
    }
}
