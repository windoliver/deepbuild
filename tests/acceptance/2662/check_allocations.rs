//! #2662.5dd46ae5 (AC4): a check of a 1 MB program with 2,000 functions makes at least 2,000 fewer
//! allocations than on the merge base, and refuses what it refuses there.
//!
//! The program is built here with the crate's own encoder: a logic item's program (`memory`,
//! `init`, `step`, `reads_at`, `writes_at`) of 2,000 functions, 1,998 of them workers with five
//! locals, nested blocks and an operand stack 2 to 8 deep, about 1.07 MB in all. A check is the
//! sandbox module's check of a program as a logic item's check runs it: the subset check
//! (`check::check` under the shipped limits) and then the rewrite (`rewrite::rewrite_as`, `Logic`).
//! The allocations are this thread's calls of the allocator (allocations and reallocations)
//! across both, counted by a counting global allocator; the file holds one test. The merge base's
//! count, the rewritten program's hash and what the base refuses are fixtures/check-1mb.json,
//! recorded from the base's run of this test.
//!
//! "Refuses what it refuses there": five programs the same size, each with one defect (a memory
//! that can grow, an import, a vector instruction in function 1,500, a type mismatch in function
//! 1,000, a drop from an empty stack in function 1,999, the function after the one whose stack is
//! deepest). Each one's refusals from the check and what the rewrite answers are the base's, word
//! for word. The admitted program's rewrite is the base's, byte for byte (by SHA-256).

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use deep_canvas_sandbox::check::{self, Limits};
use deep_canvas_sandbox::rewrite::{self, Faults, Mode};
use serde_json::{json, Value};
use wasm_encoder::{
    CodeSection, ConstExpr, EntityType, ExportKind, ExportSection, Function, FunctionSection, GlobalSection, GlobalType,
    ImportSection, Instruction as I, MemorySection, MemoryType, Module, TypeSection, ValType,
};

const ID: &str = "#2662.5dd46ae5";
const FUNCTIONS: u32 = 2000;
const FEWER: u64 = 2000;

struct Counting;

thread_local! {
    static COUNTING: Cell<bool> = const { Cell::new(false) };
    static CALLS: Cell<u64> = const { Cell::new(0) };
}

fn note() {
    if COUNTING.with(Cell::get) {
        CALLS.with(|c| c.set(c.get() + 1));
    }
}

// SAFETY: every call goes straight to the system allocator; the count is a const thread-local.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        note();
        unsafe { System.alloc(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        note();
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        note();
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// The allocations and reallocations `f` makes on this thread, and what it returns.
fn allocations<T>(f: impl FnOnce() -> T) -> (u64, T) {
    CALLS.with(|c| c.set(0));
    COUNTING.with(|c| c.set(true));
    let out = f();
    COUNTING.with(|c| c.set(false));
    (CALLS.with(Cell::get), out)
}

/// One way the program is outside the subset, or invalid.
#[derive(Clone, Copy, PartialEq)]
enum Defect {
    None,
    MemoryGrows,
    Import,
    Vector,
    Mismatch,
    Underflow,
}

const DEFECTS: [(&str, Defect); 5] = [
    ("memory_grows", Defect::MemoryGrows),
    ("import", Defect::Import),
    ("vector_in_function_1500", Defect::Vector),
    ("mismatch_in_function_1000", Defect::Mismatch),
    ("underflow_in_function_1999", Defect::Underflow),
];

/// Worker `f`'s body: `(param i32 i32) (result i32)` with an i32, an i64 and an f64 local.
fn worker(f: u32, defect: Defect) -> Function {
    let mut body = Function::new([(1, ValType::I32), (1, ValType::I64), (1, ValType::F64)]);
    if defect == Defect::Vector && f == 1500 {
        body.instruction(&I::V128Const(7)).instruction(&I::Drop);
    }
    if defect == Defect::Mismatch && f == 1000 {
        body.instruction(&I::F64Const(1.5f64.into())).instruction(&I::LocalSet(0));
    }
    if defect == Defect::Underflow && f == 1999 {
        body.instruction(&I::Drop);
    }
    body.instruction(&I::Block(wasm_encoder::BlockType::Result(ValType::I32)));
    for n in 0..40u32 {
        body.instruction(&I::LocalGet(0))
            .instruction(&I::I32Const((f * 131 + n * 7919) as i32))
            .instruction(&I::I32Add)
            .instruction(&I::LocalGet(1))
            .instruction(&I::I32Xor)
            .instruction(&I::LocalSet(2));
    }
    body.instruction(&I::Loop(wasm_encoder::BlockType::Empty))
        .instruction(&I::LocalGet(2))
        .instruction(&I::I32Const(1))
        .instruction(&I::I32ShrU)
        .instruction(&I::LocalTee(2))
        .instruction(&I::BrIf(0))
        .instruction(&I::End);
    body.instruction(&I::I64Const(i64::from(f))).instruction(&I::LocalSet(3));
    body.instruction(&I::F64Const(0.5f64.into())).instruction(&I::LocalSet(4));
    // An operand stack 2 to 8 deep; function 1,998's is 64 deep, the deepest.
    let deep = if f == 1998 { 64 } else { 2 + f % 7 };
    for d in 0..deep {
        body.instruction(&I::I32Const(d as i32));
    }
    for _ in 1..deep {
        body.instruction(&I::I32Add);
    }
    body.instruction(&I::End).instruction(&I::End);
    body
}

/// The 1 MB program of 2,000 functions, with `defect`.
fn build(defect: Defect) -> Vec<u8> {
    let mut module = Module::new();
    let mut types = TypeSection::new();
    types.ty().function([ValType::I64], []);
    types.ty().function([ValType::I32, ValType::I32], [ValType::I32]);
    module.section(&types);
    if defect == Defect::Import {
        let mut imports = ImportSection::new();
        imports.import("env", "g", EntityType::Global(GlobalType { val_type: ValType::I32, mutable: false, shared: false }));
        module.section(&imports);
    }
    let mut functions = FunctionSection::new();
    functions.function(0).function(0);
    for _ in 2..FUNCTIONS {
        functions.function(1);
    }
    module.section(&functions);
    let mut memories = MemorySection::new();
    let maximum = Some(if defect == Defect::MemoryGrows { 2 } else { 1 });
    memories.memory(MemoryType { minimum: 1, maximum, memory64: false, shared: false, page_size_log2: None });
    module.section(&memories);
    let mut globals = GlobalSection::new();
    let constant = GlobalType { val_type: ValType::I32, mutable: false, shared: false };
    globals.global(constant, &ConstExpr::i32_const(0)).global(constant, &ConstExpr::i32_const(1024));
    module.section(&globals);
    let imported = u32::from(defect == Defect::Import);
    let mut exports = ExportSection::new();
    exports
        .export("memory", ExportKind::Memory, 0)
        .export("init", ExportKind::Func, 0)
        .export("step", ExportKind::Func, 1)
        .export("reads_at", ExportKind::Global, imported)
        .export("writes_at", ExportKind::Global, imported + 1);
    module.section(&exports);
    let mut code = CodeSection::new();
    let mut init = Function::new([]);
    init.instruction(&I::End);
    code.function(&init);
    let mut step = Function::new([]);
    step.instruction(&I::I32Const(1024))
        .instruction(&I::I32Const(3))
        .instruction(&I::I32Const(4))
        .instruction(&I::Call(2))
        .instruction(&I::I32Store(wasm_encoder::MemArg { offset: 0, align: 2, memory_index: 0 }))
        .instruction(&I::End);
    code.function(&step);
    for f in 2..FUNCTIONS {
        code.function(&worker(f, defect));
    }
    module.section(&code);
    module.finish()
}

/// What the check and the rewrite answer for a program: the check's refusals, and the rewritten
/// bytes' SHA-256 or the rewrite's refusal.
fn answers(bytes: &[u8]) -> Value {
    let refusals: Vec<Value> = match check::check(bytes, &Limits::default()) {
        Ok(()) => Vec::new(),
        Err(found) => found.iter().map(check::Refusal::to_json).collect(),
    };
    let rewritten = match rewrite::rewrite_as(bytes, Faults::default(), Mode::Logic) {
        Ok(r) => json!({"sha256": rewrite::hash(&r.bytes)}),
        Err(e) => json!({"refused": e}),
    };
    json!({"check": refusals, "rewrite": rewritten})
}

/// The allocations one check of the program makes: the subset check, then the rewrite.
fn check_allocations(bytes: &[u8]) -> u64 {
    let (count, out) = allocations(|| {
        let checked = check::check(bytes, &Limits::default());
        let rewritten = rewrite::rewrite_as(bytes, Faults::default(), Mode::Logic);
        (checked, rewritten)
    });
    assert!(out.0.is_ok(), "{ID}: the check admits the program: {:?}", out.0.err());
    assert!(out.1.is_ok(), "{ID}: the rewrite takes the program: {:?}", out.1.err());
    count
}

#[test]
fn ac4_a_check_of_a_1_mb_program_with_2000_functions_makes_2000_fewer_allocations() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/acceptance/2662/fixtures/check-1mb.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{} reads: {e}", path.display()));
    let base: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{} is JSON: {e}", path.display()));

    let bytes = build(Defect::None);
    let bodies = wasmparser::Parser::new(0)
        .parse_all(&bytes)
        .filter(|p| matches!(p, Ok(wasmparser::Payload::CodeSectionEntry(_))))
        .count();
    assert_eq!(bodies as u32, FUNCTIONS, "{ID}: the program has {FUNCTIONS} functions");
    assert!((1_000_000..1_150_000).contains(&bytes.len()), "{ID}: the program is 1 MB: {} bytes", bytes.len());
    assert!(check::check_role(&bytes, "logic").is_ok(), "{ID}: the program is a logic item's");

    // What it admits and what it refuses, as on the merge base.
    let mut answered = serde_json::Map::new();
    answered.insert("admitted".into(), answers(&bytes));
    for (name, defect) in DEFECTS {
        answered.insert(name.into(), answers(&build(defect)));
    }
    let (first, second) = (check_allocations(&bytes), check_allocations(&bytes));
    if std::env::var_os("DEEP_2662_PRINT").is_some() {
        println!(
            "FIXTURE check-1mb.json {}",
            json!({"program": {"bytes": bytes.len(), "sha256": rewrite::hash(&bytes)}, "allocations": first, "answers": answered})
        );
    }
    assert_eq!(
        json!({"bytes": bytes.len(), "sha256": rewrite::hash(&bytes)}),
        base["program"],
        "INCONCLUSIVE: {ID}: the program built here isn't the one the merge base's count was read on"
    );
    for (name, got) in &answered {
        if name != "admitted" {
            assert!(
                got["check"].as_array().is_some_and(|r| !r.is_empty()),
                "{ID}: the check refuses the program with {name}: {got}"
            );
        }
        assert_eq!(got, &base["answers"][name], "{ID}: the check and the rewrite answer the program `{name}` as on the merge base ({})", base["base"]);
    }

    assert_eq!(first, second, "{ID}: two checks of one program make the same allocations");
    let then = base["allocations"].as_u64().expect("the merge base's count");
    eprintln!("{ID}: a check of the {}-byte program with {FUNCTIONS} functions makes {first} allocations; the merge base ({}) makes {then}", bytes.len(), base["base"]);
    assert!(
        first + FEWER <= then,
        "{ID}: a check of a {}-byte program with {FUNCTIONS} functions makes {first} allocations, {} fewer than the merge base's {then}, not at least {FEWER} fewer",
        bytes.len(),
        then as i64 - first as i64
    );
}
