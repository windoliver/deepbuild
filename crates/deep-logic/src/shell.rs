//! Issue #851: the game shell, `shell@1` (canvas primitives: Recipe: shell@1 game shell; Check input: shell
//! journeys). A shell document holds one `shell@1` item whose params name its screens, each a 2D document with its
//! controls, and its levels, each a document with logic items, by hash or inline. Its state is the shell item's own
//! arrays (which screen and level are active, what is unlocked, the settings), stepped by the rules here, which are
//! the logic module's first-party rules and never a program the document carries. Entering a level loads its
//! document as a piece; completing one writes its carry record and unlocks the next; a pause holds the level's clock
//! and input at the step they reached. Journeys (`journey`) turn a script of moves into one device's inputs and play
//! them, a row a step; the playtest plug-in judges the rows.

use serde_json::{json, Map, Value};

mod focus;
pub mod journey;
mod rules;
pub mod run;

pub use run::{play, Screens};

/// The six screens every shell holds, in index order; extras follow them.
pub const SIX: [&str; 6] = [
    "title",
    "settings",
    "levels",
    "pause",
    "game_over",
    "credits",
];
/// The shell's own screen indices.
pub const TITLE: i32 = 0;
pub const LEVELS: i32 = 2;
pub const PAUSE: i32 = 3;
pub const GAME_OVER: i32 = 4;
pub const CREDITS: i32 = 5;
/// `opened_by`'s depth, and the marker a level leaves on it while paused.
pub const DEPTH: usize = 8;
pub const IN_LEVEL: i32 = -2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Press,
    Toggle,
    Slider,
    Choice,
    DragAlong,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Does {
    Go(usize),
    /// A level's index, or the selected one.
    Start(Option<usize>),
    Select(usize),
    Resume,
    Back,
    Quit,
    Set(String),
}

#[derive(Clone, Debug)]
pub struct Control {
    pub id: String,
    pub kind: Kind,
    pub item: String,
    pub text: Option<String>,
    pub does: Option<Does>,
    pub enabled: Option<String>,
    pub range: [f64; 2],
    pub increment: f64,
    pub options: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Back {
    Opener,
    To(usize),
    Nothing,
}

#[derive(Clone, Debug)]
pub struct Prompt {
    pub item: String,
    pub action: String,
}

#[derive(Clone, Debug)]
pub struct Screen {
    pub name: String,
    pub doc: Value,
    pub controls: Vec<Control>,
    pub focus: Option<Vec<String>>,
    pub prompts: Vec<Prompt>,
    pub back: Back,
    pub ends: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct Level {
    pub name: String,
    pub doc: Value,
    pub done: (String, String),
    pub lost: Option<(String, String)>,
}

#[derive(Clone, Debug)]
pub struct Settings {
    pub text_size: Vec<i64>,
    pub reduced_motion: bool,
    pub volume: Vec<(String, f64)>,
    pub bindings: Vec<(String, Vec<String>)>,
    pub toggle: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Pause {
    pub keys: Vec<String>,
    pub pad: Vec<String>,
    pub corner: String,
    pub size: f64,
}

#[derive(Clone, Debug)]
pub struct Shell {
    pub id: String,
    pub screens: Vec<Screen>,
    pub levels: Vec<Level>,
    pub unlocked: Vec<usize>,
    pub fade: bool,
    pub transition: i64,
    pub settings: Settings,
    pub pause: Pause,
    pub seed: u64,
}

/// A refusal at check, with its code and what it names.
pub fn refused(code: &str, message: String, names: Value) -> Value {
    let mut r = json!({"ok": false, "code": code, "what": message, "message": message});
    if let (Some(r), Some(n)) = (r.as_object_mut(), names.as_object()) {
        for (k, v) in n {
            r.insert(k.clone(), v.clone());
        }
    }
    r
}

/// A level's name in words: its place from 1, and its own name when it has one.
pub fn level_words(levels: &[Level], i: usize) -> String {
    match levels
        .get(i)
        .map(|l| l.name.as_str())
        .filter(|n| !n.is_empty())
    {
        Some(n) => format!("level {} ({n})", i + 1),
        None => format!("level {}", i + 1),
    }
}

impl Shell {
    pub fn screen_index(&self, name: &str) -> Option<usize> {
        self.screens.iter().position(|s| s.name == name)
    }

    /// The settings' fields a `set` may name: text_size, reduced_motion, volume.<bus>, toggle.<action>.
    fn settable(&self, field: &str) -> bool {
        match field.split_once('.') {
            None => matches!(field, "text_size" | "reduced_motion"),
            Some(("volume", bus)) => self.settings.volume.iter().any(|(b, _)| b == bus),
            Some(("toggle", a)) => self.settings.toggle.iter().any(|t| t == a),
            _ => false,
        }
    }

    /// The shell document read and checked (Recipe: shell@1 game shell): every screen and level resolved by hash
    /// through `docs`, each control's item on its screen, every `go` to a screen the shell has, and no level that
    /// reads or mirrors an array its own document doesn't hold.
    pub fn of(doc: &Value, docs: &dyn Fn(&str) -> Option<Value>) -> Result<Shell, Value> {
        let items = doc.get("items").and_then(Value::as_object);
        let (id, item) = items
            .into_iter()
            .flatten()
            .find(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("shell@1"))
            .ok_or_else(|| {
                refused(
                    "shell.screen",
                    "the document holds no shell@1 item".into(),
                    json!({}),
                )
            })?;
        let p = item.get("params").cloned().unwrap_or(json!({}));
        let resolve = |v: Option<&Value>, what: &str| -> Result<Value, Value> {
            match v {
                Some(Value::String(h)) => docs(h).ok_or_else(|| {
                    refused(
                        "shell.screen",
                        format!("{what}'s document {h} isn't one the shell was given"),
                        json!({"document": h}),
                    )
                }),
                Some(d @ Value::Object(_)) => Ok(d.clone()),
                _ => Err(refused(
                    "shell.screen",
                    format!("{what} names no document"),
                    json!({}),
                )),
            }
        };
        let given = p
            .get("screens")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        for name in SIX {
            if !given.contains_key(name) {
                return Err(refused(
                    "shell.screen",
                    format!("the shell has no {name} screen"),
                    json!({"screen": name}),
                ));
            }
        }
        let mut names: Vec<String> = SIX.iter().map(|s| s.to_string()).collect();
        names.extend(given.keys().filter(|k| !SIX.contains(&k.as_str())).cloned());
        if names.len() > 16 {
            return Err(refused(
                "shell.screen",
                format!("the shell names {} screens, past 16", names.len()),
                json!({}),
            ));
        }
        let levels_given = p
            .get("levels")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if levels_given.is_empty() || levels_given.len() > 64 {
            return Err(refused(
                "shell.screen",
                "the shell lists 1 to 64 levels".into(),
                json!({}),
            ));
        }
        let mut levels = Vec::new();
        for (i, l) in levels_given.iter().enumerate() {
            let words = format!("level {}", i + 1);
            let path = |k: &str| -> Option<(String, String)> {
                let s = l.get(k)?.as_str()?;
                let (a, b) = s.split_once('.')?;
                Some((a.to_string(), b.to_string()))
            };
            let done = path("done").ok_or_else(|| {
                refused(
                    "shell.screen",
                    format!("{words}'s done names no array path"),
                    json!({"level": i}),
                )
            })?;
            levels.push(Level {
                name: l
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                doc: resolve(l.get("doc"), &words)?,
                done,
                lost: path("lost"),
            });
        }
        let settings = settings_of(p.get("settings"));
        let pause = p.get("pause");
        let strs = |v: Option<&Value>, d: &str| -> Vec<String> {
            v.and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_else(|| vec![d.to_string()])
        };
        let mut shell = Shell {
            id: id.clone(),
            screens: Vec::new(),
            levels,
            unlocked: p
                .get("unlocked")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_u64)
                        .map(|u| u as usize)
                        .collect()
                })
                .unwrap_or_else(|| vec![0]),
            fade: p.pointer("/transition/kind").and_then(Value::as_str) != Some("cut"),
            transition: p
                .pointer("/transition/steps")
                .and_then(Value::as_i64)
                .unwrap_or(30)
                .clamp(0, 120),
            settings,
            pause: Pause {
                keys: strs(pause.and_then(|p| p.get("keys")), "Escape"),
                pad: strs(pause.and_then(|p| p.get("pad")), "start"),
                corner: pause
                    .and_then(|p| p.pointer("/button/corner"))
                    .and_then(Value::as_str)
                    .unwrap_or("top_right")
                    .to_string(),
                size: pause
                    .and_then(|p| p.pointer("/button/size"))
                    .and_then(Value::as_f64)
                    .unwrap_or(48.0),
            },
            seed: doc.get("seed").and_then(Value::as_u64).unwrap_or(0),
        };
        for name in &names {
            let s = &given[name];
            let sdoc = resolve(s.get("doc"), &format!("the {name} screen"))?;
            let back = match s.get("back") {
                None => Back::Opener,
                Some(Value::String(b)) if b == "none" => Back::Nothing,
                Some(Value::Null) => Back::Nothing,
                Some(Value::String(b)) => {
                    Back::To(names.iter().position(|n| n == b).ok_or_else(|| {
                        refused(
                            "shell.screen",
                            format!(
                                "the {name} screen's back goes to {b}, a screen the shell lacks"
                            ),
                            json!({"screen": name}),
                        )
                    })?)
                }
                Some(_) => {
                    return Err(refused(
                        "shell.screen",
                        format!("the {name} screen's back is a screen or none"),
                        json!({"screen": name}),
                    ))
                }
            };
            let mut controls = Vec::new();
            for (cid, c) in s
                .get("controls")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                controls.push(control_of(name, cid, c, &sdoc, &names, shell.levels.len())?);
            }
            if controls.len() > 32 {
                return Err(refused(
                    "shell.control",
                    format!(
                        "the {name} screen lists {} controls, past 32",
                        controls.len()
                    ),
                    json!({"screen": name}),
                ));
            }
            for c in &controls {
                if let Some(Does::Set(f)) = &c.does {
                    if !shell.settable(f) {
                        return Err(refused("shell.control", format!("the {name} screen's control {} sets {f}, which the settings don't hold", c.id), json!({"screen": name, "control": c.id})));
                    }
                }
            }
            let focus = s.get("focus").and_then(Value::as_array).map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            });
            if let Some(f) = focus
                .iter()
                .flatten()
                .find(|f| !controls.iter().any(|c| &c.id == *f))
            {
                return Err(refused(
                    "shell.control",
                    format!("the {name} screen's focus names {f}, which isn't one of its controls"),
                    json!({"screen": name, "control": f}),
                ));
            }
            let mut prompts = Vec::new();
            for (item, pr) in s
                .get("prompts")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                if sdoc.pointer(&format!("/items/{item}")).is_none() {
                    return Err(refused(
                        "shell.control",
                        format!("the {name} screen's prompt {item} is an item its document lacks"),
                        json!({"screen": name, "prompt": item}),
                    ));
                }
                prompts.push(Prompt {
                    item: item.clone(),
                    action: pr
                        .get("action")
                        .and_then(Value::as_str)
                        .unwrap_or("confirm")
                        .to_string(),
                });
            }
            shell.screens.push(Screen {
                name: name.clone(),
                doc: sdoc,
                controls,
                focus,
                prompts,
                back,
                ends: s.get("ends").and_then(Value::as_i64),
            });
        }
        for (i, l) in shell.levels.iter().enumerate() {
            if let Some((array, other)) = foreign_read(&shell.levels, i) {
                let message = match other {
                    Some(o) => format!("{} reads {array}, an array of {}'s, not its own: a level reads only its own arrays and, at its step 0, what a carry record holds", level_words(&shell.levels, i), level_words(&shell.levels, o)),
                    None => format!("{} reads {array}, an array no item of its own document holds: a level reads only its own arrays and, at its step 0, what a carry record holds", level_words(&shell.levels, i)),
                };
                return Err(refused(
                    "shell.reads",
                    message,
                    json!({"level": i, "array": array}),
                ));
            }
            let has =
                |(item, _): &(String, String)| l.doc.pointer(&format!("/items/{item}")).is_some();
            if !has(&l.done) || !l.lost.as_ref().is_none_or(has) {
                return Err(refused(
                    "shell.screen",
                    format!(
                        "{}'s done or lost names an item its document lacks",
                        level_words(&shell.levels, i)
                    ),
                    json!({"level": i}),
                ));
            }
        }
        Ok(shell)
    }
}

/// The first array path a level's logic reads or mirrors that no item of its own document holds, and the other
/// level whose document does, when one does.
fn foreign_read(levels: &[Level], i: usize) -> Option<(String, Option<usize>)> {
    let own = |doc: &Value, id: &str| doc.pointer(&format!("/items/{id}")).is_some();
    let doc = &levels[i].doc;
    let controls = doc.get("controls").and_then(Value::as_object);
    for item in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(_, v)| v)
    {
        if item.get("kind").and_then(Value::as_str) != Some("logic@1") {
            continue;
        }
        let params = item.get("params");
        let reads = params
            .and_then(|p| p.get("reads"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str);
        let mirrors = params
            .and_then(|p| p.get("mirrors"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|m| m.get("array").and_then(Value::as_str));
        for path in reads.chain(mirrors) {
            let Some((id, _)) = path.split_once('.') else {
                // A bare ID is a control or a world the document lists.
                continue;
            };
            if own(doc, id) || controls.is_some_and(|c| c.contains_key(id)) {
                continue;
            }
            let other = levels
                .iter()
                .enumerate()
                .find(|(j, l)| *j != i && own(&l.doc, id))
                .map(|(j, _)| j);
            return Some((path.to_string(), other));
        }
    }
    None
}

fn control_of(
    screen: &str,
    id: &str,
    c: &Value,
    doc: &Value,
    names: &[String],
    levels: usize,
) -> Result<Control, Value> {
    let bad = |what: String| {
        refused(
            "shell.control",
            what,
            json!({"screen": screen, "control": id}),
        )
    };
    let kind = match c.get("kind").and_then(Value::as_str).unwrap_or("press") {
        "press" => Kind::Press,
        "toggle" => Kind::Toggle,
        "slider" => Kind::Slider,
        "choice" => Kind::Choice,
        "drag_along" => Kind::DragAlong,
        k => {
            return Err(bad(format!(
                "the {screen} screen's control {id} is of kind {k}, not one a shell takes"
            )))
        }
    };
    let item = c
        .get("item")
        .and_then(Value::as_str)
        .ok_or_else(|| bad(format!("the {screen} screen's control {id} names no item")))?;
    if doc.pointer(&format!("/items/{item}")).is_none() {
        return Err(bad(format!(
            "the {screen} screen's control {id} is drawn by {item}, an item its document lacks"
        )));
    }
    let text = c.get("text").and_then(Value::as_str).map(str::to_string);
    if let Some(t) = &text {
        if doc.pointer(&format!("/items/{t}")).is_none() {
            return Err(bad(format!(
                "the {screen} screen's control {id} is labelled by {t}, an item its document lacks"
            )));
        }
    }
    let level = |v: &Value| v.as_u64().map(|u| u as usize).filter(|u| *u < levels);
    let does = match c.get("does") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(match s.as_str() {
            "resume" => Does::Resume,
            "back" => Does::Back,
            "quit" => Does::Quit,
            other => {
                return Err(bad(format!(
                    "the {screen} screen's control {id} does {other}, which a shell control can't"
                )))
            }
        }),
        Some(Value::Object(o)) => {
            Some({
                let (k, v) = o.iter().next().ok_or_else(|| {
                    bad(format!(
                        "the {screen} screen's control {id} does nothing it names"
                    ))
                })?;
                match k.as_str() {
                "go" => {
                    let to = v.as_str().unwrap_or_default();
                    Does::Go(names.iter().position(|n| n == to).ok_or_else(|| {
                        refused("shell.screen", format!("the {screen} screen's control {id} goes to {to}, a screen the shell lacks"), json!({"screen": screen, "control": id, "to": to}))
                    })?)
                }
                "start" if v.as_str() == Some("selected") => Does::Start(None),
                "start" => Does::Start(Some(level(v).ok_or_else(|| bad(format!("the {screen} screen's control {id} starts a level the shell lacks")))?)),
                "select" => Does::Select(level(v).ok_or_else(|| bad(format!("the {screen} screen's control {id} selects a level the shell lacks")))?),
                "set" => Does::Set(v.as_str().unwrap_or_default().to_string()),
                other => return Err(bad(format!("the {screen} screen's control {id} does {other}, which a shell control can't"))),
            }
            })
        }
        Some(_) => {
            return Err(bad(format!(
                "the {screen} screen's control {id}'s does isn't one a shell takes"
            )))
        }
    };
    let range = c
        .get("range")
        .and_then(Value::as_array)
        .filter(|a| a.len() == 2)
        .and_then(|a| Some([a[0].as_f64()?, a[1].as_f64()?]))
        .unwrap_or([0.0, 1.0]);
    Ok(Control {
        id: id.to_string(),
        kind,
        item: item.to_string(),
        text,
        does,
        enabled: match c.get("enabled") {
            None | Some(Value::Bool(true)) => None,
            Some(Value::Bool(false)) => Some("0".into()),
            Some(v) => Some(v.as_str().map_or_else(|| v.to_string(), str::to_string)),
        },
        range,
        increment: c
            .get("increment")
            .and_then(Value::as_f64)
            .unwrap_or((range[1] - range[0]) / 10.0),
        options: c
            .get("options")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    })
}

fn settings_of(v: Option<&Value>) -> Settings {
    let s = v.cloned().unwrap_or(json!({}));
    Settings {
        text_size: s
            .get("text_size")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_i64).collect::<Vec<_>>())
            .filter(|a| !a.is_empty())
            .unwrap_or_else(|| vec![100]),
        reduced_motion: s
            .get("reduced_motion")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        volume: s
            .get("volume")
            .and_then(Value::as_object)
            .map(|o| {
                o.iter()
                    .map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0)))
                    .collect::<Vec<_>>()
            })
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| vec![("master".into(), 0.0)]),
        bindings: s
            .get("bindings")
            .and_then(Value::as_object)
            .map(|o| {
                o.iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            v.as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(Value::as_str)
                                .map(str::to_string)
                                .collect(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default(),
        toggle: s
            .get("toggle")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// The documents a call gives by hash: `documents: {sha256 → document}`.
pub fn documents_of(call: &Value) -> Map<String, Value> {
    call.get("documents")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}
