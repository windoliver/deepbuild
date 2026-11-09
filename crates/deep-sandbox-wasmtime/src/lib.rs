//! sandbox@1's engine in the app (#238): wasmtime =49.0.2 runs the bytes the sandbox module
//! rewrote. Before each call the runner sets the rewrite's counters (fuel, stack in use, the stack's
//! cap, the trap code); after a trap it reads the code the rewrite left, or maps the engine's own
//! trap to its kind, and names the function and the offset in the program as written, through the
//! offset map the rewrite carries.

pub mod layouts;
pub mod service;

use std::sync::mpsc;
use std::time::Duration;

use deep_canvas_sandbox::rewrite::{locate, offsets, Entry, FUEL, STACK, STACK_CAP, TRAP};
use deep_canvas_sandbox::trap::{raised, Trap};
use wasmtime::{Config, Engine, Instance, Module, Store, Val, WasmBacktrace};

/// The wasmtime this engine links.
pub const WASMTIME: &str = "49.0.2";

/// The native stack each call gets, past any cap the rewrite charges against (at most 2 MiB, the
/// most wasmtime allows), so the rewrite's `stack` trap comes first.
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

/// A program instantiated once; calls run in turn on its memory and globals.
pub struct Runner {
    engine: Engine,
    store: Store<()>,
    instance: Instance,
    /// The rewrite's offset map, and whether a trap names the offset in the program as written.
    map: Vec<Entry>,
    /// How far a memory sized for the run moved the code (rewrite::sized), taken off an offset.
    shift: i64,
    written: bool,
    faults: Faults,
}

impl Runner {
    /// `written`: a trap names the offset in the program as written; else in the rewritten one.
    pub fn new(bytes: &[u8], faults: Faults, written: bool) -> Result<Runner, String> {
        Runner::sized(bytes, None, faults, written)
    }

    /// As `new`, with the program's one memory holding `pages` pages when given: the memory the
    /// role's budget gives, such as a validator's asset plus 4 MiB (#415).
    pub fn sized(bytes: &[u8], pages: Option<u64>, faults: Faults, written: bool) -> Result<Runner, String> {
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
        let module = Module::new(&engine, &sized).map_err(|e| e.to_string())?;
        let mut store = Store::new(&engine, ());
        store.set_epoch_deadline(1);
        if faults.wasmtime_fuel {
            store.set_fuel(u64::MAX).map_err(|e| e.to_string())?;
        }
        let instance = Instance::new(&mut store, &module, &[]).map_err(|e| e.to_string())?;
        Ok(Runner {
            engine,
            store,
            instance,
            map: offsets(bytes),
            shift,
            written,
            faults,
        })
    }

    /// Sets an exported mutable global.
    pub fn set(&mut self, name: &str, v: Val) -> Result<(), String> {
        let g = self
            .instance
            .get_global(&mut self.store, name)
            .ok_or_else(|| format!("the rewritten program lacks {name}"))?;
        g.set(&mut self.store, v).map_err(|e| e.to_string())
    }

    /// A global's value, by its export name.
    pub fn global(&mut self, name: &str) -> Option<Val> {
        let g = self.instance.get_global(&mut self.store, name)?;
        Some(g.get(&mut self.store))
    }

    /// Whether the program exports a function of this name.
    pub fn exports(&mut self, name: &str) -> bool {
        self.instance.get_func(&mut self.store, name).is_some()
    }

    /// The exported memory's bytes.
    pub fn memory(&mut self, name: &str) -> Option<&[u8]> {
        let m = self.instance.get_memory(&mut self.store, name)?;
        Some(m.data(&self.store))
    }

    /// The exported memory's bytes, to write in place.
    pub fn memory_mut(&mut self, name: &str) -> Option<&mut [u8]> {
        let m = self.instance.get_memory(&mut self.store, name)?;
        Some(m.data_mut(&mut self.store))
    }

    /// Writes bytes into the exported memory at `at`.
    pub fn write(&mut self, name: &str, at: usize, bytes: &[u8]) -> Result<(), String> {
        let m = self
            .instance
            .get_memory(&mut self.store, name)
            .ok_or_else(|| format!("the program exports no memory {name}"))?;
        m.write(&mut self.store, at, bytes).map_err(|e| e.to_string())
    }

    pub fn call(&mut self, call: &Call) -> Result<Outcome, String> {
        if self.faults.wasmtime_fuel {
            // wasmtime's own fuel in place of the rewrite's, which is set past any budget.
            self.store
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
            .get_func(&mut self.store, &call.export)
            .ok_or_else(|| format!("the program exports no function {}", call.export))?;
        let n = f.ty(&self.store).results().len();
        let mut results = vec![Val::I32(0); n];
        self.store.set_epoch_deadline(1);
        let (done, wait) = mpsc::channel::<()>();
        let watchdog = call.deadline.map(|limit| {
            let engine = self.engine.clone();
            std::thread::spawn(move || {
                if wait.recv_timeout(limit).is_err() {
                    engine.increment_epoch();
                }
            })
        });
        let ran = f.call(&mut self.store, &call.args, &mut results);
        let _ = done.send(());
        if let Some(w) = watchdog {
            drop(w.join());
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
        let frame = e
            .downcast_ref::<WasmBacktrace>()
            .and_then(|b| b.frames().first().map(|f| (f.func_index(), f.module_offset())));
        let (function, offset) = match frame {
            Some((f, Some(o))) => (f, locate(&self.map, (o as i64 - self.shift) as u32, self.written, by_rewrite)),
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

/// The kind of an engine's own trap.
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
