use std::time::Instant;

use deep_canvas::registry::Sealed;
use deep_canvas_sandbox::layouts;
use deep_canvas_sandbox::rewrite::hash;
use deep_sandbox_wasmtime::service::{provider_budget, refusals_json, trap_json, Offsets};
use serde_json::{json, Map, Value};

use super::mesh::decode_mesh;
use super::providers;
use super::{asset, decode_data, out_bytes, refusals_what, Host, Made, DEADLINE};

impl Host {
    pub(super) fn make(
        &mut self,
        sealed: &Sealed,
        manifest: &Value,
        spec: &Value,
        given: &Map<String, Value>,
        seed: i64,
        mesh_in: &[Vec<u8>],
    ) -> Made {
        let mut started = None;
        let (trap, mut out) =
            self.make_in(sealed, manifest, spec, given, seed, mesh_in, &mut started);
        let shading = out
            .as_object_mut()
            .and_then(|o| o.remove("shading"))
            .or_else(|| trap.get("shading").cloned())
            .unwrap_or(Value::Null);
        Made {
            ms: started.map_or(0.0, |t: Instant| t.elapsed().as_secs_f64() * 1000.0),
            out: if trap.is_null() { out } else { Value::Null },
            trap,
            shading,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn make_in(
        &mut self,
        sealed: &Sealed,
        manifest: &Value,
        spec: &Value,
        given: &Map<String, Value>,
        seed: i64,
        mesh_in: &[Vec<u8>],
        started: &mut Option<Instant>,
    ) -> (Value, Value) {
        let failed = |kind: &str, what: String| (json!({"kind": kind, "what": what}), Value::Null);
        let sha = spec["program"].as_str().unwrap_or_default();
        let Some(bytes) = asset(manifest, sha) else {
            return failed(
                "asset",
                format!("the program `{sha}` is none of the pack's assets"),
            );
        };
        let budget = match provider_budget(spec.get("budget")) {
            Ok(b) => b,
            Err((field, why)) => return failed("budget", format!("{field}: {why}")),
        };
        let (sha, bytes) = match spec["links"].as_array().filter(|l| !l.is_empty()) {
            None => (sha.to_string(), bytes),
            Some(links) => {
                let mut libs = Vec::new();
                for l in links {
                    let name = l["name"].as_str().unwrap_or_default();
                    let lib = l["asset"].as_str().and_then(|a| asset(manifest, a));
                    let exports: Vec<String> = manifest
                        .pointer(&format!("/libs/{name}/exports"))
                        .and_then(Value::as_array)
                        .map(|e| {
                            e.iter()
                                .filter_map(Value::as_str)
                                .map(String::from)
                                .collect()
                        })
                        .unwrap_or_default();
                    match lib {
                        Some(b) => libs.push((
                            name.split_once('@').map_or(name, |(n, _)| n).to_string(),
                            name.to_string(),
                            b,
                            exports,
                        )),
                        None => {
                            return (
                                json!({"kind": "refused", "library": name, "what": format!("{name} is none of the pack's assets")}),
                                Value::Null,
                            )
                        }
                    }
                }
                let objects: Vec<deep_canvas_sandbox::link::Object> = libs
                    .iter()
                    .map(|(n, l, b, e)| deep_canvas_sandbox::link::Object {
                        name: n,
                        label: l,
                        bytes: b,
                        exports: e,
                        implements: &[],
                    })
                    .collect();
                match deep_canvas_sandbox::link::link(&bytes, &objects, false) {
                    Ok(linked) => (hash(&linked.bytes), linked.bytes),
                    Err(r) => {
                        return (
                            json!({"kind": "refused", "what": refusals_what(&r), "refusals": refusals_json(&r)}),
                            Value::Null,
                        )
                    }
                }
            }
        };
        let sha = sha.as_str();
        let rw = match self.rewrite_in(sha, &bytes, "provider", &budget) {
            Ok(rw) => rw,
            Err(r) => {
                let pages = budget.memory / 65_536;
                let kind = match r.iter().all(|r| {
                    r.limit
                        .as_ref()
                        .is_some_and(|l| l.name == "memory" && l.max == Some(pages))
                        && r.what.contains("past the memory budget")
                }) {
                    true => "memory",
                    false => "refused",
                };
                return (
                    json!({"kind": kind, "what": refusals_what(&r), "refusals": refusals_json(&r)}),
                    Value::Null,
                );
            }
        };
        *started = Some(Instant::now());
        let schema = spec["params"].as_object().cloned().unwrap_or_default();
        let params = match deep_sandbox_wasmtime::service::param_bytes(&schema, given) {
            Ok(p) => p,
            Err(p) => return failed("param", format!("param `{p}` is not a constant number")),
        };
        let mut inputs = Vec::new();
        for a in spec["assets"].as_array().into_iter().flatten() {
            let a = a.as_str().unwrap_or_default();
            match asset(manifest, a) {
                Some(b) => inputs.push(b),
                None => {
                    return failed(
                        "asset",
                        format!("the asset `{a}` is none of the pack's assets"),
                    )
                }
            }
        }
        inputs.extend(mesh_in.iter().cloned());
        let assets = deep_sandbox_wasmtime::service::asset_bytes(&inputs);
        self.runs += 1;
        let ran = match self.sandbox.run_with(
            &rw.bytes,
            "provider",
            seed,
            &budget,
            &[],
            &[],
            &[("params_at", &params), ("assets_at", &assets)],
            DEADLINE,
            Offsets::Written,
        ) {
            Ok(r) => r,
            Err(e) => return failed("run", e),
        };
        if let Some(t) = &ran.trap {
            return (trap_json(&Some(t.clone())), Value::Null);
        }
        if let Some(out) = spec.pointer("/out/mesh") {
            let mesh = match decode_mesh(&ran, out) {
                Ok(m) => m,
                Err(e) => return failed("over_cap", e),
            };
            let (defects, open) = providers::shading(&mesh);
            if out["closed"] == json!(true) {
                if let Some(edge) = open {
                    return (
                        json!({"kind": "open_edge", "edge": edge, "shading": defects,
                               "what": format!("the mesh is declared closed, but its welded edge {edge} doesn't join exactly two faces")}),
                        Value::Null,
                    );
                }
            }
            let mut mesh = mesh;
            let len = 8
                + 32 * mesh["positions"].as_array().map_or(0, Vec::len) as u64
                + 4 * mesh["indices"].as_array().map_or(0, Vec::len) as u64;
            if let Ok(sha) = out_bytes(&ran, len).and_then(|b| self.put(&b)) {
                mesh["sha256"] = json!(sha);
            }
            return (Value::Null, json!({"mesh": mesh, "shading": defects}));
        }
        if let Some(out) = spec.pointer("/out/rows") {
            let at = ran.out_at.unwrap_or(0) as usize;
            return match providers::decode_rows(&ran.memory, at, out) {
                Ok(rows) => (Value::Null, json!({"rows": rows})),
                Err(e) => failed("over_cap", e),
            };
        }
        let (layout, bytes) = match (spec.pointer("/out/data"), spec.pointer("/out/pages")) {
            (Some(d), _) => {
                let cap = d
                    .get("max_bytes")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(16 << 20);
                match decode_data(&ran, cap) {
                    Ok(b) => (
                        d.get("layout")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        b,
                    ),
                    Err(e) => return failed("over_cap", e),
                }
            }
            (None, Some(p)) => {
                let count = p
                    .get("count")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(layouts::PAGES_CAP);
                match out_bytes(&ran, 12 + count * (4 + layouts::PAGE)) {
                    Ok(b) => {
                        let first = p.get("first").and_then(Value::as_u64).unwrap_or(0);
                        let n = b.get(8..12).map_or(0, |h| {
                            u32::from_le_bytes(h.try_into().expect("4 bytes")) as u64
                        });
                        let outside = (0..n.min(count)).find_map(|i| {
                            let at = (12 + i * (4 + layouts::PAGE)) as usize;
                            let page =
                                u64::from(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?));
                            (!(first..first + count).contains(&page)).then_some(page)
                        });
                        if let Some(page) = outside {
                            return failed(
                                "out",
                                format!(
                                    "page {page} is outside its range, {first} to {}",
                                    first + count
                                ),
                            );
                        }
                        ("pages@1".to_string(), b)
                    }
                    Err(e) => return failed("over_cap", e),
                }
            }
            _ => {
                return failed(
                    "out",
                    "a provider writes a mesh, a data asset or pages".into(),
                )
            }
        };
        let v = self.validate_bytes(sealed, &layout, &bytes);
        if v["outcome"] == "admitted" {
            let _ = self.put(&bytes);
            return (
                Value::Null,
                json!({"data": {"layout": layout, "asset": v["asset"], "size": v["size"]}}),
            );
        }
        let kind = v["code"].as_str().unwrap_or("layout_refused").to_string();
        (
            json!({"kind": kind, "layout": layout, "asset": v["asset"], "offset": v["offset"],
                "field": v["field"], "trap": v["trap"]}),
            Value::Null,
        )
    }
}
