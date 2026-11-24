//! sandbox@1's engine in the app (#238): wasmtime =49.0.5 runs the bytes the sandbox module
//! rewrote. Before each call the runner sets the rewrite's counters (fuel, stack in use, the stack's
//! cap, the trap code); after a trap it reads the code the rewrite left, or maps the engine's own
//! trap to its kind, and names the function and the offset in the program as written, through the
//! offset map the rewrite carries.

pub mod layouts;
pub mod service;
// #172: in the web player the browser's own WebAssembly engine stands in for wasmtime, behind the
// same Runner, so the logic module steps the same rewritten bytes there.
#[cfg(target_arch = "wasm32")]
mod web;

#[cfg(not(target_arch = "wasm32"))]
use std::cell::UnsafeCell;
#[cfg(not(target_arch = "wasm32"))]
use std::rc::Rc;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(not(target_arch = "wasm32"))]
use std::sync::{mpsc, Arc};
use std::time::Duration;

#[cfg(not(target_arch = "wasm32"))]
use deep_canvas_sandbox::rewrite::{locate, offsets, Entry, FUEL, STACK, STACK_CAP, TRAP};
#[cfg(not(target_arch = "wasm32"))]
use deep_canvas_sandbox::trap::raised;
use deep_canvas_sandbox::trap::Trap;
#[cfg(not(target_arch = "wasm32"))]
pub use wasmtime::Val;
#[cfg(not(target_arch = "wasm32"))]
use wasmtime::{Config, Engine, Instance, Module, Store, WasmBacktrace};
#[cfg(target_arch = "wasm32")]
pub use web::{Runner, Val};

/// The wasmtime this engine links.
pub const WASMTIME: &str = "49.0.5";

/// The native stack each call gets, past any cap the rewrite charges against (at most 2 MiB, the
/// most wasmtime allows), so the rewrite's `stack` trap comes first. A budget's stack keeps under
/// it on every engine, so a budget means the same in the web player.
const NATIVE_STACK: usize = 2 << 20;

/// Planted wrong engines, for the kit's proof (#238).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Faults {
    /// Meters with wasmtime's own fuel instead of the rewrite's.
    pub wasmtime_fuel: bool,
    /// Reports every engine trap as `unreachable`.
    pub every_trap_unreachable: bool,
}

/// One call into a program: an export, its arguments and its budgets.
#[derive(Clone, Debug)]
pub struct Call {
    pub export: String,
    pub args: Vec<Val>,
    pub fuel: i64,
    pub stack: i32,
    /// A wall-clock limit, for a run that might never end (a planted twin under the kit).
    pub deadline: Option<Duration>,
}

/// What a call left: its results, or the trap that stopped it.
#[derive(Clone, Debug)]
pub struct Outcome {
    pub results: Vec<Val>,
    pub trap: Option<Trap>,
}

#[cfg(not(target_arch = "wasm32"))]
static COMPILES: AtomicU64 = AtomicU64::new(0);

/// #2662: how many modules this process has compiled; instantiating one doesn't count.
#[cfg(not(target_arch = "wasm32"))]
pub fn compiles() -> u64 {
    COMPILES.load(Ordering::Relaxed)
}

/// #2662: a program compiled once. Each `runner` is a fresh instance of it in a store of its own,
/// so every runner keeps its own memory, globals, fuel and trap.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone)]
pub struct Program {
    engine: Engine,
    module: Module,
    map: Arc<[Entry]>,
    shift: i64,
    written: bool,
    faults: Faults,
}

#[cfg(not(target_arch = "wasm32"))]
impl std::fmt::Debug for Program {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Program")
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Program {
    /// `bytes` compiled, as `Runner::sized` takes them.
    pub fn new(
        bytes: &[u8],
        pages: Option<u64>,
        faults: Faults,
        written: bool,
    ) -> Result<Program, String> {
        let (sized, shift) = match pages {
            Some(p) => deep_canvas_sandbox::rewrite::sized(bytes, p)?,
            None => (bytes.to_vec(), 0),
        };
        let mut config = Config::new();
        config
            .wasm_backtrace_max_frames(std::num::NonZeroUsize::new(1))
            .cranelift_nan_canonicalization(false)
            .consume_fuel(faults.wasmtime_fuel)
            .epoch_interruption(true)
            .max_wasm_stack(NATIVE_STACK)
            .wasm_simd(false)
            .wasm_relaxed_simd(false)
            .wasm_tail_call(false)
            .wasm_multi_memory(false)
            .wasm_memory64(false)
            .wasm_extended_const(false)
            .wasm_custom_page_sizes(false)
            .wasm_wide_arithmetic(false);
        let engine = Engine::new(&config).map_err(|e| e.to_string())?;
        COMPILES.fetch_add(1, Ordering::Relaxed);
        let module = Module::new(&engine, &sized).map_err(|e| e.to_string())?;
        Ok(Program {
            engine,
            module,
            map: offsets(bytes).into(),
            shift,
            written,
            faults,
        })
    }

    /// A fresh instance, in the state the module starts in.
    pub fn runner(&self) -> Result<Runner, String> {
        let mut store = Store::new(&self.engine, ());
        store.set_epoch_deadline(1);
        if self.faults.wasmtime_fuel {
            store.set_fuel(u64::MAX).map_err(|e| e.to_string())?;
        }
        let instance = Instance::new(&mut store, &self.module, &[]).map_err(|e| e.to_string())?;
        Ok(Runner {
            engine: self.engine.clone(),
            store: Rc::new(UnsafeCell::new(store)),
            instance,
            map: self.map.clone(),
            shift: self.shift,
            written: self.written,
            faults: self.faults,
        })
    }
}

/// A program instantiated once; calls run in turn on its memory and globals.
#[cfg(not(target_arch = "wasm32"))]
pub struct Runner {
    engine: Engine,
    /// Its own store, but for the planted `shared` runner's.
    store: Rc<UnsafeCell<Store<()>>>,
    instance: Instance,
    /// The rewrite's offset map, and whether a trap names the offset in the program as written.
    map: Arc<[Entry]>,
    /// How far a memory sized for the run moved the code (rewrite::sized), taken off an offset.
    shift: i64,
    written: bool,
    faults: Faults,
}

/// What a `Program` is made from: its bytes, its memory's pages, its two faults and `written`.
#[cfg(not(target_arch = "wasm32"))]
type ProgramKey = (Vec<u8>, Option<u64>, bool, bool, bool);

#[cfg(not(target_arch = "wasm32"))]
thread_local! {
    /// #1172: the programs `Runner::sized` compiled on this thread. Per thread, because a
    /// runner's deadline interrupts by its engine's epoch: an engine shared across threads would
    /// let one call's deadline stop another's.
    static PROGRAMS: std::cell::RefCell<std::collections::HashMap<ProgramKey, Program>> =
        Default::default();
}

/// The most programs a thread keeps compiled; past it, the thread starts over.
#[cfg(not(target_arch = "wasm32"))]
const PROGRAMS_MAX: usize = 256;

#[cfg(not(target_arch = "wasm32"))]
impl Runner {
    /// `written`: a trap names the offset in the program as written; else in the rewritten one.
    pub fn new(bytes: &[u8], faults: Faults, written: bool) -> Result<Runner, String> {
        Runner::sized(bytes, None, faults, written)
    }

    /// As `new`, with the program's one memory holding `pages` pages when given: the memory the
    /// role's budget gives, such as a validator's asset plus 4 MiB (#415).
    pub fn sized(
        bytes: &[u8],
        pages: Option<u64>,
        faults: Faults,
        written: bool,
    ) -> Result<Runner, String> {
        // #1172: a pack's check makes runners of one program many times, and a fresh canvas
        // core's first reply paid for compiling it each time; this thread's earlier compile of the
        // same program is reused, and the runner is a fresh instance of it all the same.
        let key: ProgramKey = (
            bytes.to_vec(),
            pages,
            faults.wasmtime_fuel,
            faults.every_trap_unreachable,
            written,
        );
        if let Some(p) = PROGRAMS.with(|c| c.borrow().get(&key).cloned()) {
            return p.runner();
        }
        let program = Program::new(bytes, pages, faults, written)?;
        PROGRAMS.with(|c| {
            let mut c = c.borrow_mut();
            if c.len() >= PROGRAMS_MAX {
                c.clear();
            }
            c.insert(key, program.clone());
        });
        program.runner()
    }

    /// #2662's planted wrong engine: a second runner on this one's store and instance, so a call
    /// on either writes the other's memory, globals and fuel.
    ///
    /// # Safety
    /// No slice `memory` or `memory_mut` gave from one of the two is held across a call on the other.
    #[doc(hidden)]
    pub unsafe fn shared(&self) -> Runner {
        Runner {
            engine: self.engine.clone(),
            store: self.store.clone(),
            instance: self.instance,
            map: self.map.clone(),
            shift: self.shift,
            written: self.written,
            faults: self.faults,
        }
    }

    /// Sets an exported mutable global.
    pub fn set(&mut self, name: &str, v: Val) -> Result<(), String> {
        let g = self
            .instance
            .get_global(st(&mut self.store), name)
            .ok_or_else(|| format!("the rewritten program lacks {name}"))?;
        g.set(st(&mut self.store), v).map_err(|e| e.to_string())
    }

    /// A global's value, by its export name.
    pub fn global(&mut self, name: &str) -> Option<Val> {
        let g = self.instance.get_global(st(&mut self.store), name)?;
        Some(g.get(st(&mut self.store)))
    }

    /// Whether the program exports a function of this name.
    pub fn exports(&mut self, name: &str) -> bool {
        self.instance.get_func(st(&mut self.store), name).is_some()
    }

    /// The exported memory's bytes.
    pub fn memory(&mut self, name: &str) -> Option<&[u8]> {
        let m = self.instance.get_memory(st(&mut self.store), name)?;
        Some(m.data(&*st(&mut self.store)))
    }

    /// The exported memory's bytes, to write in place.
    pub fn memory_mut(&mut self, name: &str) -> Option<&mut [u8]> {
        let m = self.instance.get_memory(st(&mut self.store), name)?;
        Some(m.data_mut(st(&mut self.store)))
    }

    /// Writes bytes into the exported memory at `at`.
    pub fn write(&mut self, name: &str, at: usize, bytes: &[u8]) -> Result<(), String> {
        let m = self
            .instance
            .get_memory(st(&mut self.store), name)
            .ok_or_else(|| format!("the program exports no memory {name}"))?;
        m.write(st(&mut self.store), at, bytes)
            .map_err(|e| e.to_string())
    }

    pub fn call(&mut self, call: &Call) -> Result<Outcome, String> {
        if self.faults.wasmtime_fuel {
            // wasmtime's own fuel in place of the rewrite's, which is set past any budget.
            st(&mut self.store)
                .set_fuel(call.fuel.max(0) as u64)
                .map_err(|e| e.to_string())?;
            self.set(FUEL, Val::I64(i64::MAX))?;
        } else {
            self.set(FUEL, Val::I64(call.fuel))?;
        }
        self.set(STACK, Val::I32(0))?;
        self.set(STACK_CAP, Val::I32(call.stack))?;
        self.set(TRAP, Val::I32(0))?;
        let f = self
            .instance
            .get_func(st(&mut self.store), &call.export)
            .ok_or_else(|| format!("the program exports no function {}", call.export))?;
        let n = f.ty(&*st(&mut self.store)).results().len();
        let mut results = vec![Val::I32(0); n];
        st(&mut self.store).set_epoch_deadline(1);
        // The watchdog and its channel, only for a call with a deadline (#2662).
        let watchdog = call.deadline.map(|limit| {
            let (done, wait) = mpsc::channel::<()>();
            let engine = self.engine.clone();
            let thread = std::thread::spawn(move || {
                if wait.recv_timeout(limit).is_err() {
                    engine.increment_epoch();
                }
            });
            (done, thread)
        });
        let ran = f.call(st(&mut self.store), &call.args, &mut results);
        if let Some((done, thread)) = watchdog {
            let _ = done.send(());
            drop(thread.join());
        }
        let e = match ran {
            Ok(()) => {
                return Ok(Outcome {
                    results,
                    trap: None,
                })
            }
            Err(e) => e,
        };
        let code = match self.global(TRAP) {
            Some(Val::I32(c)) => c,
            _ => 0,
        };
        let engine = e.downcast_ref::<wasmtime::Trap>().copied();
        if engine == Some(wasmtime::Trap::Interrupt) {
            return Err(format!(
                "the call ran past its {} s limit without ending",
                call.deadline.unwrap_or_default().as_secs()
            ));
        }
        let by_rewrite = raised(code).is_some();
        let kind = match (raised(code), engine) {
            (Some(k), _) => k,
            (None, None) => return Err(format!("the call failed without a trap: {e}")),
            (None, Some(_)) if self.faults.every_trap_unreachable => "unreachable",
            (None, Some(t)) => kind(t),
        };
        let frame = e.downcast_ref::<WasmBacktrace>().and_then(|b| {
            b.frames()
                .first()
                .map(|f| (f.func_index(), f.module_offset()))
        });
        let (function, offset) = match frame {
            Some((f, Some(o))) => (
                f,
                locate(
                    &self.map,
                    (o as i64 - self.shift) as u32,
                    self.written,
                    by_rewrite,
                ),
            ),
            _ => return Err(format!("the trap {kind} has no frame: {e}")),
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

/// A runner's store. Each runner's is its own, so its `&mut` is the only way in; the planted
/// `shared` runner's safety rule covers the one case with two.
#[cfg(not(target_arch = "wasm32"))]
fn st(store: &mut Rc<UnsafeCell<Store<()>>>) -> &mut Store<()> {
    // SAFETY: the `&mut` to the one handle a runner has, and `Runner::shared`'s rule for two.
    unsafe { &mut *store.get() }
}

/// The kind of an engine's own trap.
#[cfg(not(target_arch = "wasm32"))]
fn kind(t: wasmtime::Trap) -> &'static str {
    use wasmtime::Trap::*;
    match t {
        IntegerDivisionByZero => "divide",
        IntegerOverflow => "overflow",
        BadConversionToInteger => "conversion",
        MemoryOutOfBounds | HeapMisaligned => "bounds",
        BadSignature | IndirectCallToNull | TableOutOfBounds => "call",
        StackOverflow => "stack",
        OutOfFuel => "fuel",
        _ => "unreachable",
    }
}
