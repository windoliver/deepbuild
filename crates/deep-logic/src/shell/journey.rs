//! Journeys for a game shell (Check input: shell journeys): each a script of moves (activate a control, set one,
//! back, pause, play a level) that the device the call names turns into its own inputs, one a step: keys move focus
//! and press Enter, a pad moves with its d-pad and presses south, touches tap or drag at the evaluated boxes. A move a
//! device can't make ends the run with `shell.device`. The rows are the run's; the plug-in judges them.

use serde_json::{json, Map, Value};

use super::rules::PLAYING;
use super::run::{Input, Plants, Run, Screens};
use super::{Does, Kind, Shell, CREDITS, GAME_OVER, LEVELS, PAUSE, TITLE};

/// Why a run stopped short of its script: a move its device can't make, or a refusal.
type Stop = Value;

fn device_stop(device: &str, screen: &str, control: &str, why: &str) -> Stop {
    json!({"code": "shell.device", "device": device, "screen": screen, "control": control,
           "message": format!("with {device} alone, the {screen} screen's {control} can't be operated: {why}")})
}

/// The journey's level policy: each action's level steps, and how long a level may take.
struct Policy {
    actions: Vec<(String, Vec<i64>)>,
    span: i64,
}

impl Policy {
    fn of(v: Option<&Value>) -> Policy {
        let actions = v
            .and_then(|l| l.get("actions"))
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(a, s)| {
                (
                    a.clone(),
                    s.as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_i64)
                        .collect(),
                )
            })
            .collect();
        Policy {
            actions,
            span: v
                .and_then(|l| l.get("span"))
                .and_then(Value::as_i64)
                .unwrap_or(600),
        }
    }
    fn at(&self, k: i64) -> Option<&str> {
        self.actions
            .iter()
            .find(|(_, s)| s.contains(&k))
            .map(|(a, _)| a.as_str())
    }
}

struct J<'r, 'a> {
    run: &'r mut Run<'a>,
    device: String,
}

impl<'r, 'a> J<'r, 'a> {
    fn shell(&self) -> &'a Shell {
        self.run.shell
    }

    fn tick(&mut self, input: Option<Input>) -> Result<(), Stop> {
        self.run.tick(input.as_ref())
    }

    /// Steps with no input until no transition runs.
    fn settle(&mut self) -> Result<(), Stop> {
        for _ in 0..240 {
            if self.run.transition == 0 {
                return Ok(());
            }
            self.tick(None)?;
        }
        Ok(())
    }

    fn wait(&mut self, n: i64) -> Result<(), Stop> {
        for _ in 0..n {
            self.tick(None)?;
        }
        Ok(())
    }

    fn screen_name(&self) -> String {
        self.run
            .shown()
            .map_or_else(|| "level".into(), |s| self.shell().screens[s].name.clone())
    }

    /// The control on the shown screen whose `does` matches.
    fn find(&self, matches: &dyn Fn(&Does) -> bool) -> Option<String> {
        let s = self.run.shown()?;
        self.shell().screens[s]
            .controls
            .iter()
            .find(|c| c.does.as_ref().is_some_and(matches))
            .map(|c| c.id.clone())
    }

    /// Focus moved to control `i` of the shown screen with the device's up and down, the first input focusing.
    fn focus_to(&mut self, s: usize, i: usize, name: &str) -> Result<(), Stop> {
        let (down, up) = if self.device == "pad" {
            ("down", "up")
        } else {
            ("ArrowDown", "ArrowUp")
        };
        let input = |k: &str, dev: &str| {
            if dev == "pad" {
                Input::Pad(k.into())
            } else {
                Input::Key(k.into())
            }
        };
        if !self.run.engaged {
            let dev = self.device.clone();
            self.tick(Some(input(down, &dev)))?;
        }
        let order = self.run.order(s);
        let enabled = self.run.enabled(s);
        if !enabled.get(i).copied().unwrap_or(false) {
            return Err(device_stop(
                &self.device,
                &self.shell().screens[s].name,
                name,
                "it is disabled",
            ));
        }
        let live: Vec<usize> = order.iter().copied().filter(|j| enabled[*j]).collect();
        let pos = |f: Option<usize>| f.and_then(|f| live.iter().position(|j| *j == f));
        let (Some(to), Some(from)) = (pos(Some(i)), pos(self.run.focus)) else {
            return Err(device_stop(
                &self.device,
                &self.shell().screens[s].name,
                name,
                "focus can't reach it",
            ));
        };
        let n = live.len();
        let fwd = (to + n - from) % n;
        let (key, count) = if fwd <= n - fwd {
            (down, fwd)
        } else {
            (up, n - fwd)
        };
        for _ in 0..count {
            let dev = self.device.clone();
            self.tick(Some(input(key, &dev)))?;
        }
        if self.run.focus != Some(i) {
            return Err(device_stop(
                &self.device,
                &self.shell().screens[s].name,
                name,
                "focus didn't reach it",
            ));
        }
        Ok(())
    }

    fn center(&mut self, s: usize, i: usize, name: &str) -> Result<[f64; 4], Stop> {
        self.run.control_boxes(s)[i].ok_or_else(|| {
            device_stop(
                &self.device,
                &self.shell().screens[s].name,
                name,
                "it has no evaluated box to touch",
            )
        })
    }

    /// Activates control `id` on the shown screen with the device, then waits out any transition.
    fn activate(&mut self, id: &str) -> Result<(), Stop> {
        let s = self.run.shown().ok_or_else(
            || json!({"code": "shell.device", "message": format!("no screen shows {id}")}),
        )?;
        let i = self.shell().screens[s]
            .controls
            .iter()
            .position(|c| c.id == id)
            .expect("a control the script found");
        let kind = self.shell().screens[s].controls[i].kind;
        if self.device == "touch" {
            let b = self.center(s, i, id)?;
            if kind == Kind::DragAlong {
                return Err(device_stop(
                    "touch",
                    &self.shell().screens[s].name,
                    id,
                    "it takes a drag, not a tap",
                ));
            }
            self.tick(Some(Input::Tap([b[0] + b[2] / 2.0, b[1] + b[3] / 2.0])))?;
        } else {
            if matches!(kind, Kind::DragAlong) {
                return Err(device_stop(
                    &self.device,
                    &self.shell().screens[s].name,
                    id,
                    "it takes only a pointer drag",
                ));
            }
            self.focus_to(s, i, id)?;
            let confirm = if self.device == "pad" {
                Input::Pad("south".into())
            } else {
                Input::Key("Enter".into())
            };
            match kind {
                Kind::Slider | Kind::Choice => {
                    let right = if self.device == "pad" {
                        Input::Pad("right".into())
                    } else {
                        Input::Key("ArrowRight".into())
                    };
                    self.tick(Some(right))?;
                }
                _ => self.tick(Some(confirm))?,
            }
        }
        self.settle()
    }

    /// Sets a slider or a choice on the shown screen to the value `steps` increments (or options) above its least.
    fn set(&mut self, id: &str, steps: i64) -> Result<(), Stop> {
        let s = self.run.shown().expect("a screen shows");
        let i = self.shell().screens[s]
            .controls
            .iter()
            .position(|c| c.id == id)
            .expect("a control the script found");
        let c = self.shell().screens[s].controls[i].clone();
        let screen = self.shell().screens[s].name.clone();
        let target = match c.kind {
            Kind::Choice => (steps as f64).min(c.options.len().saturating_sub(1) as f64),
            _ => (c.range[0] + steps as f64 * c.increment).min(c.range[1]),
        };
        if self.device == "touch" {
            let b = self.center(s, i, id)?;
            let x = match c.kind {
                Kind::Choice => b[0] + (target + 0.5) / c.options.len().max(1) as f64 * b[2],
                _ => b[0] + (target - c.range[0]) / (c.range[1] - c.range[0]).max(1e-9) * b[2],
            };
            let y = b[1] + b[3] / 2.0;
            let input = if c.kind == Kind::DragAlong {
                Input::Drag(vec![[b[0] + 1.0, y], [x, y]])
            } else {
                Input::Tap([x, y])
            };
            self.tick(Some(input))?;
        } else {
            if c.kind == Kind::DragAlong {
                return Err(device_stop(
                    &self.device,
                    &screen,
                    id,
                    "it takes only a pointer drag",
                ));
            }
            self.focus_to(s, i, id)?;
            let (left, right) = if self.device == "pad" {
                ("left", "right")
            } else {
                ("ArrowLeft", "ArrowRight")
            };
            for _ in 0..64 {
                let now = self.run.value(&c);
                if (now - target).abs() < 1e-9 {
                    break;
                }
                let k = if now < target { right } else { left };
                let input = if self.device == "pad" {
                    Input::Pad(k.into())
                } else {
                    Input::Key(k.into())
                };
                self.tick(Some(input))?;
            }
        }
        if (self.run.value(&c) - target).abs() > 1e-9 {
            return Err(device_stop(
                &self.device,
                &screen,
                id,
                &format!(
                    "it reads {} where the journey set {target}",
                    self.run.value(&c)
                ),
            ));
        }
        Ok(())
    }

    /// The device's back: Escape, the pad's east button, or a tap on a control that does back.
    fn back(&mut self) -> Result<(), Stop> {
        let input = match self.device.as_str() {
            "pad" => Input::Pad("east".into()),
            "touch" => {
                if self.run.shown().is_none() {
                    let b = self.run.pause_button();
                    Input::Tap([b[0] + b[2] / 2.0, b[1] + b[3] / 2.0])
                } else {
                    let s = self.run.shown().expect("a screen shows");
                    let enabled = self.run.enabled(s);
                    let screen = &self.shell().screens[s];
                    // A Back control, or else one that goes where back would: the screen's own `back` screen.
                    let to = match screen.back {
                        super::Back::To(t) => Some(Does::Go(t)),
                        _ => None,
                    };
                    let found = screen
                        .controls
                        .iter()
                        .position(|c| c.does == Some(Does::Back))
                        .or_else(|| {
                            screen
                                .controls
                                .iter()
                                .position(|c| to.is_some() && c.does == to)
                        })
                        .filter(|i| enabled[*i]);
                    let Some(i) = found else {
                        let name = self.shell().screens[s].name.clone();
                        return Err(device_stop(
                            "touch",
                            &name,
                            "back",
                            "the screen has no Back control to tap",
                        ));
                    };
                    let id = self.shell().screens[s].controls[i].id.clone();
                    let b = self.center(s, i, &id)?;
                    Input::Tap([b[0] + b[2] / 2.0, b[1] + b[3] / 2.0])
                }
            }
            _ => Input::Key("Escape".into()),
        };
        self.tick(Some(input))?;
        self.settle()
    }

    /// The device's pause in a level: Escape, the pad's start, or a tap on the shell's pause button.
    fn pause(&mut self) -> Result<(), Stop> {
        let input = match self.device.as_str() {
            "pad" => Input::Pad(
                self.shell()
                    .pause
                    .pad
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "start".into()),
            ),
            "touch" => {
                let b = self.run.pause_button();
                Input::Tap([b[0] + b[2] / 2.0, b[1] + b[3] / 2.0])
            }
            _ => Input::Key(
                self.shell()
                    .pause
                    .keys
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "Escape".into()),
            ),
        };
        self.tick(Some(input))?;
        self.settle()
    }

    /// The device's input for a level's action at its next step.
    fn action(&self, name: &str) -> Result<Input, Stop> {
        let level = self.run.level.as_ref().expect("a level plays");
        let words = super::level_words(&self.shell().levels, level.index);
        let a = level.actions.iter().find(|a| a.name == name);
        let input = match self.device.as_str() {
            "pad" => a.and_then(|a| a.pad.first()).map(|p| Input::Pad(p.clone())),
            "touch" => level
                .zones
                .iter()
                .find(|(z, _)| z == name)
                .map(|(_, b)| Input::Tap([b[0] + b[2] / 2.0, b[1] + b[3] / 2.0])),
            _ => a
                .and_then(|a| a.keys.first())
                .map(|k| Input::Key(k.clone())),
        };
        input.ok_or_else(|| {
            device_stop(
                &self.device,
                &words,
                name,
                "the level gives the device no way to take this action",
            )
        })
    }

    /// Plays the loaded level with the policy until it is left, or until its own step `until`.
    fn play(&mut self, policy: &Policy, until: Option<i64>) -> Result<(), Stop> {
        self.settle()?;
        let start = self.run.step;
        while self.run.level.is_some() && self.run.state.screen == PLAYING {
            let k = self.run.level.as_ref().map_or(0, |l| l.steps);
            if until.is_some_and(|u| k >= u)
                || self.run.step - start > policy.span + until.unwrap_or(0) + 240
            {
                break;
            }
            let input = policy.at(k).map(|a| self.action(a)).transpose()?;
            self.tick(input)?;
        }
        self.settle()
    }

    /// From the title to a screen by its `go` controls, breadth first; a level, pause or game over by playing.
    fn reach(&mut self, target: usize, policy: &Policy) -> Result<bool, Stop> {
        if target == TITLE as usize {
            return Ok(true);
        }
        if target == PAUSE as usize {
            self.enter(0)?;
            if self.run.level.is_none() {
                return Ok(false);
            }
            self.pause()?;
            return Ok(self.run.shown() == Some(PAUSE as usize));
        }
        // A path of screens by `go`, breadth first from the title.
        let shell = self.shell();
        let mut prev: Vec<Option<(usize, String)>> = vec![None; shell.screens.len()];
        let mut seen = vec![false; shell.screens.len()];
        seen[0] = true;
        let mut queue = std::collections::VecDeque::from([0usize]);
        while let Some(s) = queue.pop_front() {
            for c in &shell.screens[s].controls {
                if let Some(Does::Go(t)) = &c.does {
                    if !seen[*t] {
                        seen[*t] = true;
                        prev[*t] = Some((s, c.id.clone()));
                        queue.push_back(*t);
                    }
                }
            }
        }
        if !seen[target] {
            if target == GAME_OVER as usize && self.shell().levels.iter().any(|l| l.lost.is_some())
            {
                // Game over comes only from a lost level: level 1 entered and played with no input until it is left.
                self.enter(0)?;
                let idle = Policy {
                    actions: Vec::new(),
                    span: policy.span,
                };
                self.play(&idle, None)?;
                return Ok(self.run.shown() == Some(GAME_OVER as usize));
            }
            return Ok(false);
        }
        let mut path = Vec::new();
        let mut at = target;
        while let Some((p, c)) = prev[at].clone() {
            path.push(c);
            at = p;
        }
        for c in path.into_iter().rev() {
            self.activate(&c)?;
        }
        Ok(self.run.shown() == Some(target))
    }

    /// Enters level `l` from the title: its start there, or the level select's.
    fn enter(&mut self, l: usize) -> Result<(), Stop> {
        let starts = |d: &Does| {
            matches!(d, Does::Start(Some(x)) if *x == l)
                || (l == 0 && matches!(d, Does::Start(None)))
        };
        if let Some(c) = self.find(&starts) {
            return self.activate(&c);
        }
        if let Some(c) = self.find(&|d| *d == Does::Go(LEVELS as usize)) {
            self.activate(&c)?;
        }
        if let Some(c) = self.find(&starts) {
            return self.activate(&c);
        }
        if let Some(sel) = self.find(&|d| *d == Does::Select(l)) {
            self.activate(&sel)?;
            if let Some(c) = self.find(&|d| matches!(d, Does::Start(None))) {
                return self.activate(&c);
            }
        }
        Err(
            json!({"code": "shell.unlock", "message": format!("from the {} screen no control enters {}", self.screen_name(), super::level_words(&self.shell().levels, l))}),
        )
    }
}

/// The journey the call names, played with its device at its size.
pub fn play(
    shell: &Shell,
    stored: &dyn Fn(&str) -> Option<Vec<u8>>,
    call: &Value,
    screens: &mut dyn Screens,
    plants: Plants,
) -> Result<Value, Value> {
    let spec = call.get("shell").cloned().unwrap_or(json!({}));
    let journey = spec
        .get("journey")
        .and_then(Value::as_str)
        .unwrap_or("title_to_level")
        .to_string();
    let device = spec
        .get("device")
        .and_then(Value::as_str)
        .unwrap_or("keys")
        .to_string();
    if !["keys", "pad", "touch"].contains(&device.as_str()) {
        return Err(
            json!({"ok": false, "code": "bad_input", "what": "shell.device is keys, pad or touch"}),
        );
    }
    let size = spec
        .get("size")
        .and_then(Value::as_array)
        .and_then(|a| Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?]))
        .unwrap_or([1512.0, 982.0]);
    let policy = Policy::of(spec.get("level"));
    let mut run = Run::new(shell, stored, screens, plants, size);
    // #3605: the shell's profile record, read at its start unless the viewer started fresh (a relaunch journey's
    // `launch: fresh`).
    run.keeper = super::profile::Keeper::new(call, plants.done_in_save);
    let fresh = call.get("fresh") == Some(&Value::Bool(true))
        || spec.get("launch").and_then(Value::as_str) == Some("fresh");
    let profile = run.keeper.open(shell, &mut run.state, fresh);
    let mut extra = Map::new();
    let stopped = {
        let mut j = J {
            run: &mut run,
            device: device.clone(),
        };
        script(&mut j, &journey, &spec, &policy, &mut extra)
    };
    // Each screen's controls' and texts' boxes at the size, and its frame there.
    let mut shown = Map::new();
    for (s, screen) in shell.screens.iter().enumerate() {
        let (items, unevaluated) = match run.items(s) {
            Ok(i) => (i, None),
            Err(e) => (Default::default(), Some(e)),
        };
        let enabled = run.enabled(s);
        let controls: Map<String, Value> = screen
            .controls
            .iter()
            .zip(&enabled)
            .map(|(c, e)| {
                let kind = match c.kind {
                    Kind::Press => "press",
                    Kind::Toggle => "toggle",
                    Kind::Slider => "slider",
                    Kind::Choice => "choice",
                    Kind::DragAlong => "drag_along",
                };
                let does = c.does.as_ref().map(|d| match d {
                    Does::Go(t) => format!("go {}", shell.screens[*t].name),
                    Does::Start(Some(l)) => format!("start {l}"),
                    Does::Start(None) => "start selected".into(),
                    Does::Select(l) => format!("select {l}"),
                    Does::Resume => "resume".into(),
                    Does::Back => "back".into(),
                    Does::Quit => "quit".into(),
                    Does::Set(f) => format!("set {f}"),
                });
                (c.id.clone(), json!({"box": items.get(&c.item), "enabled": e, "kind": kind, "item": c.item,
                                      "text": c.text.as_ref().and_then(|t| items.get(t)), "does": does}))
            })
            .collect();
        // #3605: each screen as the shell's arrays left it at the play's last step: its frame and what its texts show.
        let doc = run.prompted(s);
        let frame = run.screens.frame(&doc, size, 0.0);
        let texts = run.screens.texts(&doc, size).unwrap_or_default();
        let mut v = json!({"controls": controls, "frame": frame, "size": size, "texts": texts,
                           "items": items.iter().map(|(k, b)| (k.clone(), json!(b))).collect::<Map<_, _>>()});
        if let Some(e) = screen.ends {
            v["ends"] = json!(e);
        }
        if !screen.prompts.is_empty() {
            v["prompts"] = screen
                .prompts
                .iter()
                .map(|p| (p.item.clone(), json!({"action": p.action})))
                .collect::<Map<_, _>>()
                .into();
        }
        if let super::Back::Nothing = screen.back {
            v["back"] = json!("none");
        }
        // A screen whose document the canvas doesn't evaluate gives no boxes, and says why.
        if let Some(e) = unevaluated {
            v["unevaluated"] = e;
        }
        shown.insert(screen.name.clone(), v);
    }
    // The level still loaded at the end gives its track so far, too.
    if let Some(l) = run.level.as_ref() {
        let t = l.given_track();
        run.tracks.push(t);
    }
    let recording = extra.remove("recording").filter(|r| !r.is_null());
    let mut out = json!({
        "journey": journey, "device": device, "size": size,
        "steps": run.rows, "screens": shown, "entered": run.entered, "carry": run.carry,
        "track": run.track, "refused": null, "stopped": stopped.err(), "recording": recording,
        "levels": shell.levels.len(),
        "profile": profile, "profiles": run.keeper.written, "level_tracks": run.tracks,
        "completions": run.completions,
    });
    for (k, v) in extra {
        out[k] = v;
    }
    Ok(json!({"shell": out}))
}

/// A journey's moves, as its device plays them.
fn script(
    j: &mut J,
    journey: &str,
    spec: &Value,
    policy: &Policy,
    extra: &mut Map<String, Value>,
) -> Result<(), Stop> {
    j.tick(None)?;
    match journey {
        "title_to_level" => {
            j.enter(0)?;
            j.wait(30)?;
            for _ in 0..4 {
                if j.run.shown() == Some(TITLE as usize) {
                    break;
                }
                j.back()?;
            }
        }
        "unlock" | "carry" => {
            if let Some(c) = j.find(&|d| *d == Does::Go(LEVELS as usize)) {
                j.activate(&c)?;
            }
            j.enter(0)?;
            if journey == "carry" {
                // The carry journey keeps the scene change from level 1 to level 2 as one recording, from 20 steps
                // before level 1's last press.
                let last = policy
                    .actions
                    .iter()
                    .flat_map(|(_, s)| s.iter().copied())
                    .max()
                    .unwrap_or(0);
                j.play(policy, Some((last - 20).max(0)))?;
                j.run.keep_frames = true;
            }
            j.play(policy, None)?;
            if journey == "carry" && j.shell().levels.len() > 1 {
                j.enter(1)?;
                j.wait(30)?;
                j.run.keep_frames = false;
                let frames = std::mem::take(&mut j.run.frames);
                if let Some(r) = j.run.screens.recording(&frames) {
                    extra.insert("recording".into(), json!(r));
                }
            }
        }
        "pause" => {
            // One play a call: never paused with `paused: false`, else paused at `at` and held `hold` seconds.
            let at = spec
                .pointer("/pause/at")
                .and_then(Value::as_i64)
                .unwrap_or(1200);
            let hold = spec
                .pointer("/pause/hold")
                .and_then(Value::as_f64)
                .unwrap_or(30.0);
            let to = spec
                .pointer("/pause/to")
                .and_then(Value::as_i64)
                .unwrap_or(3600);
            j.enter(0)?;
            if spec.get("paused") == Some(&Value::Bool(false)) {
                j.play(policy, Some(to))?;
            } else {
                j.play(policy, Some(at))?;
                j.pause()?;
                j.wait((hold * 60.0).round() as i64)?;
                match j.find(&|d| *d == Does::Resume) {
                    Some(c) => j.activate(&c)?,
                    None => {
                        let device = j.device.clone();
                        return Err(device_stop(
                            &device,
                            "pause",
                            "resume",
                            "the pause screen has no Resume control",
                        ));
                    }
                }
                j.play(policy, Some(to))?;
            }
        }
        "credits" => {
            let Some(c) = j.find(&|d| *d == Does::Go(CREDITS as usize)) else {
                return Err(
                    json!({"code": "shell.credits", "message": "the title has no control that goes to the credits"}),
                );
            };
            j.activate(&c)?;
            let ends = j.shell().screens[CREDITS as usize].ends.unwrap_or(0);
            j.wait(ends + 1)?;
            j.back()?;
        }
        "back" => {
            let n = j.shell().screens.len();
            for target in (1..n).chain([usize::MAX]) {
                j.run.reset();
                let name = if target == usize::MAX {
                    "level".to_string()
                } else {
                    j.shell().screens[target].name.clone()
                };
                j.run.from = Some(name.clone());
                j.tick(None)?;
                let reached = if target == usize::MAX {
                    j.enter(0)?;
                    j.wait(10)?;
                    j.run.level.is_some()
                } else {
                    j.reach(target, policy)?
                };
                if !reached {
                    continue;
                }
                j.run.control = Some("back".into());
                for _ in 0..4 {
                    if j.run.shown() == Some(TITLE as usize) {
                        break;
                    }
                    if let Err(e) = j.back() {
                        extra
                            .entry("unreached")
                            .or_insert(json!([]))
                            .as_array_mut()
                            .expect("a list")
                            .push(json!({"from": name, "stop": e}));
                        break;
                    }
                }
                j.run.control = None;
            }
        }
        "focus" | "prompts" | "wired" => {
            let n = j.shell().screens.len();
            for target in 0..n {
                let name = j.shell().screens[target].name.clone();
                let ids: Vec<String> = j.shell().screens[target]
                    .controls
                    .iter()
                    .map(|c| c.id.clone())
                    .collect();
                let sub: Vec<Option<String>> = if journey == "wired" {
                    ids.into_iter().map(Some).collect()
                } else {
                    vec![None]
                };
                for control in sub {
                    j.run.reset();
                    j.run.from = Some(name.clone());
                    j.run.control = None;
                    j.tick(None)?;
                    if !j.reach(target, policy)? {
                        break;
                    }
                    match (journey, control) {
                        ("wired", Some(c)) => {
                            let i = j.shell().screens[target]
                                .controls
                                .iter()
                                .position(|x| x.id == c)
                                .expect("its control");
                            if !j.run.enabled(target)[i] {
                                continue;
                            }
                            j.run.control = Some(c.clone());
                            j.tick(None)?;
                            let budget = spec.get("budget").and_then(Value::as_i64).unwrap_or(30);
                            let r = match j.shell().screens[target].controls[i].kind {
                                Kind::Slider | Kind::Choice | Kind::DragAlong => j.set(&c, 1),
                                _ => j.activate(&c),
                            };
                            if let Err(e) = r {
                                extra
                                    .entry("unreached")
                                    .or_insert(json!([]))
                                    .as_array_mut()
                                    .expect("a list")
                                    .push(json!({"from": name, "control": c, "stop": e}));
                            }
                            j.wait(budget)?;
                        }
                        ("focus", _) => focus_walk(j, target)?,
                        _ => prompts_walk(j, target)?,
                    }
                }
            }
        }
        "layout" => {}
        // #3605: a script of moves, each with the run's device; a relaunch journey's first launch plays them too.
        "moves" | "relaunch" => {
            for m in spec
                .get("moves")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                moved(j, m, policy)?;
            }
        }
        other => {
            return Err(json!({"code": "bad_input", "message": format!("no journey {other}")}))
        }
    }
    Ok(())
}

/// #3605: one move of a `moves` journey, made with the run's device and ended with any transition settled.
fn moved(j: &mut J, m: &Value, policy: &Policy) -> Result<(), Stop> {
    if let Some(id) = m.get("activate").and_then(Value::as_str) {
        let known = j
            .run
            .shown()
            .is_some_and(|s| j.shell().screens[s].controls.iter().any(|c| c.id == id));
        if !known {
            let screen = j.screen_name();
            return Err(
                json!({"code": "shell.device", "screen": screen, "control": id,
                "message": format!("the {screen} screen shows no control {id} to activate")}),
            );
        }
        return j.activate(id);
    }
    if let Some(id) = m.get("set").and_then(Value::as_str) {
        let control = j.run.shown().and_then(|s| {
            j.shell().screens[s]
                .controls
                .iter()
                .find(|c| c.id == id)
                .cloned()
        });
        let Some(c) = control else {
            let screen = j.screen_name();
            return Err(
                json!({"code": "shell.device", "screen": screen, "control": id,
                "message": format!("the {screen} screen shows no control {id} to set")}),
            );
        };
        let want = m.get("value").and_then(Value::as_f64).unwrap_or(0.0);
        // A choice is set to the option that holds the value; a slider to its increments above its least.
        let steps = match c.kind {
            Kind::Choice => c.options.iter().position(|o| o.as_f64() == Some(want)).ok_or_else(|| {
                json!({"code": "shell.device", "control": id, "message": format!("{id} has no option {want}")})
            })? as i64,
            _ => ((want - c.range[0]) / c.increment.max(1e-9)).round() as i64,
        };
        j.set(id, steps)?;
        return j.settle();
    }
    if m.get("back").is_some() {
        return j.back();
    }
    if m.get("pause").is_some() {
        return j.pause();
    }
    match m.get("play") {
        // Until its step k has run: k + 1 steps.
        Some(Value::Number(k)) => j.play(policy, Some(k.as_i64().unwrap_or(0) + 1)),
        Some(_) => j.play(policy, None),
        None => Err(json!({"code": "bad_input", "message": format!("no move {m}")})),
    }
}

/// On screen `s`: the first input, then the device's down through every control and each setting changed in turn.
fn focus_walk(j: &mut J, s: usize) -> Result<(), Stop> {
    if j.device == "touch" {
        return Ok(());
    }
    let n = j.shell().screens[s].controls.len();
    let down = if j.device == "pad" {
        Input::Pad("down".into())
    } else {
        Input::Key("ArrowDown".into())
    };
    j.tick(Some(down.clone()))?;
    for _ in 0..n {
        j.tick(Some(down.clone()))?;
        if j.run.shown() != Some(s) {
            return Ok(());
        }
        // A toggle or a setting on the focused control, which may disable another.
        if let Some(f) = j.run.focus {
            let c = j.shell().screens[s].controls[f].clone();
            if matches!(c.does, Some(Does::Set(_))) {
                let input = match (c.kind, j.device.as_str()) {
                    (Kind::Toggle, "pad") => Input::Pad("south".into()),
                    (Kind::Toggle, _) => Input::Key("Enter".into()),
                    (_, "pad") => Input::Pad("right".into()),
                    _ => Input::Key("ArrowRight".into()),
                };
                j.tick(Some(input))?;
                j.wait(2)?;
            }
        }
    }
    j.wait(2)
}

/// On screen `s`: the run's device's neutral input a few times, each held a few steps, so each prompt's glyph can follow
/// it: keys and a pad move focus down, touches tap where no control is.
fn prompts_walk(j: &mut J, s: usize) -> Result<(), Stop> {
    if j.shell().screens[s].prompts.is_empty() {
        return Ok(());
    }
    let boxes = j.run.control_boxes(s);
    let spot = [[2.0, 2.0], [j.run.size[0] - 2.0, j.run.size[1] - 2.0]]
        .into_iter()
        .find(|p| !boxes.iter().flatten().any(|b| super::run::inside(b, *p)))
        .unwrap_or([2.0, 2.0]);
    for _ in 0..3 {
        let input = match j.device.as_str() {
            "pad" => Input::Pad("down".into()),
            "touch" => Input::Tap(spot),
            _ => Input::Key("ArrowDown".into()),
        };
        j.tick(Some(input))?;
        if j.run.shown() != Some(s) {
            return Ok(());
        }
        j.wait(3)?;
    }
    Ok(())
}
