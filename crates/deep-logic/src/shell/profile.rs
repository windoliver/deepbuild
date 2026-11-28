use std::path::PathBuf;

use serde_json::{json, Map, Value};

use super::rules::State;
use super::Shell;

const KEPT: [&str; 8] = [
    "unlocked",
    "done",
    "text_size",
    "reduced_motion",
    "volume",
    "bindings",
    "toggle",
    "custom",
];

pub struct Keeper {
    pub dir: Option<PathBuf>,
    pub done_in_save: bool,
    last: Option<Value>,
    pub written: Vec<Value>,
}

fn kind(v: &Value) -> &'static str {
    match v {
        Value::Bool(_) => "bool",
        Value::Number(n) if n.is_f64() => "f64",
        _ => "i32",
    }
}

impl Keeper {
    pub fn new(call: &Value, done_in_save: bool) -> Keeper {
        Keeper {
            dir: call
                .get("saves_dir")
                .and_then(Value::as_str)
                .map(PathBuf::from),
            done_in_save,
            last: None,
            written: Vec::new(),
        }
    }

    fn kept(&self) -> impl Iterator<Item = &'static str> + '_ {
        KEPT.iter()
            .copied()
            .filter(move |n| !(self.done_in_save && *n == "done"))
    }

    fn arrays(&self, shell: &Shell, state: &State) -> (Value, Value) {
        let all: Map<String, Value> = state
            .arrays()
            .into_iter()
            .map(|(n, v)| (n.to_string(), v))
            .collect();
        let mut arrays = Map::new();
        let mut shape = Map::new();
        for n in self.kept() {
            let v = all[n].clone();
            let list = v.as_array().cloned().unwrap_or_default();
            let ty = match n {
                "volume" | "custom" => "f64",
                "unlocked" | "done" | "reduced_motion" | "toggle" => "bool",
                _ => list.first().map_or("i32", kind),
            };
            let count = match n {
                "unlocked" | "done" => shell.levels.len(),
                _ => list.len(),
            };
            shape.insert(n.into(), json!({"type": ty, "count": count}));
            arrays.insert(n.into(), v);
        }
        (Value::Object(arrays), Value::Object(shape))
    }

    pub fn open(&mut self, shell: &Shell, state: &mut State, fresh: bool) -> Value {
        let (_, shape) = self.arrays(shell, state);
        let Some(dir) = self.dir.clone() else {
            return json!({"record": null, "damaged": [], "notices": []});
        };
        if fresh {
            self.last = Some(self.arrays(shell, state).0);
            return json!({"record": null, "damaged": [], "notices": [], "fresh": true});
        }
        let (found, damaged) = crate::profile::newest(&dir);
        let mut notices = Vec::new();
        let mut record = Value::Null;
        if let Some((hash, r)) = found {
            if r["shape"] == shape {
                apply(state, &r["arrays"]);
                record = json!(hash);
            } else {
                notices.push(json!({"code": "profile_refused", "record": hash,
                    "what": "its shape differs from this shell's; the shell starts from its defaults and the record stays"}));
            }
        }
        self.last = Some(self.arrays(shell, state).0);
        json!({"record": record, "damaged": damaged, "notices": notices})
    }

    pub fn keep(&mut self, shell: &Shell, state: &State, step: i64) {
        let Some(dir) = self.dir.clone() else { return };
        let (arrays, shape) = self.arrays(shell, state);
        if self.last.as_ref() == Some(&arrays) {
            return;
        }
        self.last = Some(arrays.clone());
        let record = json!({"shape": shape, "arrays": arrays, "step": step});
        let out = match std::fs::create_dir_all(&dir)
            .map_err(|e| e.to_string())
            .and_then(|()| crate::profile::write(&dir, &record))
        {
            Ok((hash, file)) => json!({"step": step, "hash": hash, "file": file}),
            Err(e) => json!({"ok": false, "code": "profile_failed", "step": step, "what": e}),
        };
        self.written.push(out);
    }
}

fn apply(state: &mut State, arrays: &Value) {
    let bools = |n: &str, to: &mut Vec<bool>| {
        if let Some(a) = arrays[n].as_array().filter(|a| a.len() == to.len()) {
            *to = a.iter().map(|v| v.as_bool() == Some(true)).collect();
        }
    };
    bools("unlocked", &mut state.unlocked);
    bools("done", &mut state.done);
    bools("toggle", &mut state.toggle);
    let nums = |n: &str, to: &mut Vec<f64>| {
        if let Some(a) = arrays[n].as_array().filter(|a| a.len() == to.len()) {
            *to = a.iter().map(|v| v.as_f64().unwrap_or(0.0)).collect();
        }
    };
    nums("volume", &mut state.volume);
    nums("custom", &mut state.custom);
    if let Some(a) = arrays["bindings"]
        .as_array()
        .filter(|a| a.len() == state.bindings.len())
    {
        state.bindings = a.iter().map(|v| v.as_i64().unwrap_or(-1) as i32).collect();
    }
    if let Some(t) = arrays["text_size"][0].as_i64() {
        state.text_size = t as i32;
    }
    if let Some(b) = arrays["reduced_motion"][0].as_bool() {
        state.reduced_motion = b;
    }
}
