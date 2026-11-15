//! A `cue.kind@1` entry read as data (Cue list `cues@1`): a pack kind, `{name, class, recipe}`,
//! whose recipe (Recipe) the pack check hands over beside it as `recipe_body` (and its planted
//! twin's as `twin_body`). The recipe's inputs are the verb's params; its steps run over one
//! target's window of the calling cue:
//!
//! - `{op: cue, params}` writes one cue over the calling cue's signature, its params the cue's own
//!   fields: `set: {path → value}` moves each path from what it holds to the value; `from: {path →
//!   value}` starts a path there (and, without a `set`, brings it back to what it held); a value
//!   `{pulse: {amount, shape?}}` adds a pulse instead, `{along: <ID>}` travels the path item's
//!   shape from where the target is, `{count: n}` counts a text in whole numbers, `{typed: true}`
//!   keys a text's reveal once a grapheme, in order (#1969), and `{to, travel}` moves on a key
//!   `travel`. `at` and `until` are the fractions of the window it covers (0 and 1), `ease` its
//!   own ease, `type` a path's channel type, and `on` the item it writes: an item step's copies,
//!   an `ID` input's item, or the target.
//! - `{op: mark | item, kind, params, at, repeat: {count, as}, when}` makes a derived item
//!   `<list>.<cue>.<step>[.<i>][.<j>]` (`.<i>` when the cue has several targets).
//!
//! Every value is a recipe expression over the inputs and lets, `i` and `n` (the target's rank
//! and the cue's count of targets), `j` (an item step's copy), `d` (the span in seconds), `target`
//! (its ID), `head` (its `#head` anchor, #1969), its bounds `x0`, `y0`, `x1`, `y1`, `w`, `h`,
//! `cx`, `cy`, a text's `letters` and `words`, `next` (the target after it in the cue's list,
//! cyclic), and, in a cue step, `now` (what the path holds on the item it writes at the step's
//! start), `here` (on the target), `next_now` (on the next target) and `<input>_now` (on the item
//! an `ID` input names). A cue step may `repeat: {count, as}` like an item step.

use deep_canvas::document::packs::Template;
use deep_canvas::grammar::FLICKS_PER_SECOND;
use serde_json::{json, Map, Value};

use super::{authored, Cue, Key};

/// The classes of verb, each with its end state the kit holds.
pub const CLASSES: [&str; 5] = ["enter", "exit", "emphasis", "move", "change"];

/// One target's window of a cue.
pub(crate) struct Window<'a> {
    pub list: &'a str,
    pub cue: &'a Cue,
    pub target: &'a str,
    pub rank: usize,
    pub n: usize,
    pub w0: i64,
    /// The target as the document holds it.
    pub item: Option<&'a Value>,
    /// Each item of the document, for the IDs a verb's params name.
    pub items: &'a Map<String, Value>,
    /// The document's seed, which no verb may read to vary its bytes.
    pub seed: u64,
}

/// One write a step makes, on a full path `items/<id>/<field…>`.
pub(crate) enum Write {
    Keys {
        path: String,
        ty: Option<String>,
        keys: Vec<Key>,
    },
    Pulse {
        path: String,
        pulse: Value,
    },
}

/// What a verb wrote for one target.
#[derive(Default)]
pub(crate) struct Wrote {
    pub writes: Vec<Write>,
    pub items: Vec<(String, Value)>,
}

type Scope = Vec<(String, Value)>;

fn eval(v: &Value, scope: &Scope) -> Result<Value, String> {
    Template::of(v).eval(scope)
}

fn set(scope: &mut Scope, name: &str, v: Value) {
    scope.retain(|(k, _)| k != name);
    scope.push((name.to_string(), v));
}

fn get<'s>(scope: &'s Scope, name: &str) -> Option<&'s Value> {
    scope.iter().find(|(k, _)| k == name).map(|(_, v)| v)
}

/// A pulse modifier over `[w0, w0 + d]` from `{amount, shape?}`, on the cue's ease.
pub(crate) fn pulse(body: &Value, w0: i64, d: i64, ease: &Value) -> Value {
    let mut p = json!({"kind": "pulse", "at": w0, "span": d,
                       "amount": body.get("amount").cloned().unwrap_or(json!(1)),
                       "ease": pulse_ease(ease)});
    if let Some(shape) = body.get("shape") {
        p["shape"] = shape.clone();
    }
    p
}

/// The ease a pulse takes, from the cue's key interp: its named ease, or linear.
fn pulse_ease(interp: &Value) -> Value {
    match interp.get("ease") {
        Some(e) => e.clone(),
        None => json!("linear"),
    }
}

/// The eased progress of a key interp at `x`: a named ease, else linear.
fn eased(interp: &Value, x: f64) -> f64 {
    let named = interp.get("ease").and_then(|e| {
        let name = e.get("name")?.as_str()?;
        deep_canvas::ease::parse(name, e.get("params"))
            .ok()
            .flatten()
    });
    match named {
        Some(n) => n.at(x),
        None => x.clamp(0.0, 1.0),
    }
}

/// The progress at which the ease reaches `y`, by bisection.
fn inverse(interp: &Value, y: f64) -> f64 {
    let (mut lo, mut hi) = (0.0_f64, 1.0_f64);
    for _ in 0..64 {
        let mid = (lo + hi) / 2.0;
        if eased(interp, mid) < y {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    hi
}

/// The target's bounds in its parent's space: its box, points or circle, moved by where it is.
fn bounds(item: &Value, pos: Option<&Value>) -> Option<[f64; 4]> {
    let params = item.get("params")?;
    let num = |v: &Value| v.as_f64();
    let (mut x0, mut y0, mut x1, mut y1) =
        if let Some(b) = params.get("box").and_then(Value::as_array) {
            let (x, y, w, h) = (
                num(b.first()?)?,
                num(b.get(1)?)?,
                num(b.get(2)?)?,
                num(b.get(3)?)?,
            );
            (x, y, x + w, y + h)
        } else if let Some(shape) = crate::morph::of_item(item, None) {
            let pts: Vec<[f64; 2]> = shape
                .iter()
                .flat_map(|s| s.points.iter().copied())
                .collect();
            if pts.is_empty() {
                return None;
            }
            pts.iter().fold(
                (
                    f64::INFINITY,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    f64::NEG_INFINITY,
                ),
                |(a, b, c, d), p| (a.min(p[0]), b.min(p[1]), c.max(p[0]), d.max(p[1])),
            )
        } else if let (Some(c), Some(r)) = (
            params.get("center").and_then(Value::as_array),
            params.get("r"),
        ) {
            let (cx, cy, r) = (num(c.first()?)?, num(c.get(1)?)?, num(r)?);
            (cx - r, cy - r, cx + r, cy + r)
        } else {
            return None;
        };
    if let Some(p) = pos.and_then(Value::as_array) {
        let (dx, dy) = (p.first().and_then(num)?, p.get(1).and_then(num)?);
        (x0, y0, x1, y1) = (x0 + dx, y0 + dy, x1 + dx, y1 + dy);
    }
    Some([x0, y0, x1, y1])
}

/// The recipe a verb runs: its own, or under the planted twin, its twin's.
fn recipe_of(entry: &Value, twin: bool) -> Result<&Value, String> {
    let field = if twin { "twin_body" } else { "recipe_body" };
    entry.get(field).filter(|r| r.is_object()).ok_or_else(|| {
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let what = if twin { "a planted twin" } else { "a recipe" };
        format!("`{name}` names {what} its pack doesn't hold")
    })
}

/// The scope a verb's expressions read for one target: its inputs, as the cue sets them over
/// their defaults, the window's names and the recipe's lets; with the names of its ID inputs.
fn scope_of(
    recipe: &Value,
    w: &Window<'_>,
    from: &mut dyn FnMut(&str, i64) -> Option<Value>,
) -> Result<(Scope, Vec<String>), String> {
    let cue = w.cue;
    let inputs = recipe.get("inputs").and_then(Value::as_object);
    let mut scope: Scope = Vec::new();
    let mut ids = Vec::new();
    for (k, input) in inputs.into_iter().flatten() {
        let v = cue
            .params
            .get(k)
            .or_else(|| input.get("default"))
            .cloned()
            .unwrap_or(Value::Null);
        if input.get("type").and_then(Value::as_str) == Some("ID") {
            ids.push(k.clone());
        }
        scope.push((k.clone(), v));
    }
    if let Some(k) = cue
        .params
        .keys()
        .find(|k| !inputs.is_some_and(|i| i.contains_key(*k)))
    {
        let verb = cue.kind.clone().unwrap_or_default();
        return Err(format!("`{k}` is not a param of `{verb}`"));
    }
    set(&mut scope, "i", json!(w.rank));
    set(&mut scope, "n", json!(w.n));
    set(
        &mut scope,
        "d",
        json!(cue.d as f64 / FLICKS_PER_SECOND as f64),
    );
    set(&mut scope, "target", json!(w.target));
    set(&mut scope, "head", json!(format!("{}#head", w.target)));
    let at_list = cue
        .targets
        .iter()
        .position(|(t, _)| t == w.target)
        .unwrap_or(0);
    if let Some((next, _)) = cue.targets.get((at_list + 1) % cue.targets.len().max(1)) {
        set(&mut scope, "next", json!(next));
    }
    if let Some(text) = w
        .item
        .and_then(|i| i.pointer("/params/text"))
        .and_then(Value::as_str)
    {
        set(
            &mut scope,
            "letters",
            json!(text.chars().filter(|c| !c.is_whitespace()).count()),
        );
        set(&mut scope, "words", json!(text.split_whitespace().count()));
    }
    set(&mut scope, "seed", json!(w.seed % 1_000_000));
    let pos = from(&format!("items/{}/at/pos", w.target), w.w0);
    if let Some(b) = w.item.and_then(|item| bounds(item, pos.as_ref())) {
        let named = [
            ("x0", b[0]),
            ("y0", b[1]),
            ("x1", b[2]),
            ("y1", b[3]),
            ("w", b[2] - b[0]),
            ("h", b[3] - b[1]),
            ("cx", (b[0] + b[2]) / 2.0),
            ("cy", (b[1] + b[3]) / 2.0),
        ];
        for (k, v) in named {
            set(&mut scope, k, json!(v));
        }
    }
    if let Some(lets) = recipe.get("let").and_then(Value::as_object) {
        for (k, e) in lets {
            let v = eval(e, &scope).map_err(|why| format!("let `{k}`: {why}"))?;
            set(&mut scope, k, v);
        }
    }
    Ok((scope, ids))
}

/// Applies the verb `entry` over one target's window; `from` reads what a full path holds at a
/// time, as the cue list has written it so far. With `twin`, its planted twin runs instead.
pub(crate) fn apply(
    entry: &Value,
    w: &Window<'_>,
    twin: bool,
    from: &mut dyn FnMut(&str, i64) -> Option<Value>,
) -> Result<Wrote, String> {
    let recipe = recipe_of(entry, twin)?;
    let (scope, ids) = scope_of(recipe, w, from)?;
    let d = w.cue.d;
    let at = |u: f64| w.w0 + (u * d as f64).round() as i64;
    let mut out = Wrote::default();
    // Each item step's copies, by step ID.
    let mut made: Vec<(String, Vec<(String, Value)>)> = Vec::new();
    let steps = recipe
        .get("steps")
        .and_then(Value::as_object)
        .ok_or("a verb's recipe has `steps`")?;
    for (step_id, step) in steps {
        if let Some(cond) = step.get("when") {
            if !truthy(&eval(cond, &scope)?) {
                continue;
            }
        }
        match step.get("op").and_then(Value::as_str).unwrap_or_default() {
            "mark" | "item" => {
                let copies = derive(step_id, step, w, &scope)?;
                out.items.extend(copies.iter().cloned());
                made.push((step_id.clone(), copies));
            }
            "cue" => {
                let params = step.get("params").cloned().unwrap_or(json!({}));
                let owners = owners_of(step_id, &params, w, &scope, &ids, &made)?;
                let ease = match params.get("ease") {
                    None => w.cue.ease.clone(),
                    Some(e) => super::ease_of(Some(&eval(e, &scope)?))?,
                };
                let (copies, var) = match step.get("repeat") {
                    None => (1, String::new()),
                    Some(r) => (
                        eval(r.get("count").ok_or("a repeat has `count`")?, &scope)?
                            .as_f64()
                            .filter(|c| c.is_finite() && *c >= 0.0)
                            .ok_or("a repeat's count is a number")?
                            .min(1024.0) as usize,
                        r.get("as")
                            .and_then(Value::as_str)
                            .unwrap_or("k")
                            .to_string(),
                    ),
                };
                let each = owners
                    .iter()
                    .enumerate()
                    .flat_map(|o| (0..copies).map(move |k| (o, k)));
                for ((j, (owner, item)), k) in each {
                    let mut scope = scope.clone();
                    set(&mut scope, "j", json!(j));
                    if !var.is_empty() {
                        set(&mut scope, &var, json!(k));
                    }
                    let frac = |k: &str, or: f64| -> Result<f64, String> {
                        match params.get(k) {
                            None => Ok(or),
                            Some(v) => eval(v, &scope)?
                                .as_f64()
                                .filter(|u| u.is_finite())
                                .ok_or_else(|| {
                                    format!("step `{step_id}`'s `{k}` is not a fraction")
                                }),
                        }
                    };
                    let (s0, s1) = (at(frac("at", 0.0)?), at(frac("until", 1.0)?));
                    for p in paths_of(&params) {
                        let writes = cue_path(
                            &params,
                            &p,
                            owner,
                            item.as_ref(),
                            (s0, s1),
                            &ease,
                            w,
                            &scope,
                            &ids,
                            from,
                        )?;
                        out.writes.push(writes);
                    }
                }
            }
            other => {
                return Err(format!(
                    "step `{step_id}`'s op `{other}` is none a verb runs (cue, mark, item)"
                ))
            }
        }
    }
    Ok(out)
}

/// The items a cue step writes: the copies of an item step, an ID input's item, or the target;
/// each with its derived value when it is a copy.
fn owners_of(
    step_id: &str,
    params: &Value,
    w: &Window<'_>,
    scope: &Scope,
    ids: &[String],
    made: &[(String, Vec<(String, Value)>)],
) -> Result<Vec<(String, Option<Value>)>, String> {
    let Some(name) = params.get("on").and_then(Value::as_str) else {
        return Ok(vec![(w.target.to_string(), None)]);
    };
    if let Some((_, copies)) = made.iter().find(|(s, _)| s == name) {
        return Ok(copies
            .iter()
            .map(|(id, v)| (id.clone(), Some(v.clone())))
            .collect());
    }
    if ids.iter().any(|i| i == name) {
        let id = get(scope, name).and_then(Value::as_str);
        return Ok(vec![(
            id.ok_or_else(|| format!("`{name}` names no item"))?
                .to_string(),
            None,
        )]);
    }
    Err(format!(
        "step `{step_id}` is on `{name}`, which no earlier step makes and no ID input names"
    ))
}

/// The write of one path of a cue step on `owner` over `[s0, s1]`.
#[allow(clippy::too_many_arguments)]
fn cue_path(
    params: &Value,
    p: &str,
    owner: &str,
    item: Option<&Value>,
    (s0, s1): (i64, i64),
    ease: &Value,
    w: &Window<'_>,
    scope: &Scope,
    ids: &[String],
    from: &mut dyn FnMut(&str, i64) -> Option<Value>,
) -> Result<Write, String> {
    let full = format!("items/{owner}/{p}");
    let field: Vec<String> = p.split('/').map(str::to_string).collect();
    let now = match item {
        Some(item) => authored(item, &field),
        None => from(&full, s0),
    };
    let mut scope = scope.clone();
    set(&mut scope, "now", now.clone().unwrap_or(Value::Null));
    let here = from(&format!("items/{}/{p}", w.target), s0).unwrap_or(Value::Null);
    set(&mut scope, "here", here);
    for input in ids.iter().map(String::as_str).chain(["next"]) {
        if let Some(other) = get(&scope, input)
            .and_then(Value::as_str)
            .map(str::to_string)
        {
            let v = from(&format!("items/{other}/{p}"), s0).unwrap_or(Value::Null);
            set(&mut scope, &format!("{input}_now"), v);
        }
    }
    let start = match params.get("from").and_then(|f| f.get(p)) {
        Some(v) => eval(v, &scope)?,
        None => now.clone().unwrap_or(Value::Null),
    };
    let target = params.get("set").and_then(|s| s.get(p));
    let ty = params
        .get("type")
        .and_then(|t| t.get(p))
        .and_then(Value::as_str)
        .map(str::to_string);
    let one = target.and_then(Value::as_object).filter(|o| o.len() == 1);
    if let Some(body) = one.and_then(|o| o.get("pulse")) {
        let body = eval(body, &scope)?;
        return Ok(Write::Pulse {
            path: full,
            pulse: pulse(&body, s0, s1 - s0, ease),
        });
    }
    if let Some(id) = one.and_then(|o| o.get("along")) {
        let id = eval(id, &scope)?;
        let keys = along(
            w.items,
            id.as_str().unwrap_or_default(),
            &start,
            (s0, s1),
            ease,
        )?;
        return Ok(Write::Keys {
            path: full,
            ty,
            keys,
        });
    }
    if one.and_then(|o| o.get("typed")).is_some_and(truthy) {
        let text = match item {
            Some(item) => item.pointer("/params/text"),
            None => w.items.get(owner).and_then(|i| i.pointer("/params/text")),
        };
        let text = text.and_then(Value::as_str).unwrap_or_default();
        return Ok(Write::Keys {
            path: full,
            ty,
            keys: typed(start, text, (s0, s1)),
        });
    }
    if let Some(to) = one.and_then(|o| o.get("count")) {
        let to = eval(to, &scope)?.as_f64().ok_or("a count is a number")?;
        let keys = count(&start, to, (s0, s1), ease);
        return Ok(Write::Keys {
            path: full,
            ty: Some("enum".into()),
            keys,
        });
    }
    let moving = target
        .and_then(Value::as_object)
        .filter(|o| o.contains_key("to") && o.contains_key("travel"));
    let (end, travel) = match (moving, target) {
        (Some(o), _) => (eval(&o["to"], &scope)?, Some(eval(&o["travel"], &scope)?)),
        (None, Some(v)) => (eval(v, &scope)?, None),
        (None, None) => (now.unwrap_or(Value::Null), None),
    };
    Ok(Write::Keys {
        path: full,
        ty,
        keys: tween(start, end, (s0, s1), ease, travel),
    })
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0),
        Value::Null => false,
        _ => true,
    }
}

/// The paths a cue step writes: those it sets, then those it only starts.
fn paths_of(params: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for field in ["set", "from"] {
        for k in params
            .get(field)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(k, _)| k)
        {
            if !out.contains(k) {
                out.push(k.clone());
            }
        }
    }
    out
}

/// Keys from `start` at `s0` to `end` at `s1` on `ease`; one key when the span is empty.
fn tween(
    start: Value,
    end: Value,
    (s0, s1): (i64, i64),
    ease: &Value,
    travel: Option<Value>,
) -> Vec<Key> {
    if s1 <= s0 {
        return vec![Key {
            t: s0,
            value: end,
            interp: json!("hold"),
            travel: None,
        }];
    }
    vec![
        Key {
            t: s0,
            value: start,
            interp: ease.clone(),
            travel,
        },
        Key {
            t: s1,
            value: end,
            interp: json!("hold"),
            travel: None,
        },
    ]
}

/// The keys of a move along the path item `id`'s shape, placed so it starts at `start`: one per
/// point, each at the time the ease brings the move to that share of the path's length.
fn along(
    items: &Map<String, Value>,
    id: &str,
    start: &Value,
    (s0, s1): (i64, i64),
    ease: &Value,
) -> Result<Vec<Key>, String> {
    let item = items
        .get(id)
        .ok_or_else(|| format!("`{id}` names no item"))?;
    let shape = crate::morph::of_item(item, None)
        .ok_or_else(|| format!("`{id}` has no shape to move along"))?;
    let shape = crate::morph::placed(item, &shape);
    let pts: Vec<[f64; 2]> = shape
        .iter()
        .flat_map(|s| s.points.iter().copied())
        .collect();
    if pts.len() < 2 {
        return Err(format!("`{id}`'s shape has fewer than two points"));
    }
    let s = start.as_array().cloned().unwrap_or_default();
    let base = |k: usize| s.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    let mut lengths = vec![0.0];
    for k in 1..pts.len() {
        let (dx, dy) = (pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        let last = lengths[k - 1];
        lengths.push(last + deep_canvas::ops::sqrt(dx * dx + dy * dy));
    }
    let total = lengths[pts.len() - 1];
    let last = pts.len() - 1;
    let keys = (0..pts.len())
        .map(|k| {
            let share = if total > 0.0 { lengths[k] / total } else { 1.0 };
            let u = match k {
                0 => 0.0,
                k if k == last => 1.0,
                _ => inverse(ease, share),
            };
            let mut v = vec![
                json!(base(0) + pts[k][0] - pts[0][0]),
                json!(base(1) + pts[k][1] - pts[0][1]),
            ];
            if s.len() > 2 {
                v.push(json!(base(2)));
            }
            let interp = match k {
                k if k == last => json!("hold"),
                _ if last == 1 => ease.clone(),
                _ => json!("linear"),
            };
            Key {
                t: s0 + (u * (s1 - s0) as f64).round() as i64,
                value: Value::Array(v),
                interp,
                travel: None,
            }
        })
        .collect();
    Ok(keys)
}

/// The keys of a count from what a text shows to `to`, one per whole number on the way, each
/// held from the time the ease reaches it.
fn count(start: &Value, to: f64, (s0, s1): (i64, i64), ease: &Value) -> Vec<Key> {
    let from = match start {
        Value::String(s) => s.trim().parse::<f64>().unwrap_or(0.0),
        v => v.as_f64().unwrap_or(0.0),
    };
    let (a, b) = (from.round() as i64, to.round() as i64);
    let n = (b - a).abs();
    let step = if b >= a { 1 } else { -1 };
    (0..=n)
        .map(|k| {
            let u = match k {
                0 => 0.0,
                _ => inverse(ease, k as f64 / n as f64),
            };
            Key {
                t: s0 + (u * (s1 - s0) as f64).round() as i64,
                value: json!((a + step * k).to_string()),
                interp: json!("hold"),
                travel: None,
            }
        })
        .collect()
}

/// #1969: the keys of a text typed on over `[s0, s1]`: its reveal from `start`, then one key a
/// grapheme, held, the k-th of n at `s0 + k/n` of the span, to the level that shows k graphemes
/// with `#head` after the k-th ([`typed_levels`]), the last at `s1` to 1.
///
/// [`typed_levels`]: deep_canvas_marks::animator::typed_levels
fn typed(start: Value, text: &str, (s0, s1): (i64, i64)) -> Vec<Key> {
    let levels = deep_canvas_marks::animator::typed_levels(text);
    let n = levels.len().max(1) as f64;
    let key = |t: i64, value: Value| Key {
        t,
        value,
        interp: json!("hold"),
        travel: None,
    };
    std::iter::once(key(s0, start))
        .chain(levels.into_iter().enumerate().map(|(k, level)| {
            let t = s0 + ((k + 1) as f64 / n * (s1 - s0) as f64).round() as i64;
            key(t, json!(level))
        }))
        .collect()
}

/// The copies an item step makes for one target: `<list>.<cue>.<step>[.<i>][.<j>]`.
fn derive(
    step_id: &str,
    step: &Value,
    w: &Window<'_>,
    scope: &Scope,
) -> Result<Vec<(String, Value)>, String> {
    let mut base = format!("{}.{}.{step_id}", w.list, w.cue.id);
    if w.n > 1 {
        base = format!("{base}.{}", w.rank);
    }
    let (count, var) = match step.get("repeat") {
        None => (None, String::new()),
        Some(r) => {
            let c = eval(r.get("count").ok_or("a repeat has `count`")?, scope)?;
            let c = c
                .as_f64()
                .filter(|c| c.is_finite() && *c >= 0.0)
                .ok_or("a repeat's count is a number")? as usize;
            (
                Some(c.min(1024)),
                r.get("as")
                    .and_then(Value::as_str)
                    .unwrap_or("j")
                    .to_string(),
            )
        }
    };
    let kind = step
        .get("kind")
        .and_then(Value::as_str)
        .ok_or("an item step has `kind`")?;
    let order = w
        .item
        .and_then(|i| i.get("order"))
        .and_then(Value::as_str)
        .unwrap_or("a0");
    let mut out = Vec::new();
    for j in 0..count.unwrap_or(1) {
        let mut scope = scope.clone();
        if count.is_some() {
            set(&mut scope, &var, json!(j));
        }
        let id = match count {
            Some(_) => format!("{base}.{j}"),
            None => base.clone(),
        };
        let mut item = json!({"id": id, "kind": kind, "name": id, "order": format!("{order}{j}")});
        if let Some(p) = step.get("params") {
            item["params"] = eval(p, &scope)?;
        }
        if let Some(a) = step.get("at") {
            item["at"] = eval(a, &scope)?;
        }
        if let Some(parent) = w.item.and_then(|t| t.get("parent")) {
            item["parent"] = parent.clone();
        }
        out.push((id, item));
    }
    Ok(out)
}
