//! What a frame shows, as locators find it: the elements with an accessibility role (the app's and a panel's
//! controls, as observed), the strings drawn (see `glyphs`), and the canvas's items. A locator is strict: it names
//! exactly one thing, or the call answers every match or none.

use std::collections::BTreeMap;

use gpui_kit::{base::test_support::snapshots, Window};
use serde_json::{json, Value};

use super::glyphs::{Glyphs, Run};
use crate::snapshot::role_name;

/// The roles of a form control, the things `{label}` names.
const CONTROLS: &[&str] = &[
    "text_input",
    "multiline_text_input",
    "search_input",
    "email_input",
    "password_input",
    "number_input",
    "phone_number_input",
    "url_input",
    "date_input",
    "date_time_input",
    "time_input",
    "check_box",
    "switch",
    "radio_button",
    "slider",
    "combo_box",
    "spin_button",
];

/// One located thing: what it is and where, in whole device pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    pub role: String,
    pub name: Option<String>,
    pub value: Option<String>,
    pub bounds: [i64; 4],
    pub visible: bool,
    pub enabled: bool,
    pub checked: Option<bool>,
    /// The string it draws, for a drawn string.
    pub text: Option<String>,
}

impl Target {
    pub fn summary(&self) -> Value {
        json!({"role": self.role, "name": self.name, "bounds": self.bounds})
    }

    pub fn center(&self) -> [i64; 2] {
        let [x, y, w, h] = self.bounds;
        [x + w / 2, y + h / 2]
    }
}

/// One frame, read for locating.
pub struct Frame {
    pub elements: Vec<Target>,
    pub runs: Vec<Run>,
    pub items: Vec<(String, Value)>,
    /// Where each canvas item was drawn, in device pixels.
    placed: BTreeMap<String, [i64; 4]>,
    pub scale: f32,
}

/// Why a locator found nothing to act on.
pub enum Miss {
    /// Not a locator: the words say what's wrong.
    Bad(String),
    None,
    Ambiguous(Vec<Target>),
}

impl Frame {
    pub fn read(window: &Window, glyphs: &Glyphs) -> Frame {
        let scale = window.scale_factor();
        let device = |v: gpui_kit::Pixels| (f32::from(v) * scale).round() as i64;
        let elements = snapshots(window)
            .into_iter()
            .filter_map(|e| {
                let role = role_name(e.role()?);
                let b = e.bounds();
                Some(Target {
                    role,
                    name: e.label().map(str::to_owned),
                    value: e.value().map(str::to_owned),
                    bounds: [
                        device(b.origin.x),
                        device(b.origin.y),
                        device(b.size.width),
                        device(b.size.height),
                    ],
                    visible: e.visible(),
                    enabled: e.disabled() != Some(true),
                    checked: e.checked(),
                    text: None,
                })
            })
            .collect();
        let placed = deep_app::canvas::placed()
            .into_iter()
            .map(|(id, b)| {
                let bounds = [b.origin.x, b.origin.y, b.size.width, b.size.height].map(device);
                (id, bounds)
            })
            .collect();
        Frame {
            elements,
            runs: glyphs.runs(),
            items: deep_app::canvas::items(),
            placed,
            scale,
        }
    }

    /// Every visible thing the locator names, in reading order.
    pub fn all(&self, locator: &Value) -> Result<Vec<Target>, String> {
        let form = form(locator)?;
        let visible = self.elements.iter().filter(|e| e.visible);
        let mut found: Vec<Target> = match form {
            Form::Role(role, name) => visible
                .filter(|e| {
                    role.is_none_or(|r| e.role == r)
                        && name.is_none_or(|n| e.name.as_deref() == Some(n))
                })
                .cloned()
                .collect(),
            Form::Handle(handle) => visible
                .filter(|e| e.name.as_deref() == Some(handle))
                .cloned()
                .collect(),
            Form::Text(text) => self
                .texts()
                .filter(|t| t.text.as_deref() == Some(text))
                .collect(),
            Form::Label(label) => {
                let named: Vec<Target> = visible
                    .filter(|e| {
                        CONTROLS.contains(&e.role.as_str()) && e.name.as_deref() == Some(label)
                    })
                    .cloned()
                    .collect();
                if named.is_empty() {
                    self.labelled(label)
                } else {
                    named
                }
            }
            Form::Item(id) => self
                .items
                .iter()
                .filter(|(item, _)| {
                    item == id || id.split_once('#').is_some_and(|(base, _)| base == item)
                })
                .map(|(item, value)| Target {
                    role: "canvas_item".into(),
                    name: Some(item.clone()),
                    value: Some(value.to_string()),
                    bounds: self.placed.get(item).copied().unwrap_or_default(),
                    visible: true,
                    enabled: true,
                    checked: None,
                    text: None,
                })
                .collect(),
        };
        found.sort_by_key(|t| (t.bounds[1], t.bounds[0]));
        found.dedup();
        Ok(found)
    }

    /// The one thing the locator names.
    pub fn one(&self, locator: &Value) -> Result<Target, Miss> {
        let mut found = self.all(locator).map_err(Miss::Bad)?;
        match found.len() {
            0 => Err(Miss::None),
            1 => Ok(found.remove(0)),
            _ => Err(Miss::Ambiguous(found)),
        }
    }

    /// The drawn strings that show, as targets.
    pub fn texts(&self) -> impl Iterator<Item = Target> + '_ {
        self.runs.iter().filter(|r| r.visible).map(|r| Target {
            role: "text_run".into(),
            name: Some(r.text.clone()),
            value: None,
            bounds: r.bounds,
            visible: true,
            enabled: true,
            checked: None,
            text: Some(r.text.clone()),
        })
    }

    /// The text drawn inside `bounds`, top to bottom and left to right, joined by spaces.
    pub fn text_inside(&self, bounds: [i64; 4]) -> String {
        let mut inside: Vec<&Run> = self
            .runs
            .iter()
            .filter(|r| r.visible && contains(bounds, r.bounds))
            .collect();
        inside.sort_by_key(|r| (r.bounds[1], r.bounds[0]));
        inside
            .iter()
            .map(|r| r.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// The form controls whose visible label is `label`: for each string `label` drawn, the nearest control after
    /// it, below it or to its right, within a few lines of it.
    fn labelled(&self, label: &str) -> Vec<Target> {
        let controls: Vec<&Target> = self
            .elements
            .iter()
            .filter(|e| e.visible && CONTROLS.contains(&e.role.as_str()))
            .collect();
        self.runs
            .iter()
            .filter(|r| r.visible && r.text == label)
            .filter_map(|r| {
                let [x, y, w, h] = r.bounds;
                controls
                    .iter()
                    .filter(|c| {
                        let [cx, cy, _, ch] = c.bounds;
                        let after = cy >= y + h / 2 || (cx >= x + w && cy < y + h && cy + ch > y);
                        after && cy - (y + h) <= 4 * h
                    })
                    .min_by_key(|c| ((c.bounds[1] - y).max(0), (c.bounds[0] - x).abs()))
                    .map(|c| (*c).clone())
            })
            .collect()
    }
}

enum Form<'a> {
    Role(Option<&'a str>, Option<&'a str>),
    Item(&'a str),
    Handle(&'a str),
    Text(&'a str),
    Label(&'a str),
}

/// A locator's one form: `{role, name}` (either may be null, not both), `{item}`, `{handle}`, `{text}` or `{label}`.
fn form(locator: &Value) -> Result<Form<'_>, String> {
    let Some(fields) = locator.as_object() else {
        return Err(format!("a locator is an object, not {locator}"));
    };
    let set: Vec<(&String, &Value)> = fields.iter().filter(|(_, v)| !v.is_null()).collect();
    let text = |key: &str| -> Result<Option<&str>, String> {
        match fields.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) => Ok(Some(s.as_str())),
            Some(other) => Err(format!("a locator's {key} is a string, not {other}")),
        }
    };
    let keys: Vec<&str> = set.iter().map(|(k, _)| k.as_str()).collect();
    match keys.as_slice() {
        ["role"] | ["name"] | ["name", "role"] | ["role", "name"] => Ok(Form::Role(text("role")?, text("name")?)),
        ["item"] => Ok(Form::Item(text("item")?.unwrap_or_default())),
        ["handle"] => Ok(Form::Handle(text("handle")?.unwrap_or_default())),
        ["text"] => Ok(Form::Text(text("text")?.unwrap_or_default())),
        ["label"] => Ok(Form::Label(text("label")?.unwrap_or_default())),
        _ => Err(format!(
            "a locator has one form, {{role, name}}, {{item}}, {{handle}}, {{text}} or {{label}}; this one has {keys:?}"
        )),
    }
}

pub fn contains(outer: [i64; 4], inner: [i64; 4]) -> bool {
    inner[0] >= outer[0]
        && inner[1] >= outer[1]
        && inner[0] + inner[2] <= outer[0] + outer[2]
        && inner[1] + inner[3] <= outer[1] + outer[3]
}
