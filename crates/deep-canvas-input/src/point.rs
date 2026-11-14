//! #540: the point control (canvas primitives: Control: point): a control of class document that
//! takes a place, not an option. This holds its fields as a document writes them, the check that
//! refuses one on `surface` with no targets, and the cells a path drag enters between two pointer
//! samples. What it meets in 3D is scene3d's (`pointer`), and the host computes each entry once,
//! at the gesture, and stores it.

use deep_canvas::document::Issue;
use serde_json::{json, Value};

/// The wrong programs of the point control the host runs, chosen only by a proof scenario's
/// `planted`.
pub const PLANTED: [&str; 7] = [
    "press_cell_next_frame",
    "box_corners_on_replay",
    "surface_hit_on_replay",
    "surface_at_rest",
    "throw_reads_camera",
    "box_keys_at_apply",
    "point_pick_one_pixel",
];

/// What a point control's entries are places on.
#[derive(Clone, Debug, PartialEq)]
pub enum On {
    /// A mark set on a grid: a cell.
    Set(String),
    /// A terrain plate: a ground point on its height samples.
    Plate(String),
    /// A level plane at y m: a ground point.
    Plane(f64),
    /// In 3D, the drawn surface of whichever target is under the pointer.
    Surface,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Drag {
    None,
    Path,
    Box,
}

/// A point control as its document writes it.
#[derive(Clone, Debug, PartialEq)]
pub struct Point {
    pub id: String,
    pub on: On,
    /// The buttons whose press it takes: `primary`, `secondary`, `middle`.
    pub buttons: Vec<String>,
    pub drag: Drag,
    /// A path's samples on the ground, in m.
    pub spacing: f64,
    /// The rows, elements or items an entry names when one is under the pointer.
    pub targets: Vec<String>,
    /// The pick margin in px, in 3D.
    pub margin: u32,
}

impl Point {
    /// Whether it takes a press of `button`.
    pub fn takes(&self, button: &str) -> bool {
        self.buttons.iter().any(|b| b == button)
    }
}

/// The document's point controls, in its order; one whose `on` isn't one of the four isn't here.
pub fn controls(doc: &Value) -> Vec<Point> {
    let controls = doc.get("controls").and_then(Value::as_object);
    controls
        .into_iter()
        .flatten()
        .filter(|(_, c)| c.get("kind").and_then(Value::as_str) == Some("point"))
        .filter_map(|(id, c)| {
            let on = match c.get("on")? {
                Value::String(s) if s == "surface" => On::Surface,
                Value::String(s) => {
                    let item = doc.get("items").and_then(|i| i.get(s));
                    let plate = item
                        .and_then(|i| i.pointer("/params/terrain"))
                        .is_some_and(|t| !t.is_null());
                    if plate {
                        On::Plate(s.clone())
                    } else {
                        On::Set(s.clone())
                    }
                }
                v => On::Plane(v.pointer("/plane/y").and_then(Value::as_f64).unwrap_or(0.0)),
            };
            let strings = |key: &str| -> Option<Vec<String>> {
                c.get(key)?
                    .as_array()?
                    .iter()
                    .map(|v| v.as_str().map(str::to_string))
                    .collect()
            };
            let drag = match c.get("drag").and_then(Value::as_str) {
                Some("path") => Drag::Path,
                Some("box") => Drag::Box,
                _ => Drag::None,
            };
            Some(Point {
                id: id.clone(),
                on,
                buttons: strings("buttons").unwrap_or_else(|| vec!["primary".into()]),
                drag,
                spacing: c.get("spacing").and_then(Value::as_f64).unwrap_or(0.25),
                targets: strings("targets").unwrap_or_default(),
                margin: c
                    .get("margin")
                    .and_then(Value::as_u64)
                    .map_or(3, |m| m.min(64) as u32),
            })
        })
        .collect()
}

/// A point control on `surface` with no targets is refused at check, naming the control.
pub fn check(doc: &Value) -> Vec<Issue> {
    controls(doc)
        .into_iter()
        .filter(|p| p.on == On::Surface && p.targets.is_empty())
        .map(|p| {
            Issue::error(
                "out_of_range",
                &p.id,
                format!("controls/{}/targets", p.id),
                json!([]),
                "a point control on `surface` names the targets whose drawn surface it meets",
            )
        })
        .collect()
}

/// The cells a straight segment from `a` to `b` enters, in the order entered, `a`'s own cell
/// left out: positions in cell units, cell (i, j) holding [i − ½, i + ½) × [j − ½, j + ½). A
/// segment through a corner enters the cell across x first.
pub fn crossed(a: [f64; 2], b: [f64; 2]) -> Vec<[i64; 2]> {
    let cell = |p: [f64; 2]| p.map(|v| (v + 0.5).floor() as i64);
    let (mut c, end) = (cell(a), cell(b));
    let d = [b[0] - a[0], b[1] - a[1]];
    let step = d.map(|v| if v > 0.0 { 1 } else { -1 });
    // How far along the segment (0 to 1) the next boundary on each axis is, and the distance
    // between boundaries.
    let mut next = [0, 1].map(|k| {
        if d[k] == 0.0 {
            return f64::INFINITY;
        }
        let edge = c[k] as f64 + 0.5 * step[k] as f64;
        (edge - a[k]) / d[k]
    });
    let delta = d.map(|v| if v == 0.0 { f64::INFINITY } else { 1.0 / v.abs() });
    let mut out = Vec::new();
    while c != end && out.len() < 1 << 16 {
        let k = usize::from(next[1] < next[0]);
        if next[k] > 1.0 {
            break;
        }
        c[k] += step[k];
        next[k] += delta[k];
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Criterion 1's drag: from the centre of cell (2, 2) to that of (9, 2), the cells (3, 2) to
    /// (9, 2), each once, in order.
    #[test]
    fn a_straight_drag_enters_each_cell_once_in_order() {
        let cells = crossed([2.0, 2.0], [9.0, 2.0]);
        let want: Vec<[i64; 2]> = (3..=9).map(|x| [x, 2]).collect();
        assert_eq!(cells, want);
        assert_eq!(crossed([2.2, 2.1], [2.4, 2.3]), Vec::<[i64; 2]>::new());
    }

    /// A diagonal crosses one axis at a time, so every cell it enters touches the one before.
    #[test]
    fn a_diagonal_enters_cells_that_share_an_edge() {
        let cells = crossed([0.0, 0.0], [3.0, 2.0]);
        assert_eq!(cells.last(), Some(&[3, 2]));
        let mut at = [0, 0];
        for c in cells {
            assert_eq!((c[0] - at[0]).abs() + (c[1] - at[1]).abs(), 1, "{c:?} after {at:?}");
            at = c;
        }
    }

    /// `on: surface` with `targets: []` is refused, naming the control; with a target it isn't.
    #[test]
    fn surface_with_no_targets_is_refused_naming_the_control() {
        let doc = json!({"controls": {"aim": {"kind": "point", "on": "surface"},
                                      "ok": {"kind": "point", "on": "surface", "targets": ["cube"]}}});
        let issues = check(&doc);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].ids, vec!["aim".to_string()]);
        assert_eq!(issues[0].path, "controls/aim/targets");
    }
}
