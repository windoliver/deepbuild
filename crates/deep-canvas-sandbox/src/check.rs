//! The logic subset's check (canvas primitives: Logic: sandbox): WebAssembly 2.0 without vector
//! instructions; one memory whose maximum is its minimum; fixed tables of at most 65,536 entries;
//! no passive segments, no mutable reference globals, no imports, at most 4 MiB. Each refusal names
//! the import, the proposal, the instruction and its function, the segment, the global or the limit.
//!
//! The parser's features come from [`SUBSET`], an allowlist, never the parser's defaults, so a
//! proposal a later parser turns on by default stays refused by name.

use serde_json::{json, Value};
use wasmparser::{
    CompositeInnerType, ElementKind, ExternalKind, Operator, Parser, Payload, RefType, TypeRef,
    ValType, Validator, WasmFeatures,
};

/// A program's largest size.
pub const MAX_PROGRAM: u64 = 4 * 1024 * 1024;
/// A table's most entries.
pub const MAX_TABLE: u64 = 65_536;
/// A memory page.
pub const PAGE: u64 = 65_536;
/// The export names the rewrite adds; a program may not take one.
pub const RESERVED: &str = "sandbox.";

/// Exactly WebAssembly 2.0 without vector instructions.
pub const SUBSET: WasmFeatures = WasmFeatures::WASM2.difference(WasmFeatures::SIMD);

/// The parser's default features: the planted check's, never the subset's (#238).
pub fn parser_defaults() -> WasmFeatures {
    WasmFeatures::default()
}

/// A limit a program passes: its name, the most it may be and what it is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Limit {
    pub name: &'static str,
    pub max: Option<u64>,
    pub actual: Option<u64>,
}

/// One reason a program is outside the subset.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Refusal {
    pub rule: &'static str,
    pub what: String,
    /// The import's module and name.
    pub import: Option<(String, String)>,
    /// The instruction, in the text format's spelling.
    pub instruction: Option<String>,
    /// The function the instruction is in, by index.
    pub function: Option<u32>,
    /// `data` or `elem`, and the segment's index.
    pub segment: Option<(&'static str, u32)>,
    pub global: Option<u32>,
    pub limit: Option<Limit>,
    /// The proposal past WebAssembly 2.0 the program uses.
    pub proposal: Option<&'static str>,
    /// The role and the export it lacks.
    pub role: Option<String>,
    pub export: Option<String>,
}

impl Refusal {
    fn new(rule: &'static str, what: String) -> Refusal {
        Refusal {
            rule,
            what,
            ..Refusal::default()
        }
    }

    pub fn to_json(&self) -> Value {
        let mut out = json!({"rule": self.rule, "what": self.what});
        if let Some((module, name)) = &self.import {
            out["import"] = json!({"module": module, "name": name});
        }
        if let Some(i) = &self.instruction {
            out["instruction"] = json!(i);
        }
        if let Some(f) = self.function {
            out["function"] = json!(f);
        }
        if let Some((kind, index)) = self.segment {
            out["segment"] = json!({"kind": kind, "index": index});
        }
        if let Some(g) = self.global {
            out["global"] = json!(g);
        }
        if let Some(l) = &self.limit {
            out["limit"] = json!({"name": l.name, "max": l.max, "actual": l.actual});
        }
        if let Some(p) = self.proposal {
            out["proposal"] = json!(p);
        }
        if let Some(r) = &self.role {
            out["role"] = json!(r);
        }
        if let Some(e) = &self.export {
            out["export"] = json!(e);
        }
        out
    }
}

/// What a program may use beyond the subset's shape.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    /// The parser's features: [`SUBSET`] in the shipped check.
    pub features: WasmFeatures,
    /// The memory budget, in bytes: a memory's maximum must fit it.
    pub memory: u64,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            features: SUBSET,
            memory: 256 * 1024 * 1024,
        }
    }
}

/// The proposal and the visit name of each operator, from the parser's own list.
macro_rules! define_classify {
    ($( @$proposal:ident $op:ident $({ $($arg:ident: $argty:ty),* })? => $visit:ident ($($ann:tt)*) )*) => {
        fn classify(op: &Operator<'_>) -> (&'static str, &'static str) {
            match op {
                $( Operator::$op { .. } => (stringify!($proposal), stringify!($visit)), )*
                _ => ("unknown", "visit_unknown"),
            }
        }
    };
}
wasmparser::for_each_operator!(define_classify);

/// The parser feature a proposal's operators need; an unknown one needs every feature.
fn feature(proposal: &str) -> WasmFeatures {
    match proposal {
        "mvp" => WasmFeatures::empty(),
        "sign_extension" => WasmFeatures::SIGN_EXTENSION,
        "saturating_float_to_int" => WasmFeatures::SATURATING_FLOAT_TO_INT,
        "bulk_memory" => WasmFeatures::BULK_MEMORY,
        "reference_types" => WasmFeatures::REFERENCE_TYPES,
        "tail_call" => WasmFeatures::TAIL_CALL,
        "simd" => WasmFeatures::SIMD,
        "relaxed_simd" => WasmFeatures::RELAXED_SIMD,
        "threads" => WasmFeatures::THREADS,
        "shared_everything_threads" => WasmFeatures::SHARED_EVERYTHING_THREADS,
        "exceptions" => WasmFeatures::EXCEPTIONS,
        "legacy_exceptions" => WasmFeatures::LEGACY_EXCEPTIONS,
        "gc" => WasmFeatures::GC,
        "function_references" => WasmFeatures::FUNCTION_REFERENCES,
        "memory_control" => WasmFeatures::MEMORY_CONTROL,
        "stack_switching" => WasmFeatures::STACK_SWITCHING,
        "wide_arithmetic" => WasmFeatures::WIDE_ARITHMETIC,
        "custom_descriptors" => WasmFeatures::CUSTOM_DESCRIPTORS,
        _ => WasmFeatures::all(),
    }
}

/// The proposal's name in a refusal: a proposal's later parts under the proposal they extend.
fn proposal_name(p: &'static str) -> &'static str {
    match p {
        "relaxed_simd" => "simd",
        "shared_everything_threads" => "threads",
        "legacy_exceptions" => "exceptions",
        p => p,
    }
}

/// The text format's spelling of an operator from its visit name: `visit_i32_div_s` is
/// `i32.div_s`, `visit_i32_atomic_load` is `i32.atomic.load`, `visit_return_call` is `return_call`.
pub fn instruction_name(visit: &str) -> String {
    const PREFIXES: [&str; 22] = [
        "i32_", "i64_", "f32_", "f64_", "v128_", "i8x16_", "i16x8_", "i32x4_", "i64x2_", "f32x4_",
        "f64x2_", "memory_", "table_", "local_", "global_", "ref_", "elem_", "data_", "struct_",
        "array_", "any_", "extern_",
    ];
    let bare = visit.trim_start_matches("visit_");
    match PREFIXES.iter().find(|p| bare.starts_with(**p)) {
        Some(p) => {
            let rest = &bare[p.len()..];
            let rest = match rest.strip_prefix("atomic_") {
                Some(r) => format!("atomic.{}", r.replacen("rmw_", "rmw.", 1)),
                None => rest.to_string(),
            };
            format!("{}.{rest}", &p[..p.len() - 1])
        }
        None => bare.to_string(),
    }
}

/// The operator's proposal and its text spelling.
pub fn operator(op: &Operator<'_>) -> (&'static str, String) {
    let (proposal, visit) = classify(op);
    (proposal, instruction_name(visit))
}

/// The memory an operator reads or writes, when it names one.
fn memory_of(op: &Operator<'_>) -> Option<u32> {
    use Operator::*;
    match op {
        MemorySize { mem } | MemoryGrow { mem } | MemoryFill { mem } | MemoryInit { mem, .. } => {
            Some(*mem)
        }
        MemoryCopy { dst_mem, .. } => Some(*dst_mem),
        I32Load { memarg }
        | I64Load { memarg }
        | F32Load { memarg }
        | F64Load { memarg }
        | I32Load8S { memarg }
        | I32Load8U { memarg }
        | I32Load16S { memarg }
        | I32Load16U { memarg }
        | I64Load8S { memarg }
        | I64Load8U { memarg }
        | I64Load16S { memarg }
        | I64Load16U { memarg }
        | I64Load32S { memarg }
        | I64Load32U { memarg }
        | I32Store { memarg }
        | I64Store { memarg }
        | F32Store { memarg }
        | F64Store { memarg }
        | I32Store8 { memarg }
        | I32Store16 { memarg }
        | I64Store8 { memarg }
        | I64Store16 { memarg }
        | I64Store32 { memarg } => Some(memarg.memory),
        _ => None,
    }
}

/// The instructions in the subset's features that change a table or use a segment later.
const REFUSED: [&str; 8] = [
    "table.set",
    "table.fill",
    "table.copy",
    "table.init",
    "table.grow",
    "elem.drop",
    "memory.init",
    "data.drop",
];

fn proposal(p: &'static str, what: String) -> Refusal {
    Refusal {
        proposal: Some(proposal_name(p)),
        ..Refusal::new("proposal", what)
    }
}

fn limit(name: &'static str, max: Option<u64>, actual: Option<u64>, what: String) -> Refusal {
    Refusal {
        limit: Some(Limit { name, max, actual }),
        ..Refusal::new("limit", what)
    }
}

fn invalid(e: &wasmparser::BinaryReaderError) -> Refusal {
    Refusal::new(
        "valid",
        format!(
            "not a valid program under the subset: {} at offset {}",
            e.message(),
            e.offset()
        ),
    )
}

/// Collects what puts a program outside the subset.
struct Walk<'l> {
    limits: &'l Limits,
    out: Vec<Refusal>,
}

impl Walk<'_> {
    fn has(&self, f: WasmFeatures) -> bool {
        self.limits.features.contains(f)
    }

    fn value_type(&mut self, t: ValType, at: &str) -> bool {
        match t {
            ValType::V128 if !self.has(WasmFeatures::SIMD) => {
                self.out
                    .push(proposal("simd", format!("{at} has the vector type v128")));
                false
            }
            ValType::Ref(r) => self.ref_type(r, at),
            _ => true,
        }
    }

    fn ref_type(&mut self, r: RefType, at: &str) -> bool {
        if r == RefType::FUNCREF || r == RefType::EXTERNREF {
            return true;
        }
        let (name, need) = if r.is_concrete_type_ref() || !r.is_nullable() {
            ("function_references", WasmFeatures::FUNCTION_REFERENCES)
        } else {
            ("gc", WasmFeatures::GC)
        };
        if self.has(need) {
            return true;
        }
        self.out
            .push(proposal(name, format!("{at} has the reference type {r}")));
        false
    }

    /// A constant expression: arithmetic in one is the extended constants proposal.
    fn const_expr(&mut self, expr: &wasmparser::ConstExpr<'_>, at: &str, global: Option<u32>) {
        let mut reader = expr.get_operators_reader();
        while !reader.eof() {
            let Ok(op) = reader.read() else { return };
            let (p, name) = operator(&op);
            let extended = matches!(
                op,
                Operator::I32Add
                    | Operator::I32Sub
                    | Operator::I32Mul
                    | Operator::I64Add
                    | Operator::I64Sub
                    | Operator::I64Mul
            );
            let refused = if extended {
                (!self.has(WasmFeatures::EXTENDED_CONST)).then_some("extended_const")
            } else {
                (!self.has(feature(p))).then_some(p)
            };
            if let Some(p) = refused {
                self.out.push(Refusal {
                    instruction: Some(name.clone()),
                    global,
                    ..proposal(
                        p,
                        format!("{at} uses {name} from the {} proposal", proposal_name(p)),
                    )
                });
            }
        }
    }
}

/// Checks a program against the subset; a refused program gets every reason, in the program's order.
pub fn check(bytes: &[u8], limits: &Limits) -> Result<(), Vec<Refusal>> {
    let mut w = Walk {
        limits,
        out: Vec::new(),
    };
    let size = bytes.len() as u64;
    if size > MAX_PROGRAM {
        w.out.push(limit(
            "program",
            Some(MAX_PROGRAM),
            Some(size),
            format!("the program is {size} bytes, past the subset's {MAX_PROGRAM} (4 MiB)"),
        ));
    }
    if let Err(e) = walk(bytes, &mut w) {
        w.out.push(invalid(&e));
    }
    if w.out.is_empty() {
        if let Err(e) = Validator::new_with_features(limits.features).validate_all(bytes) {
            w.out.push(invalid(&e));
        }
    }
    if w.out.is_empty() {
        Ok(())
    } else {
        Err(w.out)
    }
}

fn walk(bytes: &[u8], w: &mut Walk<'_>) -> wasmparser::Result<()> {
    let mut imported_functions = 0u32;
    let mut function = 0u32;
    let mut memories: Vec<bool> = Vec::new();
    let mut globals = 0u32;
    for payload in Parser::new(0).parse_all(bytes) {
        match payload? {
            Payload::Version {
                encoding: wasmparser::Encoding::Component,
                ..
            } => w.out.push(proposal(
                "component_model",
                "a component is not a program".into(),
            )),
            Payload::TypeSection(s) => {
                for (i, group) in s.into_iter().enumerate() {
                    let group = group?;
                    let types: Vec<_> = group.types().collect();
                    let plain = types.len() == 1
                        && types[0].is_final
                        && types[0].supertype_idx.is_none()
                        && !types[0].composite_type.shared
                        && matches!(types[0].composite_type.inner, CompositeInnerType::Func(_));
                    if !plain && !w.has(WasmFeatures::GC) {
                        w.out.push(proposal(
                            "gc",
                            format!("type {i} is a garbage-collected type from the gc proposal"),
                        ));
                        continue;
                    }
                    for t in types {
                        if let CompositeInnerType::Func(ft) = &t.composite_type.inner {
                            for v in ft.params().iter().chain(ft.results()) {
                                w.value_type(*v, &format!("type {i}"));
                            }
                        }
                    }
                }
            }
            Payload::ImportSection(s) => {
                for import in s.into_imports() {
                    let import = import?;
                    let kind = match import.ty {
                        TypeRef::Func(_) => {
                            imported_functions += 1;
                            "function"
                        }
                        TypeRef::Table(_) => "table",
                        TypeRef::Memory(m) => {
                            memories.push(m.memory64);
                            "memory"
                        }
                        TypeRef::Global(_) => {
                            globals += 1;
                            "global"
                        }
                        _ => "item",
                    };
                    w.out.push(Refusal {
                        import: Some((import.module.into(), import.name.into())),
                        ..Refusal::new(
                            "import",
                            format!(
                                "the program imports the {kind} {}.{}; a program imports nothing",
                                import.module, import.name
                            ),
                        )
                    });
                }
                function = imported_functions;
            }
            Payload::TableSection(s) => {
                for (i, table) in s.into_iter().enumerate() {
                    let table = table?;
                    let t = table.ty;
                    let at = format!("table {i}");
                    if t.table64 && !w.has(WasmFeatures::MEMORY64) {
                        w.out
                            .push(proposal("memory64", format!("{at} is a 64-bit table")));
                    }
                    w.ref_type(t.element_type, &at);
                    if let wasmparser::TableInit::Expr(e) = &table.init {
                        if !w.has(WasmFeatures::FUNCTION_REFERENCES) {
                            w.out.push(proposal(
                                "function_references",
                                format!("{at} has an initializer expression"),
                            ));
                        }
                        w.const_expr(e, &at, None);
                    }
                    let entries = t.maximum.unwrap_or(t.initial).max(t.initial);
                    if entries > MAX_TABLE {
                        w.out.push(limit(
                            "table",
                            Some(MAX_TABLE),
                            Some(entries),
                            format!("{at} has {entries} entries, past the subset's {MAX_TABLE}"),
                        ));
                    } else if t.maximum != Some(t.initial) {
                        w.out.push(limit(
                            "table",
                            Some(t.initial),
                            t.maximum,
                            format!(
                                "{at} can grow: its maximum must equal its minimum ({})",
                                t.initial
                            ),
                        ));
                    }
                }
            }
            Payload::MemorySection(s) => {
                for memory in s {
                    let m = memory?;
                    let at = format!("memory {}", memories.len());
                    memories.push(m.memory64);
                    if memories.len() > 1 && !w.has(WasmFeatures::MULTI_MEMORY) {
                        w.out.push(proposal(
                            "multi_memory",
                            format!("{at} is a second memory, from the multi_memory proposal; a program has one"),
                        ));
                    }
                    if m.memory64 && !w.has(WasmFeatures::MEMORY64) {
                        w.out.push(proposal(
                            "memory64",
                            format!("{at} is a 64-bit memory, from the memory64 proposal"),
                        ));
                    }
                    if m.shared && !w.has(WasmFeatures::THREADS) {
                        w.out.push(proposal(
                            "threads",
                            format!("{at} is shared, from the threads proposal"),
                        ));
                    }
                    if m.page_size_log2.is_some() && !w.has(WasmFeatures::CUSTOM_PAGE_SIZES) {
                        w.out.push(proposal(
                            "custom_page_sizes",
                            format!("{at} sets its page size"),
                        ));
                    }
                    if m.maximum != Some(m.initial) {
                        w.out.push(limit(
                            "memory",
                            Some(m.initial),
                            m.maximum,
                            format!(
                                "{at} can grow: its maximum must equal its minimum ({} pages)",
                                m.initial
                            ),
                        ));
                    } else if m.initial.saturating_mul(PAGE) > w.limits.memory {
                        w.out.push(limit(
                            "memory",
                            Some(w.limits.memory / PAGE),
                            Some(m.initial),
                            format!(
                                "{at} holds {} pages, past the memory budget of {} bytes",
                                m.initial, w.limits.memory
                            ),
                        ));
                    }
                }
            }
            Payload::TagSection(_) if !w.has(WasmFeatures::EXCEPTIONS) => {
                w.out.push(proposal(
                    "exceptions",
                    "the program declares a tag, from the exceptions proposal".into(),
                ));
            }
            Payload::GlobalSection(s) => {
                for global in s {
                    let g = global?;
                    let at = format!("global {globals}");
                    if w.value_type(g.ty.content_type, &at) {
                        if g.ty.shared && !w.has(WasmFeatures::SHARED_EVERYTHING_THREADS) {
                            w.out.push(Refusal {
                                global: Some(globals),
                                ..proposal("shared_everything_threads", format!("{at} is shared"))
                            });
                        }
                        if g.ty.mutable && matches!(g.ty.content_type, ValType::Ref(_)) {
                            w.out.push(Refusal {
                                global: Some(globals),
                                ..Refusal::new(
                                    "global",
                                    format!(
                                        "{at} is a mutable global of a reference type ({})",
                                        g.ty.content_type
                                    ),
                                )
                            });
                        }
                    }
                    w.const_expr(&g.init_expr, &at, Some(globals));
                    globals += 1;
                }
            }
            Payload::ExportSection(s) => {
                for export in s {
                    let e = export?;
                    if e.name.starts_with(RESERVED) {
                        w.out.push(Refusal {
                            export: Some(e.name.to_string()),
                            ..Refusal::new(
                                "export",
                                format!("the export {} takes a name the rewrite keeps", e.name),
                            )
                        });
                    }
                }
            }
            Payload::ElementSection(s) => {
                for (i, element) in s.into_iter().enumerate() {
                    let e = element?;
                    let at = format!("elem {i}");
                    match e.kind {
                        ElementKind::Passive => w.out.push(Refusal {
                            segment: Some(("elem", i as u32)),
                            ..Refusal::new(
                                "segment",
                                format!("{at} is a passive segment, kept to use later"),
                            )
                        }),
                        ElementKind::Active { offset_expr, .. } => {
                            w.const_expr(&offset_expr, &at, None)
                        }
                        _ => {}
                    }
                    if let wasmparser::ElementItems::Expressions(t, items) = e.items {
                        w.ref_type(t, &at);
                        for item in items {
                            w.const_expr(&item?, &at, None);
                        }
                    }
                }
            }
            Payload::DataSection(s) => {
                for (i, data) in s.into_iter().enumerate() {
                    let d = data?;
                    let at = format!("data {i}");
                    match d.kind {
                        wasmparser::DataKind::Passive => w.out.push(Refusal {
                            segment: Some(("data", i as u32)),
                            ..Refusal::new(
                                "segment",
                                format!("{at} is a passive segment, kept to use later"),
                            )
                        }),
                        wasmparser::DataKind::Active { offset_expr, .. } => {
                            w.const_expr(&offset_expr, &at, None)
                        }
                    }
                }
            }
            Payload::CodeSectionEntry(body) => {
                code(&body, function, &memories, w)?;
                function += 1;
            }
            _ => {}
        }
    }
    Ok(())
}

/// A function body: each instruction past the subset, by proposal, with the function it is in.
fn code(
    body: &wasmparser::FunctionBody<'_>,
    function: u32,
    memories: &[bool],
    w: &mut Walk<'_>,
) -> wasmparser::Result<()> {
    let at = format!("function {function}");
    for local in body.get_locals_reader()? {
        let (_, t) = local?;
        let before = w.out.len();
        w.value_type(t, &format!("a local of {at}"));
        for r in &mut w.out[before..] {
            r.function = Some(function);
        }
    }
    let mut ops = body.get_operators_reader()?;
    while !ops.eof() {
        let op = ops.read()?;
        let (p, name) = operator(&op);
        let named = |w: &mut Walk<'_>, r: Refusal| {
            w.out.push(Refusal {
                instruction: Some(name.clone()),
                function: Some(function),
                ..r
            })
        };
        if !w.has(feature(p)) {
            let kind = match p {
                "simd" | "relaxed_simd" => "a vector instruction",
                "threads" | "shared_everything_threads" => "an atomic instruction",
                _ => "an instruction",
            };
            let what = format!(
                "{at} uses {kind}, {name}, from the {} proposal",
                proposal_name(p)
            );
            named(w, proposal(p, what));
            continue;
        }
        if REFUSED.contains(&name.as_str()) {
            let what = format!("{at} uses {name}, which changes a table or uses a segment later");
            named(w, Refusal::new("instruction", what));
        }
        if let Some(m) = memory_of(&op) {
            if m > 0 && !w.has(WasmFeatures::MULTI_MEMORY) {
                let what =
                    format!("{at} uses {name} on memory {m}, from the multi_memory proposal");
                named(w, proposal("multi_memory", what));
            } else if memories.get(m as usize) == Some(&true) && !w.has(WasmFeatures::MEMORY64) {
                let what =
                    format!("{at} uses {name} on a 64-bit memory, from the memory64 proposal");
                named(w, proposal("memory64", what));
            }
        }
        if let Operator::Block { blockty } | Operator::Loop { blockty } | Operator::If { blockty } =
            op
        {
            if let wasmparser::BlockType::Type(t) = blockty {
                let before = w.out.len();
                w.value_type(t, &at);
                for r in &mut w.out[before..] {
                    r.function = Some(function);
                }
            }
        }
    }
    Ok(())
}

/// The exports a program's role needs (Logic: sandbox, program roles): `(name, kind)`.
pub fn role_exports(role: &str) -> Option<&'static [(&'static str, ExternalKind)]> {
    use ExternalKind::{Func, Global, Memory};
    Some(match role {
        "provider" => &[
            ("memory", Memory),
            ("gen", Func),
            ("params_at", Global),
            ("assets_at", Global),
            ("out_at", Global),
        ],
        "validator" => &[("memory", Memory), ("validate", Func), ("in_at", Global)],
        // A logic item (Logic `logic@1`: Exports; #531).
        "logic" => &[
            ("memory", Memory),
            ("init", Func),
            ("step", Func),
            ("reads_at", Global),
            ("writes_at", Global),
        ],
        "migration" => &[("old_at", Global), ("remap_at", Global), ("new_at", Global)],
        _ => return None,
    })
}

/// Refuses a program that lacks an export, or an immutable global, its role needs.
pub fn check_role(bytes: &[u8], role: &str) -> Result<(), Vec<Refusal>> {
    let Some(needs) = role_exports(role) else {
        return Err(vec![Refusal {
            role: Some(role.into()),
            ..Refusal::new("role", format!("no program role is named {role}"))
        }]);
    };
    let mut exports = Vec::new();
    let mut mutable = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.map_err(|e| vec![invalid(&e)])? {
            Payload::GlobalSection(s) => {
                for g in s {
                    mutable.push(g.map_err(|e| vec![invalid(&e)])?.ty.mutable);
                }
            }
            Payload::ExportSection(s) => {
                for e in s {
                    let e = e.map_err(|e| vec![invalid(&e)])?;
                    exports.push((e.name.to_string(), e.kind, e.index));
                }
            }
            _ => {}
        }
    }
    let lacking: Vec<Refusal> = needs
        .iter()
        .filter(
            |(name, kind)| match exports.iter().find(|(n, k, _)| n == name && k == kind) {
                Some((_, ExternalKind::Global, i)) => mutable.get(*i as usize) != Some(&false),
                Some(_) => false,
                None => true,
            },
        )
        .map(|(name, _)| Refusal {
            role: Some(role.into()),
            export: Some(name.to_string()),
            ..Refusal::new(
                "role",
                format!("a {role} exports {name}; this program lacks it"),
            )
        })
        .collect();
    if lacking.is_empty() {
        Ok(())
    } else {
        Err(lacking)
    }
}
