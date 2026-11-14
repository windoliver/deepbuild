//! The rewrite (canvas primitives: Logic: sandbox), once at check and the same on every machine:
//! every float result that is NaN becomes the one canonical NaN; each block charges its instruction
//! count to the fuel, and each `memory.fill` and `memory.copy` first charges one more unit per byte;
//! each call charges its frame's height to the stack, 8 bytes a parameter, local and value-stack slot
//! plus 64; `memory.grow` traps; and the start function becomes the export `sandbox.start`. The
//! rewritten bytes, by hash, are what runs, so a trap lands at the same function and offset in
//! wasmtime and in a browser, whatever each engine's own limits. wasmtime's own fuel isn't used.
//!
//! The counters are four exported mutable globals the runner sets before each call and reads after:
//! [`FUEL`] (units left), [`STACK`] (bytes in use), [`STACK_CAP`] and [`TRAP`] (the kind of a trap
//! the rewrite raised, 0 when the engine raised it). They are never part of a checkpoint, a save or
//! a hash.

use std::collections::BTreeMap;

use crate::check::SUBSET;
use sha2::{Digest, Sha256};
use wasm_encoder::reencode::{Reencode, RoundtripReencoder};
use wasm_encoder::{
    BlockType, CodeSection, ConstExpr, ExportKind, ExportSection, Function, GlobalSection,
    GlobalType, Ieee32, Ieee64, Instruction as I, Module, RawSection, TypeSection, ValType,
};
use wasmparser::{FuncValidatorAllocations, Operator, Parser, Payload, ValidPayload, Validator};

pub const FUEL: &str = "sandbox.fuel";
pub const STACK: &str = "sandbox.stack";
pub const STACK_CAP: &str = "sandbox.stack_cap";
pub const TRAP: &str = "sandbox.trap";
pub const START: &str = "sandbox.start";
/// The custom section that maps rewritten offsets back to the program's own.
pub const OFFSETS: &str = "sandbox.offsets";

/// The codes the rewrite leaves in [`TRAP`] before its own `unreachable`.
pub const TRAP_FUEL: i32 = 1;
pub const TRAP_STACK: i32 = 2;
pub const TRAP_GROW: i32 = 3;

pub const CANONICAL_F32: u32 = 0x7FC0_0000;
pub const CANONICAL_F64: u64 = 0x7FF8_0000_0000_0000;

/// What a call charges the stack beyond its frame's slots.
pub const CALL_OVERHEAD: u32 = 64;
/// What each parameter, local and value-stack slot charges.
pub const SLOT: u32 = 8;

/// Planted wrong rewrites, for the kit's proof that the right one is checked (#238).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Faults {
    /// Skips the fuel charge at the first loop's head, the charge each back edge reaches.
    pub skip_loop_charge: bool,
    /// Charges a call its frame's slots alone.
    pub no_call_overhead: bool,
    /// Leaves NaNs as the engine makes them.
    pub keep_nan: bool,
    /// Lets `memory.grow` run, returning −1 on a memory that can't grow.
    pub grow_returns: bool,
    /// The page tracker leaves the pages a `memory.copy` writes unmarked (#531).
    pub skip_copy_pages: bool,
    /// The page tracker leaves the pages a `memory.fill` writes unmarked (#547).
    pub skip_fill_pages: bool,
}

/// The exported global names a logic item's program gains (#531): each mutable global of the
/// program, by its index, so a checkpoint holds the whole state; each 64-page word of the page
/// bitmap; and, in a counted rewrite, each block's run count.
pub const GLOBAL: &str = "sandbox.global.";
pub const PAGES: &str = "sandbox.pages.";
pub const BLOCK: &str = "sandbox.block.";

/// What the rewrite adds beyond fuel, stack, NaNs and growth (Logic: sandbox, `rewrite.pages`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Mode {
    /// Providers, validators and registry programs.
    #[default]
    Plain,
    /// A logic item's program: every store, `memory.fill` and `memory.copy` marks the 64 KiB pages
    /// it wrote in the bitmap, and the program's mutable globals are exported.
    Logic,
    /// As `Logic`, with a run count per block, for logic.budget's report only; it never runs a
    /// step that counts, and its hash is never an item's.
    Counted,
}

/// One block the rewrite charges as a whole: its function and the offset, in the program as
/// written, of each instruction its charge counts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub function: u32,
    pub ops: Vec<u32>,
}

/// A rewritten program.
#[derive(Clone, Debug)]
pub struct Rewritten {
    pub bytes: Vec<u8>,
    /// The sha256 of `bytes`, in hex.
    pub hash: String,
    /// Every block's charge, in order: in a counted rewrite, `sandbox.block.<i>` counts block i.
    pub blocks: Vec<Block>,
}

pub fn hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::new();
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// The canonical order of the sections a program may hold, custom sections after the one before.
fn order(id: u8) -> u8 {
    match id {
        1 => 1,   // type
        2 => 2,   // import
        3 => 3,   // function
        4 => 4,   // table
        5 => 5,   // memory
        13 => 6,  // tag
        6 => 7,   // global
        7 => 8,   // export
        8 => 9,   // start
        9 => 10,  // element
        12 => 11, // data count
        10 => 12, // code
        11 => 13, // data
        _ => 0,
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Rewrites a program the subset check admitted.
pub fn rewrite(bytes: &[u8], faults: Faults) -> Result<Rewritten, String> {
    rewrite_as(bytes, faults, Mode::Plain)
}

/// Rewrites a program the subset check admitted, with what `mode` adds.
pub fn rewrite_as(bytes: &[u8], faults: Faults, mode: Mode) -> Result<Rewritten, String> {
    let logic = mode != Mode::Plain;
    let mut re = RoundtripReencoder;
    let mut mutable: Vec<u32> = Vec::new();
    let mut pages = 0u64;
    let mut validator = Validator::new_with_features(SUBSET);
    // (order, sequence, id, bytes); the type, global, export and code sections are built at the end.
    let mut raw: Vec<(u8, usize, u8, Vec<u8>)> = Vec::new();
    let mut last = 0u8;
    let mut types: Vec<wasmparser::FuncType> = Vec::new();
    let mut funcs: Vec<u32> = Vec::new();
    let mut globals = GlobalSection::new();
    let mut exports = ExportSection::new();
    let mut start = None;
    let mut bodies: Vec<Body> = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        let payload = payload.map_err(err)?;
        let valid = validator.payload(&payload).map_err(err)?;
        match &payload {
            Payload::TypeSection(s) => {
                for group in s.clone() {
                    for t in group.map_err(err)?.into_types() {
                        match t.composite_type.inner {
                            wasmparser::CompositeInnerType::Func(f) => types.push(f),
                            _ => return Err("only function types are rewritten".into()),
                        }
                    }
                }
                last = order(1);
            }
            Payload::FunctionSection(s) => {
                for f in s.clone() {
                    funcs.push(f.map_err(err)?);
                }
                if logic {
                    // Rebuilt at the end, with the page tracker's function after the program's.
                    last = order(3);
                } else {
                    raw.push(section(&payload, bytes, &mut last));
                }
            }
            Payload::MemorySection(s) => {
                if let Some(m) = s.clone().into_iter().next() {
                    pages = m.map_err(err)?.initial;
                }
                raw.push(section(&payload, bytes, &mut last));
            }
            Payload::GlobalSection(s) => {
                for (i, g) in s.clone().into_iter().enumerate() {
                    if g.map_err(err)?.ty.mutable {
                        mutable.push(i as u32);
                    }
                }
                re.parse_global_section(&mut globals, s.clone())
                    .map_err(err)?;
                last = order(6);
            }
            Payload::ExportSection(s) => {
                re.parse_export_section(&mut exports, s.clone())
                    .map_err(err)?;
                last = order(7);
            }
            Payload::StartSection { func, .. } => {
                start = Some(*func);
                last = order(8);
            }
            Payload::CodeSectionStart { .. } => last = order(10),
            Payload::CodeSectionEntry(body) => {
                let ValidPayload::Func(to_validate, _) = valid else {
                    return Err("a function body the validator didn't hand back".into());
                };
                let mut fv = to_validate.into_validator(FuncValidatorAllocations::default());
                let mut reader = body.get_binary_reader();
                fv.read_locals(&mut reader).map_err(err)?;
                let mut locals = Vec::new();
                for local in body.get_locals_reader().map_err(err)? {
                    let (n, t) = local.map_err(err)?;
                    locals.push((n, re.val_type(t).map_err(err)?));
                }
                let mut ops = Vec::new();
                let mut at = Vec::new();
                let mut height = 0;
                let mut reader = body.get_operators_reader().map_err(err)?;
                while !reader.eof() {
                    let offset = reader.original_position();
                    let op = reader.read().map_err(err)?;
                    fv.op(offset, &op).map_err(err)?;
                    height = height.max(fv.operand_stack_height());
                    ops.push(op);
                    at.push(offset as u32);
                }
                bodies.push(Body {
                    locals,
                    ops,
                    at,
                    height,
                });
            }
            Payload::End(_) | Payload::Version { .. } => {}
            _ => {
                if payload.as_section().is_some() {
                    raw.push(section(&payload, bytes, &mut last));
                }
            }
        }
    }

    // The counters, after the program's own globals.
    let g = globals.len();
    let (fuel, stack, cap, trap) = (g, g + 1, g + 2, g + 3);
    for t in [ValType::I64, ValType::I32, ValType::I32, ValType::I32] {
        let init = if t == ValType::I64 {
            ConstExpr::i64_const(0)
        } else {
            ConstExpr::i32_const(0)
        };
        globals.global(
            GlobalType {
                val_type: t,
                mutable: true,
                shared: false,
            },
            &init,
        );
    }
    for (name, i) in [(FUEL, fuel), (STACK, stack), (STACK_CAP, cap), (TRAP, trap)] {
        exports.export(name, ExportKind::Global, i);
    }
    if let Some(f) = start {
        exports.export(START, ExportKind::Func, f);
    }
    // A logic item's program: its mutable globals exported, the bitmap's words (one i64 a 64
    // pages) after the counters, and in a counted rewrite one count a block after them.
    let words = if logic {
        pages.div_ceil(64).max(1) as u32
    } else {
        0
    };
    let bitmap = g + 4;
    let counted = g + 4 + words;
    let blocks_total: u32 = if mode == Mode::Counted {
        bodies.iter().map(|b| b.starts(faults).len() as u32).sum()
    } else {
        0
    };
    for i in 0..words + blocks_total {
        globals.global(
            GlobalType {
                val_type: ValType::I64,
                mutable: true,
                shared: false,
            },
            &ConstExpr::i64_const(0),
        );
        let name = if i < words {
            format!("{PAGES}{i}")
        } else {
            format!("{BLOCK}{}", i - words)
        };
        exports.export(&name, ExportKind::Global, bitmap + i);
    }
    if logic {
        for i in &mutable {
            exports.export(&format!("{GLOBAL}{i}"), ExportKind::Global, *i);
        }
    }
    let mark = funcs.len() as u32;

    // A block type for each function body's wrapper: a type of its own when it returns several.
    let mut type_section = TypeSection::new();
    for t in &types {
        let params = t
            .params()
            .iter()
            .map(|v| re.val_type(*v))
            .collect::<Result<Vec<_>, _>>();
        let results = t
            .results()
            .iter()
            .map(|v| re.val_type(*v))
            .collect::<Result<Vec<_>, _>>();
        type_section
            .ty()
            .function(params.map_err(err)?, results.map_err(err)?);
    }
    let mut code = CodeSection::new();
    let mut tags = Vec::new();
    let counters = Counters {
        fuel,
        stack,
        cap,
        trap,
        mark: logic.then_some(mark),
        counted: (mode == Mode::Counted).then_some(counted),
    };
    let mut blocks = Vec::new();
    for (i, body) in bodies.iter().enumerate() {
        let t = &types[funcs[i] as usize];
        let results: Vec<ValType> = t
            .results()
            .iter()
            .map(|v| re.val_type(*v))
            .collect::<Result<_, _>>()
            .map_err(err)?;
        let wrapper = match results.len() {
            0 => BlockType::Empty,
            1 => BlockType::Result(results[0]),
            _ => {
                type_section.ty().function([], results.clone());
                BlockType::FunctionType(type_section.len() - 1)
            }
        };
        let params = t.params().len() as u32;
        for (start, len) in body.starts(faults) {
            blocks.push(Block {
                function: i as u32,
                ops: body.at[start..start + len].to_vec(),
            });
        }
        let first = blocks.len() - body.starts(faults).len();
        let (f, t) = body.rewrite(params, wrapper, &counters, faults, first as u32)?;
        code.function(&f);
        tags.push(t);
    }
    let mut functions = wasm_encoder::FunctionSection::new();
    if logic {
        type_section.ty().function([ValType::I32, ValType::I32], []);
        code.function(&tracker(bitmap, words));
        for f in &funcs {
            functions.function(*f);
        }
        functions.function(type_section.len() - 1);
        tags.push(Vec::new());
    }

    let mut built: Vec<(u8, usize, u8, Vec<u8>)> = raw;
    let mut push = |id: u8, data: Vec<u8>| {
        let n = built.len();
        built.push((order(id), n, id, data));
    };
    if logic {
        push(3, encoded(&functions));
    }
    push(1, encoded(&type_section));
    push(6, encoded(&globals));
    push(7, encoded(&exports));
    push(10, encoded(&code));
    built.sort_by_key(|(o, n, _, _)| (*o, *n));
    let mut module = Module::new();
    for (_, _, id, data) in &built {
        module.section(&RawSection { id: *id, data });
    }
    let mut bytes = module.finish();
    // The map, after every section it maps, from each rewritten instruction to: the instruction of
    // the program as written it stands for, so a run names the program's own offset; that
    // instruction's copy in the rewritten program, where an engine's own trap is counted whichever
    // nearby instruction the engine names; and its check's `unreachable`, where a trap the rewrite
    // raised is counted (Entry).
    let mut map = Vec::new();
    let mut entries = 0u32;
    let mut function = 0;
    for payload in Parser::new(0).parse_all(&bytes) {
        if let Payload::CodeSectionEntry(body) = payload.map_err(err)? {
            let mut reader = body.get_operators_reader().map_err(err)?;
            let mut at = Vec::new();
            while !reader.eof() {
                at.push(reader.original_position() as u32);
                reader.read().map_err(err)?;
            }
            let t = &tags[function];
            let copy: BTreeMap<u32, u32> = t
                .iter()
                .zip(&at)
                .rev()
                .filter(|(g, _)| g.op)
                .map(|(g, o)| (g.at, *o))
                .collect();
            let raise: BTreeMap<u32, u32> = t
                .iter()
                .zip(&at)
                .filter(|(g, _)| g.raises)
                .map(|(g, o)| (g.check, *o))
                .collect();
            for (g, o) in t.iter().zip(&at) {
                leb(&mut map, *o);
                leb(&mut map, g.at);
                leb(&mut map, copy.get(&g.at).copied().unwrap_or(*o));
                leb(&mut map, raise.get(&g.check).copied().unwrap_or(0));
                entries += 1;
            }
            function += 1;
        }
    }
    let mut data = Vec::new();
    leb(&mut data, entries);
    data.extend(map);
    let mut tail = Module::new();
    tail.section(&wasm_encoder::CustomSection {
        name: OFFSETS.into(),
        data: data.into(),
    });
    bytes.extend_from_slice(&tail.finish()[8..]);
    Ok(Rewritten {
        hash: hash(&bytes),
        bytes,
        blocks,
    })
}

/// The page tracker, `(addr: i32, len: i32)`: marks each 64 KiB page of `[addr, addr + len)` in
/// the bitmap's words, globals `bitmap..bitmap + words`. It runs after the write it follows, so
/// the range lies inside memory. It is the rewrite's own code: it charges no fuel or stack.
fn tracker(bitmap: u32, words: u32) -> Function {
    let (addr, len, p, end, bit) = (0, 1, 2, 3, 4);
    let mut f = Function::new([(2, ValType::I32), (1, ValType::I64)]);
    let mut i = |ins: I<'_>| {
        f.instruction(&ins);
    };
    i(I::LocalGet(len));
    i(I::I32Eqz);
    i(I::If(BlockType::Empty));
    i(I::Return);
    i(I::End);
    i(I::LocalGet(addr));
    i(I::I32Const(16));
    i(I::I32ShrU);
    i(I::LocalSet(p));
    i(I::LocalGet(addr));
    i(I::LocalGet(len));
    i(I::I32Add);
    i(I::I32Const(1));
    i(I::I32Sub);
    i(I::I32Const(16));
    i(I::I32ShrU);
    i(I::LocalSet(end));
    i(I::Loop(BlockType::Empty));
    i(I::I64Const(1));
    i(I::LocalGet(p));
    i(I::I32Const(63));
    i(I::I32And);
    i(I::I64ExtendI32U);
    i(I::I64Shl);
    i(I::LocalSet(bit));
    // block $done { block $w(words-1) { … block $w0 { br_table } case 0; br $done } … }
    for _ in 0..=words {
        i(I::Block(BlockType::Empty));
    }
    i(I::LocalGet(p));
    i(I::I32Const(6));
    i(I::I32ShrU);
    let targets: Vec<u32> = (0..words).collect();
    i(I::BrTable(targets.into(), words - 1));
    for w in 0..words {
        i(I::End);
        i(I::GlobalGet(bitmap + w));
        i(I::LocalGet(bit));
        i(I::I64Or);
        i(I::GlobalSet(bitmap + w));
        i(I::Br(words - 1 - w));
    }
    i(I::End);
    i(I::LocalGet(p));
    i(I::I32Const(1));
    i(I::I32Add);
    i(I::LocalTee(p));
    i(I::LocalGet(end));
    i(I::I32LeU);
    i(I::BrIf(0));
    i(I::End);
    i(I::End);
    f
}

/// The bytes a store writes, and the type of the value it takes, if `op` is a store.
fn store(op: &Operator<'_>) -> Option<(u64, u32, ValType)> {
    use Operator::*;
    let (m, size, t) = match op {
        I32Store { memarg } => (memarg, 4, ValType::I32),
        I64Store { memarg } => (memarg, 8, ValType::I64),
        F32Store { memarg } => (memarg, 4, ValType::F32),
        F64Store { memarg } => (memarg, 8, ValType::F64),
        I32Store8 { memarg } => (memarg, 1, ValType::I32),
        I32Store16 { memarg } => (memarg, 2, ValType::I32),
        I64Store8 { memarg } => (memarg, 1, ValType::I64),
        I64Store16 { memarg } => (memarg, 2, ValType::I64),
        I64Store32 { memarg } => (memarg, 4, ValType::I64),
        _ => return None,
    };
    Some((m.offset, size, t))
}

fn leb(out: &mut Vec<u8>, mut n: u32) {
    loop {
        let b = (n & 0x7f) as u8;
        n >>= 7;
        if n == 0 {
            out.push(b);
            return;
        }
        out.push(b | 0x80);
    }
}

/// One entry of the offset map: a rewritten instruction's offset, the offset in the program as
/// written of the instruction it stands for, that instruction's copy in the rewritten program, and
/// the offset of the `unreachable` of the check it belongs to (0 outside one).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entry {
    pub rewritten: u32,
    pub written: u32,
    pub copy: u32,
    pub raise: u32,
}

/// Rewritten bytes whose one memory holds `pages` pages, its minimum and its maximum: the memory a
/// role's budget gives, such as a validator's asset plus 4 MiB (Logic: data layouts; #415). Only the
/// memory section changes, so the offset map still holds once the returned shift, the bytes the
/// sections after it moved by, is taken off an offset past it.
pub fn sized(bytes: &[u8], pages: u64) -> Result<(Vec<u8>, i64), String> {
    for payload in Parser::new(0).parse_all(bytes) {
        let Payload::MemorySection(m) = payload.map_err(err)? else {
            continue;
        };
        let range = m.range();
        let range = range.start as usize..range.end as usize;
        let start = range.start - header_len(bytes, range.start);
        let mut memories = wasm_encoder::MemorySection::new();
        memories.memory(wasm_encoder::MemoryType {
            minimum: pages,
            maximum: Some(pages),
            memory64: false,
            shared: false,
            page_size_log2: None,
        });
        let mut section = vec![5u8];
        wasm_encoder::Encode::encode(&memories, &mut section);
        let mut out = bytes[..start].to_vec();
        out.extend(&section);
        out.extend(&bytes[range.end..]);
        let shift = section.len() as i64 - (range.end - start) as i64;
        return Ok((out, shift));
    }
    Err("the program has no memory to size".into())
}

/// The bytes of a section's id and size, given where its contents start.
fn header_len(bytes: &[u8], contents: usize) -> usize {
    // The size is a LEB128 ending at `contents`; the id is the byte before it.
    let mut at = contents - 1;
    while at > 0 && bytes[at - 1] & 0x80 != 0 {
        at -= 1;
    }
    contents - at + 1
}

/// The offset map, in the rewritten program's order.
pub fn offsets(bytes: &[u8]) -> Vec<Entry> {
    let mut out = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        let Ok(Payload::CustomSection(c)) = payload else {
            continue;
        };
        if c.name() != OFFSETS {
            continue;
        }
        let mut r = wasmparser::BinaryReader::new(c.data(), 0);
        let n = r.read_var_u32().unwrap_or(0);
        for _ in 0..n {
            let mut next = || r.read_var_u32().ok();
            match (next(), next(), next(), next()) {
                (Some(rewritten), Some(written), Some(copy), Some(raise)) => out.push(Entry {
                    rewritten,
                    written,
                    copy,
                    raise,
                }),
                _ => break,
            }
        }
    }
    out
}

/// Where a trap at the rewritten `offset` is counted: in the program as written, or in the
/// rewritten program, at the rewrite's own `unreachable` for a trap it raised and at the
/// instruction's copy for an engine's own trap, so every engine names one offset.
pub fn locate(map: &[Entry], offset: u32, written: bool, raised: bool) -> u32 {
    let e = match map.binary_search_by_key(&offset, |e| e.rewritten) {
        Ok(i) => map[i],
        Err(0) => return offset,
        Err(i) => map[i - 1],
    };
    match (written, raised) {
        (true, _) => e.written,
        (false, true) if e.raise != 0 => e.raise,
        (false, true) => offset,
        (false, false) => e.copy,
    }
}

fn encoded(s: &impl wasm_encoder::Section) -> Vec<u8> {
    // A section's encoding is its id, its size and its contents; RawSection wants the contents.
    let mut out = Vec::new();
    s.encode(&mut out);
    let mut at = 0;
    while out[at] & 0x80 != 0 {
        at += 1;
    }
    out.split_off(at + 1)
}

/// A section copied as it is, ordered after the section before it.
fn section(payload: &Payload<'_>, bytes: &[u8], last: &mut u8) -> (u8, usize, u8, Vec<u8>) {
    let (id, range) = payload.as_section().expect("a section");
    let o = if id == 0 { *last } else { order(id) };
    *last = o;
    (
        o,
        range.start as usize,
        id,
        bytes[range.start as usize..range.end as usize].to_vec(),
    )
}

struct Counters {
    fuel: u32,
    stack: u32,
    cap: u32,
    trap: u32,
    /// The page tracker's function, in a logic item's program.
    mark: Option<u32>,
    /// The first block count's global, in a counted rewrite.
    counted: Option<u32>,
}

struct Body<'a> {
    locals: Vec<(u32, ValType)>,
    ops: Vec<Operator<'a>>,
    /// Each operator's offset in the program as written.
    at: Vec<u32>,
    height: u32,
}

/// What one rewritten instruction stands for: the instruction of the program as written (`at`),
/// whether it is that instruction's own copy (`op`), and the check it belongs to, if any, with
/// whether it is the check's own `unreachable`.
#[derive(Clone, Copy, Debug)]
struct Tag {
    at: u32,
    op: bool,
    check: u32,
    raises: bool,
}

/// A function being written, with what each instruction stands for.
struct Emit {
    f: Function,
    tags: Vec<Tag>,
    at: u32,
    /// The check being written, numbered from 1; 0 outside one.
    check: u32,
    checks: u32,
}

impl Emit {
    fn i(&mut self, ins: I<'_>) {
        let raises = matches!(ins, I::Unreachable) && self.check != 0;
        self.f.instruction(&ins);
        self.tags.push(Tag {
            at: self.at,
            op: false,
            check: self.check,
            raises,
        });
    }

    /// The program's own instruction, copied.
    fn op(&mut self, ins: I<'_>) {
        self.f.instruction(&ins);
        self.tags.push(Tag {
            at: self.at,
            op: true,
            check: 0,
            raises: false,
        });
    }

    fn begin(&mut self) {
        self.checks += 1;
        self.check = self.checks;
    }

    fn end(&mut self) {
        self.check = 0;
    }
}

/// Ends a straight-line run of instructions: the next one starts a block that charges its own.
fn ends_block(op: &Operator<'_>) -> bool {
    matches!(
        op,
        Operator::Block { .. }
            | Operator::Loop { .. }
            | Operator::If { .. }
            | Operator::Else
            | Operator::End
            | Operator::Br { .. }
            | Operator::BrIf { .. }
            | Operator::BrTable { .. }
            | Operator::Return
            | Operator::Unreachable
    )
}

/// 32 for an f32 result to canonicalize, 64 for an f64 one.
fn float_result(op: &Operator<'_>) -> u8 {
    use Operator::*;
    match op {
        F32Add | F32Sub | F32Mul | F32Div | F32Sqrt | F32Min | F32Max | F32Ceil | F32Floor
        | F32Trunc | F32Nearest | F32Abs | F32Neg | F32Copysign | F32DemoteF64 => 32,
        F64Add | F64Sub | F64Mul | F64Div | F64Sqrt | F64Min | F64Max | F64Ceil | F64Floor
        | F64Trunc | F64Nearest | F64Abs | F64Neg | F64Copysign | F64PromoteF32 => 64,
        _ => 0,
    }
}

impl Body<'_> {
    /// Where each block the rewrite charges starts, and how many instructions its charge counts.
    fn starts(&self, faults: Faults) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        let mut loops = 0;
        for i in 0..self.ops.len() {
            let after_loop = i > 0 && matches!(self.ops[i - 1], Operator::Loop { .. });
            loops += usize::from(after_loop);
            let starts = i == 0 || ends_block(&self.ops[i - 1]);
            if starts && !(faults.skip_loop_charge && after_loop && loops == 1) {
                let len = self.ops[i..]
                    .iter()
                    .position(ends_block)
                    .map_or(self.ops.len() - i, |j| j + 1);
                out.push((i, len));
            }
        }
        out
    }

    fn rewrite(
        &self,
        params: u32,
        wrapper: BlockType,
        c: &Counters,
        faults: Faults,
        first_block: u32,
    ) -> Result<(Function, Vec<Tag>), String> {
        let declared: u32 = self.locals.iter().map(|(n, _)| n).sum();
        let scratch = params + declared;
        let (a, b, n, f32_tmp, f64_tmp) =
            (scratch, scratch + 1, scratch + 2, scratch + 3, scratch + 4);
        let i64_tmp = scratch + 5;
        let mut locals = self.locals.clone();
        locals.extend([(3, ValType::I32), (1, ValType::F32), (1, ValType::F64)]);
        if c.mark.is_some() {
            locals.push((1, ValType::I64));
        }
        let mut block = first_block;
        let mut e = Emit {
            f: Function::new(locals),
            tags: Vec::new(),
            at: self.at.first().copied().unwrap_or(0),
            check: 0,
            checks: 0,
        };
        let overhead = if faults.no_call_overhead {
            0
        } else {
            CALL_OVERHEAD
        };
        let frame = (SLOT * (params + declared + self.height) + overhead) as i32;
        let raise = |e: &mut Emit, kind: i32| {
            e.i(I::If(BlockType::Empty));
            e.i(I::I32Const(kind));
            e.i(I::GlobalSet(c.trap));
            e.i(I::Unreachable);
            e.i(I::End);
        };
        let check_fuel = |e: &mut Emit| {
            e.i(I::GlobalSet(c.fuel));
            e.i(I::GlobalGet(c.fuel));
            e.i(I::I64Const(0));
            e.i(I::I64LtS);
            raise(e, TRAP_FUEL);
        };
        let charge = |e: &mut Emit, units: i64| {
            e.begin();
            e.i(I::GlobalGet(c.fuel));
            e.i(I::I64Const(units));
            e.i(I::I64Sub);
            check_fuel(e);
            e.end();
        };
        let epilogue = |e: &mut Emit| {
            e.i(I::GlobalGet(c.stack));
            e.i(I::I32Const(frame));
            e.i(I::I32Sub);
            e.i(I::GlobalSet(c.stack));
        };

        // The call's charge to the stack.
        e.begin();
        e.i(I::GlobalGet(c.stack));
        e.i(I::I32Const(frame));
        e.i(I::I32Add);
        e.i(I::GlobalSet(c.stack));
        e.i(I::GlobalGet(c.stack));
        e.i(I::GlobalGet(c.cap));
        e.i(I::I32GtU);
        raise(&mut e, TRAP_STACK);
        e.end();
        e.i(I::Block(wrapper));

        let mut re = RoundtripReencoder;
        let mut depth = 0u32;
        let starts = self.starts(faults);
        let mut next = starts.iter().peekable();
        // Marks [a, a + len) written, `a` already in its local.
        let mark = |e: &mut Emit, len: Option<i32>| {
            if let Some(m) = c.mark {
                e.i(I::LocalGet(a));
                match len {
                    Some(l) => e.i(I::I32Const(l)),
                    None => e.i(I::LocalGet(n)),
                }
                e.i(I::Call(m));
            }
        };
        for (i, op) in self.ops.iter().enumerate() {
            e.at = self.at[i];
            if let Some(&(_, len)) = next.next_if(|(s, _)| *s == i) {
                charge(&mut e, len as i64);
                if let Some(base) = c.counted {
                    e.i(I::GlobalGet(base + block));
                    e.i(I::I64Const(1));
                    e.i(I::I64Add);
                    e.i(I::GlobalSet(base + block));
                }
                block += 1;
            }
            match op {
                Operator::Block { .. } | Operator::Loop { .. } | Operator::If { .. } => {
                    depth += 1;
                    e.op(re.instruction(op.clone()).map_err(err)?);
                }
                Operator::End if depth == 0 => {
                    e.op(I::End);
                    epilogue(&mut e);
                    e.i(I::End);
                }
                Operator::End => {
                    depth -= 1;
                    e.op(I::End);
                }
                Operator::Return => {
                    epilogue(&mut e);
                    e.op(I::Return);
                }
                Operator::MemoryGrow { .. } if !faults.grow_returns => {
                    e.begin();
                    e.i(I::Drop);
                    e.i(I::I32Const(TRAP_GROW));
                    e.i(I::GlobalSet(c.trap));
                    e.i(I::Unreachable);
                    e.end();
                }
                Operator::MemoryFill { .. } | Operator::MemoryCopy { .. } => {
                    // [a, b, n]: charge n before the op runs.
                    e.i(I::LocalSet(n));
                    e.i(I::LocalSet(b));
                    e.i(I::LocalSet(a));
                    e.begin();
                    e.i(I::GlobalGet(c.fuel));
                    e.i(I::LocalGet(n));
                    e.i(I::I64ExtendI32U);
                    e.i(I::I64Sub);
                    check_fuel(&mut e);
                    e.end();
                    e.i(I::LocalGet(a));
                    e.i(I::LocalGet(b));
                    e.i(I::LocalGet(n));
                    e.op(re.instruction(op.clone()).map_err(err)?);
                    let copy = matches!(op, Operator::MemoryCopy { .. });
                    let skip = if copy {
                        faults.skip_copy_pages
                    } else {
                        faults.skip_fill_pages
                    };
                    if !skip {
                        mark(&mut e, None);
                    }
                }
                _ if c.mark.is_some() && store(op).is_some() => {
                    // [addr, value]: the store, then its bytes marked.
                    let (offset, size, t) = store(op).expect("a store");
                    let value = match t {
                        ValType::I32 => b,
                        ValType::I64 => i64_tmp,
                        ValType::F32 => f32_tmp,
                        _ => f64_tmp,
                    };
                    e.i(I::LocalSet(value));
                    e.i(I::LocalTee(a));
                    e.i(I::LocalGet(value));
                    e.op(re.instruction(op.clone()).map_err(err)?);
                    e.i(I::LocalGet(a));
                    e.i(I::I32Const(offset as u32 as i32));
                    e.i(I::I32Add);
                    e.i(I::LocalSet(a));
                    mark(&mut e, Some(size as i32));
                }
                _ => {
                    e.op(re.instruction(op.clone()).map_err(err)?);
                    match float_result(op) {
                        32 if !faults.keep_nan => {
                            e.i(I::LocalTee(f32_tmp));
                            e.i(I::F32Const(Ieee32::new(CANONICAL_F32)));
                            e.i(I::LocalGet(f32_tmp));
                            e.i(I::LocalGet(f32_tmp));
                            e.i(I::F32Eq);
                            e.i(I::Select);
                        }
                        64 if !faults.keep_nan => {
                            e.i(I::LocalTee(f64_tmp));
                            e.i(I::F64Const(Ieee64::new(CANONICAL_F64)));
                            e.i(I::LocalGet(f64_tmp));
                            e.i(I::LocalGet(f64_tmp));
                            e.i(I::F64Eq);
                            e.i(I::Select);
                        }
                        _ => {}
                    }
                }
            }
        }
        Ok((e.f, e.tags))
    }
}

/// The sha256 of each function body of a rewritten program, in order, so a kit can name the first
/// function whose rewrite differs from the reference's.
pub fn functions(bytes: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        if let Ok(Payload::CodeSectionEntry(body)) = payload {
            let r = body.range();
            out.push(hash(&bytes[r.start as usize..r.end as usize]));
        }
    }
    out
}
