//! Issue #409: craft@1's checks on a claim's deliverables (canvas primitives: Film audit:
//! craft@1). A claim's brief names the checks it wants (`craft: [{check, …fields}]`); each one it
//! names adds one row to the verdict, `from: {craft: <check>}`, with the measure its threshold is
//! held to, and a check it doesn't name runs nowhere. A check's fields are the brief's over the
//! table's defaults, never the deliverable's own. Each is a threshold over a measure read from the
//! evaluated film: shot spans and camera poses from the motion program, texts and extents from the
//! frames the film audit plays, numbers from the script's words, motion share from the 12 fps
//! gray analysis frames, and sound from the mix an export renders. The measures' rules are the
//! core's (`deep_canvas::craft`).

use std::collections::BTreeMap;

use deep_canvas::craft::{self as measure, Cam, Move};
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Planted as MotionPlanted;
use deep_canvas_motion::shots::{At, Kind, Pose};
use serde_json::{json, Map, Value};

use super::{audit, time_of, Played};
use crate::hub::{Claim, Hub};
use crate::shared::FLICKS;

mod example;
mod sound;

/// craft@1's wrong programs, by the names its acceptance suite gives them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// Every craft check runs on a claim with a brief, named or not.
    RunsEveryCheck,
    /// A check takes its fields from the deliverable's own `checks` over the brief's.
    ThresholdFromAgent,
    /// camera_grammar judges a cut by its angle alone.
    JumpCutAngleOnly,
    /// camera_grammar reads each shot's move from its `move` label.
    CameraByLabel,
}

/// A wrong program of craft@1's by its name; the geometry audit's names reach it.
pub(crate) fn planted(name: &str) -> Option<Planted> {
    Some(match name {
        "craft_runs_every_check" => Planted::RunsEveryCheck,
        "craft_threshold_from_agent" => Planted::ThresholdFromAgent,
        "craft_jump_cut_angle_only" => Planted::JumpCutAngleOnly,
        "craft_camera_by_label" => Planted::CameraByLabel,
        _ => return None,
    })
}

/// The hub's flag for craft@1's wrong program `p`.
fn flag(p: Planted) -> crate::hub::Planted {
    crate::hub::Planted::Audit(crate::geometry_audit::Planted::Craft(p))
}

/// A film's analysis frames: gray, 320 px wide, one each 1/12 s as an export's resample takes
/// them, with each frame's time, the pairs a cut or a cross-fade leaves out and the pairs over
/// which the camera holds still.
pub(crate) struct Analysis {
    pub frames: Vec<Vec<u8>>,
    pub w: usize,
    pub h: usize,
    pub times: Vec<i64>,
    pub left_out: Vec<bool>,
    pub still: Vec<bool>,
}

/// One shot on the document's camera: its span and its camera's poses, every 1/12 s from its
/// start and at its last frame.
struct ShotOf {
    id: String,
    start: i64,
    end: i64,
    poses: Vec<(i64, Pose)>,
}

/// A film's timeline as its motion program compiles it: shots in time order, the cuts between
/// them (with no transition, or a cut) and the other transitions' windows.
struct Film {
    frame: i64,
    start: i64,
    span: i64,
    size: [f64; 2],
    shots: Vec<ShotOf>,
    /// The cut's time and the two shots it joins, by index.
    cuts: Vec<(i64, usize, usize)>,
    /// A transition that isn't a cut: its kind and window.
    joins: Vec<(String, i64, i64)>,
}

impl Film {
    /// The shot on screen at t: the one whose span holds it, else the last before it.
    fn shot_at(&self, t: i64) -> usize {
        self.shots.iter().rposition(|s| s.start <= t).unwrap_or(0)
    }

    fn id_at(&self, t: i64) -> &str {
        self.shots
            .get(self.shot_at(t))
            .map_or("", |s| s.id.as_str())
    }
}

/// What one check found on one deliverable.
#[derive(Default)]
struct Found {
    issues: Vec<Value>,
    blocked: Vec<Value>,
    measure: Value,
}

/// What a deliverable's checks share, each read once.
struct Ctx {
    drawn: Value,
    film: Option<Option<Film>>,
    played: Option<Option<Played>>,
    sounds: Option<Result<Vec<sound::Sound>, String>>,
}

fn kind_name(k: &Kind) -> String {
    match k {
        Kind::Cut => "cut".into(),
        Kind::CrossFade => "cross_fade".into(),
        Kind::Dip => "dip".into(),
        Kind::Wipe { .. } => "wipe".into(),
        Kind::Push { .. } => "push".into(),
        Kind::ZoomThrough { .. } => "zoom_through".into(),
        Kind::Whip { .. } => "whip".into(),
        Kind::Other(s) => s.clone(),
    }
}

/// A time a brief writes: seconds as a number, or `"<n>s"` / `"<n>ms"`.
fn seconds(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => {
            let s = s.trim();
            match s.strip_suffix("ms") {
                Some(ms) => ms.trim().parse::<f64>().ok().map(|x| x / 1000.0),
                None => s.strip_suffix('s')?.trim().parse().ok(),
            }
        }
        _ => None,
    }
}

fn num(fields: &Map<String, Value>, k: &str) -> f64 {
    seconds(fields.get(k)).unwrap_or(0.0)
}

fn secs(t: i64) -> f64 {
    t as f64 / FLICKS as f64
}

fn flicks(s: f64) -> i64 {
    (s * FLICKS as f64).round() as i64
}

/// An issue of craft check `check`: its code, the shots it names (`shot`, or a cut's two in
/// `shots`) and its frame.
fn raise<S: AsRef<str>>(
    check: &str,
    code: &str,
    severity: &str,
    shots: &[S],
    t: i64,
    what: String,
) -> Value {
    let fix = measure::check(check).map_or("", |c| c.fix.as_str());
    let shots: Vec<&str> = shots.iter().map(AsRef::as_ref).collect();
    let mut i = json!({"check": audit::FILM_AUDIT, "craft": check, "code": code, "severity": severity,
                       "ids": shots, "t": t, "what": what, "fix": fix});
    match shots.as_slice() {
        [one] => i["shot"] = json!(one),
        _ => i["shots"] = json!(shots),
    }
    i
}

/// The checks the brief names (every check, planted), each with its fields: the table's
/// defaults with the brief's entry over them.
fn named(brief: &Value, every: bool) -> Vec<(String, Map<String, Value>)> {
    let entries: Vec<&Map<String, Value>> = brief["craft"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .collect();
    let fields = |name: &str, entry: Option<&Map<String, Value>>| {
        let mut f = measure::check(name)
            .and_then(|c| c.defaults.as_object().cloned())
            .unwrap_or_default();
        for (k, v) in entry.into_iter().flatten().filter(|(k, _)| *k != "check") {
            f.insert(k.clone(), v.clone());
        }
        // A long take is the brief's to declare: none without it.
        if !entry.is_some_and(|e| e.contains_key("signature")) {
            f.remove("signature");
        }
        f
    };
    if every {
        return measure::checks()
            .iter()
            .map(|c| {
                let entry = entries
                    .iter()
                    .copied()
                    .find(|e| e.get("check").and_then(Value::as_str) == Some(c.name.as_str()));
                (c.name.clone(), fields(&c.name, entry))
            })
            .collect();
    }
    let mut out: Vec<(String, Map<String, Value>)> = Vec::new();
    for e in entries {
        let Some(name) = e.get("check").and_then(Value::as_str) else {
            continue;
        };
        if !out.iter().any(|(n, _)| n == name) {
            out.push((name.to_string(), fields(name, Some(e))));
        }
    }
    out
}

/// The fields a deliverable's own `checks` write for craft check `name` (planted only: a
/// threshold is never the agent's).
fn own_fields(drawn: &Value, name: &str) -> Map<String, Value> {
    let mut out = Map::new();
    for input in drawn["checks"].as_array().into_iter().flatten() {
        for e in input["craft"].as_array().into_iter().flatten() {
            if e["check"] == name {
                for (k, v) in e
                    .as_object()
                    .into_iter()
                    .flatten()
                    .filter(|(k, _)| *k != "check")
                {
                    out.insert(k.clone(), v.clone());
                }
            }
        }
    }
    out
}

/// An item's centre: its position, plus its 2D box's centre where it has one.
fn item_at(drawn: &Value, id: &str) -> Option<[f64; 3]> {
    let item = drawn.pointer(&format!("/items/{id}"))?;
    let p = item.pointer("/at/pos").and_then(Value::as_array);
    let c = |k: usize| {
        p.and_then(|p| p.get(k))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    let mut at = [c(0), c(1), c(2)];
    if let Some(b) = item
        .pointer("/params/box")
        .and_then(Value::as_array)
        .filter(|b| b.len() == 4)
    {
        let b: Vec<f64> = b.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect();
        at[0] += b[0] + b[2] / 2.0;
        at[1] += b[1] + b[3] / 2.0;
    }
    Some(at)
}

fn cam(p: &Pose) -> Cam {
    Cam {
        position: p.position,
        target: p.target,
        width: p.width(),
        flat: p.flat,
    }
}

/// How much the camera changes from one pose to the next: its width's log ratio and its aim's
/// turn (a flat camera's target shift over its width).
fn change(a: &Pose, b: &Pose) -> f64 {
    let (wa, wb) = (a.width().max(1e-9), b.width().max(1e-9));
    let scale = (wb / wa).ln().abs();
    let aim = if a.flat || b.flat {
        let d = [b.target[0] - a.target[0], b.target[1] - a.target[1]];
        d[0].hypot(d[1]) / wa
    } else {
        let da = [
            a.target[0] - a.position[0],
            a.target[1] - a.position[1],
            a.target[2] - a.position[2],
        ];
        let db = [
            b.target[0] - b.position[0],
            b.target[1] - b.position[1],
            b.target[2] - b.position[2],
        ];
        measure::turn(da, db) / 45.0
    };
    scale + aim
}

/// A shot's move as its camera makes it, and, when it is an accent (90% of the camera's path
/// within half a second), the time that path starts.
fn moved(film: &Film, drawn: &Value, i: usize, by_label: bool) -> (Move, Option<i64>) {
    let s = &film.shots[i];
    if by_label {
        let m = match drawn
            .pointer(&format!("/shots/{}/move", s.id))
            .and_then(Value::as_str)
        {
            Some("push" | "slam") => Move::Push,
            Some("pull") => Move::Pull,
            Some("pan") => Move::Pan,
            Some("orbit") => Move::Orbit,
            _ => Move::Hold,
        };
        return (m, None);
    }
    let (Some((_, first)), Some((_, last))) = (s.poses.first(), s.poses.last()) else {
        return (Move::Hold, None);
    };
    let about = drawn
        .pointer(&format!("/shots/{}/frame/keep", s.id))
        .and_then(Value::as_array)
        .and_then(|keep| {
            let at: Vec<[f64; 3]> = keep
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|k| item_at(drawn, k))
                .collect();
            (!at.is_empty()).then(|| {
                let n = at.len() as f64;
                [0, 1, 2].map(|k| at.iter().map(|p| p[k]).sum::<f64>() / n)
            })
        })
        .or(Some(first.target));
    let m = measure::classify(&cam(first), &cam(last), about);
    if m == Move::Hold {
        return (m, None);
    }
    // The shortest run of steps that holds 90% of the camera's path.
    let steps: Vec<f64> = s
        .poses
        .windows(2)
        .map(|w| change(&w[0].1, &w[1].1))
        .collect();
    let total: f64 = steps.iter().sum();
    if total <= 1e-9 {
        return (m, None);
    }
    let (mut best, mut from) = (usize::MAX, 0);
    let (mut lo, mut sum) = (0, 0.0);
    for hi in 0..steps.len() {
        sum += steps[hi];
        while sum - steps[lo] >= 0.9 * total && lo < hi {
            sum -= steps[lo];
            lo += 1;
        }
        if sum >= 0.9 * total - 1e-12 && hi + 1 - lo < best {
            best = hi + 1 - lo;
            from = lo;
        }
    }
    let span = s.poses[(from + best).min(s.poses.len() - 1)].0 - s.poses[from].0;
    let accent = (secs(span) <= 0.5 + 1e-9).then_some(s.poses[from].0);
    (m, accent)
}

/// The framed height of the item at `item` in a pose, up to a constant the cut's two sides share.
fn framed(p: &Pose, item: [f64; 3]) -> f64 {
    if p.flat {
        return 1.0 / p.view_width.max(1e-9);
    }
    let d = [
        item[0] - p.position[0],
        item[1] - p.position[1],
        item[2] - p.position[2],
    ];
    let d = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    1.0 / (d * (p.fov.to_radians() / 2.0).tan()).max(1e-9)
}

/// The look a shot is finished in: its own, else the film's, by asset ID.
fn look_of(drawn: &Value, shot: &str) -> String {
    let id = drawn
        .pointer(&format!("/shots/{shot}/look"))
        .and_then(Value::as_str)
        .or_else(|| drawn.pointer("/look/asset").and_then(Value::as_str))
        .unwrap_or("");
    id.split('@').next().unwrap_or("").to_string()
}

impl Hub<'_> {
    /// `drawn`'s analysis frames, as made, under its own look, with the pairs `film`'s cuts and
    /// transitions leave out; None when a frame can't be drawn.
    fn analysis(&mut self, drawn: &Value, film: &Film) -> Option<Analysis> {
        let (p, q) = drawn
            .get("transport")
            .and_then(deep_canvas::document::frame_rate_of)
            .unwrap_or((60, 1));
        let count = (film.span / film.frame).max(1) as usize;
        let (w, h) = (
            measure::ANALYSIS_WIDTH as usize,
            measure::analysis_height(film.size[0], film.size[1]),
        );
        let px = [w as u16, h as u16];
        let kept = self.with_look_of(drawn);
        let mut session = self.evaluated(drawn, film.start);
        let view = deep_canvas::schedule::default_view(drawn);
        let program = crate::film::program_of(&self.sched, &session);
        let mut frames = Vec::new();
        let mut times = Vec::new();
        let mut cams: Vec<Option<[f64; 9]>> = Vec::new();
        let mut ok = true;
        for j in measure::slots(count, f64::from(p) / f64::from(q)) {
            let t = film.start + j as i64 * film.frame;
            session.frame(&mut self.sched, t, &view);
            let Some(painted) = crate::frames::drawing_of(&self.sched, &session) else {
                ok = false;
                break;
            };
            let sides = program
                .as_deref()
                .and_then(|p| crate::film::sides(p, drawn, t, false));
            let rgba = match &sides {
                Some(s) => self
                    .film_rgba(&painted, Some(px), s, drawn, true)
                    .map(|r| r.0),
                None => self.canonical_rgba(&painted, Some(px), true).map(|r| r.0),
            };
            let Ok(rgba) = rgba else {
                ok = false;
                break;
            };
            frames.push(measure::gray(&rgba));
            times.push(t);
            cams.push(sides.as_ref().and_then(|s| s.sides.first()).map(|s| {
                let p = &s.pose;
                [
                    p.position[0],
                    p.position[1],
                    p.position[2],
                    p.target[0],
                    p.target[1],
                    p.target[2],
                    p.fov,
                    p.view_width,
                    p.roll,
                ]
            }));
        }
        if let Some((look, def)) = kept {
            self.look = look;
            self.look_def = def;
        }
        let left_out = times
            .windows(2)
            .map(|pair| {
                let (a, b) = (pair[0], pair[1]);
                film.cuts.iter().any(|&(c, _, _)| a < c && c <= b)
                    || film.joins.iter().any(|&(_, s, e)| s < b && a < e)
            })
            .collect();
        let still = cams.windows(2).map(|c| c[0] == c[1]).collect();
        ok.then_some(Analysis {
            frames,
            w,
            h,
            times,
            left_out,
            still,
        })
    }

    /// `drawn`'s timeline: its document camera's shots, each posed every 1/12 s, and the cuts
    /// and transitions between them. None without timeline shots.
    fn film_of(&mut self, drawn: &Value) -> Option<Film> {
        let (p, q) = drawn
            .get("transport")
            .and_then(deep_canvas::document::frame_rate_of)
            .unwrap_or((60, 1));
        let frame = deep_canvas::time::frame_length(p, q).ok()?;
        let span = time_of(drawn, drawn.pointer("/transport/span")).unwrap_or(0);
        let start = time_of(drawn, drawn.pointer("/transport/start")).unwrap_or(0);
        let size = [
            drawn["size"][0].as_f64().unwrap_or(1.0).max(1.0),
            drawn["size"][1].as_f64().unwrap_or(1.0).max(1.0),
        ];
        let session = self.evaluated(drawn, start);
        let program = crate::film::program_of(&self.sched, &session)?;
        let plan = program.shots.as_deref()?;
        let camera = plan.camera(drawn.get("camera")?.as_str()?)?;
        let mut order: Vec<usize> = (0..plan.shots.len())
            .filter(|&i| plan.shots[i].camera == camera)
            .collect();
        order.sort_by_key(|&i| (plan.shots[i].start, i));
        let mut state = program.state();
        let step = FLICKS / measure::ANALYSIS_FPS as i64;
        let mut shots = Vec::new();
        for &i in &order {
            let s = &plan.shots[i];
            let last = (s.end - frame).max(s.start);
            let mut times: Vec<i64> = (0..)
                .map(|k| s.start + k * step)
                .take_while(|t| *t < last)
                .collect();
            times.push(last);
            let mut poses = Vec::with_capacity(times.len());
            for t in times {
                program.evaluate(t, Validity::Full, &mut state);
                let keyed = |c: usize| plan.keyed_pose(c, &program, &state);
                let at = At {
                    reduced: false,
                    planted: MotionPlanted::None,
                    indexed: None,
                    keyed: &keyed,
                };
                poses.push((t, plan.side(i, t, &at)));
            }
            shots.push(ShotOf {
                id: s.id.clone(),
                start: s.start,
                end: s.end,
                poses,
            });
        }
        let mut cuts = Vec::new();
        let mut joins = Vec::new();
        for (k, pair) in order.windows(2).enumerate() {
            let (a, b) = (pair[0], pair[1]);
            match plan
                .transitions
                .iter()
                .find(|tr| tr.from == a && tr.to == b)
            {
                Some(tr) if !matches!(tr.kind, Kind::Cut) && tr.end > tr.start => {
                    joins.push((kind_name(&tr.kind), tr.start, tr.end));
                }
                Some(tr) => cuts.push((tr.cut, k, k + 1)),
                None => cuts.push((plan.shots[b].start, k, k + 1)),
            }
        }
        Some(Film {
            frame,
            start,
            span,
            size,
            shots,
            cuts,
            joins,
        })
    }

    /// The rows the claim's brief's craft checks add: one per check it names.
    pub(crate) fn craft_rows(&mut self, claim: &str, c: &Claim) -> Vec<Value> {
        let Some(brief) = c.brief.as_ref() else {
            return Vec::new();
        };
        let every = self.planted(flag(Planted::RunsEveryCheck));
        let agents = self.planted(flag(Planted::ThresholdFromAgent));
        let checks = named(brief, every);
        if checks.is_empty() {
            return Vec::new();
        }
        let mut found: Vec<(Vec<Value>, Vec<Value>, Map<String, Value>)> =
            checks.iter().map(|_| Default::default()).collect();
        for doc in &c.deliverables {
            let Some(r) = self.query_revision(doc, None) else {
                continue;
            };
            let mut ctx = Ctx {
                drawn: r.drawn,
                film: None,
                played: None,
                sounds: None,
            };
            for (k, (name, fields)) in checks.iter().enumerate() {
                let mut fields = fields.clone();
                if agents {
                    fields.extend(own_fields(&ctx.drawn, name));
                }
                let f = self.craft_check(name, &fields, &mut ctx);
                let (issues, blocked, measures) = &mut found[k];
                for mut i in f.issues {
                    i["doc"] = json!(doc);
                    issues.push(i);
                }
                blocked.extend(f.blocked);
                measures.insert(doc.clone(), f.measure);
            }
        }
        checks
            .iter()
            .zip(found)
            .map(|((name, _), (issues, blocked, measures))| {
                let result = if issues.iter().any(|i| i["severity"] == "error") {
                    "FAIL"
                } else if !blocked.is_empty() {
                    "BLOCKED"
                } else {
                    "PASS"
                };
                let measure = match measures.len() {
                    1 => measures.into_iter().next().map(|(_, m)| m).unwrap_or_default(),
                    _ => Value::Object(measures),
                };
                let mut row = json!({"id": format!("{claim}#craft/{name}"), "kind": audit::FILM_AUDIT,
                    "result": result, "machines": "any", "determinism": "exact", "issues": issues,
                    "from": {"craft": name}, "measure": measure});
                if !blocked.is_empty() {
                    row["blocked"] = Value::Array(blocked);
                }
                row
            })
            .collect()
    }

    fn film<'c>(&mut self, ctx: &'c mut Ctx) -> Option<&'c Film> {
        if ctx.film.is_none() {
            ctx.film = Some(self.film_of(&ctx.drawn));
        }
        ctx.film.as_ref().and_then(Option::as_ref)
    }

    /// One check on one deliverable.
    fn craft_check(&mut self, name: &str, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let blocked = |why: String| Found {
            blocked: vec![json!({"code": format!("craft.{name}"), "why": why})],
            ..Found::default()
        };
        if measure::check(name).is_none() {
            return blocked(format!("craft@1 has no check {name}"));
        }
        if self.film(ctx).is_none() {
            return blocked("the film has no timeline shots to judge".into());
        }
        match name {
            "shot_length" => self.shot_length(fields, ctx),
            "camera_grammar" => self.camera_grammar(fields, ctx),
            "ends" | "text_led" => self.text_led(name, fields, ctx),
            "look_lock" => look_lock(fields, ctx),
            "recipes" => self.recipes(fields, ctx),
            "numbers_in_script" | "caption_band" => self.on_screen(name, fields, ctx),
            "motion_share" => self.motion_share(fields, ctx),
            "accents" => self.accents(fields, ctx),
            "not_example" => self.not_example(fields, ctx),
            "silences" => self.silences(fields, ctx),
            "sound_coverage" => self.sound_coverage(fields, ctx),
            "sound_bridges" => self.sound_bridges(fields, ctx),
            "mix.balance" => self.mix_balance(fields, ctx),
            "sound_lock" => sound::sound_lock(fields, ctx),
            _ => blocked(format!("craft@1's {name} has no run")),
        }
    }

    fn shot_length(&mut self, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let drawn = ctx.drawn.clone();
        let Some(film) = self.film(ctx) else {
            return Found::default();
        };
        let (min, max, hard) = (
            num(fields, "min"),
            num(fields, "max"),
            num(fields, "hard_max"),
        );
        let declared = fields.get("signature").and_then(Value::as_object);
        let (takes, take_max) = declared.map_or((0, 0.0), |s| {
            (
                s.get("count").and_then(Value::as_u64).unwrap_or(1) as usize,
                seconds(s.get("max")).unwrap_or(20.0),
            )
        });
        // Montage spans: markers whose span lowers the minimum inside it, never under 0.25 s.
        let montage: Vec<(i64, i64, f64)> = fields
            .get("montage")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|m| {
                let id = m["span"].as_str()?;
                let mk = drawn.pointer(&format!("/markers/{id}"))?;
                let t = time_of(&drawn, mk.get("t"))?;
                let span = time_of(&drawn, mk.get("span"))?;
                Some((t, t + span, seconds(m.get("min")).unwrap_or(min).max(0.25)))
            })
            .collect();
        let mut out = Found::default();
        let mut lengths = Map::new();
        let mut long = 0;
        for s in &film.shots {
            let d = secs(s.end - s.start);
            lengths.insert(s.id.clone(), json!(d));
            let floor = montage
                .iter()
                .find(|(a, b, _)| *a <= s.start && s.end <= *b)
                .map_or(min, |m| m.2);
            let id = s.id.as_str();
            if d + 1e-9 < floor {
                out.issues.push(raise(
                    "shot_length",
                    "craft.shot_length",
                    "error",
                    &[id],
                    s.start,
                    format!("`{id}` lasts {d:.3} s, under the minimum of {floor} s"),
                ));
            } else if d > hard + 1e-9 {
                long += 1;
                if long > takes {
                    out.issues.push(raise("shot_length", "craft.shot_length", "error", &[id], s.start,
                        format!("`{id}` lasts {d:.3} s, past the hard maximum of {hard} s, and the brief declares {takes} long take(s)")));
                } else if d > take_max + 1e-9 {
                    out.issues.push(raise(
                        "shot_length",
                        "craft.shot_length",
                        "error",
                        &[id],
                        s.start,
                        format!(
                            "the long take `{id}` lasts {d:.3} s, past its maximum of {take_max} s"
                        ),
                    ));
                }
            } else if d > max + 1e-9 {
                out.issues.push(raise(
                    "shot_length",
                    "craft.shot_length",
                    "warning",
                    &[id],
                    s.start,
                    format!("`{id}` lasts {d:.3} s, past the maximum of {max} s"),
                ));
            }
        }
        out.measure = json!({"lengths": lengths});
        out
    }

    fn camera_grammar(&mut self, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let by_label = self.planted(flag(Planted::CameraByLabel));
        let angle_only = self.planted(flag(Planted::JumpCutAngleOnly));
        let drawn = ctx.drawn.clone();
        let Some(film) = self.film(ctx) else {
            return Found::default();
        };
        let mut out = Found::default();
        let moves: Vec<(Move, Option<i64>)> = (0..film.shots.len())
            .map(|i| moved(film, &drawn, i, by_label))
            .collect();
        // Pushes in a row, and the share of accents.
        let run_max = fields
            .get("push_run_max")
            .and_then(Value::as_u64)
            .unwrap_or(2) as usize;
        let mut run = 0;
        for (s, (m, _)) in film.shots.iter().zip(&moves) {
            run = if *m == Move::Push { run + 1 } else { 0 };
            if run == run_max + 1 {
                out.issues.push(raise(
                    "camera_grammar",
                    "craft.camera_grammar",
                    "error",
                    &[&s.id],
                    s.start,
                    format!("`{}` is the {} push in a row, past {run_max}", s.id, run),
                ));
            }
        }
        let accents = moves.iter().filter(|(_, a)| a.is_some()).count();
        let share = accents as f64 / film.shots.len().max(1) as f64;
        let accents_max = fields
            .get("accents_max")
            .and_then(Value::as_f64)
            .unwrap_or(0.33);
        if share > accents_max + 1e-9 {
            if let Some((s, (_, Some(t)))) = film
                .shots
                .iter()
                .zip(&moves)
                .rev()
                .find(|(_, (_, a))| a.is_some())
            {
                out.issues.push(raise(
                    "camera_grammar",
                    "craft.camera_grammar",
                    "error",
                    &[&s.id],
                    *t,
                    format!(
                        "{accents} of {} shots are accents ({share:.2}), past {accents_max}",
                        film.shots.len()
                    ),
                ));
            }
        }
        // Cuts: neighbours that differ, and no jump cut between shots that keep one item.
        let cut_change = fields
            .get("cut_change")
            .filter(|v| !v.is_null() && **v != json!(false));
        let angle_min = cut_change
            .and_then(|c| c["angle_min"].as_f64())
            .unwrap_or(30.0);
        let size_min = cut_change
            .and_then(|c| c["size_min"].as_f64())
            .unwrap_or(1.4);
        let keep = |id: &str| -> Vec<String> {
            drawn
                .pointer(&format!("/shots/{id}/frame/keep"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        };
        let mut cuts = Vec::new();
        for &(t, a, b) in &film.cuts {
            let (sa, sb) = (&film.shots[a], &film.shots[b]);
            let (Some((_, pa)), Some((_, pb))) = (sa.poses.last(), sb.poses.first()) else {
                continue;
            };
            let common = keep(&sa.id).into_iter().find(|k| keep(&sb.id).contains(k));
            let at = common
                .as_deref()
                .and_then(|k| item_at(&drawn, k))
                .unwrap_or(pa.target);
            let (angle, ratio) =
                measure::cut_change(&cam(pa), &cam(pb), at, [framed(pa, at), framed(pb, at)]);
            cuts.push(json!({"shots": [sa.id, sb.id], "t": t, "angle": angle, "size": ratio, "item": common}));
            let shots = [sa.id.as_str(), sb.id.as_str()];
            if let (Some(item), Some(_)) = (&common, cut_change) {
                if angle < angle_min && (angle_only || ratio < size_min) {
                    out.issues.push(raise("camera_grammar", "craft.camera_grammar.jump_cut", "error", &shots, t, format!(
                        "the cut from `{}` to `{}` turns {angle:.1}° about `{item}` (under {angle_min}°) and changes its framed height {ratio:.2} times (under {size_min})",
                        sa.id, sb.id)));
                    continue;
                }
            }
            let shift = (0..3)
                .map(|k| (pa.target[k] - pb.target[k]).abs())
                .fold(0.0, f64::max);
            if moves[a].0 == moves[b].0
                && angle < 1.0
                && ratio < 1.01
                && shift <= 1e-6 * pa.width().max(1.0)
            {
                out.issues.push(raise(
                    "camera_grammar",
                    "craft.camera_grammar",
                    "error",
                    &shots,
                    t,
                    format!(
                        "`{}` and `{}` are neighbours with the same framing and move",
                        sa.id, sb.id
                    ),
                ));
            }
        }
        // The line through two items: every shot's camera on the side the first takes.
        if let Some([p, q]) = fields
            .get("line")
            .and_then(|l| l["through"].as_array())
            .and_then(|ids| {
                let at: Vec<[f64; 3]> = ids
                    .iter()
                    .filter_map(Value::as_str)
                    .filter_map(|i| item_at(&drawn, i))
                    .collect();
                <[[f64; 3]; 2]>::try_from(at).ok()
            })
        {
            let mut sign = 0.0;
            for s in &film.shots {
                for (t, pose) in &s.poses {
                    let side = measure::side(p, q, pose.position);
                    if side.abs() < 1e-9 {
                        continue;
                    }
                    if sign == 0.0 {
                        sign = side.signum();
                    } else if side.signum() != sign {
                        out.issues.push(raise(
                            "camera_grammar",
                            "craft.camera_grammar.line",
                            "error",
                            &[&s.id],
                            *t,
                            format!(
                                "`{}`'s camera crosses the line through the brief's two items",
                                s.id
                            ),
                        ));
                        break;
                    }
                }
            }
        }
        let names: Map<String, Value> = film
            .shots
            .iter()
            .zip(&moves)
            .map(|(s, (m, _))| (s.id.clone(), json!(m.name())))
            .collect();
        let accented: Vec<Value> = film
            .shots
            .iter()
            .zip(&moves)
            .filter_map(|(s, (_, a))| a.map(|t| json!({"shot": s.id, "t": t})))
            .collect();
        out.measure = json!({"moves": names, "accents": accented, "cuts": cuts});
        out
    }

    fn played_of<'c>(&mut self, ctx: &'c mut Ctx) -> Option<&'c Played> {
        if ctx.played.is_none() {
            ctx.played = Some(self.film_played(&ctx.drawn, false));
        }
        ctx.played.as_ref().and_then(Option::as_ref)
    }

    /// ends and text_led: a shot is text-led when, in at least half its frames, a text with at
    /// least `words` words shows, or when a title card is its only subject.
    fn text_led(&mut self, name: &str, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let drawn = ctx.drawn.clone();
        let words = measure::check("text_led")
            .and_then(|c| c.defaults["words"].as_u64())
            .unwrap_or(8);
        let words = fields.get("words").and_then(Value::as_u64).unwrap_or(words) as usize;
        let cards = super::title_cards(&drawn);
        let Some(shots) = self.film(ctx).map(|f| {
            f.shots
                .iter()
                .map(|s| (s.id.clone(), s.start, s.end))
                .collect::<Vec<_>>()
        }) else {
            return Found::default();
        };
        let Some(played) = self.played_of(ctx) else {
            return Found {
                blocked: vec![
                    json!({"code": format!("craft.{name}"), "why": "the film can't be played"}),
                ],
                ..Found::default()
            };
        };
        // Each shot: whether it is text-led, and the first frame its text shows.
        let led: Vec<Option<i64>> = shots
            .iter()
            .map(|(id, start, end)| {
                let ks: Vec<usize> = (0..played.frames.len())
                    .filter(|k| {
                        let t = played.t(*k);
                        *start <= t && t < *end
                    })
                    .collect();
                let shows = |k: usize| {
                    played.frames[k].texts.iter().any(|x| {
                        x.opacity.iter().any(|o| *o > 0.0)
                            && (x.text.split_whitespace().count() >= words
                                || cards.contains(&x.item))
                    })
                };
                let hits: Vec<usize> = ks.iter().copied().filter(|k| shows(*k)).collect();
                let kept_card = drawn
                    .pointer(&format!("/shots/{id}/frame/keep"))
                    .and_then(Value::as_array)
                    .is_some_and(|k| {
                        k.len() == 1 && k[0].as_str().is_some_and(|c| cards.iter().any(|x| x == c))
                    });
                (!ks.is_empty() && (2 * hits.len() >= ks.len() || kept_card))
                    .then(|| hits.first().map_or(*start, |k| played.t(*k)))
            })
            .collect();
        let mut out = Found::default();
        let mut shares = Vec::new();
        if name == "ends" {
            for (end, k) in [("first", 0), ("last", shots.len().saturating_sub(1))] {
                if fields.get(end) == Some(&json!(false)) {
                    continue;
                }
                if let (Some((id, _, _)), Some(Some(t))) = (shots.get(k), led.get(k)) {
                    out.issues.push(raise(
                        "ends",
                        "craft.ends",
                        "error",
                        &[id],
                        *t,
                        format!("the {end} shot `{id}` is text-led"),
                    ));
                }
            }
        } else {
            let max = fields.get("max").and_then(Value::as_f64).unwrap_or(0.3);
            let n = led.iter().filter(|l| l.is_some()).count();
            let share = n as f64 / shots.len().max(1) as f64;
            if share > max + 1e-9 {
                for ((id, _, _), t) in shots.iter().zip(&led) {
                    if let Some(t) = t {
                        out.issues.push(raise(
                            "text_led",
                            "craft.text_led",
                            "error",
                            &[id],
                            *t,
                            format!(
                                "`{id}` is text-led: {n} of {} shots are ({share:.2}), past {max}",
                                shots.len()
                            ),
                        ));
                    }
                }
            }
            shares.push(json!(share));
        }
        let names: Vec<&str> = shots
            .iter()
            .zip(&led)
            .filter(|(_, l)| l.is_some())
            .map(|((id, _, _), _)| id.as_str())
            .collect();
        out.measure = json!({"text_led": names, "share": shares.first()});
        out
    }

    fn recipes(&mut self, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let drawn = ctx.drawn.clone();
        let max = fields.get("max").and_then(Value::as_u64).unwrap_or(2) as usize;
        let installed: Vec<(String, u64)> = self
            .packs
            .all()
            .flat_map(|p| p.recipes.values().map(|r| (r.id.clone(), r.major)))
            .collect();
        let Some(film) = self.film(ctx) else {
            return Found::default();
        };
        // Each instance: its recipe and the first shot that frames it.
        let mut instances: Vec<(i64, String, String, String)> = Vec::new();
        for (id, item) in drawn["items"].as_object().into_iter().flatten() {
            let Some(kind) = item["kind"].as_str() else {
                continue;
            };
            let Some((full, major)) = kind.rsplit_once('@') else {
                continue;
            };
            if !installed
                .iter()
                .any(|(r, m)| r == full && Some(*m) == major.parse().ok())
            {
                continue;
            }
            let at = item_at(&drawn, id).unwrap_or([0.0; 3]);
            let shot = film.shots.iter().find(|s| {
                s.poses.first().is_none_or(|(_, p)| {
                    !p.flat || {
                        let (w, h) = (p.view_width, p.view_width * film.size[1] / film.size[0]);
                        (at[0] - p.target[0]).abs() <= w / 2.0
                            && (at[1] - p.target[1]).abs() <= h / 2.0
                    }
                })
            });
            let (t, sid) = shot.map_or((film.start + film.span, String::new()), |s| {
                (s.start, s.id.clone())
            });
            instances.push((t, sid, kind.to_string(), id.clone()));
        }
        instances.sort();
        let mut used: Vec<String> = Vec::new();
        let mut out = Found::default();
        for (t, shot, kind, id) in &instances {
            if used.contains(kind) {
                continue;
            }
            used.push(kind.clone());
            if used.len() > max {
                let mut i = raise(
                    "recipes",
                    "craft.recipes",
                    "error",
                    &[shot],
                    *t,
                    format!(
                        "`{id}` brings a film recipe {kind}, the film's {}th, past {max}",
                        used.len()
                    ),
                );
                i["ids"] = json!([shot, id]);
                i["actual"] = json!({"recipe": kind, "item": id});
                out.issues.push(i);
            }
        }
        out.measure = json!({"recipes": used});
        out
    }

    /// numbers_in_script and caption_band, read from the texts and extents each frame draws.
    fn on_screen(&mut self, name: &str, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let drawn = ctx.drawn.clone();
        let Some(spans) = self.film(ctx).map(|f| {
            f.shots
                .iter()
                .map(|s| (s.id.clone(), s.start))
                .collect::<Vec<_>>()
        }) else {
            return Found::default();
        };
        let shot_at = |t: i64| {
            spans
                .iter()
                .rev()
                .find(|(_, s)| *s <= t)
                .or(spans.first())
                .map_or(String::new(), |(id, _)| id.clone())
        };
        let Some(played) = self.played_of(ctx) else {
            return Found {
                blocked: vec![
                    json!({"code": format!("craft.{name}"), "why": "the film can't be played"}),
                ],
                ..Found::default()
            };
        };
        let mut out = Found::default();
        let mut flagged: Vec<String> = Vec::new();
        if name == "numbers_in_script" {
            let said: Vec<String> = drawn
                .pointer("/script/lines")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter_map(|(_, l)| l["text"].as_str())
                .flat_map(measure::numbers)
                .collect();
            for (k, f) in played.frames.iter().enumerate() {
                for x in f
                    .texts
                    .iter()
                    .filter(|x| x.opacity.iter().any(|o| *o > 0.0))
                {
                    for n in measure::numbers(&x.text) {
                        let key = format!("{}/{n}", x.item);
                        if said.contains(&n) || flagged.contains(&key) {
                            continue;
                        }
                        flagged.push(key);
                        let (t, shot) = (played.t(k), shot_at(played.t(k)));
                        let mut i = raise(
                            name,
                            "craft.numbers_in_script",
                            "error",
                            &[&shot],
                            t,
                            format!(
                                "`{}` shows {n} on screen, a number the script's words never say",
                                x.item
                            ),
                        );
                        i["ids"] = json!([shot, x.item]);
                        i["actual"] = json!({"number": n, "item": x.item});
                        out.issues.push(i);
                    }
                }
            }
            out.measure = json!({"said": said});
        } else {
            let height = fields.get("height").and_then(Value::as_f64).unwrap_or(0.15);
            let top = played.size[1] * (1.0 - height);
            for (k, f) in played.frames.iter().enumerate() {
                let mut inside: Vec<String> = Vec::new();
                for x in &f.texts {
                    if x.boxes
                        .iter()
                        .zip(&x.opacity)
                        .any(|(b, o)| *o > 0.0 && b[3] > top + 1e-9 && b[1] < played.size[1])
                    {
                        inside.push(x.item.clone());
                    }
                }
                for (item, e) in &f.extents {
                    if !f.texts.iter().any(|x| &x.item == item)
                        && e[1] >= top
                        && e[1] < played.size[1]
                    {
                        inside.push(item.clone());
                    }
                }
                for item in inside {
                    if flagged.contains(&item) {
                        continue;
                    }
                    flagged.push(item.clone());
                    let (t, shot) = (played.t(k), shot_at(played.t(k)));
                    let mut i = raise(
                        name,
                        "craft.caption_band",
                        "error",
                        &[&shot],
                        t,
                        format!(
                            "`{item}` draws in the caption band, the bottom {height} of the frame"
                        ),
                    );
                    i["ids"] = json!([shot, item]);
                    i["item"] = json!(item);
                    out.issues.push(i);
                }
            }
            out.measure = json!({"in_band": flagged, "band_top": top});
        }
        out
    }

    fn motion_share(&mut self, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let drawn = ctx.drawn.clone();
        let Some(film) = ctx.film.take().flatten() else {
            return Found::default();
        };
        let analysis = self.analysis(&drawn, &film);
        let mut out = Found::default();
        if let Some(a) = analysis {
            let band = if film.size[0] >= film.size[1] {
                0.15
            } else {
                0.18
            };
            let rows = measure::kept_rows(a.h, band);
            // A jump the camera doesn't make reads as a cut in the export: left out like one.
            let jumps = measure::jumps(&measure::diffs(&a.frames, a.w, rows), &a.still);
            let left_out: Vec<bool> = a
                .left_out
                .iter()
                .zip(&jumps)
                .map(|(l, j)| *l || *j)
                .collect();
            let m = measure::motion(&a.frames, a.w, rows, &left_out);
            let share = m.share();
            let (min, warn) = (
                fields.get("min").and_then(Value::as_f64).unwrap_or(0.035),
                fields.get("warn").and_then(Value::as_f64).unwrap_or(0.06),
            );
            let blank_max = seconds(fields.get("blank_max")).unwrap_or(0.3);
            let first = film.shots.first().map_or("", |s| s.id.as_str());
            if share < min {
                out.issues.push(raise(
                    "motion_share",
                    "craft.motion_share",
                    "error",
                    &[first],
                    film.start,
                    format!(
                        "{} of {} frame pairs move ({share:.4}), under {min}",
                        m.fast, m.counted
                    ),
                ));
            } else if share < warn {
                out.issues.push(raise(
                    "motion_share",
                    "craft.motion_share",
                    "warning",
                    &[first],
                    film.start,
                    format!(
                        "{} of {} frame pairs move ({share:.4}), under {warn}",
                        m.fast, m.counted
                    ),
                ));
            }
            let mut runs = Vec::new();
            for (s, e) in measure::blank_runs(&a.frames, a.w, rows, &left_out) {
                let (t0, len) = (a.times[s], (e - s) as f64 / measure::ANALYSIS_FPS);
                runs.push(json!({"t": t0, "s": len}));
                if len + 1e-9 >= blank_max {
                    let shot = film.id_at(t0).to_string();
                    out.issues.push(raise(
                        "motion_share",
                        "craft.motion_share",
                        "error",
                        &[&shot],
                        t0,
                        format!(
                            "the frame is blank for {len:.3} s from {:.3} s, {blank_max} s or more",
                            secs(t0)
                        ),
                    ));
                }
            }
            out.measure =
                json!({"share": share, "fast": m.fast, "counted": m.counted, "blank_runs": runs});
        } else {
            out.blocked.push(
                json!({"code": "craft.motion_share", "why": "a frame of the film can't be drawn"}),
            );
        }
        ctx.film = Some(Some(film));
        out
    }
}

/// Markers of `kind` (and tagged `tag`): ID, time, span.
fn markers(drawn: &Value, kind: &str, tag: Option<&str>) -> Vec<(String, i64, i64)> {
    let mut out: Vec<(String, i64, i64)> = drawn["markers"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, m)| m["kind"] == kind)
        .filter(|(_, m)| {
            tag.is_none_or(|g| {
                m["tags"]
                    .as_array()
                    .is_some_and(|t| t.iter().any(|x| x == g))
            })
        })
        .filter_map(|(id, m)| {
            Some((
                id.clone(),
                time_of(drawn, m.get("t"))?,
                time_of(drawn, m.get("span")).unwrap_or(0),
            ))
        })
        .collect();
    out.sort_by_key(|m| m.1);
    out
}

/// look_lock: every shot finished in the film's one look, unless the brief names a sequence.
fn look_lock(fields: &Map<String, Value>, ctx: &Ctx) -> Found {
    let drawn = &ctx.drawn;
    let Some(Some(film)) = ctx.film.as_ref() else {
        return Found::default();
    };
    let mut out = Found::default();
    let looks: Vec<String> = film.shots.iter().map(|s| look_of(drawn, &s.id)).collect();
    if fields.get("looks").and_then(Value::as_str) != Some("sequence") {
        if let Some(first) = looks.first() {
            for (s, l) in film.shots.iter().zip(&looks).filter(|(_, l)| *l != first) {
                let mut i = raise(
                    "look_lock",
                    "craft.look_lock",
                    "error",
                    &[&s.id],
                    s.start,
                    format!(
                        "`{}` is finished in the look {l}, not the film's {first}",
                        s.id
                    ),
                );
                i["actual"] = json!({"look": l, "film": first});
                out.issues.push(i);
            }
        }
    }
    out.measure = json!({"looks": film.shots.iter().map(|s| s.id.clone()).zip(looks).collect::<BTreeMap<_, _>>()});
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brief_times_and_entries() {
        assert_eq!(seconds(Some(&json!("0.5s"))), Some(0.5));
        assert_eq!(seconds(Some(&json!("250ms"))), Some(0.25));
        assert_eq!(seconds(Some(&json!(2))), Some(2.0));
        let brief = json!({"craft": [{"check": "shot_length", "min": "1s"}]});
        let got = named(&brief, false);
        assert_eq!(got.len(), 1);
        assert_eq!(seconds(got[0].1.get("min")), Some(1.0));
        assert_eq!(seconds(got[0].1.get("max")), Some(6.0));
        assert!(
            !got[0].1.contains_key("signature"),
            "a long take is only declared"
        );
        assert!(named(&json!({"goal": "x"}), false).is_empty());
        assert_eq!(
            named(&json!({"goal": "x"}), true).len(),
            measure::checks().len()
        );
    }
}
