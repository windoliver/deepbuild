//! Literal colors into roles. With `look: generated`, each distinct sRGB color (8 bits a channel)
//! becomes one role of a look built on the shipped clean look, named by its value
//! (`lottie_rrggbb`), and a color within the status distance of a status color is reported. With
//! a named look, each color takes the role of that look nearest it (least OKLab ΔE in its light
//! theme, ties by role name). Alpha is never a role's: it goes into the paint's opacity.

use std::collections::BTreeMap;

use deep_canvas_marks::look::{self, Distance, Look};
use deep_canvas_marks::scene::Rgb;
use serde_json::{json, Value};

/// The look the import's colors go to.
pub enum Target {
    /// Roles made from the file's own colors, over this base definition.
    Generated(Value),
    /// The roles of a named look: its ID, its definition and its resolved light palette.
    Named {
        id: String,
        def: Value,
        look: Box<Look>,
    },
}

/// Where one color went, and the first layer that used it.
pub struct Mapped {
    pub role: String,
    pub distance: f64,
    pub layer: String,
}

pub struct Colors {
    pub target: Target,
    pub mapped: BTreeMap<Rgb, Mapped>,
}

/// An sRGB color in 0..1 as its 8-bit code values.
pub fn rgb(c: &[f64]) -> Rgb {
    let q = |i: usize| (c.get(i).copied().unwrap_or(0.0).clamp(0.0, 1.0) * 255.0).round() as u8;
    [q(0), q(1), q(2)]
}

pub fn hex(c: Rgb) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

/// The faces a look's fonts may name: the ones the canvas bundles.
pub fn bundled() -> Vec<&'static str> {
    deep_text::FACES.iter().map(|f| f.file).collect()
}

/// A look@1 definition resolved as a document shows it with no status binding.
pub fn resolve(def: &Value) -> Result<Look, String> {
    look::resolve_in(def, &bundled(), Distance::WhereStatusShows)
        .map_err(|r| r.to_json().to_string())
}

impl Colors {
    pub fn new(target: Target) -> Colors {
        Colors {
            target,
            mapped: BTreeMap::new(),
        }
    }

    /// The role `color` takes, first seen on `layer`.
    pub fn role(&mut self, color: Rgb, layer: &str) -> String {
        if let Some(m) = self.mapped.get(&color) {
            return m.role.clone();
        }
        let (role, distance) = match &self.target {
            Target::Generated(_) => (format!("lottie_{}", &hex(color)[1..]), 0.0),
            Target::Named { look, .. } => {
                let mut best: Option<(&String, f64)> = None;
                // The palette iterates by role name, so a tie keeps the first name.
                for (role, c) in &look.light {
                    let d = look::distance(color, *c);
                    if best.is_none_or(|(_, b)| d < b) {
                        best = Some((role, d));
                    }
                }
                best.map_or(("ink".to_string(), 0.0), |(r, d)| (r.clone(), d))
            }
        };
        self.mapped.insert(
            color,
            Mapped {
                role: role.clone(),
                distance,
                layer: layer.to_string(),
            },
        );
        role
    }

    /// The look the document names: the generated one with a role per color, or the named one.
    pub fn look(&self) -> Value {
        match &self.target {
            Target::Named { def, .. } => def.clone(),
            Target::Generated(base) => {
                let mut def = base.clone();
                def["id"] = json!("lottie");
                def["description"] = json!("The clean look with one role for each literal color of an imported Lottie file, named by its sRGB value.");
                for (color, m) in &self.mapped {
                    def["palette"][&m.role] = json!(hex(*color));
                    def["roles"][&m.role] = json!(m.role);
                }
                def
            }
        }
    }

    /// The asset ID the document names its look by.
    pub fn asset(&self) -> String {
        match &self.target {
            Target::Named { id, .. } => id.clone(),
            Target::Generated(_) => "lottie".to_string(),
        }
    }

    /// Each color's mapping, in color order: `{color, role, distance}`.
    pub fn report(&self) -> Vec<Value> {
        self.mapped
            .iter()
            .map(|(c, m)| json!({"color": hex(*c), "role": m.role, "distance": m.distance}))
            .collect()
    }

    /// Each generated role a status color is within the status distance of: its color, the
    /// layer that first used it, the state and the distance.
    pub fn clashes(&self, status: &look::Status) -> Vec<(Rgb, String, &'static str, f64)> {
        if !matches!(self.target, Target::Generated(_)) {
            return Vec::new();
        }
        self.mapped
            .iter()
            .filter_map(|(c, m)| {
                look::clash(*c, status).map(|(state, d)| (*c, m.layer.clone(), state, d))
            })
            .collect()
    }
}

/// Every literal color `v` writes, in the order it writes them: fills' and strokes' `c` (still,
/// or each key's start and end), gradients' color stops, and a solid layer's `sc`. Each takes a
/// role, whether or not an item draws it, so no color of the file is left without one.
pub fn literals(v: &Value, out: &mut Vec<[f64; 3]>) {
    let values = |p: Option<&Value>| -> Vec<Vec<f64>> {
        let nums = |v: &Value| {
            v.as_array()
                .map(|a| a.iter().filter_map(Value::as_f64).collect::<Vec<f64>>())
        };
        match p.and_then(|p| p.get("k")) {
            Some(Value::Array(keys)) if keys.first().is_some_and(Value::is_object) => keys
                .iter()
                .flat_map(|k| [k.get("s"), k.get("e")])
                .flatten()
                .filter_map(nums)
                .collect(),
            Some(k) => nums(k).into_iter().collect(),
            None => Vec::new(),
        }
    };
    match v {
        Value::Array(a) => a.iter().for_each(|x| literals(x, out)),
        Value::Object(o) => {
            match o.get("ty") {
                Some(Value::String(t)) if t == "fl" || t == "st" => {
                    out.extend(
                        values(o.get("c"))
                            .into_iter()
                            .filter(|c| c.len() >= 3)
                            .map(|c| [c[0], c[1], c[2]]),
                    );
                }
                Some(Value::String(t)) if t == "gf" || t == "gs" => {
                    let count = o
                        .get("g")
                        .and_then(|g| g.get("p"))
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0)
                        .max(0.0) as usize;
                    for flat in values(o.get("g")) {
                        out.extend(
                            flat.chunks(4)
                                .take(count)
                                .filter(|c| c.len() == 4)
                                .map(|c| [c[1], c[2], c[3]]),
                        );
                    }
                }
                Some(t) if t.as_f64() == Some(1.0) => {
                    if let Some(c) = o.get("sc").and_then(Value::as_str).and_then(parse_hex) {
                        out.push(c);
                    }
                }
                _ => {}
            }
            o.values().for_each(|x| literals(x, out));
        }
        _ => {}
    }
}

/// `#rrggbb` as sRGB in 0..1.
pub fn parse_hex(text: &str) -> Option<[f64; 3]> {
    let h = text.strip_prefix('#')?;
    if h.len() < 6 {
        return None;
    }
    let c = |i: usize| {
        u8::from_str_radix(h.get(i..i + 2)?, 16)
            .ok()
            .map(|v| f64::from(v) / 255.0)
    };
    Some([c(0)?, c(2)?, c(4)?])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean() -> Colors {
        let def = look::shipped("clean").unwrap();
        let resolved = resolve(&def).unwrap();
        Colors::new(Target::Named {
            id: "clean".into(),
            def,
            look: Box::new(resolved),
        })
    }

    #[test]
    fn a_named_look_maps_each_color_to_its_nearest_role_ties_by_name() {
        let mut c = clean();
        // The clean look's lagoon is its accent role, and graphite both ink and ink_primary.
        assert_eq!(c.role([0x1a, 0xa3, 0xc8], "l"), "accent");
        assert_eq!(c.role([0x1b, 0x1d, 0x22], "l"), "ink");
        assert_eq!(c.role([0xff, 0xff, 0xff], "l"), "ground");
        let near = c.role([0x1c, 0xa0, 0xc9], "l");
        assert_eq!(near, "accent");
        assert!(c.mapped[&[0x1c, 0xa0, 0xc9]].distance > 0.0);
    }

    #[test]
    fn a_generated_look_holds_one_role_per_color_by_value() {
        let mut c = Colors::new(Target::Generated(look::shipped("clean").unwrap()));
        assert_eq!(c.role([255, 0, 16], "l"), "lottie_ff0010");
        assert_eq!(c.role([255, 0, 16], "m"), "lottie_ff0010");
        let def = c.look();
        assert_eq!(def["roles"]["lottie_ff0010"], json!("lottie_ff0010"));
        assert_eq!(def["palette"]["lottie_ff0010"], json!("#ff0010"));
        let resolved = resolve(&def).unwrap();
        assert_eq!(resolved.light["lottie_ff0010"], [255, 0, 16]);
    }
}
