//! #450: a trail on a 3D `mark.line@1` (canvas primitives: Marks in 3D: trail). The motion
//! module reads the trail and gives its traces ([`deep_canvas_motion::trail`]); this reads the
//! source's world position at earlier times through the same pure evaluation as the frame
//! (channels, drivers, parents, or a physics bake's outputs), rides a `space: local` trace along
//! its source's parent, and draws the line, tapered and faded toward each trace's oldest point.

use std::sync::Arc;

use deep_canvas::camera::Vec3;
use deep_canvas_motion::program::Program;
pub use deep_canvas_motion::trail::{Held, Trace, Trail, Window};
use serde_json::{Map, Value};

use crate::scene::{Line, Refused, Segment};

/// What a trail draws at t: the trail, its source's place at t, its traces, the whole window's
/// baked samples, and each segment's alpha at its two ends, in the line's segment order.
#[derive(Clone, Debug, PartialEq)]
pub struct Drawn {
    pub trail: Trail,
    pub source: Vec3,
    pub traces: Vec<Trace>,
    pub samples: Option<Arc<Vec<(i64, Vec3)>>>,
    pub alpha: Vec<[f64; 2]>,
}

/// The source's world places at the times asked, or why it can't be read.
pub type Places<'a> = dyn Fn(&[i64]) -> Result<Vec<Vec3>, Refused> + 'a;

fn ours(r: deep_canvas_motion::doc::Refused) -> Refused {
    Refused {
        code: r.code,
        path: r.path,
    }
}

/// The line's trail, or `None` when it has none; a field out of its range is refused, naming it.
pub fn read(params: &Value, path: &str) -> Result<Option<Trail>, Refused> {
    deep_canvas_motion::trail::read(params, path).map_err(ours)
}

/// Where `item` stood (world m) at each of `times`, read through the chain a trail reads (#450;
/// #166's wake reads it in the water's plane): its channels and parents, or a physics bake's
/// output kept through the world's span, `<world>#<body>`, never an earlier frame
/// ([`crate::water::logic_moved`] refuses an item a logic array moves). An `#anchor` on an item
/// reads the item's origin; a source that resolves to nothing is refused at `path`.
pub(crate) fn path_at(
    map: &Map<String, Value>,
    program: &Program,
    items: &crate::scene::Items<'_>,
    item: &str,
    times: &[i64],
    path: &str,
) -> Result<Vec<Vec3>, Refused> {
    let unresolved = || {
        Err(Refused {
            code: "ref_unresolved",
            path: path.to_string(),
        })
    };
    if let Some((owner, body)) = item.split_once('#') {
        let world = items.get(owner);
        if world.is_some_and(|w| w.get("kind").and_then(Value::as_str) == Some("fixture.world@1")) {
            let params = world.map_or(Value::Null, |w| w["params"].clone());
            let bake = crate::fixtures::bake(&params, &format!("items/{owner}/params"))?;
            let Some(k) = bake.bodies.iter().position(|b| b.id == body) else {
                return unresolved();
            };
            return Ok(times.iter().map(|&at| bake.at(at)[k]).collect());
        }
    }
    let id = item.split('#').next().unwrap_or(item);
    if items.get(id).is_none() {
        return unresolved();
    }
    let at = |t| crate::scene::origin_at(map, program, id, t);
    Ok(times.iter().map(|&t| at(t)).collect())
}

/// What `trail` on line `id` (at `path`) draws at `t`, the source read at earlier times through
/// `at`, a whole window's samples kept in `held`.
pub fn drawn(
    trail: &Trail,
    (map, program, t): (&Map<String, Value>, &Program, i64),
    (id, path): (&str, &str),
    at: &Places<'_>,
    held: &mut Held,
) -> Result<Drawn, Refused> {
    let places = |times: &[i64]| {
        at(times).map_err(|r| deep_canvas_motion::doc::Refused {
            code: r.code,
            path: r.path,
            detail: None,
        })
    };
    let traced =
        deep_canvas_motion::trail::traced(trail, (map, program, t), (id, path), &places, held)
            .map_err(ours)?;
    Ok(Drawn {
        trail: trail.clone(),
        source: traced.source,
        traces: traced.traces,
        samples: traced.samples,
        alpha: Vec::new(),
    })
}

/// A `space: local` trail's traces moved with its source's parent: each point evaluated at τ is
/// taken into the parent's space as the parent stood then, and out again as it stands at t, so
/// the trace rides along; a source with no parent, or a world trail, is left as it is.
pub fn ride(
    trail: &Trail,
    drawn: &mut Drawn,
    world_at: impl Fn(&str, i64) -> crate::scene::Affine3,
    map: &Map<String, Value>,
    t: i64,
) {
    let source = trail.of.split('#').next().unwrap_or("");
    let parent = map
        .get("items")
        .and_then(|i| i.get(source))
        .and_then(|i| i.get("parent"))
        .and_then(Value::as_str);
    let Some(parent) = parent.filter(|_| trail.local) else {
        return;
    };
    let now = world_at(parent, t);
    for tr in &mut drawn.traces {
        for (p, &at) in tr.points.iter_mut().zip(&tr.times) {
            let then = crate::cut::inverse(&world_at(parent, at));
            *p = crate::scene::apply(&now, crate::scene::apply(&then, *p));
        }
    }
}

/// The line a trail draws: each trace's points joined in order, its width tapered and its alpha
/// faded toward the trace's oldest point, `(1 − u)^taper` and `(1 − u)^fade` at the share `u` of
/// the trace's time behind its newest point.
pub fn line(
    id: &str,
    trail: &Trail,
    mut drawn: Drawn,
    color: [u8; 3],
    world: bool,
    cap: crate::points::Cap,
) -> Line {
    let mut segments = Vec::new();
    let mut alpha = Vec::new();
    for tr in &drawn.traces {
        let share = deep_canvas_motion::trail::shares(trail, tr);
        for k in 1..tr.points.len() {
            segments.push(Segment {
                a: tr.points[k - 1],
                b: tr.points[k],
                wa: trail.width * share[k - 1].0,
                wb: trail.width * share[k].0,
                hidden: false,
            });
            alpha.push([share[k - 1].1, share[k].1]);
        }
    }
    drawn.alpha = alpha;
    Line {
        id: id.to_string(),
        segments,
        world,
        color,
        edges: None,
        over: false,
        joined: true,
        dash: [0.0; 2],
        dash_world: false,
        cap,
        trail: Some(Arc::new(drawn)),
    }
}
