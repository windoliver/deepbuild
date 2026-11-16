use super::*;

/// [`evaluate_sourced`] with or without an asset store (#226: the scheduler's lights read a
/// module's deforms and kinds too).
pub fn evaluate_any(
    doc: &Value,
    t: i64,
    look: &Look3,
    labels: &mut Labels,
    assets: Option<Assets<'_>>,
    outlines: Outlines<'_>,
) -> Result<Scene, Refused> {
    let Some(map) = doc.as_object() else {
        return refused("out_of_range", "");
    };
    // #506: an item a view-class control's value hides (Control: `binds` on its `visible`, as
    // the core's draw reads it), such as a card its close button closed.
    let unbound = bound_hidden(map);
    let map = unbound.as_ref().unwrap_or(map);
    // #166: a wake behind an item a logic array moves, refused at check before anything else.
    crate::water::logic_moved(map)?;
    // #268: a shore item that anything moves or reshapes, refused at check.
    crate::shore::static_items(map)?;
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    evaluate_compiled(doc, &program, t, look, labels, assets, outlines)
}

/// The document with each item hidden that a view-class control bound to its `visible` holds
/// off (#506); `None` when no such control is off.
pub(super) fn bound_hidden(map: &Map<String, Value>) -> Option<Map<String, Value>> {
    let hidden: Vec<String> = map
        .get("controls")
        .and_then(Value::as_object)?
        .values()
        .filter(|c| c.get("class").and_then(Value::as_str) == Some("view"))
        .filter(|c| c.get("default") == Some(&Value::Bool(false)))
        .flat_map(|c| {
            c.get("binds")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|b| b.as_str()?.strip_prefix("items/")?.strip_suffix("/visible"))
        .map(str::to_string)
        .collect();
    if hidden.is_empty() {
        return None;
    }
    let mut out = map.clone();
    let items = out.get_mut("items").and_then(Value::as_object_mut)?;
    for id in hidden {
        if let Some(item) = items.get_mut(&id).and_then(Value::as_object_mut) {
            item.insert("visible".into(), Value::Bool(false));
        }
    }
    Some(out)
}

/// The items a scatter's field names: an item's ID (a part's `<item>#<part>` as its item), or a
/// collection's members in ID order; `None` for a name that is neither.
pub(super) fn named_items(
    map: &Map<String, Value>,
    items: &Items<'_>,
    name: &str,
) -> Option<Vec<String>> {
    let id = name.split('#').next().unwrap_or(name);
    if items.contains_key(id) {
        return Some(vec![id.to_string()]);
    }
    let list = map
        .get("collections")?
        .get(name)?
        .get("members")?
        .as_array()?;
    let mut ids: Vec<String> = list
        .iter()
        .filter_map(|m| m.as_str().map(str::to_string))
        .collect();
    ids.sort();
    ids.dedup();
    Some(ids)
}

/// The faces of `on` (`<item>` or `<item>#<part>`) in the world: a builder's mesh, or a box's
/// six sides, whose parts are `top`, `bottom` and `side`.
pub(super) fn faces_of(
    doc: &Value,
    items: &Items<'_>,
    on: &str,
    seconds: f64,
    outlines: Outlines<'_>,
) -> Option<Vec<crate::distribute::Tri>> {
    let (id, part) = match on.split_once('#') {
        Some((id, part)) => (id, Some(part)),
        None => (on, None),
    };
    let item = items.get(id)?;
    let m = world(items, id);
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let mut out = Vec::new();
    if kind == "mark.box@1" {
        let h = size3(item.pointer("/params/size"), [1.0; 3])?.map(|x| x / 2.0);
        for axis in 0..3 {
            for sign in [-1.0, 1.0] {
                let name = match (axis, sign > 0.0) {
                    (1, true) => "top",
                    (1, false) => "bottom",
                    _ => "side",
                };
                if part.is_some_and(|p| p != name) {
                    continue;
                }
                let (a, b) = ((axis + 1) % 3, (axis + 2) % 3);
                let corner = |x: f64, y: f64| {
                    let mut p = [0.0; 3];
                    p[axis] = sign * h[axis];
                    p[a] = x * h[a];
                    p[b] = y * h[b] * sign;
                    apply(&m, p)
                };
                let q = [
                    corner(-1.0, -1.0),
                    corner(1.0, -1.0),
                    corner(1.0, 1.0),
                    corner(-1.0, 1.0),
                ];
                out.extend(
                    [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]
                        .into_iter()
                        .filter_map(crate::distribute::Tri::new),
                );
            }
        }
        return Some(out);
    }
    if !crate::builders::KINDS.contains(&kind) {
        return None;
    }
    let mesh = mesh_of(doc, id, item, seconds, outlines).ok()?;
    let all: Vec<u32>;
    let tris: &[u32] = match part {
        Some(name) => mesh
            .parts
            .get(name)
            .or_else(|| mesh.closed.get(name).map(|c| &c.0))?,
        None => {
            all = (0..mesh.triangles() as u32).collect();
            &all
        }
    };
    for &t in tris {
        let k = 3 * t as usize;
        let p = [0, 1, 2].map(|j| apply(&m, mesh.positions[mesh.indices[k + j] as usize]));
        out.extend(crate::distribute::Tri::new(p));
    }
    Some(out)
}

/// #2013: the elements of instancer `id` from its `from: {distribute}` (`from`), laid out over
/// what the scatter names as the items stand: its prototypes and each element in ID order.
#[allow(clippy::too_many_arguments)]
pub(super) fn scattered(
    map: &Map<String, Value>,
    doc: &Value,
    items: &Items<'_>,
    id: &str,
    params: &Value,
    from: &Value,
    seconds: f64,
    outlines: Outlines<'_>,
    planted: Option<&str>,
) -> Result<(Vec<String>, Arc<Vec<crate::distribute::Row>>), Refused> {
    let path = format!("items/{id}/params");
    let of = crate::cut::prototypes(params, &path)?;
    let at = format!("{path}/from/distribute");
    let Some(d) = from.get("distribute").filter(|d| d.is_object()) else {
        return refused("out_of_range", format!("{path}/from"));
    };
    // Rows come from the scatter or from written columns, never both.
    if let Some(column) = ["ids", "pos", "rot", "yaw", "proto", "hidden"]
        .into_iter()
        .find(|c| params.get(c).is_some_and(|v| !v.is_null()))
    {
        return refused("out_of_range", format!("{path}/{column}"));
    }
    let shapes_of =
        |name: &str, field: String| -> Result<Vec<deep_canvas::geometry_audit::Shape>, Refused> {
            let ids = named_items(map, items, name).ok_or(Refused {
                code: "ref_unresolved",
                path: field,
            })?;
            Ok(ids
                .iter()
                .filter_map(|x| {
                    crate::shapes::of(doc, x, items.get(x)?, &world(items, x), seconds)
                        .ok()
                        .flatten()
                })
                .flat_map(|(s, _)| s)
                .collect())
        };
    let on = d.get("on").and_then(Value::as_str).ok_or(Refused {
        code: "ref_unresolved",
        path: format!("{at}/on"),
    })?;
    if !items.contains_key(on.split('#').next().unwrap_or(on)) {
        return refused("ref_unresolved", format!("{at}/on"));
    }
    let Some(faces) = faces_of(doc, items, on, seconds, outlines) else {
        return refused("out_of_range", format!("{at}/on"));
    };
    let mut avoid = Vec::new();
    match d.get("avoid") {
        None | Some(Value::Null) => {}
        Some(Value::Array(list)) => {
            for (k, name) in list.iter().enumerate() {
                let name = name.as_str().ok_or(Refused {
                    code: "out_of_range",
                    path: format!("{at}/avoid/{k}"),
                })?;
                avoid.extend(shapes_of(name, format!("{at}/avoid/{k}"))?);
            }
        }
        Some(_) => return refused("out_of_range", format!("{at}/avoid")),
    }
    let project = match d.get("project") {
        None | Some(Value::Null) => Vec::new(),
        Some(p) => {
            let to = p.get("to").and_then(Value::as_str).ok_or(Refused {
                code: "ref_unresolved",
                path: format!("{at}/project/to"),
            })?;
            shapes_of(to, format!("{at}/project/to"))?
        }
    };
    let identity = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ];
    let protos = of
        .iter()
        .map(|p| {
            let shapes = items.get(p).and_then(|i| {
                crate::shapes::of(doc, p, i, &identity, seconds)
                    .ok()
                    .flatten()
            });
            let mut b = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
            for s in shapes.iter().flat_map(|(s, _)| s) {
                let [lo, hi] = s.aabb();
                for k in 0..3 {
                    b[0][k] = b[0][k].min(lo[k]);
                    b[1][k] = b[1][k].max(hi[k]);
                }
            }
            if b[0][0] <= b[1][0] {
                b
            } else {
                [[0.0; 3]; 2]
            }
        })
        .collect();
    let scene = crate::distribute::Scene {
        on: faces,
        avoid,
        project,
        protos,
        world: world(items, id),
        id,
        planted,
    };
    Ok((of, Arc::new(crate::distribute::rows(d, &at, &scene)?)))
}

/// #2013: the elements instancer `id` places at `t` (flicks): its `from: {distribute}`'s, or its
/// written rows, each as its columns hold it (`{id, proto, pos, yaw | rot, scale}`), in ID
/// order; `None` for an item that is no instancer.
pub fn elements_at(
    doc: &Value,
    t: i64,
    id: &str,
    planted: Option<&str>,
) -> Result<Option<Vec<crate::distribute::Row>>, Refused> {
    let Some(map) = doc.as_object() else {
        return refused("out_of_range", "");
    };
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let mut state = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut state);
    let empty = Map::new();
    let doc_items = map
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let written = eval::written(map, &program, &state);
    let mut items = Items::new(doc_items, &written, &state, &program);
    let seconds = t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
    rest(
        map,
        &program,
        &mut items,
        seconds,
        Rests::All,
        &mut Vec::new(),
    );
    let Some(item) = items
        .get(id)
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some("instance@1"))
    else {
        return Ok(None);
    };
    let empty = Value::Object(Map::new());
    let params = item.get("params").unwrap_or(&empty);
    let mut rows = match params.get("from").filter(|f| !f.is_null()) {
        Some(from) => scattered(
            map,
            doc,
            &items,
            id,
            params,
            from,
            seconds,
            Outlines::default(),
            planted,
        )?
        .1
        .to_vec(),
        None => crate::cut::elements(params, &format!("items/{id}/params"))?
            .1
            .into_iter()
            .map(|e| {
                let r = rotation_of(&e.at);
                let scale = sqrt(
                    e.at[0][0] * e.at[0][0] + e.at[1][0] * e.at[1][0] + e.at[2][0] * e.at[2][0],
                );
                crate::distribute::Row {
                    id: e.id as u32,
                    proto: e.proto,
                    pos: origin(&e.at),
                    yaw: deep_canvas::ops::deg(deep_canvas::ops::atan2(r[0][2], r[0][0])),
                    turn: Some(r),
                    scale,
                }
            })
            .collect(),
    };
    rows.sort_by_key(|r| r.id);
    Ok(Some(rows))
}

/// Each item of `doc` at `t` as evaluated, in item order, with its world transform without its
/// size: what the spatial index (#421) bounds and queries.
pub fn placed_at(doc: &Value, t: i64) -> Result<Vec<(String, Value, Affine3)>, Refused> {
    let Some(map) = doc.as_object() else {
        return refused("out_of_range", "");
    };
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let mut state = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut state);
    let empty = Map::new();
    let doc_items = map
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let written = eval::written(map, &program, &state);
    let mut items = Items::new(doc_items, &written, &state, &program);
    let seconds = t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
    rest(
        map,
        &program,
        &mut items,
        seconds,
        Rests::All,
        &mut Vec::new(),
    );
    Ok(items
        .iter()
        .map(|(id, item)| (id.clone(), item.clone(), world(&items, id)))
        .collect())
}

/// An item's Object shadow flag: true unless it says false.
pub(super) fn shadows(item: &Value, name: &str) -> bool {
    item.get(name).and_then(Value::as_bool).unwrap_or(true)
}

/// Whether a solid casts: its Object flag, and its material's `shadow` (#421).
pub(super) fn casts(item: &Value, material: &Option<Material>) -> bool {
    shadows(item, "cast_shadow") && material.as_ref().is_none_or(|m| m.casts)
}

/// A solid's outline: its own stroke, else its material's ink in the ink's role at its weight;
/// an ink on a part the outline can't follow is refused as a stroke there is (#421).
pub(super) fn inked(
    own: Option<Stroke>,
    material: &Option<Material>,
    shape: Shape,
    path: &str,
) -> Result<Option<Stroke>, Refused> {
    let Some((color, width)) = material.as_ref().and_then(|m| m.ink) else {
        return Ok(own);
    };
    if own.is_some() {
        return Ok(own);
    }
    if shape != Shape::Box {
        return refused("stroke_shape", format!("{path}/material"));
    }
    Ok(Some(Stroke {
        color,
        width,
        exact: false,
    }))
}

/// A light's face axes: its local +X and +Y in the world, unit.
pub(super) fn axes(m: &Affine3) -> [Vec3; 2] {
    [
        normalize(turn(m, [1.0, 0.0, 0.0])),
        normalize(turn(m, [0.0, 1.0, 0.0])),
    ]
}

/// A light's flicker: a gain, or the value at t of the document channel its `flicker` names; 1
/// with none.
pub(super) fn flicker(
    program: &Program,
    state: &State,
    params: &Value,
    path: &str,
) -> Result<f64, Refused> {
    match params.get("flicker") {
        None | Some(Value::Null) => Ok(1.0),
        Some(Value::Number(_)) => num(params.get("flicker")).ok_or(Refused {
            code: "out_of_range",
            path: format!("{path}/flicker"),
        }),
        Some(v) => v
            .as_str()
            .and_then(|c| program.channel_value(state, c))
            .ok_or(Refused {
                code: "ref_unresolved",
                path: format!("{path}/flicker"),
            }),
    }
}

/// A `mesh.asset@1`'s mesh, read from the store, with the name every item of that asset and
/// node shares.
pub(super) fn asset_mesh(
    read: Assets<'_>,
    id: &str,
    params: &Value,
) -> Result<(crate::geom::Mesh, Option<String>), Refused> {
    let path = format!("items/{id}/params");
    let Some(sha) = params.get("sha256").and_then(Value::as_str) else {
        return refused("out_of_range", format!("{path}/sha256"));
    };
    let Some(bytes) = read(sha) else {
        return refused("asset_missing", format!("{path}/sha256"));
    };
    let node = params.get("node").cloned().unwrap_or(Value::from(0));
    let mesh = crate::gltf::mesh(&bytes, &node).map_err(|_| Refused {
        code: "out_of_range",
        path: format!("{path}/sha256"),
    })?;
    Ok((mesh, Some(format!("{sha}#{node}"))))
}

/// An item's level of detail (#425): its `lod` bands and, for a mesh the simplify job gave
/// levels, those levels keyed off its `hash`; none when it has neither.
pub(super) fn lod_of(
    item: &Value,
    path: &str,
    bounds: [Vec3; 2],
    mesh: Option<(&crate::geom::Mesh, u64)>,
    doc: &Map<String, Value>,
) -> Result<Option<Arc<crate::lod::Lod>>, Refused> {
    let bands = crate::lod::bands_of(item, path.trim_end_matches("/params"))?;
    let leveled = mesh.filter(|(m, _)| !m.lods.is_empty());
    if bands.is_none() && leveled.is_none() {
        return Ok(None);
    }
    let crate::lod::Bands {
        bands,
        margin,
        proxy,
    } = bands.unwrap_or(crate::lod::Bands {
        bands: Vec::new(),
        margin: 0.1,
        proxy: None,
    });
    let (levels, extent) = match leveled {
        Some((m, h)) => (crate::lod::levels(&Arc::new(m.clone()), h), m.lod_extent),
        None => (Vec::new(), 0.0),
    };
    // A mesh without levels takes its proxy from the simplify step, once per content key.
    let proxy_mesh = match (proxy, mesh) {
        (Some(p), Some((m, h))) if levels.is_empty() => crate::lod::proxy_of(m, h, p),
        _ => None,
    };
    Ok(Some(Arc::new(crate::lod::Lod {
        bands,
        margin,
        bounds,
        levels,
        extent,
        lod_px: crate::lod::lod_px(doc),
        proxy,
        proxy_mesh,
        tile: None,
    })))
}

/// A built solid's world bounds' corners.
pub(crate) fn corners_of(s: &Solid) -> Vec<Vec3> {
    let Some(mesh) = &s.mesh else {
        return Vec::new();
    };
    let [lo, hi] = mesh.bounds();
    (0..8)
        .map(|c| {
            let p = [
                if c & 1 == 0 { lo[0] } else { hi[0] },
                if c & 2 == 0 { lo[1] } else { hi[1] },
                if c & 4 == 0 { lo[2] } else { hi[2] },
            ];
            apply(&s.model, p)
        })
        .collect()
}

/// Whether the node a `mesh.asset@1` names has a primitive that names one of the file's materials
/// (#423), so it draws with them rather than with the item's paint.
pub(super) fn asset_has_materials(read: Assets<'_>, params: &Value) -> bool {
    let Some(bytes) = params.get("sha256").and_then(Value::as_str).and_then(read) else {
        return false;
    };
    let node = params.get("node").cloned().unwrap_or(Value::from(0));
    crate::gltf::node_materials(&bytes, &node)
}

/// A `mesh.asset@1` naming a file's scene (#423): one solid per triangle primitive of each node,
/// picked as `<item>#<node name>` (or its index), placed at the item's `model` × the node's world
/// matrix, shaded by the `material@1` the import made of its glTF material. Naming one node, it
/// draws that node's primitives alone, in the node's own space, picked as the item.
#[allow(clippy::type_complexity)]
pub(super) fn asset_scene(
    read: Assets<'_>,
    id: &str,
    params: &Value,
    model: &Affine3,
    look: &Look3,
) -> Result<(Vec<Solid>, Vec<([[f64; 4]; 3], Value)>), Refused> {
    let path = format!("items/{id}/params/sha256");
    let Some(sha) = params.get("sha256").and_then(Value::as_str) else {
        return refused("out_of_range", path);
    };
    let Some(bytes) = read(sha) else {
        return refused("asset_missing", path);
    };
    let scene_i = params
        .pointer("/node/scene")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let one = params.get("node").filter(|n| n.get("scene").is_none());
    let imported = crate::gltf::import(&bytes, sha, scene_i, read).map_err(|p| Refused {
        code: "out_of_range",
        path: format!("items/{id}/{p}"),
    })?;
    let mut out = Vec::new();
    // The file's punctual lights at their world transforms under the item's (#428).
    let lights = imported
        .lights
        .iter()
        .map(|(w, l)| (matmul(model, w), l.clone()))
        .collect();
    for (k, node) in imported.nodes.iter().enumerate() {
        let named = |n: &Value| match n {
            Value::Number(i) => i.as_u64() == Some(node.index as u64),
            Value::String(s) => *s == node.name,
            _ => false,
        };
        if one.is_some_and(|n| !named(n)) {
            continue;
        }
        let solid_model = match one {
            Some(_) => *model,
            None => matmul(model, &node.world),
        };
        for (p, prim) in node.primitives.iter().enumerate() {
            if prim.mesh.triangles() == 0 {
                continue;
            }
            let pick = match one {
                Some(_) => id.to_string(),
                None => format!("{id}#{}", node.name),
            };
            let mat_id = format!("{id}#material{}", prim.material.map_or(-1, |m| m as i64));
            let mat_item = serde_json::json!({"kind": "material@1", "params": prim
                .material
                .and_then(|m| imported.materials.get(m))
                .map_or_else(|| serde_json::json!({"metallic": 1.0, "roughness": 1.0, "base_color": [1, 1, 1, 1]}), |m| m.params.clone())});
            let holder = serde_json::json!({"material": mat_id});
            let named = |n: &str| (n == mat_id).then_some(&mat_item);
            let material = light::material(&holder, named, look, id)?;
            let maps = light::maps(&holder, named)?;
            let mut h = deep_canvas::schedule::Hasher::new("scene3d.mesh");
            h.text(&format!("{sha}#scene{scene_i}#{k}#{p}"));
            let key = h.finish().0;
            let hash = u64::from_le_bytes([
                key[0], key[1], key[2], key[3], key[4], key[5], key[6], key[7],
            ]);
            // Its coverage: the factor's alpha, which a mask's cutoff and a blend read with the
            // base color map's (opaque parts whole).
            let alpha = material.as_ref().map_or(1.0, |m| match m.alpha_mode {
                light::AlphaMode::Opaque => 1.0,
                _ => m.base[3],
            });
            out.push(Solid {
                id: pick,
                shape: Shape::Built(hash),
                model: solid_model,
                color: material
                    .as_ref()
                    .map_or([204; 3], |m| [m.base[0], m.base[1], m.base[2]].map(encode8)),
                stroke: None,
                mesh: Some(Arc::new(prim.mesh.clone())),
                lod: None,
                mask: None,
                cast_only: false,
                receiver_sets: 0,
                caster_sets: 0,
                inset: 0.0,
                cast_shadow: true,
                receive_shadow: true,
                emission: material.as_ref().map_or([0.0; 3], |m| m.emission),
                material,
                sort_bias: 0.0,
                alpha,
                maps,
                // An imported material names no operator.
                op: None,
                cut: false,
                per_pixel: false,
                adjust: None,
                batch: 0,
                row: 0,
                sway: None,
            });
        }
    }
    Ok((out, lights))
}

/// A figure lights one item at most (Object: `tone`, "one lit per figure"), and every tone is
/// of the closed list.
pub(super) fn tones(map: &Map<String, Value>) -> Result<(), Refused> {
    let mut lit = false;
    for (id, item) in map
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(tone) = item.get("tone") else {
            continue;
        };
        match tone.as_str() {
            Some("lit") if lit && map.get("profile").and_then(Value::as_str) == Some("figure") => {
                return refused("out_of_range", format!("items/{id}/tone"));
            }
            Some("lit") => lit = true,
            Some("faint" | "lo" | "mid" | "hi") => {}
            _ => return refused("out_of_range", format!("items/{id}/tone")),
        }
    }
    Ok(())
}

/// The material operator a solid's material names, on the solid's own clock (#429): inside a
/// time-remapped recipe instance, child time.
pub(super) fn solid_op(
    items: &Items<'_>,
    map: &Map<String, Value>,
    program: &Program,
    t: i64,
    id: &str,
    item: &Value,
) -> Result<Option<SolidOp>, Refused> {
    let Some((op, op_item)) = light::material_op(item, |m| items.get(m))? else {
        return Ok(None);
    };
    let motion = &program.motion;
    let own = motion.item_time(id, eval::position(motion, t).0) - motion.transport.start;
    Ok(Some(SolidOp {
        id: op.to_string(),
        item: Arc::new(op_item.clone()),
        t: own as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64,
        doc_seed: map.get("seed").and_then(Value::as_u64).unwrap_or(0),
    }))
}
