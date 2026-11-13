//! An item's bake (Particles `particles@1`): its params read and every table built at check from
//! the document and its evaluated scene: the turbulence paths, the landing map of a collection's
//! static items, and the bursts from stated times, a baked occurrence list or another item's
//! particles. A host keeps a bake by [`key`] and evaluates or packs it at any t.

use deep_canvas_scene3d::scene::Scene;
use deep_canvas_scene3d::shore;
use serde_json::Value;

use super::bursts::{self, Event, Table};
use super::eval::{self, Baked};
use super::heightmap::{self, Map};
use super::spec::{self, Land, Refusal, Shape, Spec};
use super::surface;
use super::{turbulence, Planted, V3};

/// What a bake reads.
pub struct Inputs<'a> {
    /// The document, with its baked occurrence lists inlined under `occurrences`.
    pub doc: &'a Value,
    /// The scene evaluated at any time: the landing map reads only static items.
    pub scene: &'a Scene,
    pub id: &'a str,
    pub params: &'a Value,
    pub seed: u32,
    /// The emitter's origin in world metres.
    pub origin: V3,
    /// The curve its shape or motion runs along, resampled, and its length.
    pub curve: (Vec<V3>, f64),
    /// The item it bursts at the particles of, by ID, baked.
    pub parent: Option<(&'a str, &'a Baked)>,
    pub planted: Planted,
}

/// The item baked, or the first refusal, naming the item and the field.
pub fn bake(i: &Inputs<'_>) -> Result<Baked, Refusal> {
    let spec = spec::read(i.doc, i.id, i.params)?;
    let mut b = Baked::new(i.id, spec.clone(), i.seed, i.origin);
    b.curve = i.curve.0.clone();
    b.curve_len = i.curve.1;
    b.planted = i.planted;
    b.turbulence = spec
        .turbulence
        .map(|t| turbulence::build(&t, i.seed, i.planted.zero_table));
    if let Some(land) = &spec.land {
        b.map = Some(land_map(i, land)?);
    }
    b.births = super::births::Births::of(i.doc, i.id);
    let on = &i.params["emit"]["on"];
    let mut events = bursts::stated(&spec, i.origin);
    let mut bursting = !spec.bursts.is_empty();
    if on.is_object() {
        bursting = true;
        if on.get("list").is_some() {
            events.extend(bursts::from_list(i.id, on, i.doc)?);
        } else if let Some(parent) = on["particles"].as_str() {
            let p = i
                .parent
                .filter(|(pid, _)| *pid == parent)
                .map(|(_, b)| b)
                .ok_or_else(|| {
                    Refusal::new(
                        "ref_unresolved",
                        format!("items/{}/params/emit/on/particles", i.id),
                        format!(
                            "{}: emit.on.particles names {parent}, no particles item before it",
                            i.id
                        ),
                    )
                })?;
            events.extend(at_parent(i.id, on, p)?);
        }
    }
    if bursting {
        let table = Table::of(events);
        if let Some(r) = bursts::over_count(i.id, table.peak(spec.life[1]), spec.count) {
            return Err(r);
        }
        b.bursts = Some(table);
    }
    if let Shape::Surface(of) = &spec.shape {
        if let Some(r) = surface::over_cap(i.doc, i.id, of, Some(i.scene)) {
            return Err(r);
        }
        let step = i
            .doc
            .get("transport")
            .and_then(deep_canvas::document::frame_rate_of)
            .map_or(1.0 / 60.0, |(p, q)| f64::from(q) / f64::from(p));
        let span = i
            .doc
            .pointer("/transport/span")
            .and_then(Value::as_str)
            .and_then(|t| spec::seconds(i.doc, t).ok())
            .unwrap_or(spec.span.min(1e4));
        let mut at: Vec<f64> = Vec::new();
        for r in b.bursts.iter().flat_map(|t| &t.rows) {
            at.extend([r.t - 0.5 * step, r.t, r.t + 0.5 * step]);
        }
        let times = surface::Times { at, span, step };
        let sf = surface::bake(
            i.doc,
            i.id,
            of,
            &times,
            i.planted.bind_pose,
            i.planted.bounds_bind_pose,
        )?;
        b.surface = Some(std::sync::Arc::new(sf));
    }
    Ok(b)
}

/// The landing map of `land.on`'s members as the scene draws them, refusing a member that moves.
fn land_map(i: &Inputs<'_>, land: &Land) -> Result<Map, Refusal> {
    let path = format!("items/{}/params/land/on", i.id);
    let members: Vec<&str> = i.doc["collections"][&land.on]["members"]
        .as_array()
        .map(|m| m.iter().filter_map(Value::as_str).collect())
        .ok_or_else(|| {
            Refusal::new(
                "ref_unresolved",
                &path,
                format!(
                    "{}: land.on names {}, which is no collection",
                    i.id, land.on
                ),
            )
        })?;
    if let Some(doc) = i.doc.as_object() {
        if let Some(m) = shore::moving_member(doc, members.iter().copied()) {
            return Err(moving(i.id, m));
        }
    }
    let triangles: Vec<[V3; 3]> = i
        .scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(|s| members.contains(&s.id.as_str()))
        .flat_map(shore::triangles)
        .collect();
    let mut map = heightmap::bake(&triangles, land.cell, &path, i.id)?;
    if i.planted.floor_plane {
        // The planted landing: against the floor's plane alone.
        let floor = map.bottom;
        map.heights.iter_mut().for_each(|h| *h = h.map(|_| floor));
        map.top = floor;
    }
    Ok(map)
}

/// The refusal of a landing whose collection holds `m`, which moves: a map is baked once.
pub fn moving(id: &str, m: &str) -> Refusal {
    Refusal::new(
        "out_of_range",
        format!("items/{id}/params/land/on"),
        format!("{id}: land.on's {m} moves or reshapes during the span, and a landing map is baked once"),
    )
    .with(Value::from(m))
    .naming(m)
}

/// `emit.on: {particles, at, count, max_bursts}`: a burst at each of the parent's first births
/// or deaths, at its place, inheriting its velocity there.
fn at_parent(id: &str, on: &Value, parent: &Baked) -> Result<Vec<Event>, Refusal> {
    let death = on["at"].as_str() == Some("death");
    let max = on["max_bursts"].as_u64().unwrap_or(256) as usize;
    let count = on["count"].as_u64().unwrap_or(12);
    if count > u64::from(spec::MAX_BURST) {
        return Err(Refusal::new(
            "out_of_range",
            format!("items/{id}/params/emit/on/count"),
            format!(
                "{id}: a burst's count reaches {count}, past its cap of {}",
                spec::MAX_BURST
            ),
        ));
    }
    let mut events: Vec<Event> = eval::fates(parent, death, max)
        .into_iter()
        .map(|(t, point, velocity)| Event {
            t,
            point,
            normal: [0.0; 3],
            speed: 0.0,
            velocity,
            count: count as u32,
        })
        .collect();
    events.truncate(max);
    Ok(events)
}

/// The content key a host keeps a bake by: the item's params, seed and origin, the curve, and
/// every document field a table reads (the occurrence lists, the collections and their members'
/// places).
pub fn key(i: &Inputs<'_>, spec: &Spec) -> String {
    let mut h = deep_canvas::schedule::Hasher::new("particles.bake");
    h.bytes(i.id.as_bytes())
        .bytes(i.params.to_string().as_bytes())
        .bytes(&i.seed.to_le_bytes());
    for x in i.origin.iter().chain(i.curve.0.iter().flatten()) {
        h.bytes(&x.to_le_bytes());
    }
    if spec.land.is_some() || i.params["emit"]["on"].is_object() {
        h.bytes(i.doc["occurrences"].to_string().as_bytes())
            .bytes(i.doc["collections"].to_string().as_bytes())
            .bytes(i.doc["items"].to_string().as_bytes());
    }
    h.finish().hex()
}
