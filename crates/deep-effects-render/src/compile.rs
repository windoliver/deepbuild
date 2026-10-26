//! Compile, validate and cache (canvas primitives): an operator's JSON is read and checked, the
//! core writes its WGSL, and naga parses and validates that module with every validation flag and
//! no optional capability (no f64, subgroups, binding arrays or immediates) before wgpu sees it.
//! wgpu then builds it with its runtime checks on. A WGSL-subset source goes through the effects
//! module's front end first, which parses it with naga's WGSL parser and refuses, naming the line,
//! the column and the construct, anything the op table has no step for.

use std::collections::BTreeMap;
use std::path::PathBuf;

use deep_canvas_effects::check::{self, Checked};
use deep_canvas_effects::emit::{self, Options};
use deep_canvas_effects::graph::{self, Issue, Kind, Operator};
use serde_json::Value;

/// naga's validation, as the core runs it on every module it writes.
pub fn validate(wgsl: &str) -> Result<naga::Module, String> {
    let module = naga::front::wgsl::parse_str(wgsl).map_err(|e| e.emit_to_string(wgsl))?;
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .map_err(|e| e.emit_to_string(wgsl))?;
    Ok(module)
}

/// A checked operator with its WGSL, validated.
#[derive(Clone, Debug)]
pub struct Compiled {
    pub checked: Checked,
    pub wgsl: String,
}

impl Compiled {
    pub fn kind(&self) -> Kind {
        self.checked.op.kind
    }
}

/// The front end's refusal of a WGSL-subset source: the construct at `span`, at its line and column
/// in the source as written (the prelude the front end puts before it doesn't count).
fn at(source: &str, prelude_lines: u32, span: naga::Span, construct: &str, message: &str) -> Issue {
    let loc = span.location(source);
    Issue {
        line: Some(loc.line_number.saturating_sub(prelude_lines)),
        column: Some(loc.line_position),
        construct: Some(construct.into()),
        path: Some("source/wgsl".into()),
        ..Issue::new("operator_source", message)
    }
}

/// Every statement the subset has no step for, by the word that starts it.
fn refuse(block: &naga::Block, text: &str, prelude: u32, out: &mut Vec<Issue>) {
    for (stmt, span) in block.span_iter() {
        let word: String = text
            .get(span.to_range().unwrap_or(0..0))
            .unwrap_or("")
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_alphabetic())
            .collect();
        match stmt {
            naga::Statement::Loop {
                body, continuing, ..
            } => {
                if word == "for" {
                    refuse(body, text, prelude, out);
                    refuse(continuing, text, prelude, out);
                } else {
                    // `loop` and `while` have no count fixed at check.
                    let construct = if word == "while" { "while" } else { "loop" };
                    out.push(at(
                        text,
                        prelude,
                        *span,
                        construct,
                        &format!("a `{construct}` has no count fixed at check; write a `for` whose count is a constant or an input with a max ≤ 64"),
                    ));
                }
            }
            naga::Statement::Block(b) => refuse(b, text, prelude, out),
            naga::Statement::If { accept, reject, .. } => {
                refuse(accept, text, prelude, out);
                refuse(reject, text, prelude, out);
            }
            _ => {}
        }
    }
}

/// The effects module's front end over a WGSL-subset source: it parses the source with naga's
/// WGSL parser beside the operator's `In` and `Out`, and refuses each construct with no step,
/// naming its line, column and construct. This build lowers no source to steps yet (composed
/// graphs land in R6), so a source with nothing refused is still refused, as a whole.
pub fn front_end(op: &Operator, assets: &BTreeMap<String, PathBuf>) -> Vec<Issue> {
    let Some(asset) = &op.source else {
        return Vec::new();
    };
    let Some(text) = assets
        .get(asset)
        .and_then(|p| std::fs::read_to_string(p).ok())
    else {
        return vec![Issue::at_path(
            "operator_source",
            "source/wgsl",
            format!("asset {asset} isn't there"),
        )];
    };
    let field = |t: &graph::Ty| match t {
        graph::Ty::Tex(_) | graph::Ty::Storage(..) => None,
        t => Some(t.wgsl()),
    };
    let mut prelude = String::from("struct In {\n");
    for (name, input) in &op.inputs {
        if let Some(t) = field(&input.ty) {
            prelude.push_str(&format!("    {name}: {t},\n"));
        }
    }
    prelude.push_str("    unused: f32,\n};\nstruct Out {\n    color: vec4<f32>,\n};\n");
    let lines = prelude.matches('\n').count() as u32;
    // `pass` is a reserved word in WGSL: the entry `fn pass` is read under a name of the same
    // length, so every line and column stays the source's.
    let whole = format!("{prelude}{}", text.replace("fn pass(", "fn p_ss("));
    let entry = match op.kind {
        Kind::Pass => "p_ss",
        kind => kind.name(),
    };
    let module = match naga::front::wgsl::parse_str(&whole) {
        Ok(m) => m,
        Err(e) => {
            let loc = e.location(&whole);
            return vec![Issue {
                line: loc.map(|l| l.line_number.saturating_sub(lines)),
                column: loc.map(|l| l.line_position),
                construct: Some("parse".into()),
                path: Some("source/wgsl".into()),
                ..Issue::new("operator_source", e.message().to_string())
            }];
        }
    };
    let Some(f) = module
        .functions
        .iter()
        .map(|(_, f)| f)
        .find(|f| f.name.as_deref() == Some(entry))
    else {
        return vec![Issue::at_path(
            "operator_source",
            "source/wgsl",
            format!("the source has no entry fn {}", op.kind.name()),
        )];
    };
    let mut out = Vec::new();
    refuse(&f.body, &whole, lines, &mut out);
    if out.is_empty() {
        out.push(Issue::at_path(
            "operator_source",
            "source/wgsl",
            "this build lowers no WGSL-subset source to steps yet (composed graphs land in R6)",
        ));
    }
    out
}

/// Reads, checks, writes and validates one operator; a refusal names every issue, and nothing
/// that fails reaches naga, let alone the GPU.
pub fn compile_with(
    op: &Value,
    assets: &BTreeMap<String, PathBuf>,
    options: Options,
) -> Result<Compiled, Vec<Issue>> {
    let read = graph::read(op)?;
    let refused = front_end(&read, assets);
    if !refused.is_empty() {
        return Err(refused);
    }
    let checked = check::check(&read)?;
    let wgsl = match checked.op.kind {
        Kind::Pass => emit::pass(&checked, options),
        Kind::Compute => emit::compute(&checked),
        Kind::Material => {
            return Err(vec![Issue::at_path(
                "operator_kind_rule",
                "kind",
                "this build runs no material operator",
            )]);
        }
    };
    if let Err(e) = validate(&wgsl) {
        return Err(vec![Issue::at_path("operator_compile", "", e)]);
    }
    Ok(Compiled { checked, wgsl })
}

pub fn compile(op: &Value) -> Result<Compiled, Vec<Issue>> {
    compile_with(op, &BTreeMap::new(), Options::default())
}
