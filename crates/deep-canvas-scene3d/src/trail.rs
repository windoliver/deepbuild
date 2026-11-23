//! #450: a trail on a 3D `mark.line@1` (canvas primitives: Marks in 3D: trail). The motion
//! module reads the trail and gives its traces ([`deep_canvas_motion::trail`]); this reads the
//! source's world position at earlier times through the same pure evaluation as the frame
//! (channels, drivers, parents, or a physics bake's outputs), rides a `space: local` trace along
//! its source's parent, and draws the line, tapered and faded toward each trace's oldest point.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
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
/// #166's wake reads it in the water's plane): its channels and parents, the drivers that read a
/// logic bake's earlier steps (#265), or a physics bake's output kept through the world's span,
/// `<world>#<body>`, never an earlier frame ([`crate::water::dragged`] refuses an item a live
/// drag moves). An `#anchor` on an item reads the item's origin; a source that resolves to
/// nothing is refused at `path`.
pub(crate) fn path_at(
    (map, program, memo): (&Map<String, Value>, &Program, &RefCell<Memo>),
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
    let floor = oldest_step(map, item);
    let mut memo = memo.borrow_mut();
    let kept = memo.of_item(id);
    Ok(times
        .iter()
        .map(|&t| {
            let t = t.max(floor);
            *kept
                .entry(t)
                .or_insert_with(|| crate::scene::origin_at(map, program, id, t))
        })
        .collect())
}

/// #265: the earliest time an earlier-time read of `item` reaches: for a source a logic array
/// moves, the bake's oldest kept step, step 0 at t = 0, which a read before it holds as a keyed
/// source holds its first key; for any other source, none.
fn oldest_step(map: &Map<String, Value>, item: &str) -> i64 {
    match deep_canvas_motion::trail::logic_moved(map, item) {
        true => 0,
        false => i64::MIN,
    }
}

/// #265: the places trails and wakes read at earlier times, by item and time (world m), kept
/// with the document and the program they were read from. Each is a pure function of those and
/// the time, so a frame reads again only the times no earlier frame of the same document read,
/// and a seek reads exactly what play does; another document or program drops them all.
#[derive(Clone, Debug, Default)]
pub struct Memo {
    from: Option<Box<(Map<String, Value>, Program)>>,
    at: HashMap<String, BTreeMap<i64, Vec3>>,
}

/// Whether any of `items` reads a source at earlier times: a line's trail or a material's wake.
pub(crate) fn samples(items: &Map<String, Value>) -> bool {
    items.values().any(|i| {
        i.pointer("/params/trail").is_some_and(|t| !t.is_null())
            || i.pointer("/params/water/wake/item").is_some()
    })
}

/// The most places a memo keeps before it lets them all go together.
const MEMO_MAX: usize = 1 << 16;

impl Memo {
    /// Keeps the places read from `map` and `program`, and drops any read from another.
    pub(crate) fn of(&mut self, map: &Map<String, Value>, program: &Program) {
        let same = self
            .from
            .as_ref()
            .is_some_and(|f| f.0 == *map && f.1 == *program);
        let held: usize = self.at.values().map(BTreeMap::len).sum();
        if !same || held > MEMO_MAX {
            self.at.clear();
        }
        if !same {
            self.from = Some(Box::new((map.clone(), program.clone())));
        }
    }

    fn of_item(&mut self, id: &str) -> &mut BTreeMap<i64, Vec3> {
        if !self.at.contains_key(id) {
            self.at.insert(id.to_string(), BTreeMap::new());
        }
        self.at.get_mut(id).expect("inserted above")
    }
}

/// #265: where `item` stood (world m) at each of `times`, read through the chain a trail reads,
/// for a host that holds no evaluated scene: a world-space emitter's anchor at its birth
/// buckets. `<world>#<body>` reads the physics bake; an `#anchor` on an item reads its origin.
pub fn places(map: &Map<String, Value>, item: &str, times: &[i64]) -> Result<Vec<Vec3>, Refused> {
    let unresolved = || Refused {
        code: "ref_unresolved",
        path: format!("items/{}", item.split('#').next().unwrap_or(item)),
    };
    let items = map.get("items").and_then(Value::as_object);
    let of = |id: &str| items.and_then(|i| i.get(id));
    if let Some((owner, body)) = item.split_once('#') {
        let world =
            of(owner).filter(|w| w.get("kind").and_then(Value::as_str) == Some("fixture.world@1"));
        if let Some(w) = world {
            let bake = crate::fixtures::bake(&w["params"], &format!("items/{owner}/params"))?;
            let k = bake
                .bodies
                .iter()
                .position(|b| b.id == body)
                .ok_or_else(unresolved)?;
            return Ok(times.iter().map(|&at| bake.at(at)[k]).collect());
        }
    }
    let id = item.split('#').next().unwrap_or(item);
    of(id).ok_or_else(unresolved)?;
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let floor = oldest_step(map, item);
    Ok(times
        .iter()
        .map(|&t| crate::scene::origin_at(map, &program, id, t.max(floor)))
        .collect())
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
    fog: bool,
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
        points: Vec::new(),
        fog,
    }
}
