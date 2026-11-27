//! A shell played a step at a time (Recipe: shell@1 game shell): one device input at most a step, the shell's rules,
//! the loaded level's own step while it plays, focus and prompts, and one row a step. A level is loaded as a piece,
//! with the newest carry record it accepts at its step 0; it steps only while it plays, so a pause holds its clock
//! and input at the step they reached.

use std::collections::BTreeMap;
use std::rc::Rc;

use serde_json::{json, Map, Value};

use super::focus::{self, Box4};
use super::rules::{State, Then, PLAYING, QUIT};
use super::{level_words, Kind, Shell, PAUSE};
use crate::piece::{check_in, History, Piece};
use crate::play::{full, piece_of};
use crate::track::{Entry, Given};
use crate::world::{track_of, Record, World};
use crate::Planted;

/// What the replica gives the shell: each screen's evaluated boxes at a size, and frames drawn by the canvas.
pub trait Screens {
    /// Each item's evaluated box on the document shown at `size`, letterboxed, in the view's pixels.
    fn boxes(&mut self, doc: &Value, size: [f64; 2]) -> Result<BTreeMap<String, Box4>, Value>;
    /// The document drawn at `size` under a veil of the look's ground (0 to 1), kept as evidence: its sha256.
    fn frame(&mut self, doc: &Value, size: [f64; 2], veil: f64) -> Option<String>;
    /// Frames kept by `frame`, as one recording: its sha256.
    fn recording(&mut self, frames: &[String]) -> Option<String>;
    /// #3605: each text item the document draws at `size`, with the string it shows.
    fn texts(&mut self, doc: &Value, size: [f64; 2]) -> Result<BTreeMap<String, String>, Value>;
}

/// The replica's planted shells (`DEEP_DRIVE_PLANT`): a pause that lets the level's clock run; focus left on a control
/// that turns disabled; prompts that keep the keys' glyphs.
#[derive(Clone, Copy, Default)]
pub struct Plants {
    pub pause_runs_clock: bool,
    pub focus_stays_disabled: bool,
    pub prompts_keep_keys: bool,
    /// #3605: a level marked done when it is entered.
    pub done_on_enter: bool,
    /// #3605: `done` kept in a run's save, not the profile record.
    pub done_in_save: bool,
    /// #3605: a setting handed through the level's read region with no entry on its track.
    pub setting_in_read_region: bool,
}

/// One device input, as a journey or a replica gives it.
#[derive(Clone, Debug)]
pub enum Input {
    Key(String),
    Pad(String),
    Tap([f64; 2]),
    Drag(Vec<[f64; 2]>),
}

impl Input {
    pub fn device(&self) -> &'static str {
        match self {
            Input::Key(_) => "keys",
            Input::Pad(_) => "pad",
            Input::Tap(_) | Input::Drag(_) => "touch",
        }
    }
    pub fn json(&self) -> Value {
        match self {
            Input::Key(k) => json!({"key": k}),
            Input::Pad(p) => json!({"pad": p}),
            Input::Tap(p) => json!({"tap": p}),
            Input::Drag(d) => json!({"drag": d}),
        }
    }
}

/// A level's action, as an actions control of its declares it: the control, the action's index there, its keys and
/// its pad buttons.
#[derive(Clone, Debug)]
pub struct Action {
    pub control: String,
    pub index: usize,
    pub name: String,
    pub keys: Vec<String>,
    pub pad: Vec<String>,
}

/// A loaded level: its piece and world, the steps it has run, and how a device reaches its actions.
pub struct LevelRun {
    pub index: usize,
    piece: Rc<Piece>,
    world: World,
    rec: Record,
    step: i64,
    pub steps: i64,
    ids: Vec<String>,
    pub actions: Vec<Action>,
    /// Touch zones in the view's pixels: the action each writes and its box.
    pub zones: Vec<(String, Box4)>,
    pending: Vec<(String, f64)>,
    /// #3605: each setting the level takes that the shell declares: its place in `custom` and the
    /// value its track last gave it.
    given: Vec<(String, usize, f64)>,
    /// Planted: the setting entries it read are left off the track it gives.
    hides_settings: bool,
}

impl LevelRun {
    /// `{level, entries, steps}`: the load's track and the steps it ran.
    pub fn given_track(&self) -> Value {
        json!({"level": self.index, "entries": self.track(), "steps": self.steps})
    }

    /// The level's input track, every entry in time order, as a piece's replay reads it.
    pub fn track(&self) -> Vec<Value> {
        self.world
            .entries()
            .iter()
            // Planted: the settings the shell handed the level kept off the track it gives.
            .filter(|e| !(self.hides_settings && e.control.starts_with("settings.")))
            .map(Entry::to_json)
            .collect()
    }

    fn hash(&mut self) -> String {
        full(&self.world.deep_hashes(), &self.ids)
    }

    /// Every array of the level's logic items now, by `<item>.<array>`.
    pub fn values(&self) -> Map<String, Value> {
        let mut out = Map::new();
        for (i, item) in self.piece.items.iter().enumerate() {
            for w in &item.writes {
                if let Some(v) = self.world.array(i, &w.name) {
                    out.insert(format!("{}.{}", item.id, w.name), Value::Array(v));
                }
            }
        }
        out
    }

    fn truthy(&self, (item, array): &(String, String)) -> bool {
        let Some(i) = self.piece.items.iter().position(|it| &it.id == item) else {
            return false;
        };
        self.world.array(i, array).is_some_and(|a| {
            a.iter()
                .any(|v| v.as_f64().is_some_and(|x| x != 0.0) || v.as_bool() == Some(true))
        })
    }
}

/// The play: the shell's state and its level, the screen's focus, and the rows so far.
pub struct Run<'a> {
    pub shell: &'a Shell,
    stored: &'a dyn Fn(&str) -> Option<Vec<u8>>,
    pub screens: &'a mut dyn Screens,
    pub plants: Plants,
    pub size: [f64; 2],
    pub state: State,
    pub level: Option<LevelRun>,
    pub transition: i64,
    pub step: i64,
    pub screen_step: i64,
    pub focus: Option<usize>,
    pub engaged: bool,
    pub device: Option<&'static str>,
    boxes: BTreeMap<usize, BTreeMap<String, Box4>>,
    /// Each carry record the shell wrote: the level that gave it, its step, its hash and the record.
    pub records: Vec<(usize, i64, String, Value)>,
    pub entered: Vec<Value>,
    pub carry: Vec<Value>,
    pub rows: Vec<Value>,
    pub track: Vec<Value>,
    pub from: Option<String>,
    pub control: Option<String>,
    pub keep_frames: bool,
    pub frames: Vec<String>,
    /// The document the last frame outside a transition drew, which a fade draws out of.
    drawn: Option<Value>,
    /// #3605: the shell's profile record, where its saves are kept.
    pub keeper: super::profile::Keeper,
    /// Each level load's input track, `{level, entries, steps}`, in the order levels were left.
    pub tracks: Vec<Value>,
    /// #3605: each completion, `{level, step}`: the shell step at which the level's own `done` turned true.
    pub completions: Vec<Value>,
}

const STEP: i64 = 705_600_000 / 60;

impl<'a> Run<'a> {
    pub fn new(
        shell: &'a Shell,
        stored: &'a dyn Fn(&str) -> Option<Vec<u8>>,
        screens: &'a mut dyn Screens,
        plants: Plants,
        size: [f64; 2],
    ) -> Run<'a> {
        Run {
            state: State::new(shell),
            shell,
            stored,
            screens,
            plants,
            size,
            level: None,
            transition: 0,
            step: 0,
            screen_step: 0,
            focus: None,
            engaged: false,
            device: None,
            boxes: BTreeMap::new(),
            records: Vec::new(),
            entered: Vec::new(),
            carry: Vec::new(),
            rows: Vec::new(),
            track: Vec::new(),
            from: None,
            control: None,
            keep_frames: false,
            frames: Vec::new(),
            drawn: None,
            keeper: super::profile::Keeper::new(&Value::Null, plants.done_in_save),
            tracks: Vec::new(),
            completions: Vec::new(),
        }
    }

    /// A fresh shell, as at the start, keeping the rows and evidence so far, and the viewer's device; focus is kept
    /// when the title was already shown, since the view didn't change.
    pub fn reset(&mut self) {
        let same = self.state.screen == super::TITLE && self.transition == 0;
        self.state = State::new(self.shell);
        self.level = None;
        self.transition = 0;
        self.screen_step = 0;
        if !same {
            self.focus = None;
            self.engaged = false;
        }
        self.records.clear();
    }

    /// The shown screen's index, or none while a level plays.
    pub fn shown(&self) -> Option<usize> {
        (self.state.screen >= 0).then_some(self.state.screen as usize)
    }

    /// The shown screen's items' boxes at the run's size, evaluated once per screen.
    pub fn items(&mut self, s: usize) -> Result<BTreeMap<String, Box4>, Value> {
        if let Some(b) = self.boxes.get(&s) {
            return Ok(b.clone());
        }
        // The screen as it draws, the shell's arrays baked in, so its drivers and flips over them evaluate.
        let doc = self.prompted(s);
        let b = self.screens.boxes(&doc, self.size)?;
        self.boxes.insert(s, b.clone());
        Ok(b)
    }

    /// Each control's box on screen `s`, in control order.
    pub fn control_boxes(&mut self, s: usize) -> Vec<Option<Box4>> {
        let items = self.items(s).unwrap_or_default();
        self.shell.screens[s]
            .controls
            .iter()
            .map(|c| items.get(&c.item).copied())
            .collect()
    }

    /// Whether each control of screen `s` is enabled now, by its `enabled` expression over the shell's arrays.
    pub fn enabled(&self, s: usize) -> Vec<bool> {
        self.shell.screens[s]
            .controls
            .iter()
            .map(|c| c.enabled.as_ref().is_none_or(|e| self.truth(e)))
            .collect()
    }

    fn truth(&self, text: &str) -> bool {
        // `<shell ID>.<array>` and `<shell ID>.<array>[i]` become variables bound to the arrays' values.
        let prefix = format!("{}.", self.shell.id);
        let arrays: BTreeMap<&str, Value> = self.state.arrays().into_iter().collect();
        let mut out = String::new();
        let mut values = Vec::new();
        let mut rest = text;
        while let Some(at) = rest.find(&prefix) {
            out.push_str(&rest[..at]);
            let after = &rest[at + prefix.len()..];
            let name_len = after
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .unwrap_or(after.len());
            let name = &after[..name_len];
            let mut tail = &after[name_len..];
            let mut index = 0usize;
            if let Some(t) = tail.strip_prefix('[') {
                if let Some(close) = t.find(']') {
                    index = t[..close].trim().parse().unwrap_or(0);
                    tail = &t[close + 1..];
                }
            }
            let v = arrays
                .get(name)
                .and_then(|a| a.get(index))
                .map_or(0.0, |v| {
                    v.as_f64()
                        .unwrap_or(if v.as_bool() == Some(true) { 1.0 } else { 0.0 })
                });
            out.push_str(&format!("v{}", values.len()));
            values.push(v);
            rest = tail;
        }
        out.push_str(rest);
        match deep_canvas::expr::Expr::compile(&out, &deep_canvas::expr::Nothing, 4096) {
            Ok(e) => {
                let vars: Vec<f64> = e
                    .vars
                    .iter()
                    .map(|n| {
                        n.strip_prefix('v')
                            .and_then(|i| i.parse::<usize>().ok())
                            .and_then(|i| values.get(i).copied())
                            .unwrap_or(0.0)
                    })
                    .collect();
                let x = e.eval_num(&vars);
                x.is_finite() && x != 0.0
            }
            Err(_) => out.trim() == "true",
        }
    }

    /// The screen's focus order now.
    pub fn order(&mut self, s: usize) -> Vec<usize> {
        let boxes = self.control_boxes(s);
        focus::order(&self.shell.screens[s], &boxes)
    }

    /// A control's value now: a slider's or a choice's from the setting it sets, else none.
    pub fn value(&self, c: &super::Control) -> f64 {
        let Some(super::Does::Set(f)) = &c.does else {
            return c.range[0];
        };
        match f.split_once('.') {
            None if f == "text_size" => match c.kind {
                Kind::Choice => self
                    .shell
                    .settings
                    .text_size
                    .iter()
                    .position(|t| *t as i32 == self.state.text_size)
                    .unwrap_or(0) as f64,
                _ => f64::from(self.state.text_size),
            },
            None => f64::from(u8::from(self.state.reduced_motion)),
            Some(("volume", bus)) => self
                .shell
                .settings
                .volume
                .iter()
                .position(|(b, _)| b == bus)
                .map_or(0.0, |i| self.state.volume[i]),
            Some(("toggle", a)) => self
                .shell
                .settings
                .toggle
                .iter()
                .position(|t| t == a)
                .map_or(0.0, |i| f64::from(u8::from(self.state.toggle[i]))),
            // #3605: a choice's value is its option's index; a slider's and a toggle's the setting.
            Some(("custom", n)) => self.shell.custom(n).map_or(0.0, |i| {
                let now = self.state.custom[i];
                match c.kind {
                    Kind::Choice => c
                        .options
                        .iter()
                        .position(|o| o.as_f64() == Some(now))
                        .unwrap_or(0) as f64,
                    _ => now,
                }
            }),
            _ => 0.0,
        }
    }

    fn write(&mut self, entry: Value) {
        let mut e = entry;
        e["step"] = json!(self.step);
        e["device"] = json!(self.device);
        self.track.push(e);
    }

    /// An activation on the shown screen, as one entry, and what the rules do with it.
    fn activate(&mut self, s: usize, i: usize, value: Option<f64>) -> Then {
        let c = self.shell.screens[s].controls[i].clone();
        self.write(json!({"shell": {"control": c.id, "value": value}}));
        self.state.activate(self.shell, &c, value)
    }

    /// One input, applied at this step.
    fn input(&mut self, input: &Input) -> Then {
        self.device = Some(input.device());
        if self.transition > 0 || self.state.screen == QUIT {
            return Then::Nothing;
        }
        let Some(s) = self.shown() else {
            return self.level_input(input);
        };
        match input {
            Input::Key(k) | Input::Pad(k) => {
                let key = match (input, k.as_str()) {
                    (Input::Pad(_), "up")
                    | (Input::Key(_), "ArrowUp")
                    | (Input::Key(_), "Shift+Tab") => "up",
                    (Input::Pad(_), "down")
                    | (Input::Key(_), "ArrowDown")
                    | (Input::Key(_), "Tab") => "down",
                    (Input::Pad(_), "left") | (Input::Key(_), "ArrowLeft") => "left",
                    (Input::Pad(_), "right") | (Input::Key(_), "ArrowRight") => "right",
                    (Input::Pad(_), "south")
                    | (Input::Key(_), "Enter")
                    | (Input::Key(_), "Space")
                    | (Input::Key(_), " ") => "confirm",
                    (Input::Pad(_), "east") | (Input::Key(_), "Escape") => "back",
                    (Input::Pad(p), _) if self.shell.pause.pad.contains(p) => "pause",
                    _ => "",
                };
                if key == "back" {
                    self.write(json!({"shell": "back"}));
                    return self.state.back(self.shell);
                }
                if key == "pause" {
                    if s == PAUSE as usize && self.state.level >= 0 {
                        self.write(json!({"shell": "pause"}));
                        self.state.pause_input();
                    }
                    return Then::Nothing;
                }
                let order = self.order(s);
                let enabled = self.enabled(s);
                if !self.engaged {
                    self.engaged = true;
                    self.focus = focus::step(&order, &enabled, None, true);
                    return Then::Nothing;
                }
                let on = self.focus.map(|f| self.shell.screens[s].controls[f].kind);
                match (key, on) {
                    ("up", _) => self.focus = focus::step(&order, &enabled, self.focus, false),
                    ("down", _) => self.focus = focus::step(&order, &enabled, self.focus, true),
                    ("left" | "right", Some(Kind::Slider)) => {
                        let f = self.focus.expect("a focused slider");
                        let c = &self.shell.screens[s].controls[f];
                        let d = if key == "right" {
                            c.increment
                        } else {
                            -c.increment
                        };
                        let v = (self.value(c) + d).clamp(c.range[0], c.range[1]);
                        return self.activate(s, f, Some(v));
                    }
                    ("left" | "right", Some(Kind::Choice)) => {
                        let f = self.focus.expect("a focused choice");
                        let c = &self.shell.screens[s].controls[f];
                        let n = c.options.len().max(1) as f64;
                        let v = (self.value(c) + if key == "right" { 1.0 } else { -1.0 })
                            .clamp(0.0, n - 1.0);
                        return self.activate(s, f, Some(v));
                    }
                    ("left" | "right", Some(Kind::DragAlong)) => {}
                    ("left", _) => self.focus = focus::step(&order, &enabled, self.focus, false),
                    ("right", _) => self.focus = focus::step(&order, &enabled, self.focus, true),
                    ("confirm", Some(Kind::Press | Kind::Toggle)) => {
                        let f = self.focus.expect("a focused control");
                        if enabled[f] {
                            return self.activate(s, f, None);
                        }
                    }
                    _ => {}
                }
                Then::Nothing
            }
            Input::Tap(p) => {
                let boxes = self.control_boxes(s);
                let enabled = self.enabled(s);
                let hit = (0..boxes.len())
                    .rev()
                    .find(|i| enabled[*i] && boxes[*i].is_some_and(|b| inside(&b, *p)));
                let Some(i) = hit else { return Then::Nothing };
                let c = self.shell.screens[s].controls[i].clone();
                let b = boxes[i].expect("a hit box");
                match c.kind {
                    Kind::Press | Kind::Toggle => self.activate(s, i, None),
                    Kind::Slider => self.activate(s, i, Some(along(&c, &b, p[0]))),
                    Kind::Choice => {
                        let n = c.options.len().max(1);
                        let k = (((p[0] - b[0]) / b[2]).clamp(0.0, 0.999_999) * n as f64).floor();
                        self.activate(s, i, Some(k))
                    }
                    Kind::DragAlong => Then::Nothing,
                }
            }
            Input::Drag(points) => {
                let (Some(first), Some(last)) = (points.first(), points.last()) else {
                    return Then::Nothing;
                };
                let boxes = self.control_boxes(s);
                let enabled = self.enabled(s);
                let hit = (0..boxes.len())
                    .rev()
                    .find(|i| enabled[*i] && boxes[*i].is_some_and(|b| inside(&b, *first)));
                let Some(i) = hit else { return Then::Nothing };
                let c = self.shell.screens[s].controls[i].clone();
                match c.kind {
                    Kind::Slider | Kind::DragAlong => self.activate(
                        s,
                        i,
                        Some(along(&c, &boxes[i].expect("a hit box"), last[0])),
                    ),
                    _ => Then::Nothing,
                }
            }
        }
    }

    /// An input while a level plays: the pause input, or one of the level's actions as its entry at its next step.
    fn level_input(&mut self, input: &Input) -> Then {
        let pause = match input {
            Input::Key(k) => self.shell.pause.keys.contains(k) || k == "Escape",
            Input::Pad(p) => self.shell.pause.pad.contains(p) || p == "east",
            Input::Tap(p) => inside(&self.pause_button(), *p),
            Input::Drag(_) => false,
        };
        if pause {
            self.write(json!({"shell": "pause"}));
            self.state.pause_input();
            return Then::Nothing;
        }
        let Some(level) = self.level.as_mut() else {
            return Then::Nothing;
        };
        let action = match input {
            Input::Key(k) => level.actions.iter().find(|a| a.keys.contains(k)),
            Input::Pad(p) => level.actions.iter().find(|a| a.pad.contains(p)),
            Input::Tap(p) => level
                .zones
                .iter()
                .find(|(_, b)| inside(b, *p))
                .and_then(|(a, _)| level.actions.iter().find(|x| &x.name == a)),
            Input::Drag(_) => None,
        };
        if let Some(a) = action.cloned() {
            level.pending.push((a.control, a.index as f64));
        }
        Then::Nothing
    }

    /// The touch button the shell draws over a level, in the view's pixels.
    pub fn pause_button(&self) -> Box4 {
        let s = self.shell.pause.size;
        let m = 16.0;
        let x = if self.shell.pause.corner == "top_left" {
            m
        } else {
            self.size[0] - m - s
        };
        [x, m, s, s]
    }

    fn load(&mut self, l: usize) -> Result<(), Value> {
        let doc = &self.shell.levels[l].doc;
        let words = level_words(&self.shell.levels, l);
        let form = piece_of(doc).ok_or_else(|| {
            super::refused(
                "shell.screen",
                format!("{words}'s document has no logic item"),
                json!({"level": l}),
            )
        })?;
        let piece = Rc::new(
            check_in(
                &form,
                &Planted::default(),
                &mut History::new(),
                self.stored,
                &[],
            )
            .map_err(|r| {
                super::refused(
                    r.0.get("code").and_then(Value::as_str).unwrap_or("refused"),
                    format!(
                        "{words}: {}",
                        r.0.get("what").map_or_else(
                            || r.0.to_string(),
                            |w| w.as_str().map_or_else(|| w.to_string(), str::to_string)
                        )
                    ),
                    json!({"level": l, "refusal": r.0}),
                )
            })?,
        );
        // The newest carry record the level accepts enters its track at step 0, by hash.
        let taken = self
            .records
            .iter()
            .rev()
            .find(|(_, _, _, r)| {
                piece.items.iter().any(|i| i.carry_in.is_some())
                    && crate::carry::differs(&piece, r).is_empty()
            })
            .cloned();
        let mut entries: Vec<Entry> = taken
            .iter()
            .map(|(_, _, h, r)| crate::carry::entry(h, r))
            .collect();
        // #3605: each setting the level lists that the shell declares enters its track at step 0.
        let mut given: Vec<(String, usize, f64)> = Vec::new();
        for item in &piece.items {
            for (name, _) in &item.settings {
                let Some(i) = self.shell.custom(name) else {
                    continue;
                };
                if given.iter().any(|(n, _, _)| n == name) {
                    continue;
                }
                given.push((name.clone(), i, self.state.custom[i]));
            }
        }
        for (name, _, v) in &given {
            entries.push(setting_entry(name, 0, 0, *v));
        }
        let mut rec = Record::default();
        let world = World::new(
            piece.clone(),
            track_of(&entries),
            false,
            Planted::default(),
            &mut rec,
            None,
        )
        .map_err(|e| super::refused("refused", format!("{words}: {e:?}"), json!({"level": l})))?;
        let step = piece.items.first().map_or(STEP, |i| i.step);
        let ids = piece.items.iter().map(|i| i.id.clone()).collect();
        let actions = actions_of(doc);
        let zones = zones_of(doc, self.size);
        self.entered.push(
            json!({"level": l, "step": self.step, "carry": taken.as_ref().map(|t| t.2.clone()),
                                 "arrays": taken.as_ref().map(|t| t.3["arrays"].clone())}),
        );
        self.level = Some(LevelRun {
            index: l,
            piece,
            world,
            rec,
            step,
            steps: 0,
            ids,
            actions,
            zones,
            pending: Vec::new(),
            given,
            hides_settings: self.plants.setting_in_read_region,
        });
        Ok(())
    }

    /// The level's one step: its pending entries stamped at it, then its run; its done or lost after it.
    fn level_step(&mut self) -> Result<(), Value> {
        let Some(level) = self.level.as_mut() else {
            return Ok(());
        };
        let k = level.steps;
        // #3605: a setting changed since its last entry, on a screen the pause menu opened, enters the track at
        // this, the level's next step.
        for (name, i, last) in &mut level.given {
            let now = self.state.custom[*i];
            if now != *last {
                let key = crate::piece::setting_read(name);
                let seq = level.world.track.get(&key).map_or(0, Vec::len) as u32;
                level
                    .world
                    .append(setting_entry(name, k * level.step, seq, now))
                    .map_err(
                        |e| json!({"ok": false, "code": "refused", "what": format!("{e:?}")}),
                    )?;
                *last = now;
            }
        }
        for (control, value) in std::mem::take(&mut level.pending) {
            let seq = level.world.track.get(&control).map_or(0, Vec::len) as u32;
            level
                .world
                .append(Entry {
                    t: k * level.step,
                    seq,
                    control,
                    value: Given::Number(value),
                    writer: "you".into(),
                    player: 1,
                    as_of: None,
                    arrived: 0,
                })
                .map_err(|e| json!({"ok": false, "code": "refused", "what": format!("{e:?}")}))?;
        }
        level.world.run_through(k * level.step, &mut level.rec);
        level.rec.steps.clear();
        level.rec.wholes.clear();
        level.rec.ranges.clear();
        level.rec.fuel.clear();
        level.steps += 1;
        if let Some(trap) = level.world.failed().first() {
            return Err(
                json!({"ok": false, "code": "logic.trap", "what": format!("{} trapped at its step {k}: {trap}", level_words(&self.shell.levels, level.index))}),
            );
        }
        if k == 0 {
            if let Some(e) = self.entered.last_mut() {
                e["values"] = Value::Object(level.values());
            }
        }
        let def = &self.shell.levels[level.index];
        if level.truthy(&def.done) {
            // The giving item's carry record, from this step's state, as if its request were 1 here.
            let record = crate::carry::record_now(&level.world, k);
            if let Some((hash, record)) = record {
                self.carry.push(json!({"level": level.index, "step": k, "sha256": hash, "arrays": record["arrays"]}));
                self.records.push((level.index, k, hash, record));
            }
            self.completions
                .push(json!({"level": level.index, "step": self.step}));
            self.state.completed();
            self.unload();
            self.change();
        } else if def.lost.as_ref().is_some_and(|l| level.truthy(l)) {
            self.state.lost();
            self.unload();
            self.change();
        }
        Ok(())
    }

    /// The loaded level left: its input track kept for the reply, as a piece's replay reads it.
    fn unload(&mut self) {
        if let Some(l) = self.level.take() {
            self.tracks.push(l.given_track());
        }
    }

    /// A screen changed: its transition starts, and focus starts over.
    fn change(&mut self) {
        self.transition = self.shell.transition;
        self.screen_step = 0;
        self.focus = None;
        self.engaged = false;
    }

    /// One step: the input, the rules, the level's step while it plays, focus settled, and the step's row.
    pub fn tick(&mut self, input: Option<&Input>) -> Result<(), Value> {
        let before = (self.state.screen, self.state.paused);
        let then = match input {
            Some(i) => self.input(i),
            None => Then::Nothing,
        };
        match then {
            Then::Load(l) => {
                self.load(l)?;
                // Planted: a level marked done when it is entered.
                if self.plants.done_on_enter {
                    self.state.done[l] = true;
                }
            }
            Then::Leave => self.unload(),
            Then::Nothing => {}
        }
        if self.state.level < 0 {
            self.unload();
        }
        if (self.state.screen, self.state.paused) != before {
            let resumed = before.0 == PAUSE && self.state.screen == PLAYING;
            self.change();
            if resumed {
                self.transition = 0;
            }
        } else if self.transition > 0 {
            self.transition -= 1;
        } else {
            self.screen_step += 1;
        }
        let plays = self.state.screen == PLAYING && self.transition == 0;
        let runs =
            self.level.is_some() && (plays || (self.plants.pause_runs_clock && self.state.paused));
        if runs {
            self.level_step()?;
        }
        if let Some(s) = self.shown() {
            let enabled = self.enabled(s);
            if !self.plants.focus_stays_disabled {
                let order = self.order(s);
                self.focus = focus::settle(&order, &enabled, self.focus);
            }
        }
        self.keeper.keep(self.shell, &self.state, self.step);
        self.row();
        if self.keep_frames {
            self.keep_frame();
        }
        self.step += 1;
        Ok(())
    }

    /// The glyph a prompt shows now (Recipe: shell@1 game shell: Glyphs).
    pub fn glyph(&self, action: &str) -> &'static str {
        let device = if self.plants.prompts_keep_keys {
            "keys"
        } else {
            self.device.unwrap_or("keys")
        };
        glyph(device, action)
    }

    fn row(&mut self) {
        let level_hash = self.level.as_mut().map(LevelRun::hash);
        let values = self.level.as_ref().map(LevelRun::values);
        let hash = self.state.hash(level_hash.as_deref());
        let shown = self.shown();
        let (focus, enabled, prompts) = match shown {
            Some(s) => {
                let screen = &self.shell.screens[s];
                let en = self.enabled(s);
                let enabled: Vec<&str> = screen
                    .controls
                    .iter()
                    .zip(&en)
                    .filter(|(_, e)| **e)
                    .map(|(c, _)| c.id.as_str())
                    .collect();
                let prompts: Map<String, Value> = screen
                    .prompts
                    .iter()
                    .map(|p| (p.item.clone(), json!(self.glyph(&p.action))))
                    .collect();
                (
                    self.focus.map(|f| screen.controls[f].id.clone()),
                    json!(enabled),
                    prompts,
                )
            }
            None => (None, json!([]), Map::new()),
        };
        let mut row = json!({
            "step": self.step,
            "screen": shown.map(|s| self.shell.screens[s].name.clone()),
            "level": self.state.level,
            "level_step": self.level.as_ref().map_or(0, |l| l.steps),
            "paused": self.state.paused,
            "unlocked": self.state.unlocked,
            "done": self.state.done,
            "custom": self.state.custom,
            "values": values,
            "level_hash": level_hash,
            "focus": focus,
            "enabled": enabled,
            "prompts": prompts,
            "device": self.device,
            "hash": hash,
            "transition": self.transition,
            "screen_step": self.screen_step,
        });
        if self.state.screen == QUIT {
            row["quit"] = json!(true);
        }
        if let Some(f) = &self.from {
            row["from"] = json!(f);
        }
        if let Some(c) = &self.control {
            row["control"] = json!(c);
        }
        self.rows.push(row);
    }

    /// This step's frame: what's shown, or during a fade the screen it leaves going out under the look's ground in
    /// the first half and the one it enters coming in over the second.
    fn keep_frame(&mut self) {
        let doc = match (self.shown(), self.level.as_ref()) {
            (Some(s), _) => self.prompted(s),
            (None, Some(l)) => self.shell.levels[l.index].doc.clone(),
            _ => return,
        };
        let total = self.shell.transition as f64;
        let (doc, veil) = if self.shell.fade && self.transition > 0 && total > 0.0 {
            let p = 1.0 - self.transition as f64 / total;
            match self.drawn.clone().filter(|_| p < 0.5) {
                Some(leaving) => (leaving, p * 2.0),
                None => (doc, ((1.0 - p) * 2.0).min(1.0)),
            }
        } else {
            self.drawn = Some(doc.clone());
            (doc, 0.0)
        };
        if let Some(sha) = self.screens.frame(&doc, self.size, veil) {
            self.frames.push(sha);
        }
    }

    /// Screen `s`'s document with each prompt's text set to the glyph it shows now.
    pub fn prompted(&self, s: usize) -> Value {
        let screen = &self.shell.screens[s];
        let mut doc = screen.doc.clone();
        // #3605: the shell's arrays as the screen's flips, keyed copy and drivers read them, by `<shell ID>.<array>`.
        if let Some(d) = doc.as_object_mut() {
            let arrays = d.entry("arrays").or_insert_with(|| json!({}));
            if let Some(a) = arrays.as_object_mut() {
                a.extend(self.baked());
            }
        }
        for p in &screen.prompts {
            if let Some(params) = doc.pointer_mut(&format!("/items/{}/params", p.item)) {
                params["text"] = json!(self.glyph(&p.action));
            }
        }
        doc
    }
}

impl Run<'_> {
    /// The shell's arrays baked as a logic item's are (Logic `logic@1`; the column view): each element held from
    /// step 0, a bool as 0 or 1.
    pub fn baked(&self) -> Map<String, Value> {
        self.state
            .arrays()
            .into_iter()
            .map(|(name, v)| {
                let list: Vec<Value> = v
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|x| match x {
                        Value::Bool(b) => json!(i32::from(*b)),
                        x => x.clone(),
                    })
                    .collect();
                let ty = if matches!(name, "volume" | "custom") {
                    "f64"
                } else {
                    "i32"
                };
                let n = list.len();
                (
                    format!("{}.{name}", self.shell.id),
                    json!({"type": ty, "count": n, "every": STEP, "linear": false,
                           "steps": [{"step": 0, "changed": [[0, n]], "values": [[0, list]]}]}),
                )
            })
            .collect()
    }
}

/// #3605: a shell setting's entry on a level's track, as a number control's.
fn setting_entry(name: &str, t: i64, seq: u32, v: f64) -> Entry {
    Entry {
        t,
        seq,
        control: crate::piece::setting_read(name),
        value: Given::Number(v),
        writer: "shell".into(),
        player: 1,
        as_of: None,
        arrived: 0,
    }
}

/// A prompt's glyph for a device and an action (Recipe: shell@1 game shell: Glyphs).
pub fn glyph(device: &str, action: &str) -> &'static str {
    let i = match action {
        "back" => 1,
        "pause" => 2,
        "adjust" => 3,
        _ => 0,
    };
    match device {
        "pad" => ["(A)", "(B)", "(Menu)", "(D-pad)"][i],
        "touch" => ["Tap", "Back", "Pause", "Drag"][i],
        _ => ["Enter", "Esc", "Esc", "← →"][i],
    }
}

pub fn inside(b: &Box4, p: [f64; 2]) -> bool {
    p[0] >= b[0] && p[0] <= b[0] + b[2] && p[1] >= b[1] && p[1] <= b[1] + b[3]
}

/// A slider's value at `x` across its box, on its increments.
fn along(c: &super::Control, b: &Box4, x: f64) -> f64 {
    let f = ((x - b[0]) / b[2].max(1e-9)).clamp(0.0, 1.0);
    let raw = c.range[0] + f * (c.range[1] - c.range[0]);
    if c.increment > 0.0 {
        (c.range[0] + ((raw - c.range[0]) / c.increment).round() * c.increment)
            .clamp(c.range[0], c.range[1])
    } else {
        raw
    }
}

/// A level's actions, over its actions controls, each in its control's declaration order.
fn actions_of(doc: &Value) -> Vec<Action> {
    let mut out = Vec::new();
    for (id, c) in doc
        .get("controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if c.get("kind").and_then(Value::as_str) != Some("actions") {
            continue;
        }
        let strs = |v: Option<&Value>| {
            v.and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        };
        for (index, (name, a)) in c
            .get("actions")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .enumerate()
        {
            out.push(Action {
                control: id.clone(),
                index,
                name: name.clone(),
                keys: strs(a.get("keys")),
                pad: strs(a.get("pad")),
            });
        }
    }
    out
}

/// A level's touch zones laid out in the view's pixels (Control: touch zones): each zone's action and box.
fn zones_of(doc: &Value, [w, h]: [f64; 2]) -> Vec<(String, Box4)> {
    let mut out = Vec::new();
    for c in doc
        .get("controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(_, c)| c)
    {
        if c.get("kind").and_then(Value::as_str) != Some("touch_zones") {
            continue;
        }
        for (_, z) in c
            .get("zones")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let Some(action) = z.pointer("/role/action").and_then(Value::as_str) else {
                continue;
            };
            let off = z
                .get("offset")
                .and_then(Value::as_array)
                .map_or([0.0, 0.0], |a| {
                    [
                        a.first().and_then(Value::as_f64).unwrap_or(0.0),
                        a.get(1).and_then(Value::as_f64).unwrap_or(0.0),
                    ]
                });
            let (zw, zh) = match (
                z.pointer("/shape/circle/radius").and_then(Value::as_f64),
                z.pointer("/shape/rect"),
            ) {
                (Some(r), _) => (2.0 * r, 2.0 * r),
                (None, Some(r)) => (
                    r.get("w").and_then(Value::as_f64).unwrap_or(48.0),
                    r.get("h").and_then(Value::as_f64).unwrap_or(48.0),
                ),
                _ => (48.0, 48.0),
            };
            // The zone's center: its anchor's point in the view, moved by its offset, x right and y down.
            let at = match z
                .get("anchor")
                .and_then(Value::as_str)
                .unwrap_or("bottom_left")
            {
                "top_left" => [0.0, 0.0],
                "top_right" => [w, 0.0],
                "bottom_right" => [w, h],
                "top" => [w / 2.0, 0.0],
                "bottom" => [w / 2.0, h],
                "left" => [0.0, h / 2.0],
                "right" => [w, h / 2.0],
                _ => [0.0, h],
            };
            let center = [at[0] + off[0], at[1] + off[1]];
            out.push((
                action.to_string(),
                [center[0] - zw / 2.0, center[1] - zh / 2.0, zw, zh],
            ));
        }
    }
    out
}

/// The play call's planted shell, by the replica's plant name.
pub fn plants_of(name: Option<&str>) -> Plants {
    Plants {
        pause_runs_clock: name == Some("pause-runs-level-clock"),
        focus_stays_disabled: name == Some("focus-stays-on-disabled"),
        prompts_keep_keys: name == Some("prompts-keep-key-glyphs"),
        done_on_enter: name == Some("done-on-enter"),
        done_in_save: name == Some("done-in-save"),
        setting_in_read_region: name == Some("setting-through-reads"),
    }
}

/// The replica's play of a shell document (Check input: shell journeys): the shell checked, then the journey the
/// call names played with its device at its size; a shell its check refuses answers its refusal and no step.
pub fn play(
    document: &Value,
    stored: &dyn Fn(&str) -> Option<Vec<u8>>,
    docs: &dyn Fn(&str) -> Option<Value>,
    call: &Value,
    screens: &mut dyn Screens,
    plants: Plants,
) -> Result<Value, Value> {
    let given = super::documents_of(call);
    let by_hash = |h: &str| given.get(h).cloned().or_else(|| docs(h));
    let shell = match Shell::of(document, &by_hash) {
        Ok(s) => s,
        Err(r) => {
            let spec = call.get("shell").cloned().unwrap_or(json!({}));
            return Ok(
                json!({"shell": {"journey": spec.get("journey"), "device": spec.get("device"), "size": spec.get("size"),
                                       "refused": {"code": r["code"], "message": r["message"], "level": r.get("level"), "array": r.get("array")},
                                       "steps": [], "screens": {}, "entered": [], "carry": [], "track": [], "recording": null}}),
            );
        }
    };
    super::journey::play(&shell, stored, call, screens, plants)
}
