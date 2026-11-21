//! The shell item's arrays and its first-party rules (Recipe: shell@1 game shell): what an activation, back, pause,
//! a completed level and a lost one do to which screen and level are active, `opened_by`, what is unlocked and the
//! settings. Nothing here reads which device wrote an entry, focus or a prompt's glyph.

use serde_json::{json, Value};
use sha2::Digest as _;

use super::{Does, Kind, Shell, DEPTH, GAME_OVER, IN_LEVEL, LEVELS, PAUSE, TITLE};

/// The shown screen while a level plays, and after quit.
pub const PLAYING: i32 = -1;
pub const QUIT: i32 = -3;

#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub screen: i32,
    pub level: i32,
    pub selected: i32,
    pub unlocked: Vec<bool>,
    pub paused: bool,
    pub opened_by: [i32; DEPTH],
    pub text_size: i32,
    pub reduced_motion: bool,
    pub volume: Vec<f64>,
    pub bindings: Vec<i32>,
    pub toggle: Vec<bool>,
}

/// What a rule asks of the run beyond the arrays: a level to load or to leave.
#[derive(Debug, PartialEq)]
pub enum Then {
    Nothing,
    Load(usize),
    Leave,
}

/// A key's or a pad button's code in `bindings`: its place in this list, pad buttons from 1000.
const KEYS: [&str; 14] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Space", "Escape", "Tab", "KeyW", "KeyA", "KeyS", "KeyD", "KeyJ", "KeyK"];
const PADS: [&str; 16] = ["south", "east", "west", "north", "l1", "r1", "l2", "r2", "select", "start", "l3", "r3", "up", "down", "left", "right"];

fn code(name: &str) -> i32 {
    KEYS.iter()
        .position(|k| *k == name)
        .map(|i| i as i32)
        .or_else(|| PADS.iter().position(|p| *p == name).map(|i| 1000 + i as i32))
        .unwrap_or(-1)
}

impl State {
    pub fn new(shell: &Shell) -> State {
        let n = shell.levels.len();
        let bindings = shell
            .settings
            .bindings
            .iter()
            .flat_map(|(_, b)| (0..2).map(|j| b.get(j).map_or(-1, |k| code(k))))
            .collect();
        State {
            screen: TITLE,
            level: -1,
            selected: 0,
            unlocked: (0..n).map(|i| shell.unlocked.contains(&i)).collect(),
            paused: false,
            opened_by: [-1; DEPTH],
            text_size: shell.settings.text_size[0] as i32,
            reduced_motion: shell.settings.reduced_motion,
            volume: shell.settings.volume.iter().map(|(_, v)| *v).collect(),
            bindings,
            toggle: vec![false; shell.settings.toggle.len()],
        }
    }

    /// The arrays by name, as a logic item's read (`<shell ID>.<name>`).
    pub fn arrays(&self) -> Vec<(&'static str, Value)> {
        vec![
            ("screen", json!([self.screen])),
            ("level", json!([self.level])),
            ("selected", json!([self.selected])),
            ("unlocked", json!(self.unlocked)),
            ("paused", json!([self.paused])),
            ("opened_by", json!(self.opened_by)),
            ("text_size", json!([self.text_size])),
            ("reduced_motion", json!([self.reduced_motion])),
            ("volume", json!(self.volume)),
            ("bindings", json!(self.bindings)),
            ("toggle", json!(self.toggle)),
        ]
    }

    /// SHA-256 over the arrays and, while a level is loaded, the level's full-state hash.
    pub fn hash(&self, level: Option<&str>) -> String {
        let mut b = Vec::new();
        for (name, v) in self.arrays() {
            b.extend(name.as_bytes());
            b.push(b'=');
            b.extend(v.to_string().as_bytes());
            b.push(b'\n');
        }
        if let Some(l) = level {
            b.extend(b"level=");
            b.extend(l.as_bytes());
        }
        sha2::Sha256::digest(&b).iter().map(|x| format!("{x:02x}")).collect()
    }

    fn push(&mut self, s: i32) {
        if let Some(slot) = self.opened_by.iter_mut().find(|x| **x == -1) {
            *slot = s;
        } else {
            self.opened_by.rotate_left(1);
            self.opened_by[DEPTH - 1] = s;
        }
    }

    fn pop(&mut self) -> Option<i32> {
        let top = self.opened_by.iter().rposition(|x| *x != -1)?;
        let s = self.opened_by[top];
        self.opened_by[top] = -1;
        Some(s)
    }

    /// The screen a level was entered from, as `opened_by` holds it below the level.
    fn leave_level(&mut self) -> i32 {
        if self.opened_by.iter().rev().find(|x| **x != -1) == Some(&IN_LEVEL) {
            self.pop();
        }
        self.paused = false;
        self.level = -1;
        self.pop().filter(|s| *s >= 0).unwrap_or(TITLE)
    }

    pub fn go(&mut self, to: i32) {
        self.push(self.screen);
        self.screen = to;
    }

    /// Back (Recipe: shell@1 game shell): in a level it opens pause; from pause it leaves the level for the screen
    /// it was entered from; elsewhere it returns through `opened_by`, unless the screen's own `back` says otherwise;
    /// on the title it does nothing.
    pub fn back(&mut self, shell: &Shell) -> Then {
        match self.screen {
            PLAYING => {
                self.pause();
                Then::Nothing
            }
            TITLE | QUIT => Then::Nothing,
            s => match &shell.screens[s as usize].back {
                super::Back::Nothing => Then::Nothing,
                super::Back::To(t) if s != PAUSE => {
                    self.screen = *t as i32;
                    if *t as i32 == TITLE {
                        self.opened_by = [-1; DEPTH];
                    }
                    Then::Nothing
                }
                _ => match self.pop() {
                    Some(IN_LEVEL) => {
                        self.push(IN_LEVEL);
                        self.screen = self.leave_level();
                        Then::Leave
                    }
                    Some(t) if t >= 0 => {
                        self.screen = t;
                        Then::Nothing
                    }
                    _ => {
                        self.screen = TITLE;
                        Then::Nothing
                    }
                },
            },
        }
    }

    /// The pause input: in a level it opens pause, on pause it resumes, elsewhere nothing.
    pub fn pause_input(&mut self) {
        match self.screen {
            PLAYING => self.pause(),
            PAUSE if self.level >= 0 => self.resume(),
            _ => {}
        }
    }

    fn pause(&mut self) {
        self.push(IN_LEVEL);
        self.screen = PAUSE;
        self.paused = true;
    }

    fn resume(&mut self) {
        if self.level < 0 {
            return;
        }
        while let Some(s) = self.pop() {
            if s == IN_LEVEL {
                break;
            }
        }
        self.screen = PLAYING;
        self.paused = false;
    }

    /// An activation of a control on the shown screen, with its value (a slider's, a choice's index or a toggle's).
    pub fn activate(&mut self, shell: &Shell, control: &super::Control, value: Option<f64>) -> Then {
        let Some(does) = &control.does else {
            return Then::Nothing;
        };
        match does {
            Does::Go(s) => {
                self.go(*s as i32);
                Then::Nothing
            }
            Does::Start(which) => {
                let l = which.unwrap_or(self.selected.max(0) as usize);
                if !self.unlocked.get(l).copied().unwrap_or(false) {
                    return Then::Nothing;
                }
                if self.level >= 0 {
                    // Starting again from pause leaves the level that was playing first.
                    self.screen = self.leave_level();
                }
                self.push(self.screen);
                self.screen = PLAYING;
                self.level = l as i32;
                self.selected = l as i32;
                Then::Load(l)
            }
            Does::Select(l) => {
                if self.unlocked.get(*l).copied().unwrap_or(false) {
                    self.selected = *l as i32;
                }
                Then::Nothing
            }
            Does::Resume => {
                self.resume();
                Then::Nothing
            }
            Does::Back => self.back(shell),
            Does::Quit => {
                let leaving = self.level >= 0;
                self.level = -1;
                self.paused = false;
                self.opened_by = [-1; DEPTH];
                self.screen = QUIT;
                if leaving {
                    Then::Leave
                } else {
                    Then::Nothing
                }
            }
            Does::Set(field) => {
                let v = value.unwrap_or(match control.kind {
                    Kind::Toggle => 1.0,
                    _ => 0.0,
                });
                self.set(shell, field, control, v);
                Then::Nothing
            }
        }
    }

    fn set(&mut self, shell: &Shell, field: &str, control: &super::Control, v: f64) {
        match field.split_once('.') {
            None if field == "text_size" => {
                let options = &shell.settings.text_size;
                self.text_size = match control.kind {
                    Kind::Choice => options.get(v.max(0.0) as usize).copied().unwrap_or(options[0]) as i32,
                    _ => v as i32,
                };
            }
            None if field == "reduced_motion" => {
                self.reduced_motion = match control.kind {
                    Kind::Toggle => !self.reduced_motion,
                    _ => v != 0.0,
                }
            }
            Some(("volume", bus)) => {
                if let Some(i) = shell.settings.volume.iter().position(|(b, _)| b == bus) {
                    self.volume[i] = v;
                }
            }
            Some(("toggle", a)) => {
                if let Some(i) = shell.settings.toggle.iter().position(|t| t == a) {
                    self.toggle[i] = match control.kind {
                        Kind::Toggle => !self.toggle[i],
                        _ => v != 0.0,
                    };
                }
            }
            _ => {}
        }
    }

    /// The level completed: the next one unlocked, and the level select shown.
    pub fn completed(&mut self) {
        let l = self.level.max(0) as usize;
        if let Some(next) = self.unlocked.get_mut(l + 1) {
            *next = true;
            self.selected = (l + 1) as i32;
        }
        let from = self.leave_level();
        if from != LEVELS {
            self.push(from);
        }
        self.screen = LEVELS;
    }

    /// The level lost: game over, whose back returns to where the level was entered from.
    pub fn lost(&mut self) {
        let from = self.leave_level();
        self.push(from);
        self.screen = GAME_OVER;
    }
}
