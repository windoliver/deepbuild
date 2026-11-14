//! Spike #245: the steering fixture's step blocks in both forms (canvas primitives: Logic: step
//! blocks), on sandbox@1's rewritten program in wasmtime =49.0.5 with deep-sandbox-wasmtime's
//! engine settings.
//!
//! - `one_instance`: one instance runs `step(k)`, then each block in turn; after block b its slices
//!   are kept aside, its slices restored from S and its scratch zeroed, then the slices are merged
//!   and `join(k)` runs.
//! - `copy_on_write`: the main instance's memory is a shared mapping of a memory file holding S;
//!   each block has its own instance whose memory is a private mapping of that file, mapped again
//!   before each block; 4 threads run the blocks dealt round-robin, then the main thread merges
//!   the slices and runs `join(k)`.
//!
//! Both forms check each block's writes the same way (the pages it wrote, outside its slices and
//! scratch, against S), count each block's fuel from zero, and must end in the same bits.
//!
//! Usage: `spike-245 <steer.wat> <steps>`; prints the run's numbers as one JSON object, which
//! `record.mjs` stores with the host and the verdict.

use std::collections::BTreeMap;
use std::sync::{Arc, Barrier, Mutex};
use std::time::{Duration, Instant};

use deep_canvas_sandbox::check::{check, check_role, Limits};
use deep_canvas_sandbox::rewrite::{rewrite_as, Faults, Mode, FUEL, PAGES, STACK, STACK_CAP, TRAP};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use wasmtime::{
    Config, Engine, Global, Instance, LinearMemory, MemoryCreator, MemoryType, Module, Store, TypedFunc, Val,
};

const AGENTS: usize = 8000;
const BLOCKS: usize = 8;
const THREADS: usize = 4;
const RATE_HZ: u32 = 60;
const WARMUP: usize = 120;
const MEM: usize = 12 * 65536;
const WASM_PAGE: usize = 65536;
/// The out regions, `[at, at + BLOCKS × stride)`, and the scratch region (steer.wat's globals).
const OUT: [usize; 2] = [256_000, 384_000];
const STRIDE: usize = 16_000;
const SCRATCH: (usize, usize) = (778_240, 8192);
/// `parallel.fuel` as the fixture declares it, and the rest of `budget.fuel`.
const BLOCK_FUEL: i64 = 2_000_000;
const STEP_FUEL: i64 = 10_000_000;
const STACK_BYTES: i32 = 1 << 20;

fn program(path: &str) -> Result<Vec<u8>, String> {
    let given = wat::parse_file(path).map_err(|e| e.to_string())?;
    check(&given, &Limits::default()).map_err(|r| format!("sandbox@1 refuses the fixture: {r:?}"))?;
    check_role(&given, "logic").map_err(|r| format!("the logic role refuses the fixture: {r:?}"))?;
    Ok(rewrite_as(&given, Faults::default(), Mode::Logic)?.bytes)
}

/// deep-sandbox-wasmtime's `Runner` settings.
fn config() -> Config {
    let mut config = Config::new();
    config
        .wasm_backtrace_max_frames(std::num::NonZeroUsize::new(1))
        .cranelift_nan_canonicalization(false)
        .epoch_interruption(true)
        .max_wasm_stack(2 << 20)
        .wasm_simd(false)
        .wasm_relaxed_simd(false)
        .wasm_tail_call(false)
        .wasm_multi_memory(false)
        .wasm_memory64(false)
        .wasm_extended_const(false)
        .wasm_custom_page_sizes(false)
        .wasm_wide_arithmetic(false);
    config
}

/// One instance of the rewritten program, with the exports a step needs.
struct Inst {
    store: Store<()>,
    step: TypedFunc<i64, ()>,
    block: TypedFunc<(i64, i32), ()>,
    join: TypedFunc<i64, ()>,
    fuel: Global,
    stack: Global,
    cap: Global,
    trap: Global,
    pages: Global,
    /// The program's own mutable globals (`sandbox.global.<i>`).
    globals: Vec<Global>,
    memory: wasmtime::Memory,
}

impl Inst {
    fn new(engine: &Engine, module: &Module) -> Result<Inst, String> {
        let mut store = Store::new(engine, ());
        store.set_epoch_deadline(1 << 40);
        let instance = Instance::new(&mut store, module, &[]).map_err(|e| e.to_string())?;
        let g = |store: &mut Store<()>, n: &str| {
            instance.get_global(&mut *store, n).ok_or_else(|| format!("the program lacks {n}"))
        };
        let fuel = g(&mut store, FUEL)?;
        let stack = g(&mut store, STACK)?;
        let cap = g(&mut store, STACK_CAP)?;
        let trap = g(&mut store, TRAP)?;
        let pages = g(&mut store, &format!("{PAGES}0"))?;
        let mut globals = Vec::new();
        let names: Vec<String> = module
            .exports()
            .filter(|e| e.name().starts_with(deep_canvas_sandbox::rewrite::GLOBAL))
            .map(|e| e.name().to_string())
            .collect();
        for n in names {
            globals.push(g(&mut store, &n)?);
        }
        let f = |store: &mut Store<()>, n: &str| {
            instance.get_func(&mut *store, n).ok_or_else(|| format!("the program lacks {n}"))
        };
        let step = f(&mut store, "step")?.typed(&store).map_err(|e| e.to_string())?;
        let block = f(&mut store, "block")?.typed(&store).map_err(|e| e.to_string())?;
        let join = f(&mut store, "join")?.typed(&store).map_err(|e| e.to_string())?;
        let init: TypedFunc<(), ()> = f(&mut store, "init")?.typed(&store).map_err(|e| e.to_string())?;
        let memory = instance.get_memory(&mut store, "memory").ok_or("the program lacks memory")?;
        // The layout this harness reads and touches is the fixture's own (steer.wat's globals).
        let layout = [("npos_at", OUT[0]), ("nvel_at", OUT[1]), ("scratch_at", SCRATCH.0), ("agents", AGENTS), ("blocks", BLOCKS)];
        for (n, want) in layout {
            let got = g(&mut store, n)?.get(&mut store).unwrap_i32() as usize;
            if got != want {
                return Err(format!("the fixture's {n} is {got}, not the harness's {want}"));
            }
        }
        if memory.data_size(&store) != MEM {
            return Err(format!("the fixture's memory is not {MEM} bytes"));
        }
        let mut inst = Inst { store, step, block, join, fuel, stack, cap, trap, pages, globals, memory };
        inst.arm(STEP_FUEL)?;
        init.call(&mut inst.store, ()).map_err(|e| e.to_string())?;
        Ok(inst)
    }

    /// Sets the rewrite's counters before a call, as deep-sandbox-wasmtime's runner does.
    fn arm(&mut self, fuel: i64) -> Result<(), String> {
        let s = &mut self.store;
        self.fuel.set(&mut *s, Val::I64(fuel)).map_err(|e| e.to_string())?;
        self.stack.set(&mut *s, Val::I32(0)).map_err(|e| e.to_string())?;
        self.cap.set(&mut *s, Val::I32(STACK_BYTES)).map_err(|e| e.to_string())?;
        self.trap.set(&mut *s, Val::I32(0)).map_err(|e| e.to_string())
    }

    /// The fuel a call used, or the trap that stopped it.
    fn used(&mut self, fuel: i64, ran: wasmtime::Result<()>) -> Result<i64, String> {
        let left = self.fuel.get(&mut self.store).unwrap_i64();
        match ran {
            Ok(()) => Ok(fuel - left),
            Err(e) => Err(format!("trap {} ({e})", self.trap.get(&mut self.store).unwrap_i32())),
        }
    }

    fn run_step(&mut self, k: i64) -> Result<i64, String> {
        self.arm(STEP_FUEL)?;
        let ran = self.step.call(&mut self.store, k);
        self.used(STEP_FUEL, ran)
    }

    fn run_join(&mut self, k: i64) -> Result<i64, String> {
        self.arm(STEP_FUEL)?;
        let ran = self.join.call(&mut self.store, k);
        self.used(STEP_FUEL, ran)
    }

    /// Runs block b from zero fuel, with the page bitmap cleared; the pages it wrote.
    fn run_block(&mut self, k: i64, b: usize) -> Result<(i64, u64), String> {
        self.arm(BLOCK_FUEL)?;
        self.pages.set(&mut self.store, Val::I64(0)).map_err(|e| e.to_string())?;
        let ran = self.block.call(&mut self.store, (k, b as i32));
        let fuel = self.used(BLOCK_FUEL, ran)?;
        Ok((fuel, self.pages.get(&mut self.store).unwrap_i64() as u64))
    }

    fn get_globals(&mut self) -> Vec<Val> {
        let gs = self.globals.clone();
        gs.iter().map(|g| g.get(&mut self.store)).collect()
    }

    fn set_globals(&mut self, vals: &[Val]) -> Result<(), String> {
        let gs = self.globals.clone();
        for (g, v) in gs.iter().zip(vals) {
            g.set(&mut self.store, *v).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn bytes(&self) -> &[u8] {
        self.memory.data(&self.store)
    }

    /// The full-state hash: memory, then each mutable global's bits.
    fn deep_hash(&mut self) -> String {
        let mut state = self.bytes().to_vec();
        for v in self.get_globals() {
            let bits = match v {
                Val::I32(x) => x as u64,
                Val::I64(x) => x as u64,
                Val::F32(x) => x as u64,
                Val::F64(x) => x,
                _ => 0,
            };
            state.extend_from_slice(&bits.to_le_bytes());
        }
        hash(&state)
    }
}

/// The byte ranges block b may write: slice b of each out region, and the scratch.
fn allowed(b: usize) -> [(usize, usize); 3] {
    [
        (OUT[0] + b * STRIDE, OUT[0] + (b + 1) * STRIDE),
        (OUT[1] + b * STRIDE, OUT[1] + (b + 1) * STRIDE),
        (SCRATCH.0, SCRATCH.0 + SCRATCH.1),
    ]
}

/// The first offset block b changed outside its slices and scratch, comparing each page it wrote
/// with S; `s(lo, hi)` gives S's bytes there, or None where the form kept no copy of S.
fn stray<'a>(b: usize, written: u64, mine: &[u8], s: impl Fn(usize, usize) -> Option<&'a [u8]>) -> Option<usize> {
    let ok = allowed(b);
    for p in 0..MEM / WASM_PAGE {
        if written & (1 << p) == 0 {
            continue;
        }
        let (mut lo, end) = (p * WASM_PAGE, (p + 1) * WASM_PAGE);
        // The page's parts outside the allowed ranges, which are sorted and disjoint.
        for &(a, z) in ok.iter().chain([(end, end)].iter()) {
            let hi = a.clamp(lo, end);
            if lo < hi {
                match s(lo, hi) {
                    Some(sb) => {
                        if let Some(i) = mine[lo..hi].iter().zip(sb).position(|(x, y)| x != y) {
                            return Some(lo + i);
                        }
                    }
                    None => return Some(lo),
                }
            }
            lo = lo.max(z.min(end));
        }
    }
    None
}

/// What one step recorded.
#[derive(Clone, Default)]
struct Sample {
    wall_ns: u64,
    /// Mapping S into each block's instance and dropping it after the merge, over the step's blocks.
    map_ns: u64,
    /// The page faults each block's first touches took, summed over the step's blocks.
    fault_ns: u64,
    /// Keeping slices aside and restoring S between blocks (one instance only).
    restore_ns: u64,
    /// Comparing each block's written pages with S.
    check_ns: u64,
    minor_faults: u64,
    /// Pages the blocks' touches faulted in, and faults the blocks took after them (Linux only).
    touched: u64,
    late_faults: Option<u64>,
    step_fuel: i64,
    join_fuel: i64,
    block_fuel: [i64; BLOCKS],
}

fn minor_faults() -> u64 {
    let mut u: libc::rusage = unsafe { std::mem::zeroed() };
    unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut u) };
    u.ru_minflt as u64
}

fn ns(d: Duration) -> u64 {
    d.as_nanos() as u64
}

/// Paces steps at 60 Hz, as the app's step clock would: step k starts no earlier than k / 60 s.
struct Clock {
    start: Instant,
}

impl Clock {
    fn wait(&self, k: usize) {
        let due = self.start + Duration::from_nanos(k as u64 * 1_000_000_000 / RATE_HZ as u64);
        let now = Instant::now();
        if due > now {
            std::thread::sleep(due - now);
        }
    }
}

fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// The form run: its samples after warmup, and the full-state hash every 600 steps and at the end.
struct Run {
    samples: Vec<Sample>,
    hashes: BTreeMap<usize, String>,
    /// The memory file's kind, on copy-on-write.
    file: Option<&'static str>,
}

fn one_instance(engine: &Engine, module: &Module, steps: usize) -> Result<Run, String> {
    let mut inst = Inst::new(engine, module)?;
    let (lo, hi) = (OUT[0] / WASM_PAGE * WASM_PAGE, (OUT[1] + BLOCKS * STRIDE).div_ceil(WASM_PAGE) * WASM_PAGE);
    let (slo, shi) = (SCRATCH.0 / WASM_PAGE * WASM_PAGE, MEM);
    let mut s_out = vec![0u8; hi - lo];
    let mut s_scr = vec![0u8; shi - slo];
    let mut aside = vec![[vec![0u8; STRIDE], vec![0u8; STRIDE]]; BLOCKS];
    let mut run = Run { samples: Vec::new(), hashes: BTreeMap::new(), file: None };
    let clock = Clock { start: Instant::now() };
    for k in 0..steps + WARMUP {
        clock.wait(k);
        let mut x = Sample::default();
        let faults = minor_faults();
        let t0 = Instant::now();
        x.step_fuel = inst.run_step(k as i64)?;
        // S, where a block may write: the out regions' pages and the scratch's page.
        let t = Instant::now();
        s_out.copy_from_slice(&inst.bytes()[lo..hi]);
        s_scr.copy_from_slice(&inst.bytes()[slo..shi]);
        let globals = inst.get_globals();
        x.restore_ns += ns(t.elapsed());
        for (b, kept) in aside.iter_mut().enumerate() {
            let t = Instant::now();
            inst.memory.data_mut(&mut inst.store)[SCRATCH.0..SCRATCH.0 + SCRATCH.1].fill(0);
            x.restore_ns += ns(t.elapsed());
            let (fuel, written) = inst.run_block(k as i64, b)?;
            x.block_fuel[b] = fuel;
            let t = Instant::now();
            let s = |a: usize, z: usize| {
                if a >= lo && z <= hi {
                    Some(&s_out[a - lo..z - lo])
                } else if a >= slo && z <= shi {
                    Some(&s_scr[a - slo..z - slo])
                } else {
                    None
                }
            };
            if let Some(at) = stray(b, written, inst.bytes(), s) {
                return Err(format!("block_write {{block: {b}, offset: {at}}} at step {k}"));
            }
            x.check_ns += ns(t.elapsed());
            let t = Instant::now();
            let ok = allowed(b);
            let mem = inst.memory.data_mut(&mut inst.store);
            for r in 0..2 {
                let (a, z) = ok[r];
                kept[r].copy_from_slice(&mem[a..z]);
                mem[a..z].copy_from_slice(&s_out[a - lo..z - lo]);
            }
            mem[SCRATCH.0..SCRATCH.0 + SCRATCH.1].copy_from_slice(&s_scr[SCRATCH.0 - slo..]);
            inst.set_globals(&globals)?;
            x.restore_ns += ns(t.elapsed());
        }
        let mem = inst.memory.data_mut(&mut inst.store);
        for (b, kept) in aside.iter().enumerate() {
            let ok = allowed(b);
            for r in 0..2 {
                mem[ok[r].0..ok[r].1].copy_from_slice(&kept[r]);
            }
        }
        x.join_fuel = inst.run_join(k as i64)?;
        x.wall_ns = ns(t0.elapsed());
        x.minor_faults = minor_faults() - faults;
        if k >= WARMUP {
            run.samples.push(x);
        }
        if (k + 1) % 600 == 0 || k + 1 == steps + WARMUP {
            run.hashes.insert(k + 1, inst.deep_hash());
        }
    }
    Ok(run)
}

/// The memory file S lives in: the main instance maps it shared, each block's instance privately.
/// On Linux a memfd; elsewhere a POSIX shm object if the OS maps one privately, else an unlinked
/// file in the temp folder. `kind` names which.
struct File {
    fd: libc::c_int,
    kind: &'static str,
}

/// An fd sized to the memory, if a private mapping of it works; else why not, on stderr.
fn sized(fd: libc::c_int) -> Option<libc::c_int> {
    if fd < 0 || unsafe { libc::ftruncate(fd, MEM as libc::off_t) } != 0 {
        eprintln!("memory file: {}", std::io::Error::last_os_error());
        return None;
    }
    let rw = libc::PROT_READ | libc::PROT_WRITE;
    let p = unsafe { libc::mmap(std::ptr::null_mut(), MEM, rw, libc::MAP_PRIVATE, fd, 0) };
    if p == libc::MAP_FAILED {
        eprintln!("memory file: no private mapping: {}", std::io::Error::last_os_error());
        unsafe { libc::close(fd) };
        return None;
    }
    unsafe { libc::munmap(p, MEM) };
    Some(fd)
}

impl File {
    fn new() -> Result<File, String> {
        #[cfg(target_os = "linux")]
        let tried = sized(unsafe { libc::memfd_create(c"spike-245".as_ptr(), libc::MFD_CLOEXEC) }).map(|fd| (fd, "memfd"));
        #[cfg(not(target_os = "linux"))]
        let tried = {
            let name = std::ffi::CString::new(format!("/spike-245-{}", std::process::id())).unwrap();
            let fd = unsafe { libc::shm_open(name.as_ptr(), libc::O_RDWR | libc::O_CREAT | libc::O_EXCL, 0o600) };
            unsafe { libc::shm_unlink(name.as_ptr()) };
            sized(fd).map(|fd| (fd, "shm")).or_else(|| {
                let path = std::env::temp_dir().join(format!("spike-245-{}", std::process::id()));
                let path = std::ffi::CString::new(path.to_string_lossy().into_owned()).unwrap();
                let fd = unsafe { libc::open(path.as_ptr(), libc::O_RDWR | libc::O_CREAT | libc::O_EXCL, 0o600) };
                unsafe { libc::unlink(path.as_ptr()) };
                sized(fd).map(|fd| (fd, "tmpfile"))
            })
        };
        let (fd, kind) = tried.ok_or("no memory file maps privately")?;
        Ok(File { fd, kind })
    }
}

/// A wasm memory whose first MEM bytes map the memory file, in a reservation with the guard
/// wasmtime asked for, so the compiled code is the same as on wasmtime's own memories.
struct Mapped {
    base: usize,
    fd: libc::c_int,
    shared: bool,
}

impl Mapped {
    /// Maps the file over the memory again: a private mapping drops the copies of its last run.
    fn map(&self) -> Result<(), String> {
        let flags = libc::MAP_FIXED | if self.shared { libc::MAP_SHARED } else { libc::MAP_PRIVATE };
        let p = unsafe {
            libc::mmap(self.base as *mut libc::c_void, MEM, libc::PROT_READ | libc::PROT_WRITE, flags, self.fd, 0)
        };
        if p as usize != self.base {
            return Err(format!("mmap: {}", std::io::Error::last_os_error()));
        }
        Ok(())
    }
}

/// Maps fresh zero pages over a block's memory, dropping its private mapping of the memory file.
fn release(base: usize) -> Result<(), String> {
    let flags = libc::MAP_FIXED | libc::MAP_PRIVATE | libc::MAP_ANON;
    let p = unsafe { libc::mmap(base as *mut libc::c_void, MEM, libc::PROT_READ | libc::PROT_WRITE, flags, -1, 0) };
    if p as usize != base {
        return Err(format!("mmap: {}", std::io::Error::last_os_error()));
    }
    Ok(())
}

unsafe impl LinearMemory for Mapped {
    fn byte_size(&self) -> usize {
        MEM
    }
    fn byte_capacity(&self) -> usize {
        MEM
    }
    fn grow_to(&mut self, new_size: usize) -> wasmtime::Result<()> {
        if new_size == MEM {
            Ok(())
        } else {
            Err(wasmtime::Error::msg("the fixture's memory never grows"))
        }
    }
    fn as_ptr(&self) -> *mut u8 {
        self.base as *mut u8
    }
}

/// Makes each memory a `Mapped`, shared for the next instance when `shared` is set, and keeps
/// every base it made so the spike can map them again.
struct Creator {
    fd: libc::c_int,
    shared: Mutex<bool>,
    made: Mutex<Vec<usize>>,
}

unsafe impl MemoryCreator for Creator {
    fn new_memory(
        &self,
        _ty: MemoryType,
        minimum: usize,
        _maximum: Option<usize>,
        reserved: Option<usize>,
        guard: usize,
    ) -> Result<Box<dyn LinearMemory>, String> {
        if minimum != MEM {
            return Err(format!("the fixture's memory is {MEM} bytes, not {minimum}"));
        }
        let size = reserved.unwrap_or(MEM).max(MEM) + guard;
        let base = unsafe {
            libc::mmap(std::ptr::null_mut(), size, libc::PROT_NONE, libc::MAP_PRIVATE | libc::MAP_ANON, -1, 0)
        };
        if base == libc::MAP_FAILED {
            return Err(format!("reserve: {}", std::io::Error::last_os_error()));
        }
        let m = Mapped { base: base as usize, fd: self.fd, shared: *self.shared.lock().unwrap() };
        m.map()?;
        self.made.lock().unwrap().push(m.base);
        Ok(Box::new(m))
    }
}

/// A block instance on a worker thread, with the base of its mapped memory.
struct BlockInst {
    b: usize,
    inst: Inst,
    mem: Mapped,
}

/// What the main thread hands the workers each step.
#[derive(Default)]
struct Turn {
    k: i64,
    globals: Vec<Val>,
    stop: bool,
}

#[derive(Default, Clone)]
struct Done {
    fuel: i64,
    written: u64,
    map_ns: u64,
    fault_ns: u64,
    touched: u64,
    /// Faults the block itself took after the touches, where the OS counts per thread.
    late_faults: Option<u64>,
    check_ns: u64,
    error: Option<String>,
}

/// The byte ranges block b reads (steer.wat): POS and VEL, CSTART, its agents' CIDX, and SORTED.
fn reads(b: usize) -> [(usize, usize); 4] {
    [(0, 256_000), (512_000, 577_540), (643_076 + 4000 * b, 643_076 + 4000 * (b + 1)), (675_076, 707_076)]
}

/// Touches each OS page block b reads or writes once, writing the pages of its slices and scratch
/// (their own bytes back) and reading the rest, so the block itself then runs without a fault.
/// Returns the pages touched.
fn pretouch(base: usize, b: usize) -> u64 {
    let os = unsafe { libc::sysconf(libc::_SC_PAGESIZE) } as usize;
    let (ok, rd) = (allowed(b), reads(b));
    let (mut at, mut n) = (0, 0);
    while at < MEM {
        let p = (base + at) as *mut u8;
        let hit = |r: &[(usize, usize)]| r.iter().any(|&(a, z)| at + os > a && at < z);
        unsafe {
            if hit(&ok) {
                std::ptr::write_volatile(p, std::ptr::read_volatile(p));
                n += 1;
            } else if hit(&rd) {
                std::ptr::read_volatile(p);
                n += 1;
            }
        }
        at += os;
    }
    n
}

/// This thread's minor faults so far, where the OS counts them per thread.
#[cfg(target_os = "linux")]
fn thread_faults() -> Option<u64> {
    let mut u: libc::rusage = unsafe { std::mem::zeroed() };
    unsafe { libc::getrusage(libc::RUSAGE_THREAD, &mut u) };
    Some(u.ru_minflt as u64)
}

#[cfg(not(target_os = "linux"))]
fn thread_faults() -> Option<u64> {
    None
}

fn copy_on_write(module_bytes: &[u8], steps: usize) -> Result<Run, String> {
    let file = File::new()?;
    let creator = Arc::new(Creator { fd: file.fd, shared: Mutex::new(true), made: Mutex::new(Vec::new()) });
    let mut cfg = config();
    cfg.with_host_memory(creator.clone());
    let engine = Engine::new(&cfg).map_err(|e| e.to_string())?;
    let module = Module::new(&engine, module_bytes).map_err(|e| e.to_string())?;
    let mut main = Inst::new(&engine, &module)?;
    *creator.shared.lock().unwrap() = false;
    let mut workers: Vec<Vec<BlockInst>> = (0..THREADS).map(|_| Vec::new()).collect();
    for b in 0..BLOCKS {
        // Each block's instance; its init wrote only its own private copy, mapped again per block.
        let inst = Inst::new(&engine, &module)?;
        let base = *creator.made.lock().unwrap().last().unwrap();
        workers[b % THREADS].push(BlockInst { b, inst, mem: Mapped { base, fd: file.fd, shared: false } });
    }
    let bases: Vec<usize> = {
        let mut v = vec![0; BLOCKS];
        for w in &workers {
            for bi in w {
                v[bi.b] = bi.mem.base;
            }
        }
        v
    };
    let turn = Arc::new(Mutex::new(Turn::default()));
    let done = Arc::new(Mutex::new(vec![Done::default(); BLOCKS]));
    let go = Arc::new(Barrier::new(THREADS + 1));
    let back = Arc::new(Barrier::new(THREADS + 1));
    let main_base = creator.made.lock().unwrap()[0];
    let mut handles = Vec::new();
    for mut mine in workers {
        let (turn, done, go, back) = (turn.clone(), done.clone(), go.clone(), back.clone());
        handles.push(std::thread::spawn(move || loop {
            go.wait();
            let (k, globals, stop) = {
                let t = turn.lock().unwrap();
                (t.k, t.globals.clone(), t.stop)
            };
            if stop {
                return;
            }
            for bi in mine.iter_mut() {
                let mut d = Done::default();
                let t = Instant::now();
                let mapped = bi.mem.map();
                d.map_ns = ns(t.elapsed());
                let t = Instant::now();
                d.touched = pretouch(bi.mem.base, bi.b);
                d.fault_ns = ns(t.elapsed());
                let before = thread_faults();
                let ran = mapped.and_then(|()| {
                    bi.inst.memory.data_mut(&mut bi.inst.store)[SCRATCH.0..SCRATCH.0 + SCRATCH.1].fill(0);
                    bi.inst.set_globals(&globals)?;
                    bi.inst.run_block(k, bi.b)
                });
                d.late_faults = before.zip(thread_faults()).map(|(a, z)| z - a);
                if d.late_faults.is_some_and(|f| f > 0) {
                    d.error = Some(format!("block {} faulted after its touches: reads() misses a page", bi.b));
                }
                match ran {
                    Ok((fuel, written)) => {
                        d.fuel = fuel;
                        d.written = written;
                        let t = Instant::now();
                        // S is the main instance's memory, which nothing writes while blocks run.
                        let s = unsafe { std::slice::from_raw_parts(main_base as *const u8, MEM) };
                        if let Some(at) = stray(bi.b, written, bi.inst.bytes(), |a, z| Some(&s[a..z])) {
                            d.error = Some(format!("block_write {{block: {}, offset: {at}}} at step {k}", bi.b));
                        }
                        d.check_ns = ns(t.elapsed());
                    }
                    Err(e) => d.error = Some(e),
                }
                done.lock().unwrap()[bi.b] = d;
            }
            back.wait();
        }));
    }
    let mut run = Run { samples: Vec::new(), hashes: BTreeMap::new(), file: Some(file.kind) };
    let clock = Clock { start: Instant::now() };
    let mut failed = None;
    for k in 0..steps + WARMUP {
        clock.wait(k);
        let mut x = Sample::default();
        let faults = minor_faults();
        let t0 = Instant::now();
        x.step_fuel = match main.run_step(k as i64) {
            Ok(f) => f,
            Err(e) => {
                failed = Some(e);
                break;
            }
        };
        {
            let mut t = turn.lock().unwrap();
            t.k = k as i64;
            t.globals = main.get_globals();
        }
        go.wait();
        back.wait();
        let ds = done.lock().unwrap().clone();
        if let Some(e) = ds.iter().find_map(|d| d.error.clone()) {
            failed = Some(e);
            break;
        }
        let mem = main.memory.data_mut(&mut main.store);
        for (b, d) in ds.iter().enumerate() {
            x.block_fuel[b] = d.fuel;
            x.map_ns += d.map_ns;
            x.fault_ns += d.fault_ns;
            x.check_ns += d.check_ns;
            x.touched += d.touched;
            x.late_faults = d.late_faults.map(|f| f + x.late_faults.unwrap_or(0));
            let theirs = unsafe { std::slice::from_raw_parts(bases[b] as *const u8, MEM) };
            for (a, z) in &allowed(b)[..2] {
                mem[*a..*z].copy_from_slice(&theirs[*a..*z]);
            }
        }
        // Drop each block's mapping before join and the next step write S, so no OS charges those
        // writes a copy for a mapping that is done; the time counts as mapping.
        let t = Instant::now();
        for &base in &bases {
            if let Err(e) = release(base) {
                failed = Some(e);
                break;
            }
        }
        x.map_ns += ns(t.elapsed());
        if failed.is_some() {
            break;
        }
        match main.run_join(k as i64) {
            Ok(f) => x.join_fuel = f,
            Err(e) => {
                failed = Some(e);
                break;
            }
        }
        x.wall_ns = ns(t0.elapsed());
        x.minor_faults = minor_faults() - faults;
        if k >= WARMUP {
            run.samples.push(x);
        }
        if (k + 1) % 600 == 0 || k + 1 == steps + WARMUP {
            run.hashes.insert(k + 1, main.deep_hash());
        }
    }
    turn.lock().unwrap().stop = true;
    go.wait();
    for h in handles {
        h.join().map_err(|_| "a worker panicked".to_string())?;
    }
    match failed {
        Some(e) => Err(e),
        None => Ok(run),
    }
}

/// The q-quantile of xs, by nearest rank.
fn quantile(xs: &[u64], q: f64) -> u64 {
    let mut v = xs.to_vec();
    v.sort_unstable();
    let i = ((q * v.len() as f64).ceil() as usize).clamp(1, v.len()) - 1;
    v[i]
}

fn ms(ns: u64) -> f64 {
    ns as f64 / 1e6
}

/// A form's numbers as the record keeps them: milliseconds, one sample per step, nearest-rank
/// p50 and p95. Overhead is mapping and page faults on copy-on-write, and keeping slices aside and
/// restoring S between blocks in one instance, which maps nothing.
fn summary(run: &Run, threads: usize) -> Value {
    let pick = |f: &dyn Fn(&Sample) -> u64| run.samples.iter().map(f).collect::<Vec<_>>();
    let stat = |xs: Vec<u64>| json!({"p50": ms(quantile(&xs, 0.5)), "p95": ms(quantile(&xs, 0.95)), "max": ms(*xs.iter().max().unwrap())});
    let with_samples = |xs: Vec<u64>| {
        let mut v = stat(xs.clone());
        v["samples"] = json!(xs.iter().map(|&x| ms(x)).collect::<Vec<_>>());
        v
    };
    let fuel = |f: &dyn Fn(&Sample) -> i64| {
        let xs: Vec<u64> = run.samples.iter().map(|s| f(s) as u64).collect();
        json!({"p50": quantile(&xs, 0.5), "max": xs.iter().max().unwrap()})
    };
    let critical = |s: &Sample| {
        let busiest = (0..THREADS).map(|t| (t..BLOCKS).step_by(THREADS).map(|b| s.block_fuel[b]).sum::<i64>()).max().unwrap();
        s.step_fuel + s.join_fuel + busiest
    };
    json!({
        "threads": threads,
        "steps": run.samples.len(),
        "deep_hash": run.hashes.values().last(),
        "wall_ms": with_samples(pick(&|s| s.wall_ns)),
        "overhead_ms": with_samples(pick(&|s| s.map_ns + s.fault_ns + s.restore_ns)),
        "map_ms": stat(pick(&|s| s.map_ns)),
        "fault_ms": stat(pick(&|s| s.fault_ns)),
        "restore_ms": stat(pick(&|s| s.restore_ns)),
        "check_ms": stat(pick(&|s| s.check_ns)),
        "memory_file": run.file,
        "touched_pages": quantile(&pick(&|s| s.touched), 0.5),
        "late_faults_max": run.samples.iter().map(|s| s.late_faults).max().flatten(),
        "minor_faults": {"p50": quantile(&pick(&|s| s.minor_faults), 0.5), "p95": quantile(&pick(&|s| s.minor_faults), 0.95)},
        "fuel": {
            "step": fuel(&|s| s.step_fuel),
            "join": fuel(&|s| s.join_fuel),
            "blocks": fuel(&|s| s.block_fuel.iter().sum()),
            "block_max": fuel(&|s| *s.block_fuel.iter().max().unwrap()),
            "total": fuel(&|s| s.step_fuel + s.join_fuel + s.block_fuel.iter().sum::<i64>()),
            "critical_path_4": fuel(&critical),
        },
        "hashes": run.hashes,
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: spike-245 <steer.wat> <steps>");
        std::process::exit(2);
    }
    let steps: usize = args[2].parse().expect("steps is a count");
    let bytes = program(&args[1]).unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1)
    });
    let engine = Engine::new(&config()).expect("engine");
    let module = Module::new(&engine, &bytes).expect("module");
    let one = one_instance(&engine, &module, steps).unwrap_or_else(|e| {
        eprintln!("one_instance: {e}");
        std::process::exit(1)
    });
    let cow = copy_on_write(&bytes, steps).unwrap_or_else(|e| {
        eprintln!("copy_on_write: {e}");
        std::process::exit(1)
    });
    let out = json!({
        "agents": AGENTS,
        "blocks": BLOCKS,
        "rate_hz": RATE_HZ,
        "warmup_steps": WARMUP,
        "os_page_bytes": unsafe { libc::sysconf(libc::_SC_PAGESIZE) },
        "wasmtime": "49.0.5",
        "rewritten_sha256": hash(&bytes),
        "same_bits": one.hashes == cow.hashes,
        "forms": {"one_instance": summary(&one, 1), "copy_on_write": summary(&cow, THREADS)},
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
