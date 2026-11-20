//! lanes@1's lane graph and its kind rules (#981; canvas primitives: Logic: library interfaces):
//! the graph a logic item's `lanes` names, built at check from the piece's floor paths and refused
//! naming a bay no other bay reaches or an edge shorter than a vehicle and its gap; its bytes, the
//! item's asset 0, which a lanes@1 library reads (packs/lanes-1.0.0/LAYOUT.md); and the judge's
//! reading of a run, `lanes.clear` and `lanes.stuck`, with the geometry audit's measure of a
//! vehicle's centre off its graph. The rules read only the arrays a library writes and this graph,
//! so they hold any library, a planted one included.

use serde_json::{json, Map, Value};

/// A logic item's one vehicle kind (`lanes.vehicle`).
#[derive(Clone, Debug)]
pub struct Vehicle {
    pub length: f64,
    pub width: f64,
    pub gap: f64,
    pub speed: f64,
    pub accel: f64,
    pub decel: f64,
    /// The lift's highest fork height and its speed; 0 and 0 without a lift.
    pub lift: [f64; 2],
}

/// One edge: a floor path from its first point to its last, in the built order (by path ID).
#[derive(Clone, Debug)]
pub struct Edge {
    pub id: String,
    pub pts: Vec<[f64; 2]>,
    /// The distance along it at each point.
    pub cum: Vec<f64>,
    pub ends: [usize; 2],
    pub two_way: bool,
    pub speed: f64,
    /// The zones along it from its first point, each with the stretch of it the zone covers: a
    /// junction's at either end, its own between.
    pub pieces: Vec<(usize, f64, f64)>,
    /// Its own zones' indexes, first and count.
    pub zones: (usize, usize),
}

impl Edge {
    pub fn length(&self) -> f64 {
        *self.cum.last().unwrap_or(&0.0)
    }
}

/// A lane graph as the check builds it.
#[derive(Clone, Debug)]
pub struct Graph {
    pub vehicle: Vehicle,
    pub edges: Vec<Edge>,
    pub nodes: Vec<[f64; 2]>,
    /// Each node's path ends: (edge, 0 first point or 1 last).
    pub inc: Vec<Vec<(usize, usize)>>,
    /// Each zone's name: `<path ID>.<i>` or `junction:<IDs>`.
    pub zones: Vec<String>,
    /// The bytes a lanes@1 library reads from asset 0.
    pub bytes: Vec<u8>,
}

fn refusal(what: String, extra: Value) -> Value {
    let mut out = json!({"rule": "lanes", "what": what});
    if let (Some(o), Value::Object(e)) = (out.as_object_mut(), extra) {
        o.extend(e);
    }
    out
}

fn dist(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

fn vehicle_of(v: &Value) -> Result<Vehicle, Value> {
    let bad = |what: &str| {
        refusal(
            format!("lanes.vehicle {what}"),
            json!({"field": "lanes/vehicle"}),
        )
    };
    if let Some(k) = v
        .as_object()
        .ok_or_else(|| bad("is an object"))?
        .keys()
        .find(|k| {
            !["length", "width", "gap", "speed", "accel", "decel", "lift"].contains(&k.as_str())
        })
    {
        return Err(bad(&format!("has no field {k}")));
    }
    let positive = |k: &str| {
        v.get(k)
            .and_then(Value::as_f64)
            .filter(|x| x.is_finite() && *x > 0.0)
            .ok_or_else(|| bad(&format!("gives {k} as a positive number")))
    };
    let gap = match v.get("gap") {
        None => 0.5,
        Some(g) => g
            .as_f64()
            .filter(|x| x.is_finite() && *x >= 0.0)
            .ok_or_else(|| bad("gives gap as a number of metres"))?,
    };
    let lift = match v.get("lift") {
        None => [0.0, 0.0],
        Some(l) => {
            let max = l
                .get("max")
                .and_then(Value::as_f64)
                .filter(|x| x.is_finite() && *x >= 0.0);
            let speed = l
                .get("speed")
                .and_then(Value::as_f64)
                .filter(|x| x.is_finite() && *x > 0.0);
            match (max, speed) {
                (Some(m), Some(s)) => [m, s],
                _ => return Err(bad("gives lift as {max, speed}")),
            }
        }
    };
    Ok(Vehicle {
        length: positive("length")?,
        width: positive("width")?,
        gap,
        speed: positive("speed")?,
        accel: positive("accel")?,
        decel: positive("decel")?,
        lift,
    })
}

/// A path@1 item's points: one run of straight lines (`M` then `L`s) in metres on the floor.
fn points(items: &Map<String, Value>, id: &str) -> Result<Vec<[f64; 2]>, Value> {
    let bad = |what: String| refusal(what, json!({"path": id}));
    let item = items
        .get(id)
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some("path@1"))
        .ok_or_else(|| {
            bad(format!(
                "lanes.graph names {id}, which is no path@1 item of the piece"
            ))
        })?;
    let verbs: Vec<&str> = item
        .pointer("/params/verbs")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().map(Value::as_str).collect())
        .unwrap_or_default();
    let pts: Vec<f64> = item
        .pointer("/params/pts")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().map(Value::as_f64).collect())
        .unwrap_or_default();
    let line = verbs.len() >= 2
        && verbs[0] == "M"
        && verbs[1..].iter().all(|v| *v == "L")
        && pts.len() == 2 * verbs.len()
        && pts.iter().all(|x| x.is_finite());
    if !line {
        return Err(bad(format!(
            "{id} is one run of straight lines: verbs M then L, a point each"
        )));
    }
    Ok(pts.chunks(2).map(|p| [p[0], p[1]]).collect())
}

fn strings(v: Option<&Value>, what: &str) -> Result<Vec<String>, Value> {
    match v {
        None => Ok(Vec::new()),
        Some(v) => v
            .as_array()
            .and_then(|a| a.iter().map(|x| x.as_str().map(str::to_string)).collect())
            .ok_or_else(|| {
                refusal(
                    format!("lanes.graph.{what} is a list of path IDs"),
                    json!({"field": "lanes/graph"}),
                )
            }),
    }
}

/// The lane graph `lanes` names over the piece's `items`, or every refusal.
pub fn build(lanes: &Value, items: &Map<String, Value>) -> Result<Graph, Vec<Value>> {
    let one = |r: Value| vec![r];
    let field = |what: &str| refusal(what.into(), json!({"field": "lanes"}));
    if let Some(k) = lanes
        .as_object()
        .ok_or_else(|| one(field("lanes is {graph, vehicle}")))?
        .keys()
        .find(|k| !["graph", "vehicle"].contains(&k.as_str()))
    {
        return Err(one(field(&format!("lanes has no field {k}"))));
    }
    let vehicle = vehicle_of(lanes.get("vehicle").unwrap_or(&Value::Null)).map_err(one)?;
    let g = lanes
        .get("graph")
        .filter(|g| g.is_object())
        .ok_or_else(|| one(field("lanes.graph is {paths, two_way, speed, bays, join}")))?;
    if let Some(k) = g
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, _)| k)
        .find(|k| !["paths", "two_way", "speed", "bays", "join"].contains(&k.as_str()))
    {
        return Err(one(field(&format!("lanes.graph has no field {k}"))));
    }
    let given = strings(g.get("paths"), "paths").map_err(one)?;
    let two_way = strings(g.get("two_way"), "two_way").map_err(one)?;
    let join = match g.get("join") {
        None => 0.05,
        Some(j) => j
            .as_f64()
            .filter(|x| x.is_finite() && *x > 0.0)
            .ok_or_else(|| one(field("lanes.graph.join is a positive number of metres")))?,
    };
    if given.is_empty() {
        return Err(one(field("lanes.graph.paths names at least one path")));
    }
    let mut sorted = given.clone();
    sorted.sort();
    sorted.dedup();
    if sorted.len() != given.len() {
        return Err(one(field("lanes.graph.paths names each path once")));
    }
    if let Some(p) = two_way.iter().find(|p| !given.contains(p)) {
        return Err(one(refusal(
            format!("lanes.graph.two_way names {p}, which isn't one of its paths"),
            json!({"path": p}),
        )));
    }
    let mut pts = Vec::new();
    let mut speeds = Vec::new();
    for id in &given {
        pts.push(points(items, id).map_err(one)?);
        speeds.push(
            g.pointer(&format!(
                "/speed/{}",
                id.replace('~', "~0").replace('/', "~1")
            ))
            .and_then(Value::as_f64)
            .filter(|x| x.is_finite() && *x > 0.0)
            .ok_or_else(|| {
                one(refusal(
                    format!("lanes.graph.speed gives {id} a positive speed limit"),
                    json!({"path": id}),
                ))
            })?,
        );
    }
    // Nodes: path ends within `join` of a node's first point are that node, in the paths' order.
    let mut nodes: Vec<[f64; 2]> = Vec::new();
    let mut node = |p: [f64; 2]| match nodes.iter().position(|n| dist(*n, p) <= join) {
        Some(i) => i,
        None => {
            nodes.push(p);
            nodes.len() - 1
        }
    };
    let ends: Vec<[usize; 2]> = pts
        .iter()
        .map(|p| [node(p[0]), node(p[p.len() - 1])])
        .collect();
    let mut refused = Vec::new();
    let unit = vehicle.length + vehicle.gap;
    let r = unit / 2.0;
    // Edges in path ID order, so the lower edge is the lower ID (routes' ties).
    let mut order: Vec<usize> = (0..given.len()).collect();
    order.sort_by(|a, b| given[*a].cmp(&given[*b]));
    let mut inc: Vec<Vec<(usize, usize)>> = vec![Vec::new(); nodes.len()];
    for (e, &i) in order.iter().enumerate() {
        inc[ends[i][0]].push((e, 0));
        inc[ends[i][1]].push((e, 1));
    }
    let junction = |n: usize| inc[n].len() >= 3;
    let mut zones: Vec<String> = Vec::new();
    let mut edges: Vec<Edge> = Vec::new();
    for &i in &order {
        let p = &pts[i];
        let mut cum = vec![0.0];
        for w in p.windows(2) {
            cum.push(cum[cum.len() - 1] + dist(w[0], w[1]));
        }
        let len = cum[cum.len() - 1];
        if len < unit {
            refused.push(refusal(
                format!(
                    "{} is {len} m long, shorter than a vehicle and its gap, {unit} m",
                    given[i]
                ),
                json!({"path": given[i]}),
            ));
        }
        let from = if junction(ends[i][0]) { r } else { 0.0 };
        let to = len - if junction(ends[i][1]) { r } else { 0.0 };
        let n = (((to - from) / unit + 1e-12).floor() as usize).max(1);
        let z = (to - from) / n as f64;
        let first = zones.len();
        let mut pieces = Vec::new();
        for k in 0..n {
            zones.push(format!("{}.{k}", given[i]));
            pieces.push((
                first + k,
                from + k as f64 * z,
                if k + 1 == n {
                    to
                } else {
                    from + (k + 1) as f64 * z
                },
            ));
        }
        edges.push(Edge {
            id: given[i].clone(),
            pts: p.clone(),
            cum,
            ends: ends[i],
            two_way: two_way.contains(&given[i]),
            speed: speeds[i],
            pieces,
            zones: (first, n),
        });
    }
    // Junction zones, by node: `junction:` and the IDs of the paths ending there, sorted.
    let mut jzone = vec![usize::MAX; nodes.len()];
    for (n, ends) in inc.iter().enumerate() {
        if !junction(n) {
            continue;
        }
        let mut ids: Vec<&str> = ends.iter().map(|(e, _)| edges[*e].id.as_str()).collect();
        ids.sort();
        ids.dedup();
        jzone[n] = zones.len();
        zones.push(format!("junction:{}", ids.join(",")));
    }
    for e in &mut edges {
        let len = e.length();
        if jzone[e.ends[0]] != usize::MAX {
            e.pieces.insert(0, (jzone[e.ends[0]], 0.0, r.min(len)));
        }
        if jzone[e.ends[1]] != usize::MAX {
            e.pieces.push((jzone[e.ends[1]], (len - r).max(0.0), len));
        }
    }
    // Bays, numbered in the order `bays` lists them, each naming the node at its point.
    let mut bays: Vec<(String, usize)> = Vec::new();
    for (name, p) in g
        .get("bays")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let at = p
            .as_array()
            .filter(|a| a.len() == 2)
            .and_then(|a| Some([a[0].as_f64()?, a[1].as_f64()?]));
        match at.and_then(|p| nodes.iter().position(|n| dist(*n, p) <= join)) {
            Some(n) => bays.push((name.clone(), n)),
            None => refused.push(refusal(
                format!("bay {name} is no path end of the graph: a bay names the node at its point, within join ({join} m)"),
                json!({"bay": name}),
            )),
        }
    }
    if bays.is_empty() && refused.is_empty() {
        refused.push(field("lanes.graph.bays names at least one bay"));
    }
    // A bay no other bay reaches: no route ends there, so nothing can be sent to it.
    // Each node's arcs in, by the node they come from.
    let mut into: Vec<Vec<usize>> = vec![Vec::new(); nodes.len()];
    for e in &edges {
        into[e.ends[1]].push(e.ends[0]);
        if e.two_way {
            into[e.ends[0]].push(e.ends[1]);
        }
    }
    for (i, (name, n)) in bays.iter().enumerate() {
        let mut seen = vec![false; nodes.len()];
        let mut todo = vec![*n];
        seen[*n] = true;
        while let Some(u) = todo.pop() {
            for &a in &into[u] {
                if !seen[a] {
                    seen[a] = true;
                    todo.push(a);
                }
            }
        }
        let reached = bays
            .iter()
            .enumerate()
            .any(|(j, (_, m))| j != i && seen[*m]);
        if !reached && bays.len() > 1 {
            refused.push(refusal(
                format!("no other bay reaches bay {name}: no route of the graph ends there"),
                json!({"bay": name}),
            ));
        }
    }
    if !refused.is_empty() {
        return Err(refused);
    }
    let mut graph = Graph {
        vehicle,
        edges,
        nodes,
        inc,
        zones,
        bytes: Vec::new(),
    };
    // Each bay's heading at placement: into the first path, in `paths` order, that ends there.
    let headings: Vec<[f64; 3]> = bays
        .iter()
        .map(|(_, n)| {
            let i = given
                .iter()
                .position(|id| {
                    graph
                        .edges
                        .iter()
                        .any(|e| e.id == *id && e.ends.contains(n))
                })
                .expect("a bay's node is a path end");
            let e = graph
                .edges
                .iter()
                .find(|e| e.id == given[i])
                .expect("an edge");
            let (a, b) = if e.ends[0] == *n {
                (e.pts[0], e.pts[1])
            } else {
                (e.pts[e.pts.len() - 1], e.pts[e.pts.len() - 2])
            };
            let d = dist(a, b);
            let (hx, hy) = ((b[0] - a[0]) / d, (b[1] - a[1]) / d);
            [hy.atan2(hx), hx, hy]
        })
        .collect();
    graph.bytes = bytes(&graph, &jzone, &bays, &headings);
    Ok(graph)
}

/// The built graph's bytes (packs/lanes-1.0.0/LAYOUT.md: The built graph).
fn bytes(g: &Graph, jzone: &[usize], bays: &[(String, usize)], headings: &[[f64; 3]]) -> Vec<u8> {
    let v = &g.vehicle;
    let (n, e) = (g.nodes.len(), g.edges.len());
    let arcs: Vec<(usize, i32, usize, usize, f64)> = g
        .edges
        .iter()
        .enumerate()
        .flat_map(|(i, x)| {
            let t = x.length() / x.speed;
            let back = x.two_way.then_some((i, 1, x.ends[1], x.ends[0], t));
            std::iter::once((i, 0, x.ends[0], x.ends[1], t)).chain(back)
        })
        .collect();
    let points: usize = g.edges.iter().map(|x| x.pts.len()).sum();
    let align = |k: usize| k.div_ceil(8) * 8;
    let off_nodes = 128;
    let off_edges = off_nodes + 32 * n;
    let off_arcs = off_edges + 48 * e;
    let off_zones = off_arcs + 24 * arcs.len();
    let off_bays = off_zones + 24 * g.zones.len();
    let off_points = off_bays + 32 * bays.len();
    let off_out = off_points + 24 * points;
    let off_inc = align(off_out + 4 * (n + 1 + arcs.len()));
    let size = align(off_inc + 4 * (n + 1 + 2 * e));
    let mut b = vec![0u8; size];
    let i32_at = |b: &mut Vec<u8>, at: usize, x: i64| {
        b[at..at + 4].copy_from_slice(&(x as i32).to_le_bytes())
    };
    let f64_at =
        |b: &mut Vec<u8>, at: usize, x: f64| b[at..at + 8].copy_from_slice(&x.to_le_bytes());
    let counts = [1, n, e, arcs.len(), g.zones.len(), bays.len(), points, 0];
    let offsets = [
        off_nodes, off_edges, off_arcs, off_zones, off_bays, off_points, off_out, off_inc,
    ];
    for (k, x) in counts.iter().chain(&offsets).enumerate() {
        i32_at(&mut b, 4 * k, *x as i64);
    }
    for (k, x) in [
        v.length, v.width, v.gap, v.speed, v.accel, v.decel, v.lift[0], v.lift[1],
    ]
    .iter()
    .enumerate()
    {
        f64_at(&mut b, 64 + 8 * k, *x);
    }
    for (k, p) in g.nodes.iter().enumerate() {
        let at = off_nodes + 32 * k;
        f64_at(&mut b, at, p[0]);
        f64_at(&mut b, at + 8, p[1]);
        i32_at(&mut b, at + 16, g.inc[k].len() as i64);
        i32_at(
            &mut b,
            at + 20,
            if jzone[k] == usize::MAX {
                -1
            } else {
                jzone[k] as i64
            },
        );
    }
    let mut pt = 0;
    for (k, x) in g.edges.iter().enumerate() {
        let at = off_edges + 48 * k;
        for (j, val) in [
            x.ends[0],
            x.ends[1],
            x.two_way as usize,
            x.zones.0,
            x.zones.1,
            pt,
            x.pts.len(),
        ]
        .iter()
        .enumerate()
        {
            i32_at(&mut b, at + 4 * j, *val as i64);
        }
        f64_at(&mut b, at + 32, x.length());
        f64_at(&mut b, at + 40, x.speed);
        for (j, p) in x.pts.iter().enumerate() {
            let at = off_points + 24 * (pt + j);
            f64_at(&mut b, at, p[0]);
            f64_at(&mut b, at + 8, p[1]);
            f64_at(&mut b, at + 16, x.cum[j]);
        }
        pt += x.pts.len();
        for &(z, from, to) in &x.pieces {
            if z >= x.zones.0 && z < x.zones.0 + x.zones.1 {
                let at = off_zones + 24 * z;
                i32_at(&mut b, at, 0);
                i32_at(&mut b, at + 4, k as i64);
                f64_at(&mut b, at + 8, from);
                f64_at(&mut b, at + 16, to);
            }
        }
    }
    for (k, &z) in jzone.iter().enumerate() {
        if z != usize::MAX {
            let at = off_zones + 24 * z;
            i32_at(&mut b, at, 1);
            i32_at(&mut b, at + 4, k as i64);
        }
    }
    for (k, a) in arcs.iter().enumerate() {
        let at = off_arcs + 24 * k;
        i32_at(&mut b, at, a.0 as i64);
        i32_at(&mut b, at + 4, a.1 as i64);
        i32_at(&mut b, at + 8, a.2 as i64);
        i32_at(&mut b, at + 12, a.3 as i64);
        f64_at(&mut b, at + 16, a.4);
    }
    for (k, ((_, node), h)) in bays.iter().zip(headings).enumerate() {
        let at = off_bays + 32 * k;
        i32_at(&mut b, at, *node as i64);
        f64_at(&mut b, at + 8, h[0]);
        f64_at(&mut b, at + 16, h[1]);
        f64_at(&mut b, at + 24, h[2]);
    }
    // Each node's arcs out, in arc order, after a start per node; then its path ends.
    let mut at = off_out + 4 * (n + 1);
    for k in 0..n {
        let start = (at - off_out) / 4 - (n + 1);
        i32_at(&mut b, off_out + 4 * k, start as i64);
        for (j, a) in arcs.iter().enumerate() {
            if a.2 == k {
                i32_at(&mut b, at, j as i64);
                at += 4;
            }
        }
    }
    i32_at(&mut b, off_out + 4 * n, arcs.len() as i64);
    let mut at = off_inc + 4 * (n + 1);
    for (k, ends) in g.inc.iter().enumerate() {
        let start = (at - off_inc) / 4 - (n + 1);
        i32_at(&mut b, off_inc + 4 * k, start as i64);
        for (edge, end) in ends {
            i32_at(&mut b, at, (2 * edge + end) as i64);
            at += 4;
        }
    }
    i32_at(&mut b, off_inc + 4 * n, 2 * e as i64);
    b
}

/// The point of the graph nearest `p`: its edge, the distance along it and the distance to it.
pub fn nearest(g: &Graph, p: [f64; 2]) -> (usize, f64, f64) {
    let mut best = (0, 0.0, f64::INFINITY);
    for (k, e) in g.edges.iter().enumerate() {
        for (j, w) in e.pts.windows(2).enumerate() {
            let (dx, dy) = (w[1][0] - w[0][0], w[1][1] - w[0][1]);
            let l2 = dx * dx + dy * dy;
            let f = if l2 > 0.0 {
                (((p[0] - w[0][0]) * dx + (p[1] - w[0][1]) * dy) / l2).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let q = [w[0][0] + dx * f, w[0][1] + dy * f];
            let d = dist(p, q);
            if d < best.2 {
                best = (k, e.cum[j] + f * (e.cum[j + 1] - e.cum[j]), d);
            }
        }
    }
    best
}

/// The zones a vehicle occupies whose centre's nearest point of the graph is `s` along edge `e`:
/// those the stretch of the graph within half its length of that point, every way along the
/// paths, overlaps by more than 1e-6 m.
fn occupied(g: &Graph, (e, s): (usize, f64)) -> Vec<usize> {
    let half = g.vehicle.length / 2.0;
    let len = g.edges[e].length();
    let mut covered = vec![(e, (s - half).max(0.0), (s + half).min(len))];
    let spill =
        |node: usize, came: (usize, usize), rem: f64, covered: &mut Vec<(usize, f64, f64)>| {
            for &(q, end) in &g.inc[node] {
                if (q, end) == came {
                    continue;
                }
                let l = g.edges[q].length();
                covered.push(if end == 0 {
                    (q, 0.0, rem.min(l))
                } else {
                    (q, (l - rem).max(0.0), l)
                });
            }
        };
    if s + half > len {
        spill(g.edges[e].ends[1], (e, 1), s + half - len, &mut covered);
    }
    if s - half < 0.0 {
        spill(g.edges[e].ends[0], (e, 0), half - s, &mut covered);
    }
    let mut over: Vec<(usize, f64)> = Vec::new();
    for (q, a, b) in covered {
        for &(z, from, to) in &g.edges[q].pieces {
            let o = b.min(to) - a.max(from);
            if o > 0.0 {
                match over.iter_mut().find(|(x, _)| *x == z) {
                    Some(x) => x.1 += o,
                    None => over.push((z, o)),
                }
            }
        }
    }
    let mut out: Vec<usize> = over
        .into_iter()
        .filter(|(_, o)| *o > 1e-6)
        .map(|(z, _)| z)
        .collect();
    out.sort();
    out
}

/// How far two footprints, length × width rectangles at their centres along their headings,
/// overlap: the least overlap of their projections on the four sides' normals.
fn overlap(v: &Vehicle, a: ([f64; 2], f64), b: ([f64; 2], f64)) -> f64 {
    let (ua, ub) = ([a.1.cos(), a.1.sin()], [b.1.cos(), b.1.sin()]);
    let axes = [ua, [-ua[1], ua[0]], ub, [-ub[1], ub[0]]];
    let radius = |u: [f64; 2], n: [f64; 2]| {
        (u[0] * n[0] + u[1] * n[1]).abs() * v.length / 2.0
            + (-u[1] * n[0] + u[0] * n[1]).abs() * v.width / 2.0
    };
    axes.iter()
        .map(|n| {
            let d = ((b.0[0] - a.0[0]) * n[0] + (b.0[1] - a.0[1]) * n[1]).abs();
            radius(ua, *n) + radius(ub, *n) - d
        })
        .fold(f64::INFINITY, f64::min)
}

/// The judge's reading of one item's run, step by step.
pub struct Judge<'a> {
    g: &'a Graph,
    /// A step's length and the stuck rule's limit, in flicks.
    step: i64,
    max_wait: i64,
    steps: i64,
    clear: Vec<Value>,
    clear_failed: bool,
    stuck: Vec<Value>,
    stuck_failed: bool,
    waits: Vec<(i64, bool)>,
    audit: (f64, usize, i64),
}

/// Flicks a second (deep_canvas::time).
const FLICKS: i64 = 705_600_000;
/// The first fails a rule reports.
const SHOWN: usize = 16;

impl<'a> Judge<'a> {
    pub fn new(g: &'a Graph, step: i64, max_wait: f64) -> Judge<'a> {
        Judge {
            g,
            step,
            max_wait: (max_wait * FLICKS as f64).round() as i64,
            steps: 0,
            clear: Vec::new(),
            clear_failed: false,
            stuck: Vec::new(),
            stuck_failed: false,
            waits: Vec::new(),
            audit: (0.0, 0, 0),
        }
    }

    /// Step k's arrays: each vehicle's centre, heading and state.
    pub fn step(&mut self, k: i64, pos: &[[f64; 2]], heading: &[f64], state: &[i32]) {
        self.steps += 1;
        let g = self.g;
        let mut by_zone: Vec<(usize, Vec<usize>)> = Vec::new();
        for (v, p) in pos.iter().enumerate() {
            let (e, s, d) = nearest(g, *p);
            if d > self.audit.0 {
                self.audit = (d, v, k);
            }
            for z in occupied(g, (e, s)) {
                match by_zone.iter_mut().find(|(x, _)| *x == z) {
                    Some(x) => x.1.push(v),
                    None => by_zone.push((z, vec![v])),
                }
            }
        }
        by_zone.sort_by_key(|(z, _)| *z);
        let mut fails: Vec<Value> = by_zone
            .into_iter()
            .filter(|(_, vs)| vs.len() >= 2)
            .map(|(z, vs)| json!({"step": k, "zone": g.zones[z], "vehicles": vs}))
            .collect();
        let reach = g.vehicle.length.hypot(g.vehicle.width) + 1e-9;
        for (i, (a, ha)) in pos.iter().zip(heading).enumerate() {
            for (j, (b, hb)) in pos.iter().zip(heading).enumerate().skip(i + 1) {
                if dist(*a, *b) < reach && overlap(&g.vehicle, (*a, *ha), (*b, *hb)) > 1e-6 {
                    fails.push(json!({"step": k, "zone": null, "vehicles": [i, j]}));
                }
            }
        }
        self.clear_failed |= !fails.is_empty();
        self.clear
            .extend(fails.into_iter().take(SHOWN - self.clear.len().min(SHOWN)));
        self.waits.resize(state.len(), (0, false));
        for (v, s) in state.iter().enumerate() {
            let w = &mut self.waits[v];
            if *s == 2 {
                w.0 += 1;
            } else {
                *w = (0, false);
            }
            if !w.1 && w.0 * self.step > self.max_wait {
                w.1 = true;
                self.stuck_failed = true;
                if self.stuck.len() < SHOWN {
                    self.stuck.push(json!({"step": k, "vehicle": v, "waited": (w.0 * self.step) as f64 / FLICKS as f64}));
                }
            }
        }
    }

    /// The rules' verdicts and the audit's measure.
    pub fn result(self) -> Value {
        let rule = |failed: bool, fails: Vec<Value>| json!({"verdict": if failed { "FAIL" } else { "PASS" }, "steps": self.steps, "fails": fails});
        json!({
            "rules": {"lanes.clear": rule(self.clear_failed, self.clear.clone()), "lanes.stuck": rule(self.stuck_failed, self.stuck.clone())},
            "audit": {"on_graph": {"max": self.audit.0, "vehicle": self.audit.1, "step": self.audit.2}},
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(pts: &[[f64; 2]]) -> Value {
        let mut verbs = vec!["M"];
        verbs.extend(std::iter::repeat_n("L", pts.len() - 1));
        json!({"kind": "path@1", "params": {"verbs": verbs, "pts": pts.iter().flatten().collect::<Vec<_>>()}})
    }

    fn lanes(two_way: &[&str], bays: Value) -> Value {
        json!({"graph": {"paths": ["m1", "m2", "r"], "two_way": two_way, "speed": {"m1": 2, "m2": 2, "r": 2}, "bays": bays},
            "vehicle": {"length": 2, "width": 1, "speed": 2, "accel": 1, "decel": 1}})
    }

    fn items() -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("m1".into(), path(&[[0.0, 0.0], [10.0, 0.0]]));
        m.insert("m2".into(), path(&[[10.0, 0.0], [20.0, 0.0]]));
        m.insert("r".into(), path(&[[10.0, -5.0], [10.0, 0.0]]));
        m
    }

    /// The zone rule on a junction of three paths: each path's stretch past the junction's reach
    /// cut into zones of at least a vehicle and its gap, the junction named by its sorted paths.
    #[test]
    fn zones_are_cut_from_the_junction_reach() {
        let bays = json!({"park.1": [0, 0], "park.2": [20, 0], "rack.7": [10, -5]});
        let g = build(&lanes(&["m1", "m2", "r"], bays), &items()).unwrap();
        assert_eq!(
            g.zones,
            [
                "m1.0",
                "m1.1",
                "m1.2",
                "m2.0",
                "m2.1",
                "m2.2",
                "r.0",
                "junction:m1,m2,r"
            ]
        );
        let m1 = &g.edges[0].pieces;
        assert_eq!(m1.len(), 4);
        assert!(m1[0].1 == 0.0 && (m1[1].2 - 8.75 * 2.0 / 3.0).abs() < 1e-12 && m1[2].2 == 8.75);
        assert_eq!((m1[3].0, m1[3].1, m1[3].2), (7, 8.75, 10.0));
    }

    /// A bay no other bay reaches is refused by name; the same graph with its spur both ways isn't.
    #[test]
    fn a_bay_no_other_bay_reaches_is_refused() {
        let bays = json!({"park.1": [0, 0], "park.2": [20, 0], "rack.7": [10, -5]});
        let r = build(&lanes(&["m1", "m2"], bays.clone()), &items()).unwrap_err();
        assert_eq!(
            r.iter()
                .filter_map(|r| r["bay"].as_str())
                .collect::<Vec<_>>(),
            ["rack.7"]
        );
        assert!(build(&lanes(&["m1", "m2", "r"], bays), &items()).is_ok());
    }

    /// An edge shorter than a vehicle and its gap is refused by name.
    #[test]
    fn a_short_edge_is_refused() {
        let mut it = items();
        it.insert("r".into(), path(&[[10.0, -2.0], [10.0, 0.0]]));
        let bays = json!({"park.1": [0, 0], "park.2": [20, 0], "rack.7": [10, -2]});
        let r = build(&lanes(&["m1", "m2", "r"], bays), &it).unwrap_err();
        assert_eq!(
            r.iter()
                .filter_map(|r| r["path"].as_str())
                .collect::<Vec<_>>(),
            ["r"]
        );
    }

    /// Two vehicles whose stretches share a zone fail lanes.clear there; their footprints, apart,
    /// don't; one waiting past the limit fails lanes.stuck once.
    #[test]
    fn the_rules_read_zones_footprints_and_waits() {
        let bays = json!({"park.1": [0, 0], "park.2": [20, 0], "rack.7": [10, -5]});
        let g = build(&lanes(&["m1", "m2", "r"], bays), &items()).unwrap();
        let step = FLICKS / 10;
        let mut j = Judge::new(&g, step, 1.0);
        j.step(
            0,
            &[[8.5, 0.0], [10.0, -1.5]],
            &[0.0, std::f64::consts::FRAC_PI_2],
            &[1, 2],
        );
        j.step(
            1,
            &[[2.0, 0.0], [10.0, -3.0]],
            &[0.0, std::f64::consts::FRAC_PI_2],
            &[1, 2],
        );
        for k in 2..13 {
            j.step(k, &[[2.0, 0.0], [10.0, -3.0]], &[0.0, 0.0], &[0, 2]);
        }
        let v = j.result();
        assert_eq!(
            v["rules"]["lanes.clear"]["fails"],
            json!([{"step": 0, "zone": "junction:m1,m2,r", "vehicles": [0, 1]}])
        );
        assert_eq!(
            v["rules"]["lanes.stuck"]["fails"],
            json!([{"step": 10, "vehicle": 1, "waited": 1.1}])
        );
        let mut j = Judge::new(&g, step, 60.0);
        j.step(0, &[[5.0, 0.0], [5.5, 0.6]], &[0.0, 0.0], &[1, 1]);
        let fails = j.result()["rules"]["lanes.clear"]["fails"].clone();
        assert_eq!(
            fails,
            json!([{"step": 0, "zone": "m1.1", "vehicles": [0, 1]}, {"step": 0, "zone": "m1.2", "vehicles": [0, 1]},
            {"step": 0, "zone": null, "vehicles": [0, 1]}])
        );
    }
}
