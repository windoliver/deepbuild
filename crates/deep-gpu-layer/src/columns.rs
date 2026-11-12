//! #429's `columns` call (tests/acceptance/429/README.md, New calls): columns on a mark set and an
//! attribute on a builder's mesh, bound to a composed compute operator whose inputs read them
//! (`column: {item, name}`, `attribute: {name, domain}`; canvas primitives: Operator input), read
//! back at the rows asked; then one row of one column patched, every upload the patch made
//! reported, and the rows read again.
//!
//! A column whose type WGSL storage doesn't hold is copied into 32-bit words (Operator input:
//! Cost): u16 widened to u32, f64 narrowed to f32 by the column view's checked rule. A vec3
//! attribute is bound in place, packed at 12 bytes, and read by the core's own indexing. A patch
//! uploads the changed row's whole 4-byte word.

use std::collections::BTreeMap;

use deep_canvas::columns::narrow;
use deep_canvas_effects::graph::From;
use deep_effects_render::compile::compile_planted;
use deep_effects_render::runner::{Frame, Runner, LINEAR};
use deep_gpu::device::Device;
use serde_json::{json, Map, Value};

use crate::effects::{operator_plants, pollster_block};
use crate::{refused, App, Planted};

/// The mark set the columns sit on.
const MARKS: &str = "marks";

/// One CPU source as the GPU holds it: its operator type and its 32-bit words.
struct Source {
    /// `column` (on the mark set) or `attribute` (on the mesh).
    kind: &'static str,
    /// An attribute's domain.
    domain: String,
    ty: &'static str,
    lanes: usize,
    /// The source's own width of one value, in bytes.
    width: usize,
    words: Vec<u32>,
}

/// One value of a `ty` source as its 32-bit word, by the column view's narrowing rule; `None`
/// where the row can't narrow (it would hide, raising `column.out_of_range`).
fn word(ty: &str, v: f64) -> Option<u32> {
    match ty {
        "u16" => narrow(v, "i32", "u16")?.map(|x| x as u32),
        "f64" | "vec3" => narrow(v, "f64", "f32")?.map(|x| (x as f32).to_bits()),
        _ => None,
    }
}

fn source(kind: &'static str, name: &str, spec: &Value, rows: usize) -> Result<Source, Value> {
    let (ty, lanes, width) = match (kind, spec["type"].as_str()) {
        ("column", Some("u16")) => ("u32", 1, 2),
        ("column", Some("f64")) => ("f32", 1, 8),
        ("attribute", Some("vec3")) => ("vec3", 3, 12),
        (_, t) => {
            return Err(refused(
                "bad_input",
                format!("{kind} {name}: type {t:?} isn't u16, f64 or vec3"),
            ))
        }
    };
    let src_ty = spec["type"].as_str().unwrap_or_default();
    let values = spec["values"].as_array().cloned().unwrap_or_default();
    if values.len() != rows {
        return Err(refused(
            "bad_input",
            format!("{kind} {name} has {} rows, not {rows}", values.len()),
        ));
    }
    let mut words = Vec::with_capacity(rows * lanes);
    for (row, v) in values.iter().enumerate() {
        let lane_values: Vec<Option<f64>> = match v {
            Value::Array(a) if lanes > 1 && a.len() == lanes => {
                a.iter().map(Value::as_f64).collect()
            }
            v if lanes == 1 => vec![v.as_f64()],
            _ => vec![None],
        };
        for x in lane_values {
            match x.and_then(|x| word(src_ty, x)) {
                Some(w) => words.push(w),
                None => {
                    return Err(
                        json!({"code": "column.out_of_range", "reader": "columns", "column": name, "row": row, "value": v,
                        "reason": format!("{kind} {name} row {row} doesn't narrow to {ty}")}),
                    )
                }
            }
        }
    }
    Ok(Source {
        kind,
        domain: spec["domain"].as_str().unwrap_or_default().to_string(),
        ty,
        lanes,
        width,
        words,
    })
}

/// The composed compute operator: each source read at its element and written to `o_<name>`.
fn operator(sources: &BTreeMap<String, Source>, rows: usize) -> Value {
    let mut inputs = Map::new();
    let mut steps = Map::new();
    let mut outputs = Map::new();
    steps.insert("e".into(), json!({"op": "element@1", "args": {}}));
    for (name, s) in sources {
        let from = if s.kind == "column" {
            json!({"column": {"item": MARKS, "name": name}})
        } else {
            json!({"attribute": {"name": name, "domain": s.domain}})
        };
        inputs.insert(
            name.clone(),
            json!({"type": s.ty, "count": rows, "from": from}),
        );
        let r = format!("r_{name}");
        steps.insert(
            r.clone(),
            json!({"op": "read@1", "args": {"buf": name, "i": "e"}}),
        );
        let out = format!("o_{name}");
        let sc = if s.ty == "u32" { "u32" } else { "f32" };
        outputs.insert(
            out.clone(),
            json!({"storage": {"type": sc, "count": rows * s.lanes}}),
        );
        if s.lanes == 1 {
            steps.insert(
                format!("w_{name}"),
                json!({"op": "write@1", "args": {"buf": out, "i": "e", "v": r}}),
            );
            continue;
        }
        let base = format!("e_{name}");
        steps.insert(
            base.clone(),
            json!({"op": "mul@1", "args": {"a": "e", "b": s.lanes}}),
        );
        for (k, lane) in ["x", "y", "z", "w"].iter().take(s.lanes).enumerate() {
            let at = format!("e_{name}_{lane}");
            steps.insert(
                at.clone(),
                json!({"op": "add@1", "args": {"a": base, "b": k}}),
            );
            let v = format!("r_{name}_{lane}");
            steps.insert(
                v.clone(),
                json!({"op": "split@1", "args": {"x": r, "pick": lane}}),
            );
            steps.insert(
                format!("w_{name}_{lane}"),
                json!({"op": "write@1", "args": {"buf": out, "i": at, "v": v}}),
            );
        }
    }
    json!({"id": "columns", "kind": "compute", "origin": "composed",
        "about": "Reads mark-set columns and a mesh attribute at each element, as the GPU holds them.",
        "inputs": inputs, "steps": steps, "outputs": outputs,
        "elements": rows, "workgroup": 64, "cost": {"ns_per_element": 1000.0}})
}

/// The source an input's `from` names: a column of the mark set, or an attribute of the mesh in
/// its domain.
fn resolve<'s>(from: &From, sources: &'s BTreeMap<String, Source>) -> Option<&'s Source> {
    match from {
        From::Column { item, name } if item == MARKS => {
            sources.get(name).filter(|s| s.kind == "column")
        }
        From::Attribute { name, domain, .. } => sources
            .get(name)
            .filter(|s| s.kind == "attribute" && &s.domain == domain),
        _ => None,
    }
}

/// The operator's storage buffers, in binding order: its inputs, then its outputs.
struct Bound {
    runner: Runner,
    inputs: BTreeMap<String, wgpu::Buffer>,
    outputs: Vec<(String, wgpu::Buffer, u64)>,
}

impl Bound {
    fn new(
        device: &Device,
        compiled: deep_effects_render::compile::Compiled,
        sources: &BTreeMap<String, Source>,
    ) -> Result<Bound, String> {
        let d = &device.device;
        let mut read = Vec::new();
        for name in &compiled.checked.storage_inputs {
            let s = resolve(&compiled.checked.op.inputs[name].from, sources)
                .ok_or_else(|| format!("input {name} reads no column or attribute"))?;
            read.push((name, s));
        }
        let scope = deep_gpu::device::push_scope(d, wgpu::ErrorFilter::Validation);
        let mut inputs = BTreeMap::new();
        for (name, s) in read {
            let bytes: Vec<u8> = s.words.iter().flat_map(|w| w.to_le_bytes()).collect();
            let b = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(name),
                contents: &bytes,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            });
            inputs.insert(name.clone(), b);
        }
        let outputs = compiled
            .checked
            .op
            .storage
            .iter()
            .map(|(name, s)| {
                let size = u64::from(s.count.max(1)) * 4;
                let b = d.create_buffer(&wgpu::BufferDescriptor {
                    label: Some(name),
                    size,
                    usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
                    mapped_at_creation: false,
                });
                (name.clone(), b, size)
            })
            .collect();
        let runner = Runner::new(d, compiled, LINEAR);
        match pollster_block(scope.pop()) {
            Some(e) => Err(e.to_string()),
            None => Ok(Bound {
                runner,
                inputs,
                outputs,
            }),
        }
    }

    /// One dispatch, every output read back as words.
    fn run(&self, device: &Device) -> Result<BTreeMap<String, Vec<u32>>, String> {
        let d = &device.device;
        let c = &self.runner.compiled.checked;
        let mut bufs: Vec<&wgpu::Buffer> =
            c.storage_inputs.iter().map(|n| &self.inputs[n]).collect();
        bufs.extend(self.outputs.iter().map(|(_, b, _)| b));
        let values = deep_canvas_effects::interp::inputs(c, &BTreeMap::new(), &BTreeMap::new());
        let scope = deep_gpu::device::push_scope(d, wgpu::ErrorFilter::Validation);
        let (g0, g1, _b) = self
            .runner
            .bind(d, &Frame::default(), [1, 1], &values, &[], &bufs);
        let mut enc = d.create_command_encoder(&Default::default());
        self.runner
            .dispatch(&mut enc, c.op.elements, &(g0, g1), None);
        let backs: Vec<(String, wgpu::Buffer)> = self
            .outputs
            .iter()
            .map(|(name, b, size)| {
                let back = d.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("columns read back"),
                    size: *size,
                    usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    mapped_at_creation: false,
                });
                enc.copy_buffer_to_buffer(b, 0, &back, 0, *size);
                (name.clone(), back)
            })
            .collect();
        device.queue.submit([enc.finish()]);
        if let Some(e) = pollster_block(scope.pop()) {
            return Err(e.to_string());
        }
        for (_, back) in &backs {
            back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        }
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        let mut out = BTreeMap::new();
        for (name, back) in backs {
            let words: Vec<u32> = back
                .slice(..)
                .get_mapped_range()
                .map_err(|e| e.to_string())?
                .as_chunks::<4>()
                .0
                .iter()
                .map(|b| u32::from_le_bytes(*b))
                .collect();
            back.unmap();
            out.insert(name, words);
        }
        Ok(out)
    }
}

/// Each source's value at each of `rows`, from the operator's outputs.
fn at_rows(
    sources: &BTreeMap<String, Source>,
    out: &BTreeMap<String, Vec<u32>>,
    rows: &[usize],
) -> Value {
    let mut read = Map::new();
    for (name, s) in sources {
        let words = out.get(&format!("o_{name}")).cloned().unwrap_or_default();
        let value = |w: Option<&u32>| match w {
            None => Value::Null,
            Some(w) if s.ty == "u32" => json!(w),
            Some(w) => json!(f64::from(f32::from_bits(*w))),
        };
        let list: Vec<Value> = rows
            .iter()
            .map(|&r| {
                if s.lanes == 1 {
                    value(words.get(r))
                } else {
                    Value::Array(
                        (0..s.lanes)
                            .map(|k| value(words.get(r * s.lanes + k)))
                            .collect(),
                    )
                }
            })
            .collect();
        read.insert(name.clone(), Value::Array(list));
    }
    Value::Object(read)
}

/// The uploads a patch of `row` to `word` makes: its whole 4-byte word; the planted programs
/// write the row's own bytes alone, or re-copy the whole column.
fn uploads(planted: Option<Planted>, s: &Source, row: usize, word: u32) -> Vec<(u64, Vec<u8>)> {
    match planted {
        Some(Planted::PartialUpdate2Bytes) => {
            vec![(
                (row * 4) as u64,
                word.to_le_bytes()[..s.width.min(4)].to_vec(),
            )]
        }
        Some(Planted::RecopiesWholeColumn) => {
            let mut words = s.words.clone();
            words[row] = word;
            vec![(0, words.iter().flat_map(|w| w.to_le_bytes()).collect())]
        }
        _ => vec![((row * 4) as u64, word.to_le_bytes().to_vec())],
    }
}

pub fn call(app: &mut App, call: &Value) -> Value {
    let columns = call["columns"].as_object().cloned().unwrap_or_default();
    let attributes = call["attributes"].as_object().cloned().unwrap_or_default();
    let rows: Vec<usize> = call["rows"]
        .as_array()
        .map(|r| {
            r.iter()
                .filter_map(Value::as_u64)
                .map(|r| r as usize)
                .collect()
        })
        .unwrap_or_default();
    let n = columns
        .values()
        .chain(attributes.values())
        .filter_map(|c| c["values"].as_array().map(Vec::len))
        .max()
        .unwrap_or(0);
    if n == 0 {
        return refused(
            "bad_input",
            "columns takes columns or attributes with values",
        );
    }
    // The mark set's columns and the mesh's attributes, as the GPU holds them.
    let mut sources = BTreeMap::new();
    for (kind, set) in [("column", &columns), ("attribute", &attributes)] {
        for (name, spec) in set {
            match source(kind, name, spec, n) {
                Ok(s) => {
                    sources.insert(name.clone(), s);
                }
                Err(e) => return e,
            }
        }
    }
    let graph = operator(&sources, n);
    let (mut options, check) = operator_plants(app.planted);
    options.attribute_stride_16 = app.planted == Some(Planted::AttributeStride16);
    let compiled = match compile_planted(&graph, &BTreeMap::new(), options, check) {
        Ok(c) => c,
        Err(e) => {
            let issues: Vec<Value> = e.iter().map(|i| json!({"code": i.code, "step": i.step, "path": i.path, "message": i.message})).collect();
            return json!({"code": "operator_refused", "issues": issues});
        }
    };
    let patch = &call["patch"];
    let column = patch["column"].as_str().unwrap_or_default().to_string();
    let row = patch["row"].as_u64().unwrap_or(0) as usize;
    let Some(s) = sources.get(&column).filter(|s| s.kind == "column") else {
        return refused("bad_input", format!("the patch names no column {column:?}"));
    };
    if row >= n {
        return refused("bad_input", format!("the patch row {row} is past {n} rows"));
    }
    let src_ty = columns[&column]["type"].as_str().unwrap_or_default();
    let Some(new_word) = patch["value"].as_f64().and_then(|v| word(src_ty, v)) else {
        return json!({"code": "column.out_of_range", "reader": "columns", "column": column, "row": row, "value": patch["value"]});
    };
    let ups = uploads(app.planted, s, row, new_word);
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let bound = match Bound::new(&device, compiled, &sources) {
            Ok(b) => b,
            Err(e) => return refused("operator_compile", e),
        };
        let before = match bound.run(&device) {
            Ok(o) => at_rows(&sources, &o, &rows),
            Err(e) => return refused("no_read_back", e),
        };
        let mut reported = Vec::new();
        for (offset, bytes) in &ups {
            let scope = deep_gpu::device::push_scope(&device.device, wgpu::ErrorFilter::Validation);
            device.queue.write_buffer(&bound.inputs[&column], *offset, bytes);
            let mut u = json!({"column": column, "offset": offset, "bytes": bytes.len(), "outcome": "written"});
            if let Some(e) = pollster_block(scope.pop()) {
                u["outcome"] = json!("refused");
                u["error"] = json!(e.to_string());
            }
            reported.push(u);
        }
        let after = match bound.run(&device) {
            Ok(o) => at_rows(&sources, &o, &rows),
            Err(e) => return refused("no_read_back", e),
        };
        json!({"read": before, "patch": {"uploads": reported, "read": after}})
    })
}
