//! Issue #210: ports (technical design: Ports and readings). A document's `ports` each declare one
//! way out to one plug-in and back; a plug-in registers the port it answers (`install`'s
//! `manifest.ports`). The app's own Connect prompt opens a port, on your click only, and only for
//! what the document lists. A open port's out side sends each step's entries and rows once, in
//! step order, while the piece plays live and forward, and never on a seek, a replay, a check or
//! an export. A sound port (its document says so, or its plug-in's port does) makes its plug-in
//! a device gate owner: a mute or quiet hours stop its out side and tell the plug-in to fall
//! silent.
//!
//! The play here is the piece's own clock on the scenario's display grid: `t = t_ref + (host -
//! h_ref)`, each logic step run when the clock reaches its time, from the bake of the piece on
//! the document's input track.

use std::collections::BTreeMap;
use std::rc::Rc;
use std::time::Instant;

use deep_logic::world::{track_of, Entry, Record, World};
use serde_json::{json, Map, Value};

use crate::hub::{Hub, Planted};
use crate::placement::Grid;
use crate::shared::FLICKS;

/// What a plug-in's registered port says it takes and gives (`deep.registerPort`).
#[derive(Clone, Debug, Default)]
pub struct PluginPort {
    pub entries: Vec<String>,
    pub rows: Vec<String>,
    pub sources: Vec<String>,
    pub sound: bool,
}

/// An installed plug-in: the hosts its grant names and the ports it registers.
#[derive(Clone, Debug, Default)]
pub struct Plugin {
    pub hosts: Vec<String>,
    pub ports: BTreeMap<String, PluginPort>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum State {
    Closed,
    Open,
    Stopped,
}

impl State {
    fn name(self) -> &'static str {
        match self {
            State::Closed => "closed",
            State::Open => "open",
            State::Stopped => "stopped",
        }
    }
}

/// One message the plug-in received, when, and for an Out the ns from the end of its step's run
/// to its handoff.
struct Received {
    at: i64,
    message: Value,
    delay_ns: Option<u64>,
}

/// A port as the app holds it: its state, what its plug-in received, the first step it sends
/// and whether its gear makes sound.
struct PortRt {
    state: State,
    received: Vec<Received>,
    from: i64,
    sound: bool,
}

/// A piece playing live in a panel.
struct Play {
    doc: String,
    step: i64,
    t_ref: i64,
    h_ref: i64,
    play_host: i64,
    grid: Grid,
    next_v: i64,
    /// The next step to run, and the highest step this play ever ran.
    next_step: i64,
    high: i64,
    frames: Vec<(i64, i64)>,
    /// The host time of each step an open port did work for.
    work: Vec<i64>,
    steps: Vec<(i64, i64)>,
}

impl Play {
    fn t_at(&self, host: i64) -> i64 {
        self.t_ref + (host - self.h_ref)
    }
}

#[derive(Default)]
pub struct Ports {
    pub plugins: BTreeMap<String, Plugin>,
    ports: BTreeMap<(String, String), PortRt>,
    plays: BTreeMap<String, Play>,
}

/// A document's port as it declares it.
struct Decl {
    plugin: String,
    out: Vec<String>,
    inn: Vec<String>,
    sound: bool,
}

fn decls(doc: &Value) -> BTreeMap<String, Decl> {
    let list = |v: Option<&Value>| -> Vec<String> {
        v.and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|s| s.as_str().map(str::to_string))
            .collect()
    };
    doc.get("ports")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(name, p)| {
            Some((
                name.clone(),
                Decl {
                    plugin: p.get("plugin")?.as_str()?.to_string(),
                    out: list(p.get("out")),
                    inn: list(p.get("in")),
                    sound: p.get("sound").and_then(Value::as_bool).unwrap_or(false),
                },
            ))
        })
        .collect()
}

/// The plug-in ports a manifest registers, or `None` for one that doesn't read.
pub fn manifest_ports(manifest: &Value) -> Option<Plugin> {
    let strings = |v: Option<&Value>| -> Option<Vec<String>> {
        match v {
            None => Some(Vec::new()),
            Some(v) => v
                .as_array()?
                .iter()
                .map(|s| s.as_str().map(str::to_string))
                .collect(),
        }
    };
    let hosts = strings(manifest.get("grant").and_then(|g| g.get("hosts")))?;
    let mut ports = BTreeMap::new();
    if let Some(p) = manifest.get("ports") {
        for (name, port) in p.as_object()? {
            ports.insert(
                name.clone(),
                PluginPort {
                    entries: strings(port.get("entries"))?,
                    rows: strings(port.get("rows"))?,
                    sources: strings(port.get("sources"))?,
                    sound: match port.get("sound") {
                        None => false,
                        Some(b) => b.as_bool()?,
                    },
                },
            );
        }
    }
    Some(Plugin { hosts, ports })
}

pub enum PortCall {
    /// Your Connect of a port, with the serial of your click, or by whom else it was asked.
    Connect {
        panel: String,
        port: String,
        serial: Option<u64>,
    },
    Port {
        panel: String,
        port: String,
    },
    /// The shell's mute of a gate owner.
    Mute(String),
    Seek {
        panel: String,
        to: i64,
    },
}

pub fn parse_call(name: &str, c: &Map<String, Value>) -> Option<PortCall> {
    let s = |k: &str| Some(c.get(k)?.as_str()?.to_string());
    Some(match name {
        "connect" => PortCall::Connect {
            panel: s("panel")?,
            port: s("port")?,
            serial: match (c.get("serial"), c.get("by")) {
                (Some(n), None) => Some(n.as_u64()?),
                (None, Some(by)) => {
                    by.as_str()?;
                    None
                }
                _ => return None,
            },
        },
        "port" => PortCall::Port {
            panel: s("panel")?,
            port: s("port")?,
        },
        "mute" => PortCall::Mute(s("owner")?),
        "seek" => PortCall::Seek {
            panel: s("panel")?,
            to: c.get("to")?.as_i64()?,
        },
        _ => return None,
    })
}

fn refusal(code: &str, port: &str, more: Value) -> Value {
    let mut r = json!({"code": code, "port": port});
    if let (Some(o), Some(m)) = (r.as_object_mut(), more.as_object()) {
        o.extend(m.clone());
    }
    r
}

/// The item a list name `<item>.occurrences` belongs to.
fn list_item(name: &str) -> Option<&str> {
    name.strip_suffix(".occurrences")
}

impl Hub<'_> {
    fn quiet_at(&self, host: i64) -> bool {
        self.scenario
            .quiet_hours
            .iter()
            .any(|(from, to)| host >= *from && host < *to)
    }

    pub(crate) fn ports_call(&mut self, call: &PortCall) -> Value {
        match call {
            PortCall::Connect {
                panel,
                port,
                serial,
            } => self.connect(panel, port, *serial),
            PortCall::Port { panel, port } => {
                self.advance_piece(panel);
                match self.view_of(panel, port) {
                    Some(v) => v,
                    None => refusal("unknown_port", port, json!({})),
                }
            }
            PortCall::Mute(owner) => {
                let panels: Vec<String> = self.ports.plays.keys().cloned().collect();
                for p in panels {
                    self.advance_piece(&p);
                }
                // The planted mute silences the plug-in's own output and leaves the port's out
                // side sending.
                if self.scenario.planted != Some(Planted::MuteLeavesPortSending) {
                    let now = self.now;
                    let owned: Vec<(String, String)> = self
                        .ports
                        .ports
                        .iter()
                        .filter(|(_, r)| r.sound && r.state == State::Open)
                        .map(|(k, _)| k.clone())
                        .collect();
                    for (panel, name) in owned {
                        let plugin = self
                            .panel_document(&panel)
                            .and_then(|(d, _)| decls(&d).remove(&name))
                            .map(|d| d.plugin);
                        if plugin.as_deref() == Some(owner.as_str()) {
                            self.stop_port(&panel, &name, now);
                        }
                    }
                }
                json!({"muted": owner})
            }
            PortCall::Seek { panel, to } => {
                self.advance_piece(panel);
                let now = self.now;
                let Some(play) = self.ports.plays.get_mut(panel) else {
                    return json!({"code": "not_playing"});
                };
                play.t_ref = *to;
                play.h_ref = now;
                play.next_step = (*to + play.step - 1).div_euclid(play.step).max(0);
                json!({"seek": {"t": to}})
            }
        }
    }

    /// The plug-in told its port stopped, now.
    fn stop_port(&mut self, panel: &str, name: &str, at: i64) {
        if let Some(r) = self
            .ports
            .ports
            .get_mut(&(panel.to_string(), name.to_string()))
        {
            r.state = State::Stopped;
            r.received.push(Received {
                at,
                message: json!({"port": name, "state": "stopped"}),
                delay_ns: None,
            });
        }
    }

    fn connect(&mut self, panel: &str, name: &str, serial: Option<u64>) -> Value {
        self.advance_piece(panel);
        let now = self.now;
        let Some((doc, _)) = self.panel_document(panel) else {
            return json!({"code": "not_presented"});
        };
        let Some(decl) = decls(&doc).remove(name) else {
            return refusal("unknown_port", name, json!({}));
        };
        // Only your hardware input asks: a tour, the piece's logic, an agent's tool, a bridge
        // and a replica carry no serial of yours.
        let gesture = serial.and_then(|s| {
            let (p, _) = self.placement.gesture_of(s)?;
            let p = p.to_string();
            self.placement.serial_fresh_in(s, &p, now).then_some(p)
        });
        let Some(gesture) = gesture else {
            return refusal("no_serial", name, json!({}));
        };
        let Some(plugin) = self.ports.plugins.get(&decl.plugin) else {
            return refusal("plugin_missing", name, json!({"plugin": decl.plugin}));
        };
        let Some(theirs) = plugin.ports.get(name) else {
            return refusal("plugin_port_missing", name, json!({"plugin": decl.plugin}));
        };
        // A plug-in asks only for what the document lists.
        for (asked, listed) in [
            (&theirs.entries, &decl.out),
            (&theirs.rows, &decl.out),
            (&theirs.sources, &decl.inn),
        ] {
            if let Some(c) = asked.iter().find(|c| !listed.contains(c)) {
                return refusal("not_listed", name, json!({"control": c}));
            }
        }
        // A plug-in whose port says its gear makes sound is a gate owner whatever the document
        // says; the planted gate trusts the document's flag.
        let trusts = self.scenario.planted == Some(Planted::GateTrustsDocumentSound);
        let sound = decl.sound || (theirs.sound && !trusts);
        if sound && gesture != panel {
            return refusal("serial_not_granting", name, json!({}));
        }
        let from = self.ports.plays.get(panel).map_or(0, |p| p.next_step);
        let state = if sound && self.quiet_at(now) {
            State::Stopped
        } else {
            State::Open
        };
        self.ports.ports.insert(
            (panel.to_string(), name.to_string()),
            PortRt {
                state,
                received: Vec::new(),
                from,
                sound,
            },
        );
        if state == State::Stopped {
            self.stop_port(panel, name, now);
        }
        self.view_of(panel, name)
            .unwrap_or_else(|| refusal("unknown_port", name, json!({})))
    }

    /// `{port: {name, state, prompt, received}}`: a closed port's prompt is the app's own,
    /// naming the plug-in, its grant's hosts, and what goes out and in.
    fn view_of(&self, panel: &str, name: &str) -> Option<Value> {
        let (doc, _) = self.panel_document(panel)?;
        let decl = decls(&doc).remove(name)?;
        let held = self.ports.ports.get(&(panel.to_string(), name.to_string()));
        let state = held.map_or(State::Closed, |r| r.state);
        let hosts = self
            .ports
            .plugins
            .get(&decl.plugin)
            .map(|p| p.hosts.clone())
            .unwrap_or_default();
        let sound = held.map_or_else(
            || {
                decl.sound
                    || self
                        .ports
                        .plugins
                        .get(&decl.plugin)
                        .and_then(|p| p.ports.get(name))
                        .is_some_and(|p| p.sound)
            },
            |r| r.sound,
        );
        let prompt = (state == State::Closed).then(|| {
            json!({"port": name, "plugin": decl.plugin, "hosts": hosts,
                   "out": decl.out, "in": decl.inn, "sound": sound})
        });
        let received: Vec<Value> = held
            .into_iter()
            .flat_map(|r| &r.received)
            .map(|m| {
                let mut v = json!({"at": m.at, "message": m.message});
                if let Some(d) = m.delay_ns {
                    v["delay_ns"] = json!(d);
                }
                v
            })
            .collect();
        Some(
            json!({"port": {"name": name, "state": state.name(), "prompt": prompt,
                             "received": received}}),
        )
    }

    /// Play granted in a panel showing a piece with logic: its clock starts, `None` for a panel
    /// that shows none.
    pub(crate) fn start_piece_play(
        &mut self,
        panel: &str,
        granted: bool,
        serial: bool,
    ) -> Option<Value> {
        let (doc, _) = self.panel_document(panel)?;
        deep_logic::play::piece_of(&doc)?;
        if !granted {
            return Some(
                json!({"code": if serial { "serial_not_granting" } else { "no_gesture" }}),
            );
        }
        let id = self.panel_doc(panel)?;
        let track = self.track_json(&id);
        let form = self.forms.get(&id)?;
        let piece = match self.logic_piece(form, &track) {
            Ok(Some(p)) => p,
            Ok(None) => return None,
            Err(i) => return Some(json!({"code": i.code, "issues": [i.to_json()]})),
        };
        let step = piece.items.first().map_or(FLICKS, |i| i.step.max(1));
        let grid = self
            .placement
            .pacing(panel)
            .map(|(_, d)| d.grid())
            .or_else(|| {
                self.scenario
                    .clock
                    .and_then(|c| c.refresh_hz)
                    .map(|hz| Grid {
                        next_vsync: FLICKS / hz,
                        period: FLICKS / hz,
                    })
            });
        let Some(grid) = grid else {
            return Some(json!({"code": "no_display"}));
        };
        let now = self.now;
        let first = (now - grid.next_vsync).max(0);
        let next_v = first / grid.period + i64::from(first % grid.period != 0);
        self.ports.plays.insert(
            panel.to_string(),
            Play {
                doc: id,
                step,
                t_ref: 0,
                h_ref: now,
                play_host: now,
                grid,
                next_v,
                next_step: 0,
                high: -1,
                frames: Vec::new(),
                work: Vec::new(),
                steps: Vec::new(),
            },
        );
        Some(json!({"playing": true}))
    }

    /// The piece baked on its track over `count` steps: its occurrence rows by item.
    fn bake_rows(&self, doc: &str, count: i64) -> Option<(Rc<deep_logic::piece::Piece>, Record)> {
        let form = self.forms.get(doc)?;
        let track = self.track_json(doc);
        let piece = Rc::new(self.logic_piece(form, &track).ok()??);
        let entries: Vec<Entry> = track
            .iter()
            .filter(|e| e.get("present").is_none())
            .filter_map(Entry::parse)
            .collect();
        let mut rec = Record::default();
        let mut world = World::new(
            piece.clone(),
            track_of(&entries),
            false,
            Default::default(),
            &mut rec,
            None,
        )
        .ok()?;
        world.run(count, &mut rec, &mut |_, _| {});
        Some((piece, rec))
    }

    /// Plays the panel's piece on to now: each display frame and each step before it, in time
    /// order, and each open port's out side for the steps run live and forward.
    pub(crate) fn advance_piece(&mut self, panel: &str) {
        let Some(mut play) = self.ports.plays.remove(panel) else {
            return;
        };
        let now = self.now;
        let g = play.grid;
        loop {
            let vs = g.next_vsync + play.next_v * g.period;
            if vs >= now {
                break;
            }
            play.next_v += 1;
            if vs >= play.play_host {
                play.frames.push((vs, play.t_at(vs)));
            }
        }
        let planted = self.scenario.planted == Some(Planted::PortSendsOnSeek);
        let mut due: Vec<(i64, i64, bool)> = Vec::new();
        loop {
            let k = play.next_step;
            let host = play.h_ref + (k * play.step - play.t_ref);
            if host >= now {
                break;
            }
            due.push((k, host, k > play.high));
            play.high = play.high.max(k);
            play.next_step += 1;
        }
        let decls = self
            .panel_document(panel)
            .map(|(d, _)| decls(&d))
            .unwrap_or_default();
        let open = |me: &Self, name: &String| {
            me.ports
                .ports
                .get(&(panel.to_string(), name.clone()))
                .is_some_and(|r| r.state == State::Open)
        };
        let names: Vec<String> = decls.keys().cloned().collect();
        let mut sends: Vec<(i64, i64)> = Vec::new();
        for (k, host, fresh) in &due {
            play.steps.push((*k, *host));
            if names.iter().any(|n| open(self, n)) {
                play.work.push(*host);
                if *fresh || planted {
                    sends.push((*k, *host));
                }
            }
        }
        let last = sends.iter().map(|(k, _)| *k).max();
        let baked = last.and_then(|k| self.bake_rows(&play.doc, k + 1));
        let track = self.track_json(&play.doc);
        let step = play.step;
        let doc = play.doc.clone();
        self.ports.plays.insert(panel.to_string(), play);
        let Some((piece, rec)) = baked else {
            return;
        };
        let occ = rec.occurrences(&piece);
        for (k, host) in sends {
            for name in &names {
                let key = (panel.to_string(), name.clone());
                let Some(decl) = decls.get(name) else {
                    continue;
                };
                let started = Instant::now();
                let Some(r) = self.ports.ports.get(&key) else {
                    continue;
                };
                if r.state != State::Open || k < r.from {
                    continue;
                }
                if r.sound && self.quiet_at(host) {
                    self.stop_port(panel, name, host);
                    continue;
                }
                let controls: Vec<&String> =
                    decl.out.iter().filter(|o| list_item(o).is_none()).collect();
                let entries: Vec<Value> = track
                    .iter()
                    .filter(|e| {
                        let t = e["t"].as_i64().unwrap_or(0);
                        e["control"]
                            .as_str()
                            .is_some_and(|c| controls.iter().any(|o| *o == c))
                            && t > (k - 1) * step
                            && t <= k * step
                    })
                    .cloned()
                    .collect();
                let rows: Vec<Value> = decl
                    .out
                    .iter()
                    .filter_map(|o| list_item(o))
                    .flat_map(|item| {
                        occ.get(item)
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter(|r| r["step"].as_i64() == Some(k))
                            .cloned()
                    })
                    .collect();
                if entries.is_empty() && rows.is_empty() {
                    continue;
                }
                let mut message = json!({"port": name, "step": k, "t": k * step});
                if !entries.is_empty() {
                    message["entries"] = Value::Array(entries);
                }
                if !rows.is_empty() {
                    message["rows"] = Value::Array(rows);
                }
                let delay_ns = u64::try_from(started.elapsed().as_nanos()).ok();
                if let Some(r) = self.ports.ports.get_mut(&key) {
                    r.received.push(Received {
                        at: host,
                        message,
                        delay_ns,
                    });
                }
            }
        }
        let _ = doc;
    }

    /// Your control input on a panel playing a piece: one entry on the document's input track, at
    /// the first step not yet run or the play's own time, whichever is later (Input track).
    pub(crate) fn piece_press(
        &mut self,
        panel: &str,
        event: &deep_canvas::scope::Event,
    ) -> Option<Value> {
        let deep_canvas::scope::Event::Control { control, value } = event else {
            return None;
        };
        self.ports.plays.get(panel)?;
        self.advance_piece(panel);
        let (serial, _) = self.route(panel, event);
        let now = self.now;
        let play = self.ports.plays.get(panel)?;
        let t = play.t_at(now).max(play.next_step * play.step);
        let doc = play.doc.clone();
        Some(
            match self.enter_quiet(&doc, control, value.clone(), t, serial) {
                Ok(entry) => json!({"serial": serial, "picks": 0, "commits": [{"gesture": serial}],
                                "appended": entry.into_iter().collect::<Vec<_>>()}),
                Err(e) => e,
            },
        )
    }

    /// The transport, the play's input track and the occurrence lists of a piece playing under a
    /// port (or none): `None` for a panel that plays no piece.
    pub(crate) fn piece_audio(&mut self, call: &crate::audio::AudioCall) -> Option<Value> {
        use crate::audio::AudioCall;
        let panel = match call {
            AudioCall::Transport { panel, .. }
            | AudioCall::Occurrences(panel)
            | AudioCall::InputTrack(panel) => panel,
            _ => return None,
        };
        self.ports.plays.get(panel)?;
        self.advance_piece(panel);
        let play = self.ports.plays.get(panel)?;
        Some(match call {
            AudioCall::Transport { from, to, .. } => {
                let frames: Vec<Value> = play
                    .frames
                    .iter()
                    .filter(|f| f.0 >= *from && f.0 < *to)
                    .map(|f| json!({"at": f.0, "t": f.1}))
                    .collect();
                let steps: Vec<Value> = play
                    .steps
                    .iter()
                    .filter(|s| s.1 >= *from && s.1 < *to)
                    .map(|s| json!({"step": s.0, "at": s.1}))
                    .collect();
                let work = play
                    .work
                    .iter()
                    .filter(|w| **w >= *from && **w < *to)
                    .count();
                json!({"transport": {"frames": frames, "steps": steps, "port_work": work}})
            }
            AudioCall::InputTrack(_) => json!({"input_track": self.track_json(&play.doc)}),
            _ => {
                let (doc, count) = (play.doc.clone(), play.next_step);
                let lists = self
                    .bake_rows(&doc, count)
                    .map(|(piece, rec)| {
                        rec.occurrences(&piece)
                            .into_iter()
                            .map(|(item, rows)| (format!("{item}.occurrences"), rows))
                            .collect::<Map<String, Value>>()
                    })
                    .unwrap_or_default();
                json!({"occurrences": lists})
            }
        })
    }
}
