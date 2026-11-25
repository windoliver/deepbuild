//! Issue #3036: tracks on the ground (canvas primitives: Builder plate: terrain). A terrain
//! plate's `tracks` names a collection of items. At t the plate reads each one's place at every
//! whole multiple of the document's frame interval over the span, through the chain a trail reads
//! ([`crate::trail::path_at`]), never an earlier frame; where the item's lowest point was no more
//! than 2 cm over the plate, the surface a frame draws lowers by up to `depth` across `width` in a
//! raised-cosine profile about the path the item took, and darkens by `darken`. It is drawing
//! only: the solid's mesh changes, and the plate's samples, which its physics shape, picks,
//! `rest_on` and every measure read, stay as built.

use std::cell::RefCell;
use std::sync::Arc;

use deep_canvas::color::{srgb_decode, srgb_encode};
use deep_canvas::document::Issue;
use deep_canvas::geometry_audit::Shape as True;
use deep_canvas::heights::Heights;
use deep_canvas::ops::{cos, hypot, PI};
use deep_canvas::schedule::{Canonical, Hasher};
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

use crate::geom::Mesh;
use crate::scene::{apply, Items, Refused, Shape, Solid};
use crate::spec::{p, P, S};

/// The most samples alive on one plate; a plate that would read more is refused at check.
pub const MAX_SAMPLES: usize = 4096;
/// How far over the plate an item's lowest point may be where it marks the ground, m.
const NEAR: f64 = 0.02;
const FLICKS: i64 = deep_canvas::camera::FLICKS_PER_SECOND;
const KEYS: [&str; 5] = ["items", "width", "depth", "span", "darken"];
const FIX: &str = "Name fewer items, shorten `span`, or lower the document's frame rate.";

/// The planted plate that lowers about each place it read alone, with nothing between them.
pub const AT_SAMPLES_ONLY: &str = "tracks_lower_at_samples_only";
/// The planted plate that reads each item's x and z alone, never how high it is.
pub const GROUND_POSITION: &str = "tracks_read_ground_position";
/// The planted plate whose physics shape takes the heights it draws (`terrain_rays` plants it).
pub const FEEDS_PHYSICS: &str = "tracks_feed_physics_shape";
/// The planted plate that keeps the surface the frame before drew and lowers it about each
/// item's place now.
pub const KEEPS_LAST_FRAME: &str = "tracks_keep_last_frame";

/// `tracks` among a plate's params: shading class, so it reaches no content key.
pub(crate) fn param() -> P {
    p(
        "tracks",
        "tracks",
        "",
        Value::Null,
        S,
        Value::Null,
        json!("none"),
    )
    .takes("{items: collection, width: m, depth: m, span?: s | all, darken?: 0..1} | none")
}

/// A plate's `tracks` as read: the collection's members, the profile's width and depth in m, how
/// far back it reads in s (none for `all`) and how much it darkens.
#[derive(Clone, Debug, PartialEq)]
struct Tracks {
    items: Vec<String>,
    width: f64,
    depth: f64,
    span: Option<f64>,
    darken: f64,
}

/// A refusal: its code, its path, what it refused there and why.
struct Fault {
    code: &'static str,
    path: String,
    actual: Value,
    what: String,
}

impl Fault {
    fn issue(self, id: &str) -> Issue {
        let mut issue = Issue::error(self.code, id, self.path, self.actual, &self.what);
        if self.code == "over_budget" {
            issue.fix = FIX.into();
        }
        issue
    }

    /// A frame's refusal, its issue left in the host's memo where the host keeps one.
    fn refused(self, id: &str, memo: Option<&RefCell<crate::contributed::Memo>>) -> Refused {
        let refused = Refused {
            code: self.code,
            path: self.path.clone(),
        };
        if let Some(memo) = memo {
            memo.borrow_mut().refused = Some(self.issue(id).to_json());
        }
        refused
    }
}

/// The items a plate's tracks read at earlier times: the members of the collection they name.
pub(crate) fn sources<'a>(
    doc: &'a Map<String, Value>,
    item: &'a Value,
) -> impl Iterator<Item = &'a str> {
    let named = item.pointer("/params/tracks/items").and_then(Value::as_str);
    let members = named.and_then(|c| doc.get("collections")?.get(c)?.get("members")?.as_array());
    members.into_iter().flatten().filter_map(Value::as_str)
}

/// The plate `id`'s `tracks`, none where it keeps none; a field out of its range, tracks on a
/// plate with no terrain and a collection the document lacks are refused, naming the field.
fn read(doc: &Map<String, Value>, id: &str, params: &Value) -> Result<Option<Tracks>, Fault> {
    let spec = match params.get("tracks") {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(s)) if s == "none" => return Ok(None),
        Some(v) => v,
    };
    let bad = |code, k: &str, what: &str| Fault {
        code,
        path: format!("items/{id}/params/tracks/{k}")
            .trim_end_matches('/')
            .to_string(),
        actual: spec.get(k).unwrap_or(spec).clone(),
        what: what.into(),
    };
    let fields = spec
        .as_object()
        .filter(|_| crate::terrain::of_params(params).is_some())
        .ok_or_else(|| {
            bad(
                "out_of_range",
                "",
                "a terrain plate keeps tracks, as an object",
            )
        })?;
    if let Some(k) = fields.keys().find(|k| !KEYS.contains(&k.as_str())) {
        return Err(bad("out_of_range", k.as_str(), "tracks hold no such field"));
    }
    let members = fields
        .get("items")
        .and_then(Value::as_str)
        .and_then(|c| doc.get("collections")?.get(c)?.get("members")?.as_array())
        .ok_or_else(|| {
            bad(
                "ref_unresolved",
                "items",
                "tracks name a collection of items",
            )
        })?;
    let range = "tracks take a width over 0 m, a depth of 0 m or more, a span over 0 s or `all`, \
                 and a darken from 0 to 1";
    let num = |k: &str, default: Option<f64>, least: f64, most: f64| {
        let within = |x: &f64| x.is_finite() && (least..=most).contains(x);
        match (fields.get(k).filter(|v| !v.is_null()), default) {
            (None, Some(d)) => Ok(d),
            (v, _) => v
                .and_then(Value::as_f64)
                .filter(within)
                .ok_or_else(|| bad("out_of_range", k, range)),
        }
    };
    let span = match fields.get("span") {
        Some(Value::String(s)) if s == "all" => None,
        None | Some(Value::Null) => None,
        Some(_) => Some(num("span", None, f64::MIN_POSITIVE, f64::MAX)?),
    };
    Ok(Some(Tracks {
        items: members
            .iter()
            .filter_map(|m| m.as_str().map(str::to_string))
            .collect(),
        width: num("width", None, f64::MIN_POSITIVE, f64::MAX)?,
        depth: num("depth", None, 0.0, f64::MAX)?,
        span,
        darken: num("darken", Some(0.2), 0.0, 1.0)?,
    }))
}

/// How far back a plate's samples reach, in flicks: its span, and no further than the
/// document's own; none where neither ends.
fn reach(doc: &Map<String, Value>, tracks: &Tracks) -> Option<i64> {
    let own = tracks.span.map(|s| (s * FLICKS as f64).round() as i64);
    let whole = doc
        .get("transport")
        .and_then(|t| t.get("span"))
        .and_then(crate::fixtures::time);
    match (own, whole) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

/// The times a plate reads at `t`, oldest first, in flicks: each whole multiple of the frame
/// interval `step` from t − `reach` to t, both ends counted, none before the document's start.
fn times(t: i64, step: i64, reach: Option<i64>) -> Vec<i64> {
    let first = reach.map_or(0, |r| -(r - t).div_euclid(step)).max(0);
    (first..=t.div_euclid(step)).map(|k| k * step).collect()
}

/// The plate's tracks with the document's frame interval and their reach, none where it keeps
/// none. The samples alive at one time are each item's over the reach, or up to `t` where
/// nothing ends it; more than [`MAX_SAMPLES`] are refused, naming the plate and the count.
fn admitted(
    doc: &Map<String, Value>,
    id: &str,
    params: &Value,
    t: i64,
) -> Result<Option<(Tracks, i64, Option<i64>)>, Fault> {
    let Some(tracks) = read(doc, id, params)? else {
        return Ok(None);
    };
    let step = crate::trail::frame_interval(doc).max(1);
    let reach = reach(doc, &tracks);
    let count = tracks.items.len() * (reach.unwrap_or(t.max(0)) / step + 1) as usize;
    if count > MAX_SAMPLES {
        return Err(Fault {
            code: "over_budget",
            path: format!("items/{id}/params/tracks"),
            actual: json!({"plate": id, "count": count}),
            what: format!(
                "{count} samples are alive at one time on {id}: a plate reads {MAX_SAMPLES}"
            ),
        });
    }
    Ok(Some((tracks, step, reach)))
}

/// The check over `form`'s plates that keep tracks: each one's refusal, as a frame refuses it.
pub fn check(form: &Value) -> Vec<Issue> {
    let Some(doc) = form.as_object() else {
        return Vec::new();
    };
    let items = doc.get("items").and_then(Value::as_object);
    items
        .into_iter()
        .flatten()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("plate@1"))
        .filter_map(|(id, i)| {
            let params = i.get("params").unwrap_or(&Value::Null);
            Some(admitted(doc, id, params, 0).err()?.issue(id))
        })
        .collect()
}

/// How far `p` lies from the segment `a`–`b`, in the ground's plane.
fn distance(p: [f64; 2], [a, b]: [[f64; 2]; 2]) -> f64 {
    let (ab, ap) = ([b[0] - a[0], b[1] - a[1]], [p[0] - a[0], p[1] - a[1]]);
    let l2 = ab[0] * ab[0] + ab[1] * ab[1];
    let h = if l2 > 0.0 {
        ((ap[0] * ab[0] + ap[1] * ab[1]) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    hypot(ap[0] - ab[0] * h, ap[1] - ab[1] * h)
}

/// The most cells a field's grid holds a side.
const GRID: usize = 256;

/// What a plate lowers about: the stretches its items took on the ground, in world x and z (a
/// place alone is a stretch of no length), found through a grid over them so a point reads the
/// few near it.
struct Field {
    segs: Vec<[[f64; 2]; 2]>,
    /// Half the profile's width, m.
    half: f64,
    lo: [f64; 2],
    cell: [f64; 2],
    n: [usize; 2],
    cells: Vec<Vec<u32>>,
}

impl Field {
    /// A field over `segs`, which hold one stretch or more.
    fn new(segs: Vec<[[f64; 2]; 2]>, half: f64) -> Field {
        let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
        for q in segs.iter().flatten() {
            for a in 0..2 {
                lo[a] = lo[a].min(q[a] - half);
                hi[a] = hi[a].max(q[a] + half);
            }
        }
        let n = [0, 1].map(|a| (((hi[a] - lo[a]) / half).ceil() as usize).clamp(1, GRID));
        let cell = [0, 1].map(|a| (hi[a] - lo[a]) / n[a] as f64);
        let mut f = Field {
            segs: Vec::new(),
            half,
            lo,
            cell,
            n,
            cells: vec![Vec::new(); n[0] * n[1]],
        };
        for (k, [a, b]) in segs.iter().enumerate() {
            let from = f.at([a[0].min(b[0]) - half, a[1].min(b[1]) - half]);
            let to = f.at([a[0].max(b[0]) + half, a[1].max(b[1]) + half]);
            for j in from[1]..=to[1] {
                for i in from[0]..=to[0] {
                    f.cells[j * n[0] + i].push(k as u32);
                }
            }
        }
        f.segs = segs;
        f
    }

    /// The cell that holds `q`, or the nearest one on the grid.
    fn at(&self, q: [f64; 2]) -> [usize; 2] {
        [0, 1].map(|a| {
            let c = ((q[a] - self.lo[a]) / self.cell[a]).floor().max(0.0);
            (c as usize).min(self.n[a] - 1)
        })
    }

    /// The share of the depth the surface lowers by at (x, z): a raised cosine of its distance
    /// to the nearest stretch, 1 on it and 0 from half the width out.
    fn weight(&self, x: f64, z: f64) -> f64 {
        let on = |a: usize, v: f64| {
            (self.lo[a]..=self.lo[a] + self.cell[a] * self.n[a] as f64).contains(&v)
        };
        if !(on(0, x) && on(1, z)) {
            return 0.0;
        }
        let c = self.at([x, z]);
        let d = self.cells[c[1] * self.n[0] + c[0]]
            .iter()
            .map(|&k| distance([x, z], self.segs[k as usize]))
            .fold(f64::INFINITY, f64::min);
        if d < self.half {
            0.5 * (1.0 + cos(PI * d / self.half))
        } else {
            0.0
        }
    }
}

/// The lowest point of a true shape, m.
fn low(shape: &True) -> f64 {
    match shape {
        True::Ball { c, r } => c[1] - r,
        True::Capsule { a, b, r } => a[1].min(b[1]) - r,
        True::Obb { c, axes, half } => {
            c[1] - (0..3).map(|j| axes[j][1].abs() * half[j]).sum::<f64>()
        }
        True::Heights(h) => h.aabb()[0][1],
    }
}

/// How far under its origin `item`'s lowest point lies as it stands at `secs`: a baked body's
/// radius, another item's true shape's reach down, nothing for an item with no shape.
fn below(doc: &Value, items: &Items<'_>, item: &str, secs: f64) -> f64 {
    let (id, body) = item.split_once('#').unwrap_or((item, ""));
    let Some(it) = items.get(id) else {
        return 0.0;
    };
    if it.get("kind").and_then(Value::as_str) == Some("fixture.world@1") {
        let world = crate::fixtures::bake(&it["params"], "").ok();
        let radius = world.and_then(|w| Some(w.bodies.iter().find(|b| b.id == body)?.radius));
        return radius.unwrap_or(0.0);
    }
    let m = crate::scene::world_moved(items, id, None);
    let shapes = crate::shapes::of(doc, id, it, &m, secs).ok().flatten();
    let lowest = shapes
        .iter()
        .flat_map(|(shapes, _)| shapes)
        .map(low)
        .fold(f64::INFINITY, f64::min);
    if lowest.is_finite() {
        m[1][3] - lowest
    } else {
        0.0
    }
}

/// `built` as a frame draws it: each vertex lowered by its share `w` of the depth, the normals
/// made again where `grid` says the mesh is the plate's own samples, and with a darken each
/// vertex's own color, the plate's base color less its share of the darken.
fn lowered(built: &Mesh, w: &[f64], tracks: &Tracks, plate: &Solid, grid: bool) -> Mesh {
    let mut m = built.clone();
    let up = Some(plate.model[1][1]).filter(|s| *s != 0.0).unwrap_or(1.0);
    for (q, w) in m.positions.iter_mut().zip(w) {
        q[1] -= tracks.depth * w / up;
    }
    if grid {
        let tris = m.triangles();
        crate::terrain::smooth(&mut m, tris);
    }
    if tracks.darken > 0.0 {
        let base = match &plate.material {
            Some(mat) => [mat.base[0], mat.base[1], mat.base[2]],
            None => plate.color.map(|c| srgb_decode(f64::from(c) / 255.0)),
        };
        for (name, c) in ["color.r", "color.g", "color.b"].into_iter().zip(base) {
            let channel = w.iter().map(|w| srgb_encode(c * (1.0 - tracks.darken * w)));
            m.attributes.insert(name.into(), channel.collect());
        }
    }
    m
}

/// A plate's solid as a frame at `t` draws it, with its mesh and the hash it draws by, which its
/// tiles are made from. A plate that keeps no tracks, or whose items have marked nothing yet,
/// draws as built; one that does draws its mesh lowered and darkened about the stretches its
/// items took, keyed by what it then holds.
pub(crate) fn of(
    plate: &mut Solid,
    (doc, map, program, t): (&Value, &Map<String, Value>, &Program, i64),
    memo: &RefCell<crate::trail::Memo>,
    items: &Items<'_>,
    ask: &crate::contributed::Ask<'_>,
) -> Result<(Arc<Mesh>, u64), Refused> {
    let built = plate.mesh.clone().expect("a built mesh");
    let Shape::Built(hash) = plate.shape else {
        return Ok((built, 0));
    };
    let item = items.get(&plate.id);
    let params = item.and_then(|i| i.get("params")).unwrap_or(&Value::Null);
    let (tracks, step, reach) = match admitted(map, &plate.id, params, t) {
        Ok(Some(read)) => read,
        Ok(None) => return Ok((built, hash)),
        Err(fault) => return Err(fault.refused(&plate.id, ask.memo)),
    };
    // The plate as built: its samples, which the mesh holds one a vertex unless a stack moved
    // them.
    let grid = crate::terrain::of_params(params).and_then(|s| crate::terrain::grid(s, false).ok());
    let Some((size, [cols, rows])) = grid else {
        return Ok((built, hash));
    };
    let own = built.positions.len() == cols * rows;
    let h: Vec<f64> = match own {
        true => built.positions.iter().map(|q| q[1]).collect(),
        false => crate::terrain::build(params, false).map_or(Vec::new(), |t| t.h),
    };
    let Some(surface) = Heights::new(apply(&plate.model, [0.0; 3]), size, cols, rows, h) else {
        return Ok((built, hash));
    };
    let planted = |name: &str| ask.planted == Some(name);
    let times = match planted(KEEPS_LAST_FRAME) {
        true => vec![t],
        false => times(t, step, reach),
    };
    let path = format!("items/{}/params/tracks/items", plate.id);
    let mut segs = Vec::new();
    for id in &tracks.items {
        let places = crate::trail::path_at((map, program, memo), items, id, &times, &path)?;
        let under = below(doc, items, id, t as f64 / FLICKS as f64);
        let on: Vec<Option<[f64; 2]>> = places
            .iter()
            .map(|q| {
                let y = surface.height(q[0], q[2])?;
                (planted(GROUND_POSITION) || q[1] - under <= y + NEAR).then_some([q[0], q[2]])
            })
            .collect();
        for (k, a) in on.iter().enumerate() {
            let Some(a) = *a else {
                continue;
            };
            let alone = planted(AT_SAMPLES_ONLY);
            match on.get(k + 1).copied().flatten() {
                Some(b) if !alone => segs.push([a, b]),
                _ if alone || k == 0 || on[k - 1].is_none() => segs.push([a, a]),
                _ => {}
            }
        }
    }
    let mut w = vec![0.0; built.positions.len()];
    if !segs.is_empty() {
        let field = Field::new(segs, tracks.width / 2.0);
        for (w, q) in w.iter_mut().zip(&built.positions) {
            let q = apply(&plate.model, *q);
            *w = field.weight(q[0], q[2]);
        }
    }
    // The planted plate: what the host kept of the frame before, and this frame's for the next.
    if let Some(memo) = ask.memo.filter(|_| planted(KEEPS_LAST_FRAME)) {
        let mut memo = memo.borrow_mut();
        let last = memo.tracks.entry(plate.id.clone()).or_default();
        if last.len() == w.len() {
            w.iter_mut()
                .zip(last.iter())
                .for_each(|(w, l)| *w = w.max(*l));
        }
        last.clone_from(&w);
    }
    if w.iter().all(|w| *w == 0.0) {
        return Ok((built, hash));
    }
    let stack = item
        .and_then(|i| i.get("modifiers"))
        .and_then(Value::as_array);
    let grid = own && stack.is_none_or(|m| m.is_empty());
    let drawn = Arc::new(lowered(&built, &w, &tracks, plate, grid));
    let mut key = Hasher::new("scene3d.mesh");
    key.bytes(&drawn.canonical_bytes());
    let key = key.finish().0;
    let hash = u64::from_le_bytes(key[..8].try_into().expect("8 bytes"));
    plate.mesh = Some(drawn.clone());
    plate.shape = Shape::Built(hash);
    Ok((drawn, hash))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(tracks: Value, span: &str, fps: u32, members: usize) -> Value {
        let balls: Vec<String> = (0..members).map(|k| format!("ball{k}")).collect();
        json!({
            "transport": {"span": span, "frame_rate": [fps, 1]},
            "collections": {"rollers": {"members": balls}},
            "items": {"ground": {"kind": "plate@1", "params": {
                "terrain": {"height": 0.5, "size": [12, 2], "spacing": 0.05}, "tracks": tracks}}},
        })
    }

    #[test]
    fn more_than_4096_samples_alive_are_refused_naming_the_plate_and_the_count() {
        let tracks =
            |span: f64| json!({"items": "rollers", "width": 0.4, "depth": 0.05, "span": span});
        // 8 items over 26 s at 24 frames a second: 8 × (26 × 24 + 1) = 5,000.
        let issues = check(&doc(tracks(26.0), "30s", 24, 8));
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "over_budget");
        assert_eq!(issues[0].path, "items/ground/params/tracks");
        assert_eq!(issues[0].actual, json!({"plate": "ground", "count": 5000}));
        // Over 20 s: 8 × 481 = 3,848, and `all` reaches no further back than the document.
        assert!(check(&doc(tracks(20.0), "30s", 24, 8)).is_empty());
        let all = json!({"items": "rollers", "width": 0.4, "depth": 0.05});
        assert!(check(&doc(all.clone(), "20s", 24, 8)).is_empty());
        assert_eq!(
            check(&doc(all.clone(), "30s", 24, 8))[0].actual["count"],
            5768
        );
        // The cap's edge: 4,096 samples are read, 4,097 refused.
        assert!(check(&doc(all.clone(), "4095s", 1, 1)).is_empty());
        assert_eq!(check(&doc(all, "4096s", 1, 1))[0].actual["count"], 4097);
    }

    #[test]
    fn tracks_under_an_item_a_live_drag_moves_are_refused_naming_the_item() {
        let tracks = json!({"items": "rollers", "width": 0.4, "depth": 0.05});
        let mut doc = doc(tracks, "1s", 60, 1);
        doc["items"]["ball0"] = json!({"kind": "mark.sphere@1"});
        assert_eq!(crate::water::dragged(doc.as_object().unwrap()), Ok(()));
        doc["controls"] = json!({"grab": {"handle": {"item": "ball0"}}});
        let refused = crate::water::dragged(doc.as_object().unwrap()).unwrap_err();
        assert_eq!(
            (refused.code, refused.path.as_str()),
            ("out_of_range", "items/ball0")
        );
    }

    #[test]
    fn a_field_out_of_its_range_is_refused_naming_it() {
        let bad = |tracks: Value| check(&doc(tracks, "1s", 60, 1)).remove(0);
        let at = |k: &str| format!("items/ground/params/tracks/{k}");
        let none = bad(json!({"items": "nobody", "width": 0.4, "depth": 0.05}));
        assert_eq!((none.code, none.path), ("ref_unresolved", at("items")));
        let wide = json!({"items": "rollers", "width": 0, "depth": 0.05});
        assert_eq!(bad(wide).path, at("width"));
        let dark = json!({"items": "rollers", "width": 0.4, "depth": 0.05, "darken": 1.5});
        assert_eq!(bad(dark).path, at("darken"));
        assert!(check(&doc(json!("none"), "1s", 60, 1)).is_empty());
    }
}
