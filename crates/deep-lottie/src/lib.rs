//! Issue #162: the Lottie import (canvas primitives: Asset job: Lottie import), the `import`
//! job's tool with `from: lottie`. A Lottie 1.0.1 file comes in as a canvas document, the look it
//! names by hash and the issues the document can't hold: layers as items and groups, precomps as
//! groups with their layers placed in time, shapes as paths with ops, keys as Bézier keys, masks,
//! mattes and markers as their own kinds, and literal colors as roles of a generated look or of a
//! named one. Expressions, text layers, merge paths and layer effects come back as issues naming
//! their layer, never as code. It runs outside the canvas core, once per file: built to
//! WebAssembly by `node scripts/lottie-wasm.mjs`, it is the job tool in `packages/jobs/import`,
//! whose output checks are [`check`]'s.
//!
//! Its maps iterate in key order and its math goes through `deep_canvas::ops`, so one file always
//! gives the same bytes.

pub mod check;
mod colors;
mod geom;
mod ids;
mod items;
mod layers;
mod out;
mod read;
mod shapes;

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use crate::colors::{Colors, Target};
use crate::out::{n, Out, Time};
use crate::read::{num, scriptlike, Reader};

pub use crate::out::Issue;

/// The job's three outputs as their bytes: the document, the look it names by hash, and the
/// report (`{issues: [{code, layer, property?, what}], colors: [{color, role, distance}]}`).
pub struct Imported {
    pub document: Vec<u8>,
    pub look: Vec<u8>,
    pub report: Vec<u8>,
}

/// The canonical bytes of a JSON value: keys in order, whole numbers as integers.
pub fn bytes(v: &Value) -> Vec<u8> {
    deep_canvas::canon::canonical_bytes(v, &deep_canvas::canon::NoShape)
        .unwrap_or_else(|_| v.to_string().into_bytes())
}

/// Frame rates a document may run at (Time and the flick: the valid rates), as `p/q`.
fn rates() -> Vec<(u32, u32)> {
    const WHOLE: [u32; 20] = [
        8, 12, 15, 16, 18, 20, 24, 25, 30, 48, 50, 60, 72, 75, 90, 96, 100, 120, 144, 240,
    ];
    WHOLE
        .iter()
        .flat_map(|&p| [(p, 1), (p * 1000, 1001)])
        .collect()
}

/// The file's frame rate as a valid one: the rate it names, a decimal rate normalised (29.97 as
/// 30000/1001), or the nearest valid rate, reported.
fn rate(fr: f64) -> ((u32, u32), bool) {
    let all = rates();
    let near = all
        .iter()
        .copied()
        .min_by(|a, b| {
            (f64::from(a.0) / f64::from(a.1) - fr)
                .abs()
                .total_cmp(&(f64::from(b.0) / f64::from(b.1) - fr).abs())
        })
        .unwrap_or((60, 1));
    let exact = (f64::from(near.0) / f64::from(near.1) - fr).abs() < 1e-3;
    (near, exact)
}

/// The look the params name: `generated`, or `<look>@1` from the job's `look` input or, without
/// one, the shipped look of that name.
fn target(name: &str, given: Option<&[u8]>) -> Result<Target, String> {
    let base = || {
        deep_canvas_marks::look::shipped("clean")
            .ok_or("the shipped clean look is missing".to_string())
    };
    if name == "generated" {
        return Ok(Target::Generated(base()?));
    }
    let Some((id, major)) = name.split_once('@') else {
        return Err(format!(
            "the look {name:?} is neither generated nor <look>@<major>"
        ));
    };
    if major != "1" {
        return Err(format!(
            "the look {name} names major {major}; looks are look@1"
        ));
    }
    let def = match given {
        Some(bytes) => serde_json::from_slice::<Value>(bytes)
            .map_err(|e| format!("the look input is no JSON: {e}"))?,
        None => deep_canvas_marks::look::shipped(id).ok_or(format!(
            "no look input was given and no shipped look is named {id}"
        ))?,
    };
    if def
        .get("id")
        .and_then(Value::as_str)
        .is_some_and(|i| i != id)
    {
        return Err(format!(
            "the look input is {:?}, not the {id} the params name",
            def["id"]
        ));
    }
    let look = colors::resolve(&def).map_err(|r| format!("the look {id} is refused: {r}"))?;
    Ok(Target::Named {
        id: id.to_string(),
        def,
        look: Box::new(look),
    })
}

/// What the document's envelope takes from the file's root.
struct Head {
    ip: f64,
    op: f64,
    nm: String,
    size: [f64; 2],
    layers: usize,
    rate: (u32, u32),
}

/// The file's layers and markers into `out`, which takes the look `target` names.
fn map(root: &Map<String, Value>, target: Target) -> Result<(Out, Head), String> {
    let layers = root
        .get("layers")
        .and_then(Value::as_array)
        .ok_or("the file is no Lottie animation: it has no layers")?;
    let fr = num(root.get("fr"))
        .filter(|f| *f > 0.0)
        .ok_or("the file is no Lottie animation: it has no frame rate")?;
    let ((p, q), exact) = rate(fr);
    let mut out = Out {
        items: Map::new(),
        channels: Map::new(),
        constraints: Map::new(),
        data: Map::new(),
        collections: Map::new(),
        markers: Map::new(),
        issues: Vec::new(),
        ids: Default::default(),
        names: Default::default(),
        colors: Colors::new(target),
        fr: f64::from(p) / f64::from(q),
    };
    if !exact {
        out.issue("frame_rate", "", None, format!("{fr} fps isn't a rate a document runs at; it runs at {p}/{q}, every key at its own time"));
    }
    let (ip, op) = (
        num(root.get("ip")).unwrap_or(0.0),
        num(root.get("op")).unwrap_or(0.0),
    );
    let assets: BTreeMap<String, &Map<String, Value>> = root
        .get("assets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|a| Some((a.get("id")?.as_str()?.to_string(), a.as_object()?)))
        .collect();
    // Every literal color the file writes takes a role, first seen on the layer that writes it.
    let comps = std::iter::once(layers).chain(
        root.get("assets")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|a| a.get("layers")?.as_array()),
    );
    for list in comps {
        for layer in list {
            let mut found = Vec::new();
            colors::literals(layer, &mut found);
            let nm = layer.get("nm").and_then(Value::as_str).unwrap_or("");
            for c in found {
                out.colors.role(colors::rgb(&c), nm);
            }
        }
    }
    let mut reader = Reader::new(root);
    let ctx = layers::Ctx {
        assets,
        span: (ip, op.max(ip)),
    };
    let comp = layers::Comp {
        layers,
        parent: None,
        time: Time::ROOT,
        depth: 0,
    };
    layers::comp(&mut out, &mut reader, &ctx, &comp, &mut BTreeSet::new());
    layers::markers(
        &mut out,
        root.get("markers")
            .and_then(Value::as_array)
            .map_or(&[][..], |m| m.as_slice()),
        op,
    );
    let nm = root
        .get("nm")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let size = [
        num(root.get("w")).unwrap_or(0.0),
        num(root.get("h")).unwrap_or(0.0),
    ];
    Ok((
        out,
        Head {
            ip,
            op: op.max(ip),
            nm,
            size,
            layers: layers.len(),
            rate: (p, q),
        },
    ))
}

/// Imports `file` (a Lottie file's JSON) by `params` (`{from: lottie, look}`), with the job's
/// `look` input when it has one; the reason when it can't.
pub fn import(file: &[u8], params: &Value, look: Option<&[u8]>) -> Result<Imported, String> {
    if params
        .get("from")
        .and_then(Value::as_str)
        .unwrap_or("lottie")
        != "lottie"
    {
        return Err(format!(
            "this tool imports from lottie, not {}",
            params["from"]
        ));
    }
    let target = target(
        params
            .get("look")
            .and_then(Value::as_str)
            .unwrap_or("generated"),
        look,
    )?;
    let parsed: Value =
        serde_json::from_slice(file).map_err(|e| format!("the file is no JSON: {e}"))?;
    let Some(root) = parsed.as_object() else {
        return Err("the file is no Lottie animation: its root is no object".into());
    };
    let (mut out, head) = map(root, target)?;
    // The file's tree is read: its memory goes back before the document's bytes are written.
    drop(parsed);
    let Head {
        ip,
        op,
        nm,
        size,
        layers,
        rate: (p, q),
    } = head;
    // A generated role a status color is within the status distance of.
    let look_def = out.colors.look();
    let resolved = colors::resolve(&look_def).ok();
    if let Some(status) = resolved.as_ref().and_then(|l| l.status.as_ref()) {
        for (c, layer, state, d) in out.colors.clashes(status) {
            out.issue(
                "color_near_status",
                &layer,
                None,
                format!(
                    "{} is {d:.3} from the status color {state}, within the look's status distance",
                    colors::hex(c)
                ),
            );
        }
    }
    let look_bytes = bytes(&look_def);
    let asset = out.colors.asset();
    let title = if nm.is_empty() || scriptlike(&nm) {
        "Lottie import".to_string()
    } else {
        nm.clone()
    };
    let license = look_def
        .get("license")
        .and_then(Value::as_str)
        .unwrap_or("Apache-2.0");
    let mut doc = json!({
        "format": 1,
        "id": ids::sanitize(&nm, "lottie"),
        "profile": "figure",
        "title": title,
        "description": format!("A Lottie animation imported as a document: {layers} layers, {} items.", out.items.len()),
        "size": [n(size[0]), n(size[1])],
        "transport": {"frame_rate": [p, q], "start": out.flicks(ip), "span": out.flicks(op) - out.flicks(ip)},
        "layers": {"main": {"writer": "import", "title": "Lottie import", "order": "a0"}},
        "look": {"asset": format!("{asset}@1"), "theme": "light"},
        "assets": {asset.clone(): {"sha256": deep_canvas::canon::sha256_hex(&look_bytes), "license": license}},
    });
    for (key, section) in [
        ("items", &mut out.items),
        ("channels", &mut out.channels),
        ("constraints", &mut out.constraints),
        ("data", &mut out.data),
        ("collections", &mut out.collections),
        ("markers", &mut out.markers),
    ] {
        if !section.is_empty() {
            doc[key] = Value::Object(std::mem::take(section));
        }
    }
    let report = json!({"issues": out.issues.iter().map(Issue::to_json).collect::<Vec<_>>(), "colors": out.colors.report()});
    Ok(Imported {
        document: bytes(&doc),
        look: look_bytes,
        report: bytes(&report),
    })
}

/// The tool's WebAssembly calls: a block for the request, one call, and the answer's block back.
#[cfg(target_arch = "wasm32")]
mod wasm {
    #[no_mangle]
    pub extern "C" fn deep_lottie_alloc(len: usize) -> *mut u8 {
        let mut v = Vec::<u8>::with_capacity(len);
        let p = v.as_mut_ptr();
        std::mem::forget(v);
        p
    }

    /// # Safety
    /// `ptr` and `len` are a block `deep_lottie_alloc` or a call gave.
    #[no_mangle]
    pub unsafe extern "C" fn deep_lottie_free(ptr: *mut u8, len: usize) {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }

    fn give(out: Vec<u8>) -> u64 {
        let mut b = out.into_boxed_slice();
        let (p, n) = (b.as_mut_ptr(), b.len());
        std::mem::forget(b);
        ((p as u64) << 32) | n as u64
    }

    /// # Safety
    /// `ptr` and `len` are a block `deep_lottie_alloc` gave, filled with a request as [`crate::call`]
    /// frames it.
    #[no_mangle]
    pub unsafe extern "C" fn deep_lottie_call(ptr: *mut u8, len: usize) -> u64 {
        let bytes = Vec::from_raw_parts(ptr, len, len);
        give(crate::call(&bytes))
    }
}

/// The parts of a framed block: each a little-endian `u32` length, then that many bytes.
fn parts(mut b: &[u8]) -> Option<Vec<&[u8]>> {
    let mut out = Vec::new();
    while !b.is_empty() {
        let n = u32::from_le_bytes(b.get(..4)?.try_into().ok()?) as usize;
        out.push(b.get(4..4 + n)?);
        b = &b[4 + n..];
    }
    Some(out)
}

fn framed(status: u8, parts: &[&[u8]]) -> Vec<u8> {
    let mut out = vec![status];
    for p in parts {
        out.extend((p.len() as u32).to_le_bytes());
        out.extend_from_slice(p);
    }
    out
}

/// One request of the tool's WebAssembly module, its op's name then its parts framed, each part
/// raw bytes so a large file is never escaped into JSON: `import` with the params' JSON, the
/// file and the look (empty for none) answers 0 then the document, the look and the report, or
/// 1 then why it couldn't run; `check` with a document and its look answers 0 then each output
/// check's finding as JSON, `null` where it passes.
pub fn call(request: &[u8]) -> Vec<u8> {
    let Some(p) = parts(request) else {
        return framed(1, &[b"the request isn't framed"]);
    };
    match p.as_slice() {
        [b"import", params, file, look] => {
            let params: Value = serde_json::from_slice(params).unwrap_or(Value::Null);
            match import(file, &params, (!look.is_empty()).then_some(*look)) {
                Ok(i) => framed(0, &[&i.document, &i.look, &i.report]),
                Err(why) => framed(1, &[why.as_bytes()]),
            }
        }
        [b"check", document, look] => {
            let doc: Value = serde_json::from_slice(document).unwrap_or(Value::Null);
            let errors = check::document(&doc, look);
            let found = json!({
                "document": (!errors.is_empty()).then_some(errors),
                "colors_mapped": check::colors_mapped(&doc),
                "no_expression": check::no_expression(&doc),
            });
            framed(0, &[found.to_string().as_bytes()])
        }
        _ => framed(1, &[b"the request names no op: import or check"]),
    }
}
