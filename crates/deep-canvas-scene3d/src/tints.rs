//! #537: a terrain plate's overlays (canvas primitives: Builder plate: terrain overlays). Up to
//! two on a `plate@1` with `terrain`, each reading a logic item's i32 array of cols × rows values,
//! row-major, as the logic module gives it at t: the core's column view folds the array's baked
//! steps ([`deep_canvas::columns::map`]), pure in t, so seeking equals playing. A ground point
//! (x, z) of the plate's own space lies in cell (⌊(x − origin.x) ÷ cell⌋, ⌊(z − origin.z) ÷
//! cell⌋), whose value indexes a look role, or `none`, that the cover's base color mixes toward
//! by `opacity` before lighting. `overlays` is a shading-class param, so no overlay or array value
//! reaches the plate's heights, mesh, collision or content key. One reader serves the check
//! ([`check`], issues with what they refused) and the frame ([`tints`], a refusal), so the two
//! never disagree.

use std::collections::BTreeSet;

use deep_canvas::document::{Issue, STATUS_ROLE};
use serde_json::{json, Map, Value};

use crate::look::Look3;
use crate::scene::Refused;

/// The most overlays a plate holds.
pub const MAX_OVERLAYS: usize = 2;
/// The most roles an overlay indexes.
pub const MAX_ROLES: usize = 16;
/// A cell's byte where its value indexes no role: past `roles`, or a row the view hides.
pub const UNTINTED: u8 = 255;
/// The warning a value past an overlay's roles raises, at the step its excursion begins.
pub const RANGE: &str = "terrain.overlay_range";
const FIX: &str = "Write values that index the overlay's roles, or add the roles they index.";
/// An overlay's fields.
const KEYS: [&str; 6] = ["grid", "size", "origin", "cell", "roles", "opacity"];

/// One overlay of a plate at a frame's t, as the renderer uploads it.
#[derive(Clone, Debug, PartialEq)]
pub struct Tint {
    /// The plate's item ID, which its solid carries.
    pub plate: String,
    /// Its place in the plate's `overlays`: the second applies over the first.
    pub layer: usize,
    /// The logic step whose values these are.
    pub step: i64,
    /// Cols and rows.
    pub size: [u32; 2],
    /// Its corner and its cell's side in the plate's own space, m.
    pub origin: [f64; 2],
    pub cell: f64,
    pub opacity: f64,
    /// Each role's sRGB color; `None` for `none`.
    pub roles: Vec<Option<[u8; 3]>>,
    /// One byte a cell, row-major (`cells[z · cols + x]`): the role its value indexes, or
    /// [`UNTINTED`].
    pub cells: Vec<u8>,
}

impl Tint {
    /// What the renderer keeps its cells by: `<plate>/<layer>`.
    pub fn key(&self) -> String {
        format!("{}/{}", self.plate, self.layer)
    }
}

/// One overlay as read from its plate, with the baked array its grid names.
struct Overlay<'a> {
    grid: &'a str,
    array: &'a Value,
    size: [usize; 2],
    origin: [f64; 2],
    cell: f64,
    roles: Vec<Option<&'a str>>,
    opacity: f64,
}

/// A refusal: its code, its path and what it refused there.
struct Fault {
    code: &'static str,
    path: String,
    actual: Value,
}

fn out_of_range(path: String, actual: &Value) -> Fault {
    Fault {
        code: "out_of_range",
        path,
        actual: actual.clone(),
    }
}

/// Every `plate@1` of a document's `items` with its ID and params.
fn plates<'a>(items: Option<&'a Value>) -> impl Iterator<Item = (&'a String, &'a Value)> + 'a {
    items
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("plate@1"))
        .map(|(id, i)| (id, i.get("params").unwrap_or(&Value::Null)))
}

/// Each overlay of the plate `id` (its `params`), its grid read from `arrays` (the document's,
/// which the host bakes); or the first refusal. A role resolves in the look the frame draws in,
/// where one the look lacks tints nothing; a status role is refused here.
fn read<'a>(id: &str, params: &'a Value, arrays: &'a Value) -> Result<Vec<Overlay<'a>>, Fault> {
    let at = format!("items/{id}/params/overlays");
    let list = match params.get("overlays") {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(list)) => list,
        Some(v) => return Err(out_of_range(at, v)),
    };
    if list.is_empty() {
        return Ok(Vec::new());
    }
    if list.len() > MAX_OVERLAYS {
        return Err(out_of_range(
            format!("{at}/{MAX_OVERLAYS}"),
            &list[MAX_OVERLAYS],
        ));
    }
    // Overlays tint a terrain plate's cover alone.
    let Some(t) = crate::terrain::of_params(params) else {
        return Err(out_of_range(at, &params["overlays"]));
    };
    let (size, _) =
        crate::terrain::grid(t, false).map_err(|p| out_of_range(format!("items/{id}/{p}"), t))?;
    let corner = [-size[0] / 2.0, -size[1] / 2.0];
    let spacing = t.get("spacing").and_then(Value::as_f64).unwrap_or(1.0);
    list.iter()
        .enumerate()
        .map(|(k, o)| overlay(&format!("{at}/{k}"), o, (corner, spacing), arrays))
        .collect()
}

fn overlay<'a>(
    at: &str,
    o: &'a Value,
    (corner, spacing): ([f64; 2], f64),
    arrays: &'a Value,
) -> Result<Overlay<'a>, Fault> {
    let Some(fields) = o.as_object() else {
        return Err(out_of_range(at.into(), o));
    };
    if let Some((k, v)) = fields.iter().find(|(k, _)| !KEYS.contains(&k.as_str())) {
        return Err(out_of_range(format!("{at}/{k}"), v));
    }
    let field = |k: &str| fields.get(k).filter(|v| !v.is_null());
    let bad = |k: &str| out_of_range(format!("{at}/{k}"), field(k).unwrap_or(&Value::Null));
    let pair = |k: &str| -> Option<[f64; 2]> {
        let a = field(k)?.as_array().filter(|a| a.len() == 2)?;
        Some([a[0].as_f64()?, a[1].as_f64()?]).filter(|p| p.iter().all(|x| x.is_finite()))
    };
    let side = |v: &Value| {
        v.as_u64()
            .filter(|n| (1..=u64::from(u16::MAX)).contains(n))
            .map(|n| n as usize)
    };
    let size = field("size")
        .and_then(Value::as_array)
        .filter(|a| a.len() == 2)
        .and_then(|a| Some([side(&a[0])?, side(&a[1])?]))
        .ok_or_else(|| bad("size"))?;
    let origin = match field("origin") {
        None => corner,
        Some(_) => pair("origin").ok_or_else(|| bad("origin"))?,
    };
    let positive = |k: &str, d: f64| match field(k) {
        None => Ok(d),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x > 0.0)
            .ok_or_else(|| bad(k)),
    };
    let cell = positive("cell", spacing)?;
    let opacity = match field("opacity") {
        None => 1.0,
        Some(v) => v
            .as_f64()
            .filter(|x| (0.0..=1.0).contains(x))
            .ok_or_else(|| bad("opacity"))?,
    };
    let listed = field("roles")
        .and_then(Value::as_array)
        .filter(|l| l.len() <= MAX_ROLES)
        .ok_or_else(|| bad("roles"))?;
    let mut roles = Vec::with_capacity(listed.len());
    for (j, r) in listed.iter().enumerate() {
        let path = format!("{at}/roles/{j}");
        let refuse = |code| Fault {
            code,
            path: path.clone(),
            actual: r.clone(),
        };
        match r.as_str() {
            Some("none") => roles.push(None),
            Some(role) if role.starts_with(STATUS_ROLE) => {
                return Err(refuse("status_color_unbound"))
            }
            Some(role) => roles.push(Some(role)),
            None => return Err(refuse("out_of_range")),
        }
    }
    let grid = field("grid")
        .and_then(Value::as_str)
        .ok_or_else(|| bad("grid"))?;
    let Some(array) = arrays.get(grid) else {
        return Err(Fault {
            code: "ref_unresolved",
            path: format!("{at}/grid"),
            actual: json!(grid),
        });
    };
    let ty = array["type"].as_str().unwrap_or_default();
    if ty != "i32" {
        return Err(Fault {
            code: "bad_column",
            path: format!("{at}/grid"),
            actual: json!({"array": grid, "type": ty}),
        });
    }
    let count = array["count"].as_u64().unwrap_or(0);
    if count != (size[0] * size[1]) as u64 {
        return Err(Fault {
            code: "out_of_range",
            path: format!("{at}/size"),
            actual: json!({"array": grid, "count": count, "size": size}),
        });
    }
    Ok(Overlay {
        grid,
        array,
        size,
        origin,
        cell,
        roles,
        opacity,
    })
}

/// What a refusal says, by its code.
fn what(code: &str) -> &'static str {
    match code {
        "status_color_unbound" => {
            "an overlay's role is a status color, which only a status binding reaches"
        }
        "ref_unresolved" => "an overlay names an array no logic item writes",
        "bad_column" => "an overlay's grid reads an array that isn't i32",
        _ => "a terrain plate holds at most two overlays, each with a grid of cols × rows values",
    }
}

/// Every step at which a cell of `o` begins to index none of its roles, with its row and value,
/// by the baked steps alone: every cell at step 0 (before which each is 0), then the cells each
/// later step wrote.
fn excursions(o: &Overlay<'_>) -> Vec<(i64, usize, f64)> {
    let n = o.size[0] * o.size[1];
    let roles = o.roles.len() as f64;
    let mut raw = vec![0.0; n];
    let mut past = vec![false; n];
    let mut out = Vec::new();
    let steps = o.array["steps"].as_array().map_or(&[][..], Vec::as_slice);
    let mut checks: Vec<(i64, Option<&Value>)> = Vec::new();
    if steps.first().and_then(|s| s["step"].as_i64()) != Some(0) {
        checks.push((0, None));
    }
    checks.extend(
        steps
            .iter()
            .map(|s| (s["step"].as_i64().unwrap_or(0), Some(s))),
    );
    for (step, s) in checks {
        let mut touched = BTreeSet::new();
        for run in s.and_then(|s| s["values"].as_array()).into_iter().flatten() {
            let start = run[0].as_u64().unwrap_or(0) as usize;
            for (j, v) in run[1].as_array().into_iter().flatten().enumerate() {
                if start + j < n {
                    raw[start + j] = v.as_f64().unwrap_or(f64::NAN);
                    touched.insert(start + j);
                }
            }
        }
        let rows: Vec<usize> = if step == 0 {
            (0..n).collect()
        } else {
            touched.into_iter().collect()
        };
        for row in rows {
            let v = raw[row];
            let is_past = !(v >= 0.0 && v < roles);
            if is_past && !past[row] {
                out.push((step, row, v));
            }
            past[row] = is_past;
        }
    }
    out
}

/// `terrain.overlay_range` for the cell at `row` of overlay `k` of the plate `id`.
fn range(id: &str, k: usize, o: &Overlay<'_>, (step, row, value): (i64, usize, f64)) -> Issue {
    let cell = [row % o.size[0], row / o.size[0]];
    let mut issue = Issue::error(
        RANGE,
        id,
        format!("items/{id}/params/overlays/{k}/grid"),
        json!({"array": o.grid, "cell": cell, "value": value as i64, "step": step}),
        "a cell's value indexes none of the overlay's roles; it tints nothing while it lasts",
    );
    issue.severity = "warning";
    issue.fix = FIX.into();
    issue
}

/// The check over `form`'s terrain overlays, its arrays baked into its `arrays`: each plate's
/// first refusal, and every `terrain.overlay_range` its arrays raise, each at the step its
/// excursion begins.
pub fn check(form: &Value) -> Vec<Issue> {
    let mut out = Vec::new();
    for (id, params) in plates(form.get("items")) {
        match read(id, params, &form["arrays"]) {
            Err(f) => out.push(Issue::error(f.code, id, f.path, f.actual, what(f.code))),
            Ok(list) => {
                for (k, o) in list.iter().enumerate() {
                    out.extend(excursions(o).into_iter().map(|e| range(id, k, o, e)));
                }
            }
        }
    }
    out
}

/// The `terrain.overlay_range` issues a frame at `t` of `form` raises: each cell whose excursion
/// past its overlay's roles begins at the frame's step.
pub fn raised_at(form: &Value, t: i64) -> Vec<Issue> {
    let mut out = Vec::new();
    for (id, params) in plates(form.get("items")) {
        let Ok(list) = read(id, params, &form["arrays"]) else {
            continue;
        };
        for (k, o) in list.iter().enumerate() {
            let step = t.div_euclid(o.array["every"].as_i64().unwrap_or(1).max(1));
            let begun = excursions(o).into_iter().filter(|e| e.0 == step);
            out.extend(begun.map(|e| range(id, k, o, e)));
        }
    }
    out
}

/// Every terrain overlay of the document `map` at `t` (flicks) under `look`, in item order and
/// each plate's overlays in order; refused as the check refuses it.
pub fn tints(map: &Map<String, Value>, look: &Look3, t: i64) -> Result<Vec<Tint>, Refused> {
    let arrays = map.get("arrays").unwrap_or(&Value::Null);
    let mut out = Vec::new();
    for (id, params) in plates(map.get("items")) {
        let list = read(id, params, arrays).map_err(|f| Refused {
            code: f.code,
            path: f.path,
        })?;
        for (k, o) in list.into_iter().enumerate() {
            let m = deep_canvas::columns::map(o.array, t, None, false).ok_or_else(|| Refused {
                code: "bad_column",
                path: format!("items/{id}/params/overlays/{k}/grid"),
            })?;
            let n = o.roles.len() as f64;
            let cells = m
                .values
                .iter()
                .zip(&m.hidden)
                .map(|(&v, &hidden)| {
                    if !hidden && v >= 0.0 && v < n {
                        v as u8
                    } else {
                        UNTINTED
                    }
                })
                .collect();
            out.push(Tint {
                plate: id.clone(),
                layer: k,
                step: m.step,
                size: [o.size[0] as u32, o.size[1] as u32],
                origin: o.origin,
                cell: o.cell,
                opacity: o.opacity,
                roles: o
                    .roles
                    .iter()
                    .map(|r| r.and_then(|r| look.role(r)))
                    .collect(),
                cells,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    const FOG: [u8; 3] = [200, 204, 214];
    const DIM: [u8; 3] = [60, 64, 80];

    fn look() -> Look3 {
        Look3::from_roles(BTreeMap::from([("fog".into(), FOG), ("dim".into(), DIM)]))
    }

    /// An i32 array of `count` values stepping every 10 flicks.
    fn array(count: usize, steps: Value) -> Value {
        json!({"type": "i32", "count": count, "every": 10, "linear": false, "steps": steps})
    }

    /// A 4 × 2 m terrain plate at 1 m spacing with `overlays` over `rules.fog`.
    fn doc(overlays: Value, fog: Value) -> Value {
        json!({
            "items": {"ground": {"kind": "plate@1", "params": {
                "terrain": {"height": 0, "size": [4, 2]}, "overlays": overlays}}},
            "arrays": {"rules.fog": fog},
        })
    }

    fn fog() -> Value {
        json!({"grid": "rules.fog", "size": [4, 2], "roles": ["fog", "dim", "none"]})
    }

    fn zeros() -> Value {
        array(8, json!([]))
    }

    fn errors(form: &Value) -> Vec<(&'static str, String, Value)> {
        check(form)
            .into_iter()
            .filter(|i| i.severity == "error")
            .map(|i| (i.code, i.path, i.actual))
            .collect()
    }

    /// Each rule of the overlays' check, at check and at the frame alike: dropping any one of
    /// them admits its document.
    #[test]
    fn each_refusal_names_its_code_and_path_at_check_and_at_the_frame() {
        let at = "items/ground/params/overlays";
        let with = |key: &str, v: Value| {
            let mut o = fog();
            o[key] = v;
            doc(json!([o]), zeros())
        };
        let mut bare = doc(json!([fog()]), zeros());
        bare["items"]["ground"]["params"]
            .as_object_mut()
            .unwrap()
            .remove("terrain");
        let f64_array =
            json!({"type": "f64", "count": 8, "every": 10, "linear": false, "steps": []});
        let cases: Vec<(Value, &str, String)> = vec![
            (doc(json!("fog"), zeros()), "out_of_range", at.into()),
            (
                doc(json!([fog(), fog(), fog()]), zeros()),
                "out_of_range",
                format!("{at}/2"),
            ),
            (bare, "out_of_range", at.into()),
            (
                with("blend", json!("mix")),
                "out_of_range",
                format!("{at}/0/blend"),
            ),
            (
                with("size", json!([0, 2])),
                "out_of_range",
                format!("{at}/0/size"),
            ),
            (
                with("size", json!([4, 70_000])),
                "out_of_range",
                format!("{at}/0/size"),
            ),
            (
                with("origin", json!([1])),
                "out_of_range",
                format!("{at}/0/origin"),
            ),
            (
                with("cell", json!(0)),
                "out_of_range",
                format!("{at}/0/cell"),
            ),
            (
                with("opacity", json!(1.5)),
                "out_of_range",
                format!("{at}/0/opacity"),
            ),
            (
                with("roles", json!(vec!["fog"; 17])),
                "out_of_range",
                format!("{at}/0/roles"),
            ),
            (
                with("roles", json!(["fog", "status.fail"])),
                "status_color_unbound",
                format!("{at}/0/roles/1"),
            ),
            (
                with("grid", json!("rules.gone")),
                "ref_unresolved",
                format!("{at}/0/grid"),
            ),
            (
                doc(json!([fog()]), f64_array),
                "bad_column",
                format!("{at}/0/grid"),
            ),
            (
                with("size", json!([3, 2])),
                "out_of_range",
                format!("{at}/0/size"),
            ),
        ];
        assert!(errors(&doc(json!([fog(), fog()]), zeros())).is_empty());
        assert!(tints(
            doc(json!([fog()]), zeros()).as_object().unwrap(),
            &look(),
            0
        )
        .is_ok());
        for (form, code, path) in cases {
            let got = errors(&form);
            assert_eq!(
                got.iter()
                    .map(|(c, p, _)| (*c, p.clone()))
                    .collect::<Vec<_>>(),
                vec![(code, path.clone())],
                "{form}"
            );
            let refused = tints(form.as_object().unwrap(), &look(), 0).expect_err("refused");
            assert_eq!((refused.code, refused.path), (code, path));
        }
        // A count other than cols × rows names both.
        let got = errors(&with("size", json!([3, 2])));
        assert_eq!(
            got[0].2,
            json!({"array": "rules.fog", "count": 8, "size": [3, 2]})
        );
    }

    /// `overlays` is a shading-class param: the plate's geometry params and its built mesh are
    /// the same with and without them.
    #[test]
    fn overlays_rebuild_nothing() {
        let with = doc(json!([fog(), fog()]), zeros());
        let mut without = with.clone();
        without["items"]["ground"]["params"]
            .as_object_mut()
            .unwrap()
            .remove("overlays");
        let (a, b) = (&with["items"]["ground"], &without["items"]["ground"]);
        let geometry = |item| crate::spec::params_of(item, "plate@1", true, None);
        let shading = |item| crate::spec::params_of(item, "plate@1", false, None);
        assert_eq!(geometry(a), geometry(b));
        assert_ne!(shading(a), shading(b));
        let run = crate::stack::Run::default();
        let built = |d: &Value, item| crate::build::built(d, "ground", item, &run, 0.0).unwrap();
        assert_eq!(built(&with, a), built(&without, b));
    }

    /// A 3 × 2 grid read row-major: a value indexes its role's byte, a value past the roles or
    /// below 0 none; the default origin is the plate's corner and the default cell its spacing.
    #[test]
    fn cells_read_row_major_one_byte_each() {
        let mut form = doc(
            json!([{"grid": "rules.fog", "size": [3, 2], "roles": ["fog", "dim", "none"], "opacity": 0.5}]),
            array(
                6,
                json!([{"step": 0, "changed": [[0, 6]], "values": [[0, [0, 1, 2, 3, -1, 1]]]},
                       {"step": 2, "changed": [[4, 5]], "values": [[4, [2]]]}]),
            ),
        );
        form["items"]["ground"]["params"]["terrain"] = json!({"height": 0, "size": [3, 2]});
        let at = |t| tints(form.as_object().unwrap(), &look(), t).unwrap();
        let first = at(15);
        assert_eq!(
            first,
            vec![Tint {
                plate: "ground".into(),
                layer: 0,
                step: 1,
                size: [3, 2],
                origin: [-1.5, -1.0],
                cell: 1.0,
                opacity: 0.5,
                roles: vec![Some(FOG), Some(DIM), None],
                cells: vec![0, 1, 2, UNTINTED, UNTINTED, 1],
            }]
        );
        assert_eq!(first[0].key(), "ground/0");
        let later = at(20);
        assert_eq!(
            (later[0].step, later[0].cells.clone()),
            (2, vec![0, 1, 2, UNTINTED, 2, 1])
        );
    }

    /// A cell whose value leaves the roles at step 3, changes while out, returns at step 6 and
    /// leaves again at step 8 raises `terrain.overlay_range` at steps 3 and 8 alone, naming the
    /// array, the cell, the value and the step.
    #[test]
    fn an_excursion_raises_once_at_its_first_step() {
        let mut form = doc(
            json!([{"grid": "rules.fog", "size": [2, 2], "roles": ["fog", "dim", "none"]}]),
            array(
                4,
                json!([{"step": 3, "changed": [[3, 4]], "values": [[3, [5]]]},
                       {"step": 4, "changed": [[2, 4]], "values": [[2, [1, 7]]]},
                       {"step": 6, "changed": [[3, 4]], "values": [[3, [0]]]},
                       {"step": 8, "changed": [[3, 4]], "values": [[3, [9]]]}]),
            ),
        );
        form["items"]["ground"]["params"]["terrain"] = json!({"height": 0, "size": [2, 2]});
        let warned: Vec<Value> = check(&form)
            .iter()
            .map(|i| {
                assert_eq!((i.code, i.severity), (RANGE, "warning"));
                let j = i.to_json();
                json!([j["path"], j["array"], j["cell"], j["value"], j["step"]])
            })
            .collect();
        let grid = "items/ground/params/overlays/0/grid";
        assert_eq!(
            warned,
            vec![
                json!([grid, "rules.fog", [1, 1], 5, 3]),
                json!([grid, "rules.fog", [1, 1], 9, 8])
            ]
        );
        let steps: Vec<Vec<i64>> = [30, 35, 40, 60, 80, 89]
            .iter()
            .map(|t| {
                raised_at(&form, *t)
                    .iter()
                    .map(|i| i.actual["step"].as_i64().unwrap())
                    .collect()
            })
            .collect();
        assert_eq!(
            steps,
            vec![vec![3], vec![3], vec![], vec![], vec![8], vec![8]]
        );
    }
}
