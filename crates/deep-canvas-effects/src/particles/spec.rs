//! A particles@1 item's params, read and checked (Particles `particles@1`: Fields, emit regions,
//! occurrence bursts, bounce and kill, turbulence). Every cap the design names is refused here,
//! at check, naming the item and the field; nothing is clamped silently.

use serde_json::Value;

use super::V3;

/// At most this many particles an item holds outside a showpiece or an export.
pub const MAX_COUNT: u32 = 65_536;
/// At most this many in a showpiece or an export.
pub const MAX_COUNT_SHOWPIECE: u32 = 1_048_576;
/// At most this many bounce planes: six close a box.
pub const MAX_PLANES: usize = 6;
/// At most this many contacts before a particle rests or dies.
pub const MAX_BOUNCES: u8 = 4;
/// At most this many particles one burst holds.
pub const MAX_BURST: u32 = 256;
/// Turbulence's path and step caps.
pub const MAX_PATHS: u32 = 64;
pub const MAX_STEPS: u32 = 128;
/// Drag below this is none: the arc's no-drag forms hold (as the shipped graph's).
pub const NO_DRAG: f64 = 1e-4;

/// The count cap of a budget class (Operator budgets by class: a showpiece's or an export's
/// compute elements; every other class holds 65,536 particles an item).
pub fn count_cap(class: &str) -> u32 {
    match class {
        "showpiece" | "export" => MAX_COUNT_SHOWPIECE,
        _ => MAX_COUNT,
    }
}

/// Why an item's params are refused: the code, the path under the document, the sentence that
/// names what and why, the value refused, and any other item it names.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub path: String,
    pub what: String,
    pub actual: Box<Value>,
    pub also: Vec<String>,
}

impl Refusal {
    pub fn new(code: &'static str, path: impl Into<String>, what: impl Into<String>) -> Self {
        Self {
            code,
            path: path.into(),
            what: what.into(),
            actual: Box::new(Value::Null),
            also: Vec::new(),
        }
    }

    /// The same refusal with the value it refused.
    pub fn with(mut self, actual: Value) -> Self {
        *self.actual = actual;
        self
    }

    /// The same refusal naming another item too.
    pub fn naming(mut self, id: &str) -> Self {
        self.also.push(id.to_string());
        self
    }
}

/// Where particles are born, about the emitter's origin, +Y up.
#[derive(Clone, Debug, PartialEq)]
pub enum Shape {
    Point,
    /// A disk across +Y of this radius.
    Disk(f64),
    /// A ball of this radius.
    Sphere(f64),
    /// Along a curve item.
    Along(String),
    /// A box of this size, centred on the origin.
    Box(V3),
    /// An annulus across +Y.
    Ring {
        r: f64,
        inner: f64,
    },
    /// A cylinder about +Y, centred on the origin, `h` tall.
    Cylinder {
        r: f64,
        h: f64,
    },
    /// A cylinder `h` tall about +Y with a half-ball of radius `r` on each end.
    Capsule {
        r: f64,
        h: f64,
    },
    /// On an item's or a collection's mesh.
    Surface(String),
}

/// How a ballistic particle is launched.
#[derive(Clone, Debug, PartialEq)]
pub enum Launch {
    /// Up a cone about +Y whose cosine runs from 1 to 0.4, at a speed drawn from the range (the
    /// shipped graph's launch).
    Cone([f64; 2]),
    /// At this velocity.
    Vector(V3),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Motion {
    Ballistic {
        launch: Launch,
        gravity: V3,
        drag: f64,
    },
    Along {
        curve: Option<String>,
        speed: f64,
    },
    /// About `axis` through the emitter at `spin` rad/s.
    Orbit {
        axis: V3,
        spin: f64,
    },
    Drift {
        amplitude: f64,
        frequency: f64,
    },
}

/// A plane n̂·x = offset, its normal made unit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plane {
    pub normal: V3,
    pub offset: f64,
}

/// What a particle does at its last contact.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Then {
    Rest,
    Die,
    Bounce,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Bounce {
    pub planes: Vec<Plane>,
    pub restitution: f64,
    pub friction: f64,
    /// The contact that ends the bouncing: a particle bounces `max − 1` times, then rests or dies
    /// where it meets the `max`-th.
    pub max: u8,
    pub then: Then,
}

impl Default for Bounce {
    fn default() -> Self {
        Self {
            planes: Vec::new(),
            restitution: 0.4,
            friction: 0.2,
            max: 3,
            then: Then::Die,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Land {
    pub on: String,
    pub cell: f64,
    pub then: Then,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum KillRegion {
    Box([V3; 2]),
    Plane(Plane),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Kill {
    pub region: KillRegion,
    pub keep_inside: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Turbulence {
    pub strength: f64,
    pub frequency: f64,
    pub paths: u32,
    pub steps: u32,
    pub travel: f64,
    pub seed: Option<u32>,
}

/// A burst at a stated time.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Burst {
    pub t: f64,
    pub count: u32,
}

/// A particles@1 item, read.
#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub count: u32,
    pub life: [f64; 2],
    pub shape: Shape,
    /// Born on the region's surface rather than in its volume.
    pub on_surface: bool,
    pub rate: f64,
    pub span: f64,
    pub motion: Motion,
    pub bounce: Option<Bounce>,
    pub land: Option<Land>,
    pub kill: Option<Kill>,
    pub turbulence: Option<Turbulence>,
    /// Stated bursts (`emit.bursts`).
    pub bursts: Vec<Burst>,
    /// `inherit: {normal, velocity}`.
    pub inherit: [f64; 2],
    pub follow: bool,
}

/// The params of item `id` of `doc` read and checked, or the first refusal, naming the item and
/// the field. The count's class cap is the rule's ([`super::eval`] holds any count). A time is a
/// number of seconds or a time literal, read at the document's frame rate.
pub fn read(doc: &Value, id: &str, p: &Value) -> Result<Spec, Refusal> {
    let at = |f: &str| format!("items/{id}/params/{f}");
    let num = |v: &Value, f: &str, default: f64| -> Result<f64, Refusal> {
        match v {
            Value::Null => Ok(default),
            v => v.as_f64().filter(|x| x.is_finite()).ok_or_else(|| {
                Refusal::new("out_of_range", at(f), format!("{id}: {f} must be a number"))
            }),
        }
    };
    let vec3 = |v: &Value, f: &str, default: V3| -> Result<V3, Refusal> {
        match v {
            Value::Null => Ok(default),
            Value::Array(a) if a.len() == 3 => {
                let mut out = [0.0; 3];
                for (k, x) in a.iter().enumerate() {
                    out[k] = num(x, f, 0.0)?;
                }
                Ok(out)
            }
            _ => Err(Refusal::new(
                "out_of_range",
                at(f),
                format!("{id}: {f} must be three numbers"),
            )),
        }
    };
    let pair = |v: &Value, f: &str, default: [f64; 2]| -> Result<[f64; 2], Refusal> {
        match v {
            Value::Null => Ok(default),
            Value::Array(a) if a.len() == 2 => Ok([num(&a[0], f, 0.0)?, num(&a[1], f, 0.0)?]),
            v => num(v, f, default[0]).map(|x| [x, x]),
        }
    };
    let count = match &p["count"] {
        Value::Null => 256,
        v => v
            .as_u64()
            .and_then(|c| u32::try_from(c).ok())
            .ok_or_else(|| {
                Refusal::new(
                    "out_of_range",
                    at("count"),
                    format!("{id}: count must be a whole number of particles"),
                )
            })?,
    };
    let life = pair(&p["life"], "life", [1.0, 1.0])?;
    if life[0] <= 0.0 || life[1] < life[0] {
        return Err(Refusal::new(
            "out_of_range",
            at("life"),
            format!("{id}: life must be above 0 s, its min at most its max"),
        ));
    }
    let emit = &p["emit"];
    let radius = num(&emit["radius"], "emit/radius", 0.25)?;
    let (shape, on_surface) = shape(id, emit, radius, &num, &vec3)?;
    let rate = num(&emit["rate"], "emit/rate", 100.0)?;
    if rate < 0.0 {
        return Err(Refusal::new(
            "out_of_range",
            at("emit/rate"),
            format!("{id}: emit.rate must be 0 or more per second"),
        ));
    }
    let span = num(&emit["span"], "emit/span", 1e9)?;
    let mut bursts = Vec::new();
    // A stated burst holds any count; the item's own count holds the peak live (bursts::over_count).
    for (k, b) in emit["bursts"].as_array().into_iter().flatten().enumerate() {
        let c = b["count"].as_u64().unwrap_or(0).min(u64::from(u32::MAX));
        let t = match &b["t"] {
            Value::String(text) => seconds(doc, text).map_err(|e| {
                Refusal::new(
                    "out_of_range",
                    at(&format!("emit/bursts/{k}/t")),
                    format!("{id}: burst {k}'s t: {e}"),
                )
            })?,
            v => num(v, &format!("emit/bursts/{k}/t"), 0.0)?,
        };
        bursts.push(Burst { t, count: c as u32 });
    }
    let m = &p["motion"];
    let variant = m
        .as_object()
        .and_then(|o| o.keys().find(|k| *k != "bounce").cloned())
        .unwrap_or_else(|| "ballistic".into());
    let v = &m[&variant];
    let motion = match variant.as_str() {
        "along" => Motion::Along {
            curve: v["curve"].as_str().map(str::to_string),
            speed: num(&v["speed"], "motion/along/speed", 1.0)?,
        },
        "orbit" => Motion::Orbit {
            axis: vec3(&v["axis"], "motion/orbit/axis", [0.0, 1.0, 0.0])?,
            spin: deep_canvas::ops::rad(num(&v["rate"], "motion/orbit/rate", 0.0)?),
        },
        "drift" => Motion::Drift {
            amplitude: num(&v["amplitude"], "motion/drift/amplitude", 0.0)?,
            frequency: num(&v["frequency"], "motion/drift/frequency", 0.0)?,
        },
        _ => {
            let launch = match &v["velocity"] {
                Value::Null => Launch::Cone(pair(&v["v0"], "motion/ballistic/v0", [1.0, 2.0])?),
                vel => Launch::Vector(vec3(vel, "motion/ballistic/velocity", [0.0; 3])?),
            };
            let drag = num(&v["drag"], "motion/ballistic/drag", 0.0)?;
            if drag < 0.0 {
                return Err(Refusal::new(
                    "out_of_range",
                    at("motion/ballistic/drag"),
                    format!("{id}: drag must be 0 or more per second"),
                ));
            }
            Motion::Ballistic {
                launch,
                gravity: vec3(&v["gravity"], "motion/ballistic/gravity", [0.0, -9.8, 0.0])?,
                drag,
            }
        }
    };
    let (bounce_v, bounce_path) = if m["bounce"].is_null() {
        (&m["ballistic"]["bounce"], "motion/ballistic/bounce")
    } else {
        (&m["bounce"], "motion/bounce")
    };
    let bounce = match bounce_v {
        Value::Null => None,
        b => Some(bounce_of(id, b, bounce_path, &num)?),
    };
    let land = match &p["land"] {
        Value::Null => None,
        l => Some(land_of(id, l, &num)?),
    };
    if (bounce.is_some() || land.is_some()) && !matches!(motion, Motion::Ballistic { .. }) {
        let f = if land.is_some() { "land" } else { bounce_path };
        return Err(Refusal::new(
            "out_of_range",
            at(f),
            format!("{id}: {f} needs ballistic motion"),
        ));
    }
    let kill = match &p["kill"] {
        Value::Null => None,
        k => Some(kill_of(id, k, &num, &vec3)?),
    };
    let turbulence = match &p["turbulence"] {
        Value::Null => None,
        t => Some(turbulence_of(id, t, &num)?),
    };
    let inherit = [
        num(&p["inherit"]["normal"], "inherit/normal", 0.0)?,
        num(&p["inherit"]["velocity"], "inherit/velocity", 0.0)?,
    ];
    Ok(Spec {
        count,
        life,
        shape,
        on_surface,
        rate,
        span,
        motion,
        bounce,
        land,
        kill,
        turbulence,
        bursts,
        inherit,
        follow: p["follow"].as_bool().unwrap_or(false),
    })
}

/// A time literal (`0s`, `250ms`, `12f`) as seconds from the document's start, at its frame rate.
pub fn seconds(doc: &Value, text: &str) -> Result<f64, String> {
    use deep_canvas::grammar::{Time, TimeContext};
    let rate = doc
        .get("transport")
        .and_then(deep_canvas::document::frame_rate_of)
        .unwrap_or((60, 1));
    let ctx = TimeContext {
        frame_rate: rate,
        ..TimeContext::default()
    };
    match Time::parse(text) {
        Ok(Time::Span(span)) => span
            .resolve(&ctx)
            .map(|f| f as f64 / 705_600_000.0)
            .map_err(|r| r.what),
        Ok(_) => Err("a time is a span from the start, such as 0s or 120f".into()),
        Err(r) => Err(r.what),
    }
}

type Num<'a> = dyn Fn(&Value, &str, f64) -> Result<f64, Refusal> + 'a;
type Vec3<'a> = dyn Fn(&Value, &str, V3) -> Result<V3, Refusal> + 'a;

fn shape(
    id: &str,
    emit: &Value,
    radius: f64,
    num: &Num<'_>,
    vec3: &Vec3<'_>,
) -> Result<(Shape, bool), Refusal> {
    let on_surface = emit["on"].as_str() == Some("surface");
    let bad = |what: &str| {
        Refusal::new(
            "out_of_range",
            format!("items/{id}/params/emit/shape"),
            format!("{id}: {what}"),
        )
    };
    let shape = match &emit["shape"] {
        Value::Null => Shape::Point,
        Value::String(s) => match s.as_str() {
            "point" => Shape::Point,
            "disk" => Shape::Disk(radius),
            "sphere" => Shape::Sphere(radius),
            other => return Err(bad(&format!("emit.shape {other} is no shape"))),
        },
        Value::Object(o) => {
            let (name, v) = o.iter().next().ok_or_else(|| bad("emit.shape is empty"))?;
            let f = |k: &str| format!("emit/shape/{name}/{k}");
            let r = |k: &str, d: f64| num(&v[k], &f(k), d);
            match name.as_str() {
                "along" => Shape::Along(v.as_str().unwrap_or_default().to_string()),
                "disk" => Shape::Disk(r("r", radius)?),
                "sphere" => Shape::Sphere(r("r", radius)?),
                "box" => Shape::Box(vec3(&v["size"], &f("size"), [1.0; 3])?),
                "ring" => Shape::Ring {
                    r: r("r", radius)?,
                    inner: r("inner_r", 0.0)?,
                },
                "cylinder" => Shape::Cylinder {
                    r: r("r", radius)?,
                    h: r("h", 1.0)?,
                },
                "capsule" => Shape::Capsule {
                    r: r("r", radius)?,
                    h: r("h", 1.0)?,
                },
                "surface" => Shape::Surface(
                    v["of"]
                        .as_str()
                        .or(v.as_str())
                        .ok_or_else(|| bad("emit.shape surface names no item"))?
                        .to_string(),
                ),
                other => return Err(bad(&format!("emit.shape {other} is no shape"))),
            }
        }
        _ => return Err(bad("emit.shape is no shape")),
    };
    let sizes_ok = match &shape {
        Shape::Disk(r) | Shape::Sphere(r) => *r >= 0.0,
        Shape::Box(s) => s.iter().all(|x| *x >= 0.0),
        Shape::Ring { r, inner } => *inner >= 0.0 && inner <= r,
        Shape::Cylinder { r, h } | Shape::Capsule { r, h } => *r >= 0.0 && *h >= 0.0,
        _ => true,
    };
    if !sizes_ok {
        return Err(bad(
            "an emit region's sizes must be 0 or more, a ring's inner_r at most its r",
        ));
    }
    // A surface item is always emitted on.
    let on_surface = on_surface || matches!(shape, Shape::Surface(_));
    Ok((shape, on_surface))
}

fn then_of(v: &Value, allowed: &[(&str, Then)], default: Then) -> Option<Then> {
    match v.as_str() {
        None => Some(default),
        Some(s) => allowed.iter().find(|(n, _)| *n == s).map(|(_, t)| *t),
    }
}

fn bounce_of(id: &str, b: &Value, path: &str, num: &Num<'_>) -> Result<Bounce, Refusal> {
    let at = |f: &str| format!("items/{id}/params/{path}/{f}");
    let planes_v = b["planes"].as_array().cloned().unwrap_or_default();
    if planes_v.len() > MAX_PLANES {
        return Err(Refusal::new(
            "out_of_range",
            at("planes"),
            format!(
                "{id}: {} bounce planes; at most {MAX_PLANES} are declared (six close a box)",
                planes_v.len()
            ),
        )
        .with(Value::from(planes_v.len())));
    }
    let mut planes = Vec::with_capacity(planes_v.len());
    for (k, pl) in planes_v.iter().enumerate() {
        planes.push(plane_of(id, pl, &format!("{path}/planes/{k}"), num)?);
    }
    let d = Bounce::default();
    let restitution = num(
        &b["restitution"],
        &format!("{path}/restitution"),
        d.restitution,
    )?;
    let friction = num(&b["friction"], &format!("{path}/friction"), d.friction)?;
    if !(0.0..=1.0).contains(&restitution) || !(0.0..=1.0).contains(&friction) {
        return Err(Refusal::new(
            "out_of_range",
            at("restitution"),
            format!("{id}: restitution and friction run from 0 to 1"),
        ));
    }
    let max = match &b["max"] {
        Value::Null => d.max,
        v => v
            .as_u64()
            .filter(|m| (1..=u64::from(MAX_BOUNCES)).contains(m))
            .ok_or_else(|| {
                Refusal::new(
                    "out_of_range",
                    at("max"),
                    format!("{id}: max contacts run from 1 to {MAX_BOUNCES}"),
                )
            })? as u8,
    };
    let then = then_of(
        &b["then"],
        &[("rest", Then::Rest), ("die", Then::Die)],
        d.then,
    )
    .ok_or_else(|| {
        Refusal::new(
            "out_of_range",
            at("then"),
            format!("{id}: then is rest or die"),
        )
    })?;
    Ok(Bounce {
        planes,
        restitution,
        friction,
        max,
        then,
    })
}

fn plane_of(id: &str, pl: &Value, path: &str, num: &Num<'_>) -> Result<Plane, Refusal> {
    let n = pl["normal"].as_array().filter(|a| a.len() == 3);
    let normal = match n {
        Some(a) => [
            num(&a[0], path, 0.0)?,
            num(&a[1], path, 0.0)?,
            num(&a[2], path, 0.0)?,
        ],
        None => [0.0; 3],
    };
    let l = super::len(normal);
    if l == 0.0 {
        return Err(Refusal::new(
            "out_of_range",
            format!("items/{id}/params/{path}/normal"),
            format!("{id}: a plane's normal must be three numbers, not all 0"),
        ));
    }
    Ok(Plane {
        normal: super::scale(normal, 1.0 / l),
        offset: num(&pl["offset"], &format!("{path}/offset"), 0.0)? / l,
    })
}

fn land_of(id: &str, l: &Value, num: &Num<'_>) -> Result<Land, Refusal> {
    let at = |f: &str| format!("items/{id}/params/land/{f}");
    let on = l["on"].as_str().ok_or_else(|| {
        Refusal::new(
            "ref_unresolved",
            at("on"),
            format!("{id}: land.on names no collection"),
        )
    })?;
    let cell = num(&l["cell"], "land/cell", 0.05)?;
    if cell <= 0.0 {
        return Err(Refusal::new(
            "out_of_range",
            at("cell"),
            format!("{id}: land.cell must be above 0 m"),
        ));
    }
    // One map looking down, one layer: the design's other maps and layers aren't in this build.
    let down_only = l["maps"].is_null()
        || l["maps"]
            .as_array()
            .is_some_and(|m| m.len() == 1 && m[0] == "down");
    if !down_only || !(l["layers"].is_null() || l["layers"].as_u64() == Some(1)) {
        let f = if down_only { "layers" } else { "maps" };
        return Err(Refusal::new(
            "out_of_range",
            at(f),
            format!("{id}: land reads one map looking down, one layer deep"),
        ));
    }
    let then = then_of(
        &l["then"],
        &[
            ("rest", Then::Rest),
            ("die", Then::Die),
            ("bounce", Then::Bounce),
        ],
        Then::Rest,
    )
    .ok_or_else(|| {
        Refusal::new(
            "out_of_range",
            at("then"),
            format!("{id}: then is rest, die or bounce"),
        )
    })?;
    Ok(Land {
        on: on.to_string(),
        cell,
        then,
    })
}

fn kill_of(id: &str, k: &Value, num: &Num<'_>, vec3: &Vec3<'_>) -> Result<Kill, Refusal> {
    let region = match (&k["box"], &k["plane"]) {
        (Value::Array(b), _) if b.len() == 2 => {
            let lo = vec3(&b[0], "kill/box/0", [0.0; 3])?;
            let hi = vec3(&b[1], "kill/box/1", [0.0; 3])?;
            KillRegion::Box([
                [lo[0].min(hi[0]), lo[1].min(hi[1]), lo[2].min(hi[2])],
                [lo[0].max(hi[0]), lo[1].max(hi[1]), lo[2].max(hi[2])],
            ])
        }
        (_, pl) if pl.is_object() => KillRegion::Plane(plane_of(id, pl, "kill/plane", num)?),
        _ => {
            return Err(Refusal::new(
                "out_of_range",
                format!("items/{id}/params/kill"),
                format!("{id}: kill takes a box of two corners or a plane"),
            ))
        }
    };
    Ok(Kill {
        region,
        keep_inside: k["keep"].as_str() != Some("outside"),
    })
}

fn turbulence_of(id: &str, t: &Value, num: &Num<'_>) -> Result<Turbulence, Refusal> {
    let whole = |k: &str, default: u32, cap: u32| -> Result<u32, Refusal> {
        match &t[k] {
            Value::Null => Ok(default),
            v => v
                .as_u64()
                .filter(|n| (1..=u64::from(cap)).contains(n))
                .map(|n| n as u32)
                .ok_or_else(|| {
                    Refusal::new(
                        "out_of_range",
                        format!("items/{id}/params/turbulence/{k}"),
                        format!("{id}: turbulence.{k} runs from 1 to {cap}"),
                    )
                }),
        }
    };
    let strength = num(&t["strength"], "turbulence/strength", 0.5)?;
    let frequency = num(&t["frequency"], "turbulence/frequency", 1.0)?;
    let travel = num(&t["travel"], "turbulence/travel", 4.0)?;
    if strength < 0.0 || frequency <= 0.0 || travel <= 0.0 {
        return Err(Refusal::new(
            "out_of_range",
            format!("items/{id}/params/turbulence"),
            format!("{id}: turbulence's strength is 0 or more, its frequency and travel above 0"),
        ));
    }
    Ok(Turbulence {
        strength,
        frequency,
        paths: whole("paths", 32, MAX_PATHS)?,
        steps: whole("steps", 64, MAX_STEPS)?,
        travel,
        seed: t["seed"].as_u64().map(|s| s as u32),
    })
}
