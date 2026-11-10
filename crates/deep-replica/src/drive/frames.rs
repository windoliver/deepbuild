//! Issue #1546: the replica that draws only the frames a real window would (`launch.frames: "dirty"`). Each frame of
//! its clock asks GPUI for a frame with no forced render, so GPUI draws only when its invalidator says the window is
//! dirty, and every read (`see`, `expect`, `wait_for`, an action's wait) reads the last frame GPUI drew. After each
//! step the last drawn frame's snapshot is compared with a forced frame's: the check's own, never what a read sees, so
//! a view a real window would show stale stays stale here. A run where every step drew proves nothing: it reads
//! INCONCLUSIVE, never PASS. `feed` and `resize` are the record events and the resizes a journey is made of.

use std::collections::BTreeMap;

use gpui_kit::{px, size, test::TestWindowExt as _, ElementId};
use serde_json::{json, Value};

use super::{fail, locate::Frame, Fail, Plant, Replica, FLICKS};

/// The mode's state: the last drawn frame, the step's counts, and what each step found.
pub(super) struct Dirty {
    drawn: (Value, Frame),
    frames: u64,
    drew: u64,
    steps: Vec<Value>,
    findings: Vec<Value>,
}

impl Dirty {
    pub(super) fn new(drawn: (Value, Frame)) -> Dirty {
        Dirty {
            drawn,
            frames: 0,
            drew: 0,
            steps: Vec::new(),
            findings: Vec::new(),
        }
    }

    /// The last frame GPUI drew, as the reads see it.
    pub(super) fn drawn(&self) -> (Value, Frame) {
        self.drawn.clone()
    }

    /// `close`'s report: every step, every finding, and the claim.
    pub(super) fn report(&self) -> Value {
        let clean = self
            .steps
            .iter()
            .filter(|s| s["frames"].as_u64() > Some(0) && s["drawn"] == 0)
            .count();
        let claim = match (self.findings.is_empty(), clean) {
            (false, _) => "FAIL",
            (true, 0) => "INCONCLUSIVE",
            (true, _) => "PASS",
        };
        json!({"claim": claim, "clean": clean, "steps": self.steps, "findings": self.findings})
    }
}

impl Replica {
    /// The views' clock follows the replica's: its launch's now plus `t`.
    pub(super) fn move_views_clock(&self) {
        deep_app::views::set_clock(self.now + self.clock.t * 1000 / FLICKS);
    }

    /// One frame of the clock: a frame request with no forced render, and the frame GPUI drew, if it drew one.
    pub(super) fn request(&mut self) {
        if self.plant == Some(Plant::NotifiesEveryStep) {
            let _ = self
                .cx
                .update_window(self.window, |root, _, cx| cx.notify(root.entity_id()));
        }
        // A frame redraws every view, so the canvas items it lists are this frame's alone.
        deep_app::canvas::clear_items();
        let drew = self.cx.request_frame(self.window);
        if drew {
            let glyphs = self.glyphs.clone();
            let _ = self
                .cx
                .update_window(self.window, |_, window, _| glyphs.keep_scene(window));
        }
        let read = drew.then(|| self.live_tree());
        let dirty = self.dirty.as_mut().expect("the dirty mode");
        dirty.frames += 1;
        if let Some(read) = read {
            dirty.drew += 1;
            dirty.drawn = read;
        }
    }

    /// GPUI's test input (typing, keys, a drag) draws as it delivers, as a real window draws after input: that frame
    /// is the one the reads see.
    pub(super) fn input_drew(&mut self) {
        if self.dirty.is_some() {
            let read = self.live_tree();
            let dirty = self.dirty.as_mut().expect("the dirty mode");
            dirty.drew += 1;
            dirty.drawn = read;
        }
    }

    /// A step begins: nothing passed or drew yet.
    pub(super) fn begin_step(&mut self) {
        if let Some(dirty) = &mut self.dirty {
            dirty.frames = 0;
            dirty.drew = 0;
        }
    }

    /// A step ends: the last drawn frame against a forced one, each view's first differing node named.
    pub(super) fn end_step(&mut self, step: usize, call: &str) {
        if self.dirty.is_none() {
            return;
        }
        let glyphs = self.glyphs.clone();
        let _ = self.cx.update_window(self.window, |_, window, cx| {
            deep_app::canvas::clear_items();
            window.render_frame(cx);
            glyphs.keep_scene(window);
        });
        let forced = self.live_tree();
        let t = self.clock.t;
        let dirty = self.dirty.as_mut().expect("the dirty mode");
        let equal = dirty.drawn.0 == forced.0;
        let mut differ = differences(&dirty.drawn, &forced);
        if !equal && differ.is_empty() {
            // The trees match but what else the snapshot holds doesn't: the canvas items, or the window.
            let window = |tree: &Value| json!({"role": "window", "name": null, "value": null, "bounds": tree["tree"]["bounds"]});
            differ.push((
                "window".into(),
                window(&forced.0),
                Some(window(&dirty.drawn.0)),
            ));
        }
        for (view, node, drawn) in differ {
            dirty.findings.push(
                json!({"step": step, "call": call, "view": view, "node": node, "drawn": drawn}),
            );
        }
        dirty.steps.push(json!({
            "step": step, "call": call, "t": t, "frames": dirty.frames, "drawn": dirty.drew, "equal": equal,
        }));
    }

    /// `feed`: one record event into the replica's own record, at the next `log_pos` and the views' clock now,
    /// through the app's one reader as the hub's stream delivers it; then one frame of the clock.
    pub(super) fn feed(&mut self, call: &Value) -> Result<Value, Fail> {
        let feed = &call["feed"];
        let (Some(session), Some(mut event)) =
            (feed["session"].as_str(), feed["event"].as_object().cloned())
        else {
            return Err(fail(
                "refused",
                "feed takes {session, event}: a session id and a record event",
            ));
        };
        let log_pos = deep_app::record::with_view(|view| view.log_pos).unwrap_or(0) + 1;
        let ts = self.now + self.clock.t * 1000 / FLICKS;
        event.insert("session".into(), json!(session));
        event.insert("log_pos".into(), json!(log_pos));
        event.insert("ts".into(), json!(ts));
        let event = Value::Object(event);
        self.notifier.saw(&event, ts);
        self.hub_copy.saw(&event);
        self.events.push(event.clone());
        self.cx.update(|cx| deep_app::record::deliver(event, cx));
        self.tick();
        Ok(json!({"log_pos": log_pos, "ts": ts}))
    }

    /// `open`: an address through the app's one open, as a click, ⌘K or `deep open` opens it, or a `deepbuild://` link
    /// through the function the OS's URL handler calls (#1460); then one frame of the clock. The address the window
    /// shows, or what became of the one asked for.
    pub(super) fn open(&mut self, call: &Value) -> Result<Value, Fail> {
        let open = &call["open"];
        let said = match (open["address"].as_str(), open["url"].as_str()) {
            (Some(text), None) => self.cx.update(|cx| deep_app::open::arrive(text, cx)),
            (None, Some(url)) => self.cx.update(|cx| deep_app::open::link(url, cx)),
            _ => {
                return Err(fail(
                    "refused",
                    "open takes {address} or {url}: an address, or a deepbuild:// link",
                ))
            }
        };
        self.tick();
        Ok(match said {
            Ok(address) => json!({"address": address}),
            Err(words) => json!({"address": null, "said": words}),
        })
    }

    /// `notification`: a click on the body of the `click`th notification this replica posted, through the function the
    /// OS's notification-click handler calls (#1460); then one frame of the clock.
    pub(super) fn notification(&mut self, call: &Value) -> Result<Value, Fail> {
        let Some(posted) = call["notification"]["click"]
            .as_u64()
            .and_then(|n| self.notified.get(n as usize).cloned())
        else {
            return Err(fail(
                "refused",
                format!(
                    "notification.click is the index of a notification this replica posted; it posted {}",
                    self.notified.len()
                ),
            ));
        };
        let tag = posted["session"].as_str().unwrap_or_default().to_owned();
        let _ = self.cx.update(|cx| deep_app::open::notification(&tag, cx));
        self.tick();
        Ok(json!({"notification": {
            "t": posted["t"], "ask": posted["ask"], "session": posted["session"], "text": posted["text"],
        }}))
    }

    /// `resize`: the window's content to `[w, h]` points, as the platform resizes it; then one frame of the clock.
    pub(super) fn resize(&mut self, call: &Value) -> Result<Value, Fail> {
        let wh = call["resize"]["size"].as_array();
        let Some([w, h]) = wh.and_then(|wh| {
            let n: Vec<u64> = wh
                .iter()
                .filter_map(Value::as_u64)
                .filter(|&n| n > 0)
                .collect();
            (n.len() == 2 && wh.len() == 2).then(|| [n[0], n[1]])
        }) else {
            return Err(fail("refused", "resize.size is [width, height] in points"));
        };
        self.cx
            .simulate_resize(self.window, size(px(w as f32), px(h as f32)));
        self.tick();
        let scale = self.scale();
        Ok(json!({"window": {"size": [w, h], "scale": scale as u32}}))
    }
}

/// The shipped view a node was drawn by: the `view:<name>` its path runs through.
fn view_of(path: &[ElementId]) -> Option<String> {
    path.iter().find_map(|id| match id {
        ElementId::Name(name) => name.strip_prefix("view:").map(str::to_owned),
        _ => None,
    })
}

/// A snapshot's nodes, in tree order, by the view that drew each: a drawn string goes with the node it sits in.
fn by_view((tree, frame): &(Value, Frame)) -> BTreeMap<String, Vec<Value>> {
    let views: BTreeMap<String, String> = frame
        .elements
        .iter()
        .filter_map(|e| {
            Some((
                key(&e.role, e.name.as_deref(), &e.bounds),
                view_of(&e.path)?,
            ))
        })
        .collect();
    let mut out: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    fn walk(
        node: &Value,
        inherited: &str,
        views: &BTreeMap<String, String>,
        out: &mut BTreeMap<String, Vec<Value>>,
    ) {
        for child in node["children"].as_array().into_iter().flatten() {
            let bounds: Vec<i64> = child["bounds"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_i64)
                .collect();
            let own = views.get(&key(
                child["role"].as_str().unwrap_or_default(),
                child["name"].as_str(),
                &bounds,
            ));
            let view = own.map_or(inherited, String::as_str);
            let mut flat = child.clone();
            if let Some(fields) = flat.as_object_mut() {
                fields.remove("children");
            }
            out.entry(view.to_owned()).or_default().push(flat);
            walk(child, view, views, out);
        }
    }
    walk(&tree["tree"], "window", &views, &mut out);
    out
}

fn key(role: &str, name: Option<&str>, bounds: &[i64]) -> String {
    format!("{role}\u{1}{}\u{1}{bounds:?}", name.unwrap_or_default())
}

/// Each view whose nodes differ: its name, the forced frame's node at the first place they differ, and the drawn
/// frame's node there, if it has one.
fn differences(
    drawn: &(Value, Frame),
    forced: &(Value, Frame),
) -> Vec<(String, Value, Option<Value>)> {
    let (drawn, forced) = (by_view(drawn), by_view(forced));
    let mut views: Vec<&String> = forced.keys().chain(drawn.keys()).collect();
    views.sort();
    views.dedup();
    let none = Vec::new();
    views
        .into_iter()
        .filter_map(|view| {
            let (d, f) = (
                drawn.get(view).unwrap_or(&none),
                forced.get(view).unwrap_or(&none),
            );
            let at = (0..d.len().max(f.len())).find(|&i| d.get(i) != f.get(i))?;
            let node = f.get(at).or(d.get(at))?.clone();
            Some((view.clone(), node, d.get(at).cloned()))
        })
        .collect()
}
