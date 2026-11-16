//! The sandbox module's pinned linker (canvas primitives: Logic: linked libraries; #190). At check,
//! before the subset check and the rewrite, it merges a logic item's program and its libraries,
//! each a relocatable WebAssembly object (the WebAssembly tool conventions' Linking.md: a `linking`
//! section with its symbol table, and `reloc.CODE` and `reloc.DATA`), into one module with no
//! imports: one memory, the program's data where it put it and each library's after the one before,
//! every `lib:<name>.<function>` import resolved to that library's function. The objects' code is
//! copied byte for byte with each relocation patched in place, so the merged bytes depend only on
//! the objects and their order.

use std::collections::BTreeMap;

use wasm_encoder::{
    CodeSection, ConstExpr, DataSection, ElementSection, Elements, ExportKind, ExportSection,
    FunctionSection, GlobalSection, MemorySection, MemoryType, Module, StartSection, TableSection,
    TypeSection,
};
use wasmparser::{
    DataKind, ElementItems, ElementKind, ExternalKind, KnownCustom, Linking, Operator, Parser,
    Payload, RelocationType, SymbolFlags, SymbolInfo, TypeRef,
};

use crate::check::{Limit, Refusal};

/// The most a merged program may be: the subset's own cap.
pub const MAX_PROGRAM: u64 = 4 * 1024 * 1024;
const PAGE: u64 = 65_536;

/// One object to link: its library's name and its `name@version`, which a refusal and a trap
/// name, and the functions its pack lists as its exports; the program's are empty.
pub struct Object<'a> {
    pub name: &'a str,
    pub label: &'a str,
    pub bytes: &'a [u8],
    pub exports: &'a [String],
}

/// The merged program, and each library function's index in it with its library and its name.
pub struct Linked {
    pub bytes: Vec<u8>,
    pub functions: BTreeMap<u32, (String, String)>,
    /// The bytes of memory the libraries' data takes, `[start, end)`, if any.
    pub data: Option<(u32, u32)>,
}

fn refused(what: String) -> Refusal {
    Refusal {
        rule: "link",
        what,
        ..Refusal::default()
    }
}

fn import_refused(module: &str, name: &str, what: String) -> Refusal {
    Refusal {
        import: Some((module.into(), name.into())),
        ..refused(what)
    }
}

/// An object as the linker reads it.
#[derive(Default)]
struct Parsed {
    types: Vec<wasmparser::FuncType>,
    /// Function imports: module, name, type.
    imports: Vec<(String, String, u32)>,
    /// Defined functions' type indices.
    funcs: Vec<u32>,
    memory: Option<wasmparser::MemoryType>,
    tables: Vec<wasmparser::TableType>,
    globals: Vec<(wasmparser::GlobalType, Vec<u8>)>,
    exports: Vec<(String, ExternalKind, u32)>,
    start: Option<u32>,
    /// Active element segments of functions: table, offset, function indices.
    elements: Vec<(u32, i32, Vec<u32>)>,
    /// Active data segments: offset, byte range in the object.
    data: Vec<(u32, std::ops::Range<usize>)>,
    /// Each data segment's alignment, as the segment info gives it.
    align: Vec<u32>,
    /// Function bodies' byte ranges in the object.
    bodies: Vec<std::ops::Range<usize>>,
    /// Section index → its content's start, for a relocation's target.
    sections: Vec<usize>,
    symbols: Vec<Symbol>,
    linking: bool,
    relocs: Vec<(usize, Vec<wasmparser::RelocationEntry>)>,
}

#[derive(Clone)]
enum Symbol {
    /// A function: its index, its name, and whether it's global (a library's export) and
    /// flagged exported (a program's).
    Func(u32, Option<String>, bool, bool),
    GlobalSym(u32, Option<String>, bool),
    Data(Option<(u32, u32)>, String),
    Other,
}

fn i32_const(expr: &wasmparser::ConstExpr) -> Option<i32> {
    let mut ops = expr.get_operators_reader();
    match (ops.read().ok()?, ops.read().ok()?) {
        (Operator::I32Const { value }, Operator::End) => Some(value),
        _ => None,
    }
}

#[allow(clippy::result_large_err)] // one refusal, as the subset check gives it
fn parse(o: &Object) -> Result<Parsed, Refusal> {
    let bad = |e: wasmparser::BinaryReaderError| refused(format!("{}: {e}", who(o)));
    let mut p = Parsed::default();
    for payload in Parser::new(0).parse_all(o.bytes) {
        let payload = payload.map_err(bad)?;
        if let Some((_, range)) = payload.as_section() {
            p.sections.push(range.start as usize);
        }
        match payload {
            Payload::TypeSection(s) => {
                for t in s.into_iter_err_on_gc_types() {
                    p.types.push(t.map_err(bad)?);
                }
            }
            Payload::ImportSection(s) => {
                for i in s.into_imports() {
                    let i = i.map_err(bad)?;
                    match i.ty {
                        TypeRef::Func(t) => p.imports.push((i.module.into(), i.name.into(), t)),
                        TypeRef::Memory(m) if i.module == "env" && i.name == "__linear_memory" => {
                            p.memory = Some(m)
                        }
                        _ => {
                            return Err(import_refused(
                                i.module,
                                i.name,
                                format!(
                                    "{} imports {}.{}: an object imports only library functions",
                                    who(o),
                                    i.module,
                                    i.name
                                ),
                            ))
                        }
                    }
                }
            }
            Payload::FunctionSection(s) => {
                for f in s {
                    p.funcs.push(f.map_err(bad)?);
                }
            }
            Payload::TableSection(s) => {
                for t in s {
                    p.tables.push(t.map_err(bad)?.ty);
                }
            }
            Payload::MemorySection(s) => {
                for m in s {
                    p.memory = Some(m.map_err(bad)?);
                }
            }
            Payload::GlobalSection(s) => {
                for g in s {
                    let g = g.map_err(bad)?;
                    let r = g.init_expr.get_binary_reader();
                    let at = r.original_position() as usize;
                    let end = at + r.bytes_remaining();
                    p.globals.push((g.ty, o.bytes[at..end].to_vec()));
                }
            }
            Payload::ExportSection(s) => {
                for e in s {
                    let e = e.map_err(bad)?;
                    p.exports.push((e.name.into(), e.kind, e.index));
                }
            }
            Payload::StartSection { func, .. } => p.start = Some(func),
            Payload::ElementSection(s) => {
                for e in s {
                    let e = e.map_err(bad)?;
                    let (
                        ElementKind::Active {
                            table_index,
                            offset_expr,
                        },
                        ElementItems::Functions(f),
                    ) = (e.kind, e.items)
                    else {
                        return Err(refused(format!(
                            "{} holds an element segment that isn't active functions",
                            who(o)
                        )));
                    };
                    let at = i32_const(&offset_expr).ok_or_else(|| {
                        refused(format!(
                            "{} offsets an element segment by more than a constant",
                            who(o)
                        ))
                    })?;
                    let f = f
                        .into_iter()
                        .collect::<Result<Vec<u32>, _>>()
                        .map_err(bad)?;
                    p.elements.push((table_index.unwrap_or(0), at, f));
                }
            }
            Payload::DataSection(s) => {
                for d in s {
                    let d = d.map_err(bad)?;
                    let DataKind::Active {
                        memory_index: 0,
                        offset_expr,
                    } = d.kind
                    else {
                        return Err(refused(format!(
                            "{} holds a data segment that isn't active",
                            who(o)
                        )));
                    };
                    let at = i32_const(&offset_expr).ok_or_else(|| {
                        refused(format!(
                            "{} offsets a data segment by more than a constant",
                            who(o)
                        ))
                    })?;
                    // A segment's bytes end its range.
                    let end = d.range.end as usize;
                    (at as u32)
                        .checked_add(d.data.len() as u32)
                        .ok_or_else(|| {
                            refused(format!("{} places a data segment past 4 GiB", who(o)))
                        })?;
                    p.data.push((at as u32, end - d.data.len()..end));
                }
            }
            Payload::CodeSectionEntry(b) => {
                let r = b.range();
                p.bodies.push(r.start as usize..r.end as usize)
            }
            Payload::CustomSection(c) => match c.as_known() {
                KnownCustom::Linking(l) => {
                    p.linking = true;
                    for sub in l.subsections() {
                        let sub = sub.map_err(bad)?;
                        if let Linking::SegmentInfo(m) = &sub {
                            for seg in m.clone() {
                                let a = seg.map_err(bad)?.alignment;
                                p.align
                                    .push(1u32.checked_shl(a).filter(|_| a < 32).ok_or_else(
                                        || {
                                            refused(format!(
                                                "{} aligns a data segment to 2^{a} bytes",
                                                who(o)
                                            ))
                                        },
                                    )?);
                            }
                        }
                        if let Linking::SymbolTable(t) = sub {
                            for s in t {
                                p.symbols.push(match s.map_err(bad)? {
                                    SymbolInfo::Func { index, name, flags } => Symbol::Func(
                                        index,
                                        name.map(str::to_string),
                                        !flags.contains(SymbolFlags::BINDING_LOCAL)
                                            && !flags.contains(SymbolFlags::UNDEFINED),
                                        flags.contains(SymbolFlags::EXPORTED),
                                    ),
                                    SymbolInfo::Global { index, name, flags } => Symbol::GlobalSym(
                                        index,
                                        name.map(str::to_string),
                                        flags.contains(SymbolFlags::EXPORTED),
                                    ),
                                    SymbolInfo::Data { name, symbol, .. } => Symbol::Data(
                                        symbol.map(|d| (d.index, d.offset)),
                                        name.into(),
                                    ),
                                    _ => Symbol::Other,
                                });
                            }
                        }
                    }
                }
                KnownCustom::Reloc(r) => {
                    let entries = r
                        .entries()
                        .into_iter()
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(bad)?;
                    p.relocs.push((r.section_index() as usize, entries));
                }
                _ => {}
            },
            _ => {}
        }
    }
    if !p.linking {
        return Err(refused(format!(
            "{} is no relocatable object: it has no linking section",
            who(o)
        )));
    }
    // An object's exports are its symbols: a program's flagged exported, a library's global
    // functions, each by its name.
    let program = o.name.is_empty();
    for s in &p.symbols {
        let e = match s {
            Symbol::Func(i, Some(n), global, exported)
                if (program && *exported) || (!program && *global && o.exports.contains(n)) =>
            {
                (n.clone(), ExternalKind::Func, *i)
            }
            Symbol::GlobalSym(i, Some(n), true) if program => (n.clone(), ExternalKind::Global, *i),
            _ => continue,
        };
        if !p.exports.contains(&e) {
            p.exports.push(e);
        }
    }
    if program && !p.exports.iter().any(|e| e.1 == ExternalKind::Memory) && p.memory.is_some() {
        p.exports.push(("memory".into(), ExternalKind::Memory, 0));
    }
    if !o.name.is_empty() && (!p.tables.is_empty() || !p.elements.is_empty() || p.start.is_some()) {
        return Err(refused(format!("{} declares a table, an element segment or a start function: a library holds only functions, globals and data", who(o))));
    }
    Ok(p)
}

fn who(o: &Object) -> String {
    if o.name.is_empty() {
        "the program".into()
    } else {
        format!("library {}", o.label)
    }
}

/// A 5-byte LEB128 of a 32-bit value, as an object pads every patched index; a signed one
/// sign-extends the value's bit 31.
fn leb5(v: u32, signed: bool) -> [u8; 5] {
    let mut out = [0u8; 5];
    let mut v: i64 = if signed { v as i32 as i64 } else { v as i64 };
    for (i, b) in out.iter_mut().enumerate() {
        *b = (v & 0x7f) as u8 | if i < 4 { 0x80 } else { 0 };
        v >>= 7;
    }
    out
}

/// Merges `program` and `libs` in that order, the order the libraries resolve in. `stub_hosts` is
/// a planted twin's (#190): each host function import bound to a function that traps.
pub fn link(program: &[u8], libs: &[Object], stub_hosts: bool) -> Result<Linked, Vec<Refusal>> {
    let mut objects = vec![Object {
        name: "",
        label: "",
        bytes: program,
        exports: &[],
    }];
    objects.extend(libs.iter().map(|l| Object {
        name: l.name,
        label: l.label,
        bytes: l.bytes,
        exports: l.exports,
    }));
    let parsed: Vec<Parsed> = objects
        .iter()
        .map(parse)
        .collect::<Result<_, _>>()
        .map_err(|r| vec![r])?;
    // Index spaces: each object's defined functions and globals after the objects before it.
    let mut func_base = Vec::new();
    let mut global_base = Vec::new();
    let (mut nf, mut ng) = (0u32, 0u32);
    for p in &parsed {
        func_base.push(nf);
        global_base.push(ng);
        nf += p.funcs.len() as u32;
        ng += p.globals.len() as u32;
    }
    // Every function import resolved to a library listed before the object that imports it, or
    // any library for the program.
    let mut refusals = Vec::new();
    let mut resolved: Vec<Vec<u32>> = Vec::new();
    let mut stubs: Vec<(usize, u32)> = Vec::new();
    for (oi, p) in parsed.iter().enumerate() {
        let mut r = Vec::new();
        for (module, name, ty) in &p.imports {
            let lib = module.strip_prefix("lib:").unwrap_or("");
            let spelled = format!("{module}.{name}");
            let target = (1..objects.len()).find(|&li| objects[li].name == lib && !lib.is_empty());
            let export = target.and_then(|li| {
                parsed[li]
                    .exports
                    .iter()
                    .find(|(n, k, _)| n == name && *k == ExternalKind::Func)
                    .map(|(_, _, i)| (li, *i))
            });
            match (target, export) {
                (None, _) if lib.is_empty() && stub_hosts => {
                    r.push(nf + stubs.len() as u32);
                    stubs.push((oi, *ty));
                }
                (None, _) if lib.is_empty() => refusals.push(import_refused(module, name, format!("{} imports {spelled}, which is no library function: a linked object imports only lib:<name>.<function>", who(&objects[oi])))),
                (Some(li), _) if oi != 0 && li >= oi => refusals.push(import_refused(module, name, format!("{} imports {spelled} from {}, which isn't listed before it", who(&objects[oi]), objects[li].label))),
                (_, Some((li, i))) if (i as usize) >= parsed[li].imports.len() => {
                    r.push(func_base[li] + i - parsed[li].imports.len() as u32)
                }
                _ => refusals.push(import_refused(module, name, format!("{} imports lib:{lib}.{name}, which no listed library exports", who(&objects[oi])))),
            }
        }
        resolved.push(r);
    }
    if !refusals.is_empty() {
        return Err(refusals);
    }
    let func = |oi: usize, i: u32| -> u32 {
        let n = parsed[oi].imports.len() as u32;
        if i < n {
            resolved[oi][i as usize]
        } else {
            func_base[oi] + i - n
        }
    };
    // Types, each once, in first use.
    let mut types: Vec<wasmparser::FuncType> = Vec::new();
    let mut type_map: Vec<Vec<u32>> = Vec::new();
    for p in &parsed {
        let mut m = Vec::new();
        for t in &p.types {
            let at = types.iter().position(|u| u == t).unwrap_or_else(|| {
                types.push(t.clone());
                types.len() - 1
            });
            m.push(at as u32);
        }
        type_map.push(m);
    }
    // Data: the program's where its object put it, then each library's segments in link order,
    // each at its alignment after the one before.
    let mut seg_at: Vec<Vec<u32>> = vec![parsed[0].data.iter().map(|d| d.0).collect()];
    let mut end = parsed[0]
        .data
        .iter()
        .map(|(at, r)| at + r.len() as u32)
        .max()
        .unwrap_or(0);
    let program_end = end;
    let mut first: Option<u32> = None;
    for p in &parsed[1..] {
        let mut at = Vec::new();
        for (i, (_, r)) in p.data.iter().enumerate() {
            let a = p.align.get(i).copied().unwrap_or(1).max(1);
            let base = (end as u64).div_ceil(a as u64) * a as u64;
            let past = base + r.len() as u64;
            if past > u32::MAX as u64 {
                return Err(vec![refused(format!(
                    "{}'s data passes 4 GiB",
                    who(&objects[seg_at.len()])
                ))]);
            }
            first.get_or_insert(base as u32);
            at.push(base as u32);
            end = past as u32;
        }
        seg_at.push(at);
    }
    // Each object's bytes with its relocations patched.
    let mut patched: Vec<Vec<u8>> = Vec::new();
    for (oi, p) in parsed.iter().enumerate() {
        let mut b = objects[oi].bytes.to_vec();
        for (section, entries) in &p.relocs {
            let at = *p.sections.get(*section).ok_or_else(|| {
                vec![refused(format!(
                    "{} relocates a section it doesn't hold",
                    who(&objects[oi])
                ))]
            })?;
            for e in entries {
                let sym = |i: u32| p.symbols.get(i as usize).cloned().unwrap_or(Symbol::Other);
                let value: u64 = match e.ty {
                    RelocationType::FunctionIndexLeb | RelocationType::FunctionIndexI32 => match sym(e.index) {
                        Symbol::Func(i, ..) => func(oi, i) as u64,
                        _ => return Err(vec![refused(format!("{} relocates a call through a symbol that isn't a function", who(&objects[oi])))]),
                    },
                    RelocationType::TypeIndexLeb => *type_map[oi].get(e.index as usize).ok_or_else(|| vec![refused(format!("{} relocates a type it doesn't declare", who(&objects[oi])))])? as u64,
                    RelocationType::GlobalIndexLeb | RelocationType::GlobalIndexI32 => match sym(e.index) {
                        Symbol::GlobalSym(i, ..) => (global_base[oi] + i) as u64,
                        _ => return Err(vec![refused(format!("{} relocates a global through a symbol that isn't one", who(&objects[oi])))]),
                    },
                    RelocationType::MemoryAddrLeb | RelocationType::MemoryAddrSleb | RelocationType::MemoryAddrI32 => match sym(e.index) {
                        Symbol::Data(Some((seg, off)), _) => {
                            let at = seg_at[oi].get(seg as usize).ok_or_else(|| vec![refused(format!("{} names a data segment it doesn't hold", who(&objects[oi])))])?;
                            (*at as i64 + off as i64 + e.addend) as u32 as u64
                        }
                        Symbol::Data(None, name) => return Err(vec![refused(format!("{} reads data {name} it doesn't define: libraries share functions only", who(&objects[oi])))]),
                        _ => return Err(vec![refused(format!("{} relocates an address through a symbol that isn't data", who(&objects[oi])))]),
                    },
                    other => return Err(vec![refused(format!("{} holds a relocation of type {other:?}, which the linker doesn't take: a library is called, never addressed", who(&objects[oi])))]),
                };
                let at = at + e.offset as usize;
                let slot = b.get_mut(at..at + e.ty.extent()).ok_or_else(|| {
                    vec![refused(format!(
                        "{} relocates past its section's end",
                        who(&objects[oi])
                    ))]
                })?;
                match e.ty.extent() {
                    5 => slot.copy_from_slice(&leb5(
                        value as u32,
                        e.ty == RelocationType::MemoryAddrSleb,
                    )),
                    _ => slot.copy_from_slice(&(value as u32).to_le_bytes()),
                }
            }
        }
        patched.push(b);
    }
    // The program's memory, grown to hold the libraries' data where it passes the end; the
    // item's memory budget still holds it.
    let memory = parsed[0].memory;
    let need = (end as u64).div_ceil(PAGE);
    let pages = memory.map_or(need, |m| m.initial.max(need));
    let mut module = Module::new();
    let mut t = TypeSection::new();
    for f in &types {
        t.ty().function(
            f.params().iter().map(|v| val(*v)),
            f.results().iter().map(|v| val(*v)),
        );
    }
    module.section(&t);
    let mut fs = FunctionSection::new();
    for (oi, p) in parsed.iter().enumerate() {
        for f in &p.funcs {
            fs.function(type_map[oi][*f as usize]);
        }
    }
    for (oi, ty) in &stubs {
        fs.function(type_map[*oi][*ty as usize]);
    }
    module.section(&fs);
    let program = &parsed[0];
    if !program.tables.is_empty() {
        let mut ts = TableSection::new();
        for tt in &program.tables {
            ts.table(wasm_encoder::TableType {
                element_type: wasm_encoder::RefType::FUNCREF,
                table64: false,
                minimum: tt.initial,
                maximum: tt.maximum,
                shared: false,
            });
        }
        module.section(&ts);
    }
    if program.memory.is_some() || end > 0 {
        let mut ms = MemorySection::new();
        ms.memory(MemoryType {
            minimum: pages,
            maximum: memory.map_or(Some(pages), |m| m.maximum.map(|x| x.max(need))),
            memory64: false,
            shared: false,
            page_size_log2: None,
        });
        module.section(&ms);
    }
    let mut gs = GlobalSection::new();
    for p in &parsed {
        for (g, init) in &p.globals {
            gs.global(
                wasm_encoder::GlobalType {
                    val_type: val(g.content_type),
                    mutable: g.mutable,
                    shared: false,
                },
                &ConstExpr::raw(init[..init.len() - 1].iter().copied()),
            );
        }
    }
    if !gs.is_empty() {
        module.section(&gs);
    }
    let mut es = ExportSection::new();
    for (name, kind, i) in &program.exports {
        let (kind, i) = match kind {
            ExternalKind::Func => (ExportKind::Func, func(0, *i)),
            ExternalKind::Global => (ExportKind::Global, *i),
            ExternalKind::Memory => (ExportKind::Memory, *i),
            ExternalKind::Table => (ExportKind::Table, *i),
            ExternalKind::Tag | ExternalKind::FuncExact => continue,
        };
        es.export(name, kind, i);
    }
    module.section(&es);
    if let Some(s) = program.start {
        module.section(&StartSection {
            function_index: func(0, s),
        });
    }
    if !program.elements.is_empty() {
        let mut el = ElementSection::new();
        for (table, at, f) in &program.elements {
            let f: Vec<u32> = f.iter().map(|i| func(0, *i)).collect();
            el.active(
                Some(*table),
                &ConstExpr::i32_const(*at),
                Elements::Functions(f.into()),
            );
        }
        module.section(&el);
    }
    let mut code = CodeSection::new();
    for (oi, p) in parsed.iter().enumerate() {
        for r in &p.bodies {
            code.raw(&patched[oi][r.clone()]);
        }
    }
    for _ in &stubs {
        // No locals, unreachable, end.
        code.raw(&[0, 0x00, 0x0b]);
    }
    module.section(&code);
    let mut ds = DataSection::new();
    for (oi, p) in parsed.iter().enumerate() {
        for ((_, r), at) in p.data.iter().zip(&seg_at[oi]) {
            ds.active(
                0,
                &ConstExpr::i32_const(*at as i32),
                patched[oi][r.clone()].iter().copied(),
            );
        }
    }
    if !ds.is_empty() {
        module.section(&ds);
    }
    let bytes = module.finish();
    let actual = bytes.len() as u64;
    if actual > MAX_PROGRAM {
        return Err(vec![Refusal {
            limit: Some(Limit {
                name: "program",
                max: Some(MAX_PROGRAM),
                actual: Some(actual),
            }),
            ..Refusal {
                rule: "limit",
                what: format!(
                    "the merged program is {actual} bytes, past the subset's {MAX_PROGRAM} (4 MiB)"
                ),
                ..Refusal::default()
            }
        }]);
    }
    let mut functions = BTreeMap::new();
    for (oi, p) in parsed.iter().enumerate().skip(1) {
        let n = p.imports.len() as u32;
        let mut names: BTreeMap<u32, &str> = BTreeMap::new();
        for s in &p.symbols {
            if let Symbol::Func(i, Some(name), ..) = s {
                names.entry(*i).or_insert(name);
            }
        }
        for d in 0..p.funcs.len() as u32 {
            let name = names
                .get(&(n + d))
                .map_or_else(|| format!("function {d}"), |s| s.to_string());
            functions.insert(func_base[oi] + d, (objects[oi].label.to_string(), name));
        }
    }
    let data = first
        .map(|f| (f, end))
        .filter(|(f, e)| e > f && *f >= program_end);
    Ok(Linked {
        bytes,
        functions,
        data,
    })
}

fn val(v: wasmparser::ValType) -> wasm_encoder::ValType {
    match v {
        wasmparser::ValType::I32 => wasm_encoder::ValType::I32,
        wasmparser::ValType::I64 => wasm_encoder::ValType::I64,
        wasmparser::ValType::F32 => wasm_encoder::ValType::F32,
        wasmparser::ValType::F64 => wasm_encoder::ValType::F64,
        wasmparser::ValType::V128 => wasm_encoder::ValType::V128,
        wasmparser::ValType::Ref(_) => wasm_encoder::ValType::FUNCREF,
    }
}
