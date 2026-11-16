//! sandbox@1's engine in the web player (#172): the browser's own WebAssembly engine runs the
//! bytes the app's sandbox module rewrote, behind the native Runner's surface, so the logic module
//! steps them unchanged. Nothing here checks or rewrites. As the app's runner does, before each
//! call it sets the rewrite's counters; after a trap it reads the code the rewrite left, or maps
//! the engine's own trap to its kind from its message, and names the function and the offset in
//! the program as written through the rewrite's offset map. The guest's memory is read through a
//! copy taken after each call and written back before the next one when it was handed out.

use std::cell::RefCell;
use std::collections::HashMap;

use deep_canvas_sandbox::rewrite::{locate, offsets, Entry, FUEL, STACK, STACK_CAP, TRAP};
use deep_canvas_sandbox::trap::{raised, Trap};
use js_sys::{Array, Function, Object, Reflect, Uint8Array, WebAssembly};
use wasm_bindgen::{JsCast, JsValue};
use wasmparser::{ExternalKind, Parser, Payload, TypeRef, ValType};

use crate::{Call, Faults, Outcome};

/// A value of the program's globals or arguments, as wasmtime's `Val` holds one: floats by their
/// bits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Val {
    I32(i32),
    I64(i64),
    F32(u32),
    F64(u64),
}

/// The value types the program declares: each exported global's, by export name.
#[derive(Clone, Default)]
struct Types {
    globals: HashMap<String, ValType>,
}

fn types(bytes: &[u8]) -> Types {
    let mut out = Types::default();
    // The global index space: imported globals first, then the module's own.
    let mut defined: Vec<ValType> = Vec::new();
    let mut exports: Vec<(String, u32)> = Vec::new();
    for payload in Parser::new(0).parse_all(bytes).flatten() {
        match payload {
            Payload::ImportSection(r) => {
                for i in r.into_imports().flatten() {
                    if let TypeRef::Global(g) = i.ty {
                        defined.push(g.content_type);
                    }
                }
            }
            Payload::GlobalSection(r) => {
                for g in r.into_iter().flatten() {
                    defined.push(g.ty.content_type);
                }
            }
            Payload::ExportSection(r) => {
                for e in r.into_iter().flatten() {
                    if e.kind == ExternalKind::Global {
                        exports.push((e.name.to_string(), e.index));
                    }
                }
            }
            _ => {}
        }
    }
    for (name, index) in exports {
        if let Some(t) = defined.get(index as usize) {
            out.globals.insert(name, *t);
        }
    }
    out
}

thread_local! {
    /// Each program compiled once per page, by its bytes: the player's one thread compiles a
    /// program the first time a world opens it.
    static MODULES: RefCell<HashMap<Vec<u8>, WebAssembly::Module>> = RefCell::new(HashMap::new());
}

fn module_of(bytes: &[u8]) -> Result<WebAssembly::Module, String> {
    MODULES.with(|m| {
        if let Some(found) = m.borrow().get(bytes) {
            return Ok(found.clone());
        }
        let compiled =
            WebAssembly::Module::new(&Uint8Array::from(bytes).into()).map_err(|e| message(&e))?;
        m.borrow_mut().insert(bytes.to_vec(), compiled.clone());
        Ok(compiled)
    })
}

fn message(e: &JsValue) -> String {
    Reflect::get(e, &"message".into())
        .ok()
        .and_then(|m| m.as_string())
        .or_else(|| e.as_string())
        .unwrap_or_else(|| "the engine failed".into())
}

/// A program instantiated once; calls run in turn on its memory and globals.
pub struct Runner {
    exports: Object,
    types: Types,
    map: Vec<Entry>,
    shift: i64,
    written: bool,
    faults: Faults,
    /// The guest's memory as last read, and whether it is current and whether it was handed out
    /// to be written in place.
    copy: Vec<u8>,
    fresh: bool,
    dirty: bool,
}

impl Runner {
    /// `written`: a trap names the offset in the program as written; else in the rewritten one.
    pub fn new(bytes: &[u8], faults: Faults, written: bool) -> Result<Runner, String> {
        Runner::sized(bytes, None, faults, written)
    }

    /// As `new`, with the program's one memory holding `pages` pages when given.
    pub fn sized(
        bytes: &[u8],
        pages: Option<u64>,
        faults: Faults,
        written: bool,
    ) -> Result<Runner, String> {
        let (sized, shift) = match pages {
            Some(p) => deep_canvas_sandbox::rewrite::sized(bytes, p)?,
            None => (bytes.to_vec(), 0),
        };
        let module = module_of(&sized)?;
        let instance =
            WebAssembly::Instance::new(&module, &Object::new()).map_err(|e| message(&e))?;
        Ok(Runner {
            exports: instance.exports(),
            types: types(&sized),
            map: offsets(bytes),
            shift,
            written,
            faults,
            copy: Vec::new(),
            fresh: false,
            dirty: false,
        })
    }

    fn export(&self, name: &str) -> Option<JsValue> {
        Reflect::get(&self.exports, &name.into())
            .ok()
            .filter(|v| !v.is_undefined())
    }

    /// Sets an exported mutable global.
    pub fn set(&mut self, name: &str, v: Val) -> Result<(), String> {
        let g = self
            .export(name)
            .ok_or_else(|| format!("the rewritten program lacks {name}"))?;
        Reflect::set(&g, &"value".into(), &to_js(v))
            .map(|_| ())
            .map_err(|e| message(&e))
    }

    /// A global's value, by its export name.
    pub fn global(&mut self, name: &str) -> Option<Val> {
        let g = self.export(name)?;
        let v = Reflect::get(&g, &"value".into()).ok()?;
        let t = self
            .types
            .globals
            .get(name)
            .copied()
            .unwrap_or(ValType::I32);
        from_js(&v, t)
    }

    /// Whether the program exports a function of this name.
    pub fn exports(&mut self, name: &str) -> bool {
        self.export(name).is_some_and(|f| f.is_function())
    }

    fn buffer(&self, name: &str) -> Option<Uint8Array> {
        let m: WebAssembly::Memory = self.export(name)?.dyn_into().ok()?;
        Some(Uint8Array::new(&m.buffer()))
    }

    fn pull(&mut self, name: &str) -> bool {
        if self.fresh || self.dirty {
            return true;
        }
        let Some(b) = self.buffer(name) else {
            return false;
        };
        self.copy.resize(b.length() as usize, 0);
        b.copy_to(&mut self.copy);
        self.fresh = true;
        true
    }

    fn push(&mut self, name: &str) {
        if !self.dirty {
            return;
        }
        if let Some(b) = self.buffer(name) {
            let n = (b.length() as usize).min(self.copy.len());
            b.subarray(0, n as u32).copy_from(&self.copy[..n]);
        }
        self.dirty = false;
    }

    /// The exported memory's bytes.
    pub fn memory(&mut self, name: &str) -> Option<&[u8]> {
        self.pull(name).then_some(self.copy.as_slice())
    }

    /// The exported memory's bytes, to write in place.
    pub fn memory_mut(&mut self, name: &str) -> Option<&mut [u8]> {
        if !self.pull(name) {
            return None;
        }
        self.dirty = true;
        Some(self.copy.as_mut_slice())
    }

    /// Writes bytes into the exported memory at `at`.
    pub fn write(&mut self, name: &str, at: usize, bytes: &[u8]) -> Result<(), String> {
        self.push(name);
        let b = self
            .buffer(name)
            .ok_or_else(|| format!("the program exports no memory {name}"))?;
        if at + bytes.len() > b.length() as usize {
            return Err("out of bounds memory access".into());
        }
        b.subarray(at as u32, (at + bytes.len()) as u32)
            .copy_from(bytes);
        self.fresh = false;
        Ok(())
    }

    pub fn call(&mut self, call: &Call) -> Result<Outcome, String> {
        self.push("memory");
        self.set(FUEL, Val::I64(call.fuel))?;
        self.set(STACK, Val::I32(0))?;
        self.set(STACK_CAP, Val::I32(call.stack))?;
        self.set(TRAP, Val::I32(0))?;
        let f: Function = self
            .export(&call.export)
            .and_then(|f| f.dyn_into().ok())
            .ok_or_else(|| format!("the program exports no function {}", call.export))?;
        let args: Array = call.args.iter().map(|v| to_js(*v)).collect();
        let ran = f.apply(&JsValue::NULL, &args);
        self.fresh = false;
        let e = match ran {
            Ok(v) => {
                let results = if v.is_undefined() {
                    Vec::new()
                } else {
                    from_js(
                        &v,
                        if v.is_bigint() {
                            ValType::I64
                        } else {
                            ValType::I32
                        },
                    )
                    .into_iter()
                    .collect()
                };
                return Ok(Outcome {
                    results,
                    trap: None,
                });
            }
            Err(e) => e,
        };
        let code = match self.global(TRAP) {
            Some(Val::I32(c)) => c,
            _ => 0,
        };
        let engine = engine_kind(&e);
        let by_rewrite = raised(code).is_some();
        let kind = match (raised(code), engine) {
            (Some(k), _) => k,
            (None, None) => return Err(format!("the call failed without a trap: {}", message(&e))),
            (None, Some(_)) if self.faults.every_trap_unreachable => "unreachable",
            (None, Some(k)) => k,
        };
        let stack = Reflect::get(&e, &"stack".into())
            .ok()
            .and_then(|s| s.as_string())
            .unwrap_or_default();
        let (function, offset) = match frame(&stack) {
            Some((f, o)) => (
                f,
                locate(
                    &self.map,
                    (o as i64 - self.shift) as u32,
                    self.written,
                    by_rewrite,
                ),
            ),
            None => return Err(format!("the trap {kind} has no frame: {}", message(&e))),
        };
        Ok(Outcome {
            results: Vec::new(),
            trap: Some(Trap {
                kind: kind.into(),
                function,
                offset,
            }),
        })
    }
}

fn to_js(v: Val) -> JsValue {
    match v {
        Val::I32(x) => JsValue::from(x),
        Val::I64(x) => JsValue::from(x),
        Val::F32(x) => JsValue::from(f32::from_bits(x)),
        Val::F64(x) => JsValue::from(f64::from_bits(x)),
    }
}

fn from_js(v: &JsValue, t: ValType) -> Option<Val> {
    Some(match t {
        ValType::I64 => Val::I64(i64::try_from(v.clone()).ok()?),
        ValType::F32 => Val::F32((v.as_f64()? as f32).to_bits()),
        ValType::F64 => Val::F64(v.as_f64()?.to_bits()),
        _ => Val::I32(v.as_f64()? as i32),
    })
}

/// The kind of an engine's own trap, from its message, as the web runner names it (#238); none
/// for an error that isn't a trap.
fn engine_kind(e: &JsValue) -> Option<&'static str> {
    let m = message(e).to_lowercase();
    if e.is_instance_of::<js_sys::RangeError>() || m.contains("call stack") {
        return Some("stack");
    }
    if !e.is_instance_of::<WebAssembly::RuntimeError>() {
        return None;
    }
    Some(
        if m.contains("divide by zero") || m.contains("remainder by zero") {
            "divide"
        } else if m.contains("float unrepresentable") || m.contains("invalid conversion") {
            "conversion"
        } else if m.contains("unrepresentable") || m.contains("integer overflow") {
            "overflow"
        } else if m.contains("out of bounds memory") || m.contains("memory access out of bounds") {
            "bounds"
        } else if m.contains("signature mismatch")
            || m.contains("null function")
            || m.contains("table index")
            || m.contains("indirect call")
        {
            "call"
        } else {
            "unreachable"
        },
    )
}

/// The first wasm frame of a trap's stack: its function index and module offset.
fn frame(stack: &str) -> Option<(u32, u32)> {
    let at = stack.find("wasm-function[")?;
    let rest = &stack[at + "wasm-function[".len()..];
    let close = rest.find(']')?;
    let function = rest[..close].parse().ok()?;
    let hex = rest[close..].strip_prefix("]:0x")?;
    let end = hex
        .find(|c: char| !c.is_ascii_hexdigit())
        .unwrap_or(hex.len());
    let offset = u32::from_str_radix(&hex[..end], 16).ok()?;
    Some((function, offset))
}
