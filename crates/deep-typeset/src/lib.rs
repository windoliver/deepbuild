//! The typeset job's first tool, `typst-mitex` (issue #220; canvas primitives: "Asset job:
//! typeset"): a formula's LaTeX or Typst source in, an SVG with one `<g id>` per part and its probe
//! out. LaTeX goes through mitex 0.2.7 to Typst, and Typst 0.15.1 lays the parts out as one formula,
//! so parting a formula moves none of its glyphs. It runs outside the canvas core, built once to
//! WebAssembly and run by the plug-in's Node entry with the fonts in the plug-in's own folder.

mod parts;
mod svg;
mod world;

use serde_json::{json, Map, Value};
use typst_layout::PagedDocument;

pub use parts::id_of;
pub use world::Base;

use parts::{Given, Syntax};

/// The tool's name and version, as its job tool is pinned.
pub const TOOL: &str = "typst-mitex";
pub const VERSION: &str = "1.0.0";

/// The font size a formula is set at, in the SVG's units.
const SIZE: f64 = 16.0;

/// The fonts the job names, by the family each sets.
const FONTS: [(&str, &str); 1] = [("new_computer_modern_math", "New Computer Modern Math")];

/// The licence of each family whose outlines the job draws.
fn licence_of(family: &str) -> &'static str {
    match family {
        "New Computer Modern Math" | "New Computer Modern" => "GUST Font License 1.0",
        _ => "unknown",
    }
}

/// A job's answer: its two outputs, or the issue that stopped it (its probe naming the issue and
/// its SVG empty), or why it couldn't run.
pub enum Answer {
    Done { svg: String, probe: String },
    Issue { probe: String },
    Failed(String),
}

/// Typesets one job's params, as `deep_job` hands them to the tool.
pub fn run(base: &Base, params: &Value) -> Answer {
    match typeset(base, params) {
        Ok((svg, probe)) => Answer::Done {
            svg,
            probe: probe.to_string(),
        },
        Err(Ok(issue)) => Answer::Issue {
            probe: json!({"issues": [issue.0]}).to_string(),
        },
        Err(Err(why)) => Answer::Failed(why),
    }
}

type Stop = Result<parts::Issue, String>;

fn typeset(base: &Base, params: &Value) -> Result<(String, Value), Stop> {
    let field = |k: &str| params.get(k).filter(|v| !v.is_null());
    let syntax_name = field("syntax")
        .and_then(Value::as_str)
        .unwrap_or("latex_math");
    let syntax = Syntax::of(syntax_name)
        .ok_or_else(|| Err(format!("the syntax {syntax_name} isn't one the job reads")))?;
    let given: Vec<Given> = match (field("parts"), field("source")) {
        (Some(Value::Array(parts)), None) => parts
            .iter()
            .map(|p| match p {
                Value::String(s) => Ok(Given {
                    source: s.clone(),
                    id: None,
                }),
                Value::Object(o) => Ok(Given {
                    source: o
                        .get("source")
                        .and_then(Value::as_str)
                        .ok_or("a part names its source")?
                        .to_owned(),
                    id: o.get("id").and_then(Value::as_str).map(str::to_owned),
                }),
                _ => Err("a part is a source, or {source, id}"),
            })
            .collect::<Result<_, _>>()
            .map_err(|e| Err(e.to_owned()))?,
        (None, Some(Value::String(s))) => vec![Given {
            source: s.clone(),
            id: None,
        }],
        _ => return Err(Err("a typeset job takes parts or one source".into())),
    };
    let display = field("display").and_then(Value::as_bool).unwrap_or(true);
    let font_name = field("font")
        .and_then(Value::as_str)
        .unwrap_or("new_computer_modern_math");
    let family = FONTS
        .iter()
        .find(|(n, _)| *n == font_name)
        .map(|(_, f)| *f)
        .ok_or_else(|| Err(format!("the font {font_name} isn't one the job bundles")))?;
    let macros: Vec<String> = field("macros")
        .and_then(Value::as_array)
        .map(|m| {
            m.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();

    let source = parts::source_of(&given);
    let parts = parts::parts(&given, syntax, &macros)?;
    let main = main_of(&parts, syntax, display, family);
    let job = world::Job::new(base, main);
    let doc = typst::compile::<PagedDocument>(&job)
        .output
        .map_err(|errors| {
            let why: Vec<String> = errors.iter().map(|e| e.message.to_string()).collect();
            Err(format!(
                "Typst couldn't set the formula: {}",
                why.join("; ")
            ))
        })?;
    let page = doc
        .pages()
        .first()
        .ok_or_else(|| Err("Typst set no page".to_owned()))?;
    let drawn = svg::draw(&page.frame, parts.len());

    let made_by = json!({"tool": TOOL, "version": VERSION, "input": source});
    let mut families: Vec<String> = base
        .fonts()
        .iter()
        .map(|f| f.info().family.clone())
        .filter(|f| f == family)
        .collect();
    families.dedup();
    let licence: Vec<Value> = families
        .iter()
        .map(|f| json!({"font": f, "license": licence_of(f)}))
        .collect();
    let (w, h) = (page.frame.width().to_pt(), page.frame.height().to_pt());

    let mut out = String::new();
    out.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" width=\"{w}\" height=\"{h}\">",
        w = svg::num(w),
        h = svg::num(h)
    ));
    out.push_str(&format!(
        "<metadata><deep:typeset xmlns:deep=\"urn:deepbuild:typeset\">{}</deep:typeset></metadata>",
        svg::escape(&json!({"made_by": made_by, "license": licence}).to_string())
    ));
    let mut probe_parts = Vec::with_capacity(parts.len());
    let mut glyphs = 0;
    for (part, d) in parts.iter().zip(&drawn) {
        out.push_str(&format!(
            "<g id=\"{}\" data-source=\"{}\">",
            svg::escape(&part.id),
            svg::escape(&part.source)
        ));
        for p in &d.paths {
            out.push_str(p);
        }
        out.push_str("</g>");
        glyphs += d.glyphs;
        let mut row = Map::new();
        row.insert("id".into(), json!(part.id));
        row.insert("source".into(), json!(part.source));
        row.insert("box".into(), json!(d.bbox()));
        row.insert("at".into(), json!(part.start()));
        probe_parts.push(Value::Object(row));
    }
    out.push_str("</svg>\n");
    let probe = json!({
        "made_by": made_by,
        "license": licence,
        "parts": probe_parts,
        "baseline": baseline(&page.frame),
        "glyphs": glyphs,
        "size": [svg::round(w), svg::round(h)],
        "issues": [],
    });
    Ok((out, probe))
}

/// The formula's baseline from the top of the SVG: the first frame inside the page that has one.
fn baseline(frame: &typst::layout::Frame) -> f64 {
    fn find(frame: &typst::layout::Frame, y: f64) -> Option<f64> {
        for (pos, item) in frame.items() {
            if let typst::layout::FrameItem::Group(g) = item {
                if g.frame.has_baseline() && g.transform.is_identity() {
                    return Some(y + pos.y.to_pt() + g.frame.baseline().to_pt());
                }
                if let Some(b) = find(&g.frame, y + pos.y.to_pt()) {
                    return Some(b);
                }
            }
        }
        None
    }
    svg::round(find(frame, 0.0).unwrap_or_else(|| frame.baseline().to_pt()))
}

/// The job's main file: each part evaluated on its own and tagged by its fill, all set as one
/// formula, so the parts sit exactly where the whole would.
fn main_of(parts: &[parts::Part], syntax: Syntax, display: bool, family: &str) -> String {
    let mut s = String::new();
    s.push_str("#import \"/mitex/specs/mod.typ\": mitex-scope\n");
    s.push_str("#set page(width: auto, height: auto, margin: 0pt, fill: none)\n");
    s.push_str(&format!("#set text(font: \"{family}\", size: {SIZE}pt)\n"));
    s.push_str(&format!(
        "#show math.equation: set text(font: \"{family}\")\n"
    ));
    let (mode, scope) = match syntax {
        Syntax::LatexMath => ("math", ", scope: mitex-scope"),
        Syntax::LatexText => ("markup", ", scope: mitex-scope"),
        Syntax::TypstMath => ("math", ""),
        Syntax::Typst => ("markup", ""),
    };
    let body: Vec<String> = parts
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let [r, g, b] = svg::tag(i);
            format!(
                "#text(fill: rgb({r}, {g}, {b}), eval(\"{}\", mode: \"{mode}\"{scope}))",
                quote(&p.code)
            )
        })
        .collect();
    let body = body.join(" ");
    if syntax.is_math() {
        if display {
            s.push_str(&format!("$ {body} $\n"));
        } else {
            s.push_str(&format!("${body}$\n"));
        }
    } else {
        s.push_str(&body);
        s.push('\n');
    }
    s
}

/// A Typst string literal's inside.
fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    //! The module's calls: `font` hands in one font file, `call` one job's params as JSON, and
    //! each answers JSON in memory the caller frees.
    use std::cell::RefCell;

    thread_local! {
        static BASE: RefCell<crate::Base> = RefCell::new(crate::Base::new());
    }

    #[no_mangle]
    pub extern "C" fn deep_typeset_alloc(len: usize) -> *mut u8 {
        let mut v = Vec::<u8>::with_capacity(len);
        let p = v.as_mut_ptr();
        std::mem::forget(v);
        p
    }

    /// # Safety
    /// `ptr` and `len` are a block `deep_typeset_alloc` or a call gave.
    #[no_mangle]
    pub unsafe extern "C" fn deep_typeset_free(ptr: *mut u8, len: usize) {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }

    fn give(out: String) -> u64 {
        let mut b = out.into_bytes().into_boxed_slice();
        let (p, n) = (b.as_mut_ptr(), b.len());
        std::mem::forget(b);
        ((p as u64) << 32) | n as u64
    }

    /// # Safety
    /// `ptr` and `len` are a block `deep_typeset_alloc` gave, filled with a font file.
    #[no_mangle]
    pub unsafe extern "C" fn deep_typeset_font(ptr: *mut u8, len: usize) -> u32 {
        let bytes = Vec::from_raw_parts(ptr, len, len);
        BASE.with(|b| u32::from(b.borrow_mut().add_font(bytes)))
    }

    /// # Safety
    /// `ptr` and `len` are a block `deep_typeset_alloc` gave, filled with the params as JSON.
    #[no_mangle]
    pub unsafe extern "C" fn deep_typeset_call(ptr: *mut u8, len: usize) -> u64 {
        let bytes = Vec::from_raw_parts(ptr, len, len);
        let answer = match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(params) => BASE.with(|b| crate::run(&b.borrow(), &params)),
            Err(e) => crate::Answer::Failed(format!("the params aren't JSON: {e}")),
        };
        give(match answer {
            crate::Answer::Done { svg, probe } => {
                serde_json::json!({"svg": svg, "probe": probe}).to_string()
            }
            crate::Answer::Issue { probe } => {
                serde_json::json!({"svg": "", "probe": probe}).to_string()
            }
            crate::Answer::Failed(why) => serde_json::json!({"failed": why}).to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Base {
        let mut base = Base::new();
        assert!(base.add_font(
            include_bytes!("../../../packages/jobs/typeset/tool/fonts/NewCMMath-Regular.otf")
                .to_vec()
        ));
        base
    }

    fn done(base: &Base, params: Value) -> (String, Value) {
        match run(base, &params) {
            Answer::Done { svg, probe } => (svg, serde_json::from_str(&probe).unwrap()),
            Answer::Issue { probe } => panic!("issue {probe}"),
            Answer::Failed(why) => panic!("failed {why}"),
        }
    }

    #[test]
    fn five_parts_are_five_groups_of_outlines() {
        let base = base();
        let (svg, probe) = done(&base, json!({"parts": ["a^2", "+", "b^2", "=", "c^2"]}));
        assert_eq!(svg.matches("<g id=").count(), 5);
        assert!(!svg.contains("<text") && !svg.contains("<use"));
        let ids: Vec<&str> = probe["parts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["t-a_5e2", "t-_2b", "t-b_5e2", "t-_3d", "t-c_5e2"]);
        for p in probe["parts"].as_array().unwrap() {
            assert!(p["box"][2].as_f64().unwrap() > 0.0, "{p}");
        }
        assert_eq!(probe["glyphs"], 8);
        // The same source as one part draws the same paths.
        let (whole, _) = done(&base, json!({"source": "a^2 + b^2 = c^2"}));
        let paths = |s: &str| {
            let mut v: Vec<String> = s
                .split("<path ")
                .skip(1)
                .map(|p| p.split("/>").next().unwrap().to_owned())
                .collect();
            v.sort();
            v
        };
        assert_eq!(paths(&svg), paths(&whole));
        assert_eq!(
            svg,
            done(&base, json!({"parts": ["a^2", "+", "b^2", "=", "c^2"]})).0
        );
    }

    #[test]
    fn issues_stop_the_job() {
        let base = base();
        let Answer::Issue { probe } = run(&base, &json!({"source": "\\ce{H2O}"})) else {
            panic!()
        };
        assert!(probe.contains("typeset.unknown_command"), "{probe}");
    }
}
