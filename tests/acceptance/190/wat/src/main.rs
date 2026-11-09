//! `acceptance-190-wat <out-dir> [--library | --program] <file.wat>...`: assembles each WebAssembly text
//! file to `<out-dir>/<stem>.wasm`. With no flag the module is written as the `wat` crate assembles it.
//! With `--library` or `--program` it is written as a relocatable object, laid out as the WebAssembly
//! tool conventions' Linking.md lays one out (README: Relocatable objects):
//!
//! - every `call` and `global.get`/`global.set` immediate becomes a 5-byte padded LEB with an
//!   R_WASM_FUNCTION_INDEX_LEB (0) or R_WASM_GLOBAL_INDEX_LEB (7) relocation in `reloc.CODE`;
//! - every `i32.const` whose value is in [0x4000_0000, 0x5000_0000) is an address in the object's own
//!   data, `value - 0x4000_0000`: it becomes a 5-byte padded SLEB of that address with an
//!   R_WASM_MEMORY_ADDR_SLEB (4) relocation against the data symbol of the segment holding it;
//! - a `linking` section (version 2) holds the symbol table (WASM_SYMBOL_TABLE, 8) and the segment
//!   info (WASM_SEGMENT_INFO, 5): one function symbol per function (an import is undefined, 0x10; an
//!   exported function is a global symbol named by its export, flagged WASM_SYM_EXPORTED, 0x20, under
//!   `--program` only; any other is local, 0x02, named from the name section), one global symbol per
//!   defined global the same way, and one local data symbol `.data.<i>` per data segment;
//! - the export and name sections are dropped (exports are the symbols' flags).
//!
//! An object imports its memory as `env.__linear_memory` and has no table, element segment, start
//! function or imported global. Each output is validated, and an object's `linking` and `reloc.CODE`
//! sections are read back through wasmparser's readers. Exit 1 with the error on stderr when a file
//! doesn't assemble, convert or validate.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use wasmparser::{
    DataKind, ExternalKind, KnownCustom, Name, Operator, Parser, Payload, TypeRef,
};

const MARK: i64 = 0x4000_0000;
const MARK_END: i64 = 0x5000_0000;

const SYM_LOCAL: u32 = 0x02;
const SYM_UNDEFINED: u32 = 0x10;
const SYM_EXPORTED: u32 = 0x20;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((dir, rest)) = args.split_first() else {
        eprintln!("usage: acceptance-190-wat <out-dir> [--library | --program] <file.wat>...");
        std::process::exit(2);
    };
    let (mode, files) = match rest.first().map(String::as_str) {
        Some("--library") => (Some(false), &rest[1..]),
        Some("--program") => (Some(true), &rest[1..]),
        _ => (None, rest),
    };
    let dir = PathBuf::from(dir);
    let mut failed = false;
    for file in files {
        let path = Path::new(file);
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("out");
        let built = wat::parse_file(path)
            .map_err(|e| e.to_string())
            .and_then(|bytes| wasmparser::validate(&bytes).map(|_| bytes).map_err(|e| e.to_string()))
            .and_then(|bytes| match mode {
                None => Ok(bytes),
                Some(program) => object(&bytes, program),
            });
        match built {
            Ok(bytes) => std::fs::write(dir.join(format!("{stem}.wasm")), &bytes).expect("write the .wasm"),
            Err(e) => {
                eprintln!("{file}: {e}");
                failed = true;
            }
        }
    }
    if failed {
        std::process::exit(1);
    }
}

fn uleb(out: &mut Vec<u8>, mut v: u64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(b);
            return;
        }
        out.push(b | 0x80);
    }
}
fn uleb5(out: &mut Vec<u8>, v: u32) {
    let mut v = v;
    for i in 0..5 {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        out.push(if i < 4 { b | 0x80 } else { b });
    }
}
fn sleb(out: &mut Vec<u8>, mut v: i64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        let done = (v == 0 && b & 0x40 == 0) || (v == -1 && b & 0x40 != 0);
        if done {
            out.push(b);
            return;
        }
        out.push(b | 0x80);
    }
}
fn sleb5(out: &mut Vec<u8>, v: i32) {
    let mut v = v as i64;
    for i in 0..5 {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        out.push(if i < 4 { b | 0x80 } else { b });
    }
}
fn string(out: &mut Vec<u8>, s: &str) {
    uleb(out, s.len() as u64);
    out.extend_from_slice(s.as_bytes());
}
fn section(out: &mut Vec<u8>, id: u8, contents: &[u8]) {
    out.push(id);
    uleb(out, contents.len() as u64);
    out.extend_from_slice(contents);
}
fn custom(out: &mut Vec<u8>, name: &str, payload: &[u8]) {
    let mut c = Vec::new();
    string(&mut c, name);
    c.extend_from_slice(payload);
    section(out, 0, &c);
}

struct Segment {
    start: u32,
    len: u32,
}
struct Reloc {
    ty: u8,
    offset: u32,
    symbol: u32,
    addend: Option<i64>,
}

fn object(bytes: &[u8], program: bool) -> Result<Vec<u8>, String> {
    let at = |r: std::ops::Range<u64>| &bytes[r.start as usize..r.end as usize];
    let e = |e: wasmparser::BinaryReaderError| e.to_string();
    let mut func_imports: Vec<(String, String)> = Vec::new();
    let mut defined_funcs = 0u32;
    let mut defined_globals = 0u32;
    let mut exports: BTreeMap<(u8, u32), String> = BTreeMap::new();
    let mut func_names: BTreeMap<u32, String> = BTreeMap::new();
    let mut global_names: BTreeMap<u32, String> = BTreeMap::new();
    let mut segments: Vec<Segment> = Vec::new();
    let mut memory_imported = false;
    // Sections to copy as they are: (id, contents), and where the code section goes.
    let mut kept: Vec<(u8, Vec<u8>)> = Vec::new();
    let mut bodies = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.map_err(e)? {
            Payload::Version { .. } | Payload::End(_) => {}
            Payload::TypeSection(r) => kept.push((1, at(r.range()).to_vec())),
            Payload::ImportSection(r) => {
                kept.push((2, at(r.range()).to_vec()));
                for i in r.into_imports() {
                    let i = i.map_err(e)?;
                    match i.ty {
                        TypeRef::Func(_) | TypeRef::FuncExact(_) => func_imports.push((i.module.to_string(), i.name.to_string())),
                        TypeRef::Memory(_) if i.module == "env" && i.name == "__linear_memory" => memory_imported = true,
                        _ => return Err(format!("an object imports only functions and env.__linear_memory, not {}.{}", i.module, i.name)),
                    }
                }
            }
            Payload::FunctionSection(r) => {
                defined_funcs = r.count();
                kept.push((3, at(r.range()).to_vec()));
            }
            Payload::TableSection(_) | Payload::ElementSection(_) | Payload::StartSection { .. } => {
                return Err("an object here has no table, element segment or start function".into())
            }
            Payload::MemorySection(_) => return Err("an object imports its memory as env.__linear_memory".into()),
            Payload::GlobalSection(r) => {
                defined_globals = r.count();
                kept.push((6, at(r.range()).to_vec()));
            }
            Payload::ExportSection(r) => {
                for x in r {
                    let x = x.map_err(e)?;
                    match x.kind {
                        ExternalKind::Func | ExternalKind::FuncExact => exports.insert((0, x.index), x.name.to_string()),
                        ExternalKind::Global => exports.insert((2, x.index), x.name.to_string()),
                        _ => None,
                    };
                }
            }
            Payload::DataCountSection { range, .. } => kept.push((12, at(range).to_vec())),
            Payload::CodeSectionStart { .. } => kept.push((10, Vec::new())),
            Payload::CodeSectionEntry(body) => bodies.push(body),
            Payload::DataSection(r) => {
                kept.push((11, at(r.range()).to_vec()));
                for d in r {
                    let d = d.map_err(e)?;
                    let DataKind::Active { offset_expr, .. } = d.kind else {
                        return Err("an object's data segments are active".into());
                    };
                    let mut ops = offset_expr.get_operators_reader();
                    let Operator::I32Const { value } = ops.read().map_err(e)? else {
                        return Err("a data segment's offset is an i32.const".into());
                    };
                    segments.push(Segment { start: value as u32, len: d.data.len() as u32 });
                }
            }
            Payload::CustomSection(c) => {
                if let KnownCustom::Name(names) = c.as_known() {
                    for n in names {
                        match n.map_err(e)? {
                            Name::Function(map) => {
                                for x in map {
                                    let x = x.map_err(e)?;
                                    func_names.insert(x.index, x.name.to_string());
                                }
                            }
                            Name::Global(map) => {
                                for x in map {
                                    let x = x.map_err(e)?;
                                    global_names.insert(x.index, x.name.to_string());
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            other => return Err(format!("an object here holds no {other:?}")),
        }
    }
    if !memory_imported {
        return Err("an object imports its memory as env.__linear_memory".into());
    }

    // The symbol table: functions, globals, then data.
    let mut symtab = Vec::new();
    let mut count = 0u32;
    let mut func_sym = Vec::new();
    let imported = func_imports.len() as u32;
    for i in 0..imported + defined_funcs {
        func_sym.push(count);
        count += 1;
        symtab.push(0u8);
        if i < imported {
            uleb(&mut symtab, SYM_UNDEFINED as u64);
            uleb(&mut symtab, i as u64);
        } else {
            let (flags, name) = match exports.get(&(0, i)) {
                Some(n) => (if program { SYM_EXPORTED } else { 0 }, n.clone()),
                None => (SYM_LOCAL, func_names.get(&i).cloned().unwrap_or_else(|| format!("f{i}"))),
            };
            uleb(&mut symtab, flags as u64);
            uleb(&mut symtab, i as u64);
            string(&mut symtab, &name);
        }
    }
    let mut global_sym = Vec::new();
    for g in 0..defined_globals {
        global_sym.push(count);
        count += 1;
        symtab.push(2u8);
        let (flags, name) = match exports.get(&(2, g)) {
            Some(n) => (if program { SYM_EXPORTED } else { 0 }, n.clone()),
            None => (SYM_LOCAL, global_names.get(&g).cloned().unwrap_or_else(|| format!("g{g}"))),
        };
        uleb(&mut symtab, flags as u64);
        uleb(&mut symtab, g as u64);
        string(&mut symtab, &name);
    }
    let mut data_sym = Vec::new();
    for (i, s) in segments.iter().enumerate() {
        data_sym.push(count);
        count += 1;
        symtab.push(1u8);
        uleb(&mut symtab, SYM_LOCAL as u64);
        string(&mut symtab, &format!(".data.{i}"));
        uleb(&mut symtab, i as u64);
        uleb(&mut symtab, 0);
        uleb(&mut symtab, s.len as u64);
    }

    // The code section, every relocatable immediate padded, with its relocations.
    let mut code = Vec::new();
    uleb(&mut code, bodies.len() as u64);
    let mut relocs: Vec<Reloc> = Vec::new();
    for body in &bodies {
        let range = body.range();
        let mut ops = body.get_operators_reader().map_err(e)?;
        let ops_start = ops.original_position();
        let mut out: Vec<u8> = bytes[range.start as usize..ops_start as usize].to_vec();
        let mut here: Vec<Reloc> = Vec::new();
        while !ops.eof() {
            let start = ops.original_position();
            let op = ops.read().map_err(e)?;
            let end = ops.original_position();
            match op {
                Operator::Call { function_index } => {
                    out.push(0x10);
                    here.push(Reloc { ty: 0, offset: out.len() as u32, symbol: func_sym[function_index as usize], addend: None });
                    uleb5(&mut out, function_index);
                }
                Operator::GlobalGet { global_index } | Operator::GlobalSet { global_index } => {
                    out.push(bytes[start as usize]);
                    here.push(Reloc { ty: 7, offset: out.len() as u32, symbol: global_sym[global_index as usize], addend: None });
                    uleb5(&mut out, global_index);
                }
                Operator::I32Const { value } if (MARK..MARK_END).contains(&(value as i64)) => {
                    let addr = (value as i64 - MARK) as u32;
                    let (seg, s) = segments
                        .iter()
                        .enumerate()
                        .find(|(_, s)| s.start <= addr && addr <= s.start + s.len)
                        .ok_or_else(|| format!("address {addr} is in none of the object's data segments"))?;
                    out.push(0x41);
                    here.push(Reloc { ty: 4, offset: out.len() as u32, symbol: data_sym[seg], addend: Some((addr - s.start) as i64) });
                    sleb5(&mut out, addr as i32);
                }
                Operator::CallIndirect { .. } | Operator::RefFunc { .. } | Operator::ReturnCall { .. } => {
                    return Err("an object here makes no indirect call and takes no function reference".into())
                }
                _ => out.extend_from_slice(&bytes[start as usize..end as usize]),
            }
        }
        let mut sized = Vec::new();
        uleb(&mut sized, out.len() as u64);
        let base = (code.len() + sized.len()) as u32;
        code.extend_from_slice(&sized);
        code.extend_from_slice(&out);
        relocs.extend(here.into_iter().map(|r| Reloc { offset: r.offset + base, ..r }));
    }

    let mut module = b"\0asm\x01\0\0\0".to_vec();
    let mut code_index = 0u32;
    for (i, (id, contents)) in kept.iter().enumerate() {
        if *id == 10 {
            code_index = i as u32;
            section(&mut module, 10, &code);
        } else {
            section(&mut module, *id, contents);
        }
    }
    let mut linking = Vec::new();
    uleb(&mut linking, 2);
    let mut table = Vec::new();
    uleb(&mut table, count as u64);
    table.extend_from_slice(&symtab);
    linking.push(8);
    uleb(&mut linking, table.len() as u64);
    linking.extend_from_slice(&table);
    if !segments.is_empty() {
        let mut info = Vec::new();
        uleb(&mut info, segments.len() as u64);
        for i in 0..segments.len() {
            string(&mut info, &format!(".data.{i}"));
            uleb(&mut info, 3);
            uleb(&mut info, 0);
        }
        linking.push(5);
        uleb(&mut linking, info.len() as u64);
        linking.extend_from_slice(&info);
    }
    custom(&mut module, "linking", &linking);
    let mut reloc = Vec::new();
    uleb(&mut reloc, code_index as u64);
    uleb(&mut reloc, relocs.len() as u64);
    for r in &relocs {
        reloc.push(r.ty);
        uleb(&mut reloc, r.offset as u64);
        uleb(&mut reloc, r.symbol as u64);
        if let Some(a) = r.addend {
            sleb(&mut reloc, a);
        }
    }
    custom(&mut module, "reloc.CODE", &reloc);

    wasmparser::validate(&module).map_err(|e| format!("the object doesn't validate: {e}"))?;
    read_back(&module, count, relocs.len())?;
    Ok(module)
}

/// Reads the object's `linking` and `reloc.CODE` back through wasmparser's own readers.
fn read_back(module: &[u8], symbols: u32, relocs: usize) -> Result<(), String> {
    let e = |e: wasmparser::BinaryReaderError| e.to_string();
    let (mut seen_symbols, mut seen_relocs) = (None, None);
    for p in Parser::new(0).parse_all(module) {
        if let Payload::CustomSection(c) = p.map_err(e)? {
            match c.as_known() {
                KnownCustom::Linking(l) => {
                    if l.version() != 2 {
                        return Err("linking version isn't 2".into());
                    }
                    for s in l.subsections() {
                        if let wasmparser::Linking::SymbolTable(t) = s.map_err(e)? {
                            let mut n = 0;
                            for x in t {
                                x.map_err(e)?;
                                n += 1;
                            }
                            seen_symbols = Some(n);
                        }
                    }
                }
                KnownCustom::Reloc(r) => {
                    let mut n = 0;
                    for x in r.entries() {
                        x.map_err(e)?;
                        n += 1;
                    }
                    seen_relocs = Some(n);
                }
                _ => {}
            }
        }
    }
    if seen_symbols != Some(symbols) || seen_relocs != Some(relocs) {
        return Err(format!("read back {seen_symbols:?} symbols and {seen_relocs:?} relocations, wrote {symbols} and {relocs}"));
    }
    Ok(())
}
