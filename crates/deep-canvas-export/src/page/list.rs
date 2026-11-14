//! #169 (canvas primitives: Export: playable page): a live piece's discrete states and the edges
//! between them, one control changing. A state is where a play of the piece comes to rest: the
//! stop the timeline holds at (or its end), each listed control's value, and the hash of every
//! carried state the core's carried-state list holds there, so two plays that leave any carried
//! state different stay two states however alike they draw. The listing runs breadth first over
//! plays: each is the piece's input track with one more entry, stamped on the frame grid where the
//! play before it came to rest, so the same moves made in another order land on the same clock.
//!
//! Moves only go forward: a toggle's, a choice's or a stages control's other options; a control a
//! marker waits for, each option, only while the timeline holds there; and advance at a stage with
//! a stage ahead of it. Back and a jump by number retrace or skip what forward moves list already.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use deep_canvas::document::variants;
use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::schedule::CarriedState;
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::present::Kind;
use deep_canvas_motion::program::Program;
use serde_json::{json, Value};

/// The most states and edges a page holds (Export: playable page).
pub const MOST_STATES: usize = 64;
pub const MOST_EDGES: usize = 256;

/// How long a change may take to come to rest before the page refuses it.
const SETTLE: i64 = 60 * FLICKS_PER_SECOND;

/// The control kinds a page lists as states; any other is a warning.
const LISTED: [&str; 3] = ["toggle", "choice", "stages"];

/// A control the page lists: its options' names, in order, and how a change reaches the frames.
#[derive(Clone, Debug, PartialEq)]
pub struct Axis {
    pub id: String,
    pub kind: String,
    pub names: Vec<String>,
    /// Class view: a change is the viewer's own pick, written as the control's default.
    pub view: bool,
    /// A marker waits for it: it changes only while the timeline holds there.
    pub waited: bool,
    pub default: Option<usize>,
}

impl Axis {
    /// The value an entry or a default carries for option `o`.
    pub fn value(&self, o: usize) -> Value {
        match self.kind.as_str() {
            "toggle" => Value::Bool(o == 1),
            _ => Value::String(self.names[o].clone()),
        }
    }

    fn option(&self, v: &Value) -> Option<usize> {
        let name = match v {
            Value::Bool(b) => b.to_string(),
            Value::String(s) => s.clone(),
            _ => return None,
        };
        self.names.iter().position(|n| *n == name)
    }
}

/// One play: the input track, each view-class control's pick, and the clock it rests at.
#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    pub track: Vec<Value>,
    pub view: BTreeMap<String, usize>,
    pub t: i64,
}

/// What tells two states apart.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Key {
    /// The stop the timeline holds at, by marker, or `None` where it runs to its end.
    pub stop: Option<String>,
    pub values: Vec<Option<usize>>,
    pub carried: Vec<CarriedState>,
}

/// A state: what tells it apart, the first play that reached it, and where it rests.
#[derive(Clone, Debug)]
pub struct State {
    pub key: Key,
    pub node: Node,
    pub rest: Rest,
}

/// One control changing: from state `from` to state `to`, on the play `node` (the play of `from`
/// with the change), whose frames from `at` until it rests are the edge's clip. `control` is
/// `None` for present mode's advance.
#[derive(Clone, Debug)]
pub struct Edge {
    pub from: usize,
    pub to: usize,
    pub control: Option<String>,
    pub value: Value,
    pub node: Node,
    pub at: i64,
}

#[derive(Clone, Debug)]
pub struct Listing {
    pub axes: Vec<Axis>,
    pub states: Vec<State>,
    pub edges: Vec<Edge>,
    pub warnings: Vec<Value>,
    /// Whether the plays run in present mode: the piece has stage markers.
    pub present: bool,
}

/// Where a play comes to rest: the clock, the stop held there and, at a looping hold, its span;
/// the control that stop waits for, its stage number, and whether a stage lies ahead of it.
#[derive(Clone, Debug, PartialEq)]
pub struct Rest {
    pub t: i64,
    pub stop: Option<String>,
    pub loop_len: Option<i64>,
    pub waits: Option<String>,
    pub stage: Option<usize>,
    pub ahead: bool,
}

fn refusal(code: &str, why: String, more: Value) -> Value {
    let mut out = json!({"outcome": "refused", "code": code, "why": why});
    if let (Some(o), Some(m)) = (out.as_object_mut(), more.as_object()) {
        o.extend(m.clone());
    }
    out
}

/// The controls the page lists, and a warning for each control it can't hold as states.
pub fn axes(doc: &Value) -> (Vec<Axis>, Vec<Value>) {
    let waited: BTreeSet<&str> = (doc["markers"].as_object().into_iter().flatten())
        .filter_map(|(_, m)| m["waits_for"].as_str())
        .collect();
    let mut axes = Vec::new();
    let mut warnings = Vec::new();
    for (id, c) in doc["controls"].as_object().into_iter().flatten() {
        let kind = c["kind"].as_str().unwrap_or_default();
        if !LISTED.contains(&kind) {
            // The transport's play and pause are the player's own.
            if kind != "transport" {
                warnings.push(json!({"item": id, "what": format!("{kind} control {id} isn't a state a page can hold: it keeps its default")}));
            }
            continue;
        }
        let names = match kind {
            "toggle" => vec!["false".to_string(), "true".to_string()],
            _ => variants::option_names(doc, c),
        };
        let mut axis = Axis {
            id: id.clone(),
            kind: kind.into(),
            names,
            view: crate::page::class_of(c) == "view",
            waited: waited.contains(id.as_str()),
            default: None,
        };
        // Before any pick: its default, a toggle's off, or a variant choice's set's default.
        axis.default = match c.get("default") {
            Some(v) => axis.option(v),
            None if kind == "toggle" => Some(0),
            None => (c["variant"].as_str())
                .and_then(|set| doc["variants"][set]["default"].as_str())
                .and_then(|d| axis.names.iter().position(|n| n == d)),
        };
        axes.push(axis);
    }
    (axes, warnings)
}

/// Whether `doc` has a stage marker, so its plays run in present mode and hold at each stage.
fn has_stages(doc: &Value) -> bool {
    (doc["markers"].as_object().into_iter().flatten()).any(|(_, m)| m["kind"] == "stage")
}

/// The played form of `node`: its track inlined, each view pick as its control's default, and
/// present mode on where the piece has stage markers.
pub fn played(doc: &Value, axes: &[Axis], node: &Node, present: bool) -> Value {
    let mut out = doc.clone();
    out["track"] = Value::Array(node.track.clone());
    if present {
        out["present"] = Value::Bool(true);
    }
    for a in axes.iter().filter(|a| a.view) {
        if let Some(o) = node.view.get(&a.id) {
            out["controls"][&a.id]["default"] = a.value(*o);
        }
    }
    out
}

/// The first frame-grid clock at or after `from` where `form`'s play rests: the timeline holds
/// at a stop or has run its course, and nothing an entry started still moves. Where the piece
/// loops (a hold that loops, or a transport that wraps with no stops) it rests at the first frame
/// that equals the frame a loop later.
pub fn rest(form: &Value, from: i64, frame: i64) -> Result<Rest, Value> {
    let map = form.as_object().ok_or_else(|| json!({"code": "bad_doc"}))?;
    let program = Program::compile(map).map_err(|r| {
        refusal(
            "page_uncompiled",
            format!("the piece doesn't compile at {}: {}", r.path, r.code),
            json!({"path": r.path}),
        )
    })?;
    let path = &program.path;
    let tr = program.motion.transport;
    let last = path.pieces.last();
    // A play that ends on a hold rests there at the earliest; one that runs, where nothing moves.
    let anchor = match last {
        Some(p) if p.kind != Kind::Run => p.t,
        _ => from,
    };
    let grid =
        |t: i64| t.div_euclid(frame) * frame + if t.rem_euclid(frame) == 0 { 0 } else { frame };
    let mut t = grid(anchor.max(from));
    let looping = match last.map(|p| p.kind) {
        Some(Kind::Loop { len, .. }) => Some(len),
        _ if path.pieces.is_empty() && (tr.wrap || tr.ping_pong) => tr.span,
        _ => None,
    };
    // At rest nothing moves, or, where the piece loops, each frame is the frame a loop later.
    let (mut state, mut later) = (program.state(), program.state());
    let bits = |s: &deep_canvas_motion::program::State| -> Vec<u64> {
        (s.slots
            .iter()
            .chain(&s.values)
            .chain(s.cameras.iter().flatten()))
        .map(|v| v.to_bits())
        .collect()
    };
    loop {
        program.evaluate(t, Validity::Full, &mut state);
        let rests = match looping {
            Some(len) if len > 0 => {
                program.evaluate(t + len, Validity::Full, &mut later);
                bits(&state) == bits(&later)
            }
            _ => state.valid_until.is_none(),
        };
        if rests {
            break;
        }
        t += frame;
        if t - from > SETTLE {
            return Err(refusal(
                "page_unsettled",
                "a change still moves a minute after it was made, so the page has no state to land on".into(),
                json!({"t": from}),
            ));
        }
    }
    let held = path.held_at(t).map(|k| &path.stops[k]);
    Ok(Rest {
        t,
        stop: held.map(|s| s.marker.clone()),
        loop_len: looping,
        waits: held
            .and_then(|s| s.waits.as_ref())
            .map(|w| w.control.clone()),
        stage: held.and_then(|s| s.stage),
        ahead: held.is_some_and(|h| (path.stops.iter()).any(|s| s.stage.is_some() && s.at > h.at)),
    })
}

/// Each listed control's value in `node`: its last entry, its view pick, or its default.
fn values(axes: &[Axis], node: &Node) -> Vec<Option<usize>> {
    axes.iter()
        .map(|a| {
            if a.view {
                return node.view.get(&a.id).copied().or(a.default);
            }
            let last = node.track.iter().rfind(|e| e["control"] == a.id.as_str());
            last.map_or(a.default, |e| a.option(&e["value"]))
        })
        .collect()
}

/// The moves out of a state: `(axis, option)` for a control, `None` for advance.
fn moves(axes: &[Axis], state: &State, present: bool) -> Vec<Option<(usize, usize)>> {
    let r = &state.rest;
    let mut out = Vec::new();
    for (i, a) in axes.iter().enumerate() {
        for o in 0..a.names.len() {
            let offered = if a.waited {
                r.waits.as_deref() == Some(a.id.as_str())
            } else {
                state.key.values[i] != Some(o)
            };
            if offered {
                out.push(Some((i, o)));
            }
        }
    }
    // Advance at a stage that waits for nothing, while a stage lies ahead.
    if present && r.stage.is_some() && r.waits.is_none() && r.ahead {
        out.push(None);
    }
    out
}

/// The core's carried state of a played form at a clock, as the host reads it.
pub type Probe<'a> = dyn FnMut(&Value, i64) -> Result<Vec<CarriedState>, Value> + 'a;

/// The piece's states and edges, breadth first from its first rest. `probe` gives the core's
/// carried state of a played form at a clock. More than [`MOST_STATES`] states or
/// [`MOST_EDGES`] edges is refused, naming the controls that multiply, or the carried state
/// that does.
pub fn list(doc: &Value, frame: i64, probe: &mut Probe<'_>) -> Result<Listing, Value> {
    let (axes, warnings) = axes(doc);
    let present = has_stages(doc);
    if let Some(a) = axes.iter().find(|a| a.waited && a.names.is_empty()) {
        return Err(refusal(
            "page_wait_unlisted",
            format!(
                "a marker waits for {}, which has no options a page can list",
                a.id
            ),
            json!({"control": a.id}),
        ));
    }
    let start = doc["transport"]["start"].as_i64().unwrap_or(0);
    let mut states: Vec<State> = Vec::new();
    let mut edges: Vec<Edge> = Vec::new();
    let mut index: BTreeMap<Key, usize> = BTreeMap::new();
    let mut queue = VecDeque::new();
    // The state `node`'s play rests in, found or added, and the clock it rests at.
    let mut reach = |node: Node,
                     from: i64,
                     states: &mut Vec<State>,
                     index: &mut BTreeMap<Key, usize>,
                     queue: &mut VecDeque<usize>|
     -> Result<(usize, i64), Value> {
        let form = played(doc, &axes, &node, present);
        let r = rest(&form, from, frame)?;
        let node = Node { t: r.t, ..node };
        let key = Key {
            stop: r.stop.clone(),
            values: values(&axes, &node),
            carried: probe(&form, r.t)?,
        };
        if let Some(&i) = index.get(&key) {
            return Ok((i, r.t));
        }
        if states.len() == MOST_STATES {
            let mut all: Vec<&Key> = states.iter().map(|s| &s.key).collect();
            all.push(&key);
            return Err(too_many_states(&axes, &all));
        }
        let t = r.t;
        index.insert(key.clone(), states.len());
        queue.push_back(states.len());
        states.push(State { key, node, rest: r });
        Ok((states.len() - 1, t))
    };
    let first = Node {
        track: Vec::new(),
        view: BTreeMap::new(),
        t: start,
    };
    reach(first, start, &mut states, &mut index, &mut queue)?;
    while let Some(s) = queue.pop_front() {
        let state = states[s].clone();
        let node = &state.node;
        for mv in moves(&axes, &state, present) {
            let mut next = node.clone();
            let (control, value) = match mv {
                None => {
                    next.track.push(json!({"t": node.t, "present": "advance"}));
                    (None, json!("advance"))
                }
                Some((i, o)) => {
                    let a = &axes[i];
                    let v = a.value(o);
                    if a.view {
                        next.view.insert(a.id.clone(), o);
                    } else {
                        next.track
                            .push(json!({"t": node.t, "control": a.id, "value": v}));
                    }
                    (Some(a.id.clone()), v)
                }
            };
            // The edge's clip runs on its own play to where that play rests, which may differ
            // from the clock of the first play that reached its state.
            // A change shows on the next frame at the earliest, so a play's moves are a frame
            // apart at least and whatever steps between them sees each.
            let (to, rests) = reach(
                next.clone(),
                node.t + frame,
                &mut states,
                &mut index,
                &mut queue,
            )?;
            next.t = rests;
            if edges.len() == MOST_EDGES {
                let keys: Vec<&Key> = states.iter().map(|s| &s.key).collect();
                return Err(refusal(
                    "page_edges",
                    format!(
                        "a playable page holds at most {MOST_EDGES} edges, and this piece has more: {} multiply",
                        multiply_names(&axes, &keys)
                    ),
                    json!({"most": MOST_EDGES, "controls": multiplying(&axes, &keys)}),
                ));
            }
            edges.push(Edge {
                from: s,
                to,
                control,
                value,
                node: next,
                at: node.t,
            });
        }
    }
    Ok(Listing {
        axes,
        states,
        edges,
        warnings,
        present,
    })
}

/// The listed controls whose values differ among `keys`, with "stages" when the stop does.
fn multiplying(axes: &[Axis], keys: &[&Key]) -> Vec<String> {
    let mut out = Vec::new();
    let stops: BTreeSet<_> = keys.iter().map(|k| &k.stop).collect();
    if stops.len() > 1 {
        out.push("stages".to_string());
    }
    for (i, a) in axes.iter().enumerate() {
        let seen: BTreeSet<_> = keys.iter().map(|k| k.values[i]).collect();
        if seen.len() > 1 {
            out.push(a.id.clone());
        }
    }
    out
}

fn multiply_names(axes: &[Axis], keys: &[&Key]) -> String {
    multiplying(axes, keys).join(" × ")
}

/// The refusal past [`MOST_STATES`]: the controls that multiply, or, where the stops and the
/// controls alone stay within the cap, the carried state that keeps the states apart.
fn too_many_states(axes: &[Axis], keys: &[&Key]) -> Value {
    let plain: BTreeSet<_> = keys.iter().map(|k| (&k.stop, &k.values)).collect();
    if plain.len() <= MOST_STATES {
        let mut rows: BTreeMap<(String, String, String), BTreeSet<&str>> = BTreeMap::new();
        for k in keys {
            for c in &k.carried {
                rows.entry((c.module.clone(), c.kind.clone(), c.key.clone()))
                    .or_default()
                    .insert(&c.hash);
            }
        }
        let carried: Vec<Value> = (rows.into_iter())
            .filter(|(_, hashes)| hashes.len() > 1)
            .map(|((module, kind, key), _)| json!({"module": module, "kind": kind, "key": key}))
            .collect();
        let named: Vec<&str> = carried
            .iter()
            .filter_map(|c| c["module"].as_str())
            .collect();
        return refusal(
            "page_states",
            format!("a playable page holds at most {MOST_STATES} states, and this piece has more: the carried state of {} keeps them apart", named.join(", ")),
            json!({"most": MOST_STATES, "controls": [], "carried": carried}),
        );
    }
    refusal(
        "page_states",
        format!(
            "a playable page holds at most {MOST_STATES} states, and this piece has more: {} multiply",
            multiply_names(axes, keys)
        ),
        json!({"most": MOST_STATES, "controls": multiplying(axes, keys)}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAME: i64 = FLICKS_PER_SECOND / 30;

    /// Four stages, an explode toggle and a color variant choice of `colors` options.
    fn walkthrough(colors: usize) -> Value {
        let options: Vec<Value> = (0..colors)
            .map(|i| json!({"name": format!("c{i}"), "patch": []}))
            .collect();
        json!({
            "id": "walk", "title": "Walk", "size": [640, 360],
            "transport": {"span": "20s", "frame_rate": [30, 1]},
            "items": {},
            "controls": {
                "explode": {"kind": "toggle", "label": "Explode", "role": "switch"},
                "color": {"kind": "choice", "label": "Color", "role": "radiogroup", "variant": "color"},
            },
            "variants": {"color": {"default": "c0", "options": options}},
            "markers": {
                "s1": {"kind": "stage", "name": "One", "t": "0s"},
                "s2": {"kind": "stage", "name": "Two", "t": "5s"},
                "s3": {"kind": "stage", "name": "Three", "t": "10s"},
                "s4": {"kind": "stage", "name": "Four", "t": "15s"},
            },
        })
    }

    fn none(_: &Value, _: i64) -> Result<Vec<CarriedState>, Value> {
        Ok(Vec::new())
    }

    #[test]
    fn four_stages_a_toggle_and_three_colors_are_twenty_four_states() {
        let listing = list(&walkthrough(3), FRAME, &mut none).expect("listed");
        assert_eq!(listing.states.len(), 24);
        // Each state: the toggle's other value and the two other colors; stages 1 to 3 advance.
        assert_eq!(listing.edges.len(), 24 * 3 + 3 * 6);
        let advances = listing.edges.iter().filter(|e| e.control.is_none()).count();
        assert_eq!(advances, 18);
    }

    #[test]
    fn past_256_edges_the_page_is_refused_naming_the_controls_that_multiply() {
        // 4 stages × 2 × 8 colors = 64 states, each with 1 + 7 changes: 512 edges and more.
        let refused = list(&walkthrough(8), FRAME, &mut none).expect_err("refused");
        assert_eq!(refused["code"], "page_edges");
        assert_eq!(refused["controls"], json!(["stages", "explode", "color"]));
    }

    #[test]
    fn carried_state_that_never_settles_is_named_when_the_controls_alone_fit() {
        // A module whose carried state counts the entries made keeps every play apart.
        let mut counts = |form: &Value, _: i64| {
            let n = form["track"].as_array().map_or(0, Vec::len);
            Ok(vec![CarriedState {
                module: "test.count".into(),
                kind: "checkpoint".into(),
                key: "test.count.state".into(),
                hash: n.to_string(),
            }])
        };
        let refused = list(&walkthrough(3), FRAME, &mut counts).expect_err("refused");
        assert_eq!(refused["code"], "page_states");
        assert_eq!(refused["controls"], json!([]));
        assert_eq!(refused["carried"][0]["module"], "test.count");
    }

    #[test]
    fn a_change_a_follow_channel_eases_in_rests_where_the_ease_ends() {
        // A lid that fades in over 1 s once the toggle turns on, turned on at 0.
        let form = json!({
            "id": "lid", "title": "Lid", "size": [320, 180],
            "transport": {"span": "2s", "frame_rate": [30, 1]},
            "items": {"lid": {"kind": "rect@1", "params": {"box": [100, 60, 120, 25]}}},
            "controls": {"explode": {"kind": "toggle", "label": "Explode", "default": false}},
            "channels": {"fade": {"target": "items/lid/adjust/opacity", "type": "f32", "mode": "follow",
                "follow": {"source": "controls/explode/value", "model": {"transition": {"span": "1s", "interp": "linear"}}}}},
            "track": [{"t": 0, "control": "explode", "value": true}],
        });
        let at = rest(&form, FRAME, FRAME).expect("rests");
        assert_eq!(at.t, FLICKS_PER_SECOND, "rests a frame in, mid-fade");
    }
}
