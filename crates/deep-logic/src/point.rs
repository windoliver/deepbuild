//! A point control's entry value and the 248 B record a logic item's read region holds for it
//! (canvas primitives: Control: point; #540): `u8 phase, u8 button, u8 mods, u8 flags`, 4 zero
//! bytes, `f64 x, y, z` (a cell as cx, cy, 0, a ground point or a surface's point), `u32 set`, 4
//! zero bytes, `i64 key[0], key[1]`, twelve `f64` for the corners, three for a surface's normal
//! and two for its uv, `u32 face` and 4 zero bytes, and six `f64` for the ray's origin and
//! direction. A field the entry doesn't hold is zero bytes.

use serde_json::{json, Map, Value};

// The record's byte codes. The design leaves them open, so each is set here and nowhere else
// (web/logic.mjs keeps its twin of this block).
/// Each phase's name and its code at offset 0.
const PHASES: [(&str, u8); 3] = [("press", 0), ("move", 1), ("release", 2)];
/// Each button's name and its code at offset 1.
const BUTTONS: [(&str, u8); 3] = [("primary", 0), ("secondary", 1), ("middle", 2)];
/// Each modifier's name and its bit at offset 2.
const MODS: [(&str, u8); 4] = [("shift", 1), ("ctrl", 2), ("alt", 4), ("meta", 8)];
/// The bits at offset 3, in the design's order: which fields the record holds.
const CELL: u8 = 1;
const GROUND: u8 = 2;
const HIT: u8 = 4;
const CORNERS: u8 = 8;
const SURFACE: u8 = 16;
const UV: u8 = 32;
const RAY: u8 = 64;
/// A box release's unit keys, in a tail after the record: `u32 n, u32 truncated`, then n ×
/// `(u32 slot, u32 gen)`.
const UNITS: u8 = 128;
/// The most unit keys a release holds.
pub const MAX_UNITS: usize = 256;

/// The record's length.
pub const SIZE: usize = 248;

/// A point control's hover as a preview reads it (Logic: preview): a point entry's record, flags
/// bit 0 set for a cell, x and y the cell's; none is 248 zero bytes.
pub fn hover(cell: Option<[f64; 2]>) -> Vec<u8> {
    let mut b = vec![0u8; SIZE];
    if let Some([cx, cy]) = cell {
        b[3] = 1;
        b[8..16].copy_from_slice(&cx.to_le_bytes());
        b[16..24].copy_from_slice(&cy.to_le_bytes());
    }
    b
}

/// One point entry's value, as its JSON form holds it: absent keys and nulls are none.
#[derive(Clone, Debug, PartialEq)]
pub struct Point {
    /// Indices in `PHASES` and `BUTTONS`; `mods` holds `MODS` bits.
    phase: usize,
    button: usize,
    mods: u8,
    cell: Option<[i32; 2]>,
    ground: Option<[f64; 3]>,
    hit: Option<(u32, [i64; 2])>,
    corners: Option<[Option<[f64; 3]>; 4]>,
    surface: Option<Surface>,
    /// Origin, then unit direction.
    ray: Option<[[f64; 3]; 2]>,
    units: Option<(Vec<[u32; 2]>, bool)>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Surface {
    point: [f64; 3],
    /// A mark's nearest point has no triangle: no normal and no face.
    normal: Option<[f64; 3]>,
    uv: Option<[f64; 2]>,
    face: Option<u32>,
}

/// `key` of `v` read by `read`: none when absent or null, and no value when present but unread.
fn opt<'a, T>(v: &'a Value, key: &str, read: impl Fn(&'a Value) -> Option<T>) -> Option<Option<T>> {
    match v.get(key) {
        None | Some(Value::Null) => Some(None),
        Some(x) => read(x).map(Some),
    }
}

fn f64s<const N: usize>(v: &Value) -> Option<[f64; N]> {
    let a = v.as_array().filter(|a| a.len() == N)?;
    let mut out = [0.0; N];
    for (o, x) in out.iter_mut().zip(a) {
        *o = x.as_f64()?;
    }
    Some(out)
}

fn named(table: &[(&str, u8)], v: Option<&Value>) -> Option<usize> {
    let name = v?.as_str()?;
    table.iter().position(|(n, _)| *n == name)
}

fn put(b: &mut [u8], at: usize, xs: &[f64]) {
    for (i, x) in xs.iter().enumerate() {
        b[at + 8 * i..at + 8 * i + 8].copy_from_slice(&x.to_le_bytes());
    }
}

impl Point {
    /// A press, move or release with its button; none for any other phase or button, a field of
    /// the wrong shape, or more than one of cell, ground and surface, since x, y, z holds one.
    pub fn parse(v: &Value) -> Option<Point> {
        let phase = named(&PHASES, v.get("phase"))?;
        let button = named(&BUTTONS, v.get("button"))?;
        let mut mods = 0;
        if let Some(m) = opt(v, "mods", |m| m.is_object().then_some(m))? {
            for (name, bit) in MODS {
                if opt(m, name, Value::as_bool)?.unwrap_or(false) {
                    mods |= bit;
                }
            }
        }
        let cell = opt(v, "cell", |c| match c.as_array()?.as_slice() {
            [x, y] => Some([
                i32::try_from(x.as_i64()?).ok()?,
                i32::try_from(y.as_i64()?).ok()?,
            ]),
            _ => None,
        })?;
        let ground = opt(v, "ground", f64s::<3>)?;
        // As a pick's value: the target's index and its key.
        let hit = opt(v, "hit", |h| {
            let set = u32::try_from(h.get("set")?.as_u64()?).ok()?;
            match h.get("key")?.as_array()?.as_slice() {
                [a, b] => Some((set, [a.as_i64()?, b.as_i64()?])),
                _ => None,
            }
        })?;
        let corners = opt(v, "corners", |c| {
            let c = c.as_array().filter(|c| c.len() == 4)?;
            let mut out = [None; 4];
            for (o, x) in out.iter_mut().zip(c) {
                *o = if x.is_null() { None } else { Some(f64s(x)?) };
            }
            Some(out)
        })?;
        let surface = opt(v, "surface", |s| {
            Some(Surface {
                point: f64s(s.get("point")?)?,
                normal: opt(s, "normal", f64s::<3>)?,
                uv: opt(s, "uv", f64s::<2>)?,
                face: opt(s, "face", |f| u32::try_from(f.as_u64()?).ok())?,
            })
        })?;
        let ray = opt(v, "ray", |r| {
            Some([f64s(r.get("origin")?)?, f64s(r.get("dir")?)?])
        })?;
        let units = opt(v, "units", |u| {
            let keys = u
                .get("keys")?
                .as_array()
                .filter(|k| k.len() <= MAX_UNITS)?
                .iter()
                .map(|k| match k.as_array()?.as_slice() {
                    [a, b] => Some([
                        u32::try_from(a.as_u64()?).ok()?,
                        u32::try_from(b.as_u64()?).ok()?,
                    ]),
                    _ => None,
                })
                .collect::<Option<Vec<_>>>()?;
            Some((keys, u.get("truncated")?.as_bool()?))
        })?;
        if usize::from(cell.is_some())
            + usize::from(ground.is_some())
            + usize::from(surface.is_some())
            > 1
        {
            return None;
        }
        Some(Point {
            phase,
            button,
            mods,
            cell,
            ground,
            hit,
            corners,
            surface,
            ray,
            units,
        })
    }

    /// The value as `parse` reads it, without the keys that are none.
    pub fn to_json(&self) -> Value {
        let mut o = Map::new();
        o.insert("phase".into(), json!(PHASES[self.phase].0));
        o.insert("button".into(), json!(BUTTONS[self.button].0));
        let mods = MODS
            .iter()
            .map(|(n, bit)| (n.to_string(), json!(self.mods & bit != 0)));
        o.insert("mods".into(), Value::Object(mods.collect()));
        if let Some(c) = self.cell {
            o.insert("cell".into(), json!(c));
        }
        if let Some(g) = self.ground {
            o.insert("ground".into(), json!(g));
        }
        if let Some((set, key)) = self.hit {
            o.insert("hit".into(), json!({"set": set, "key": key}));
        }
        if let Some(c) = self.corners {
            o.insert("corners".into(), json!(c));
        }
        if let Some(s) = &self.surface {
            o.insert(
                "surface".into(),
                json!({"point": s.point, "normal": s.normal, "uv": s.uv, "face": s.face}),
            );
        }
        if let Some([origin, dir]) = self.ray {
            o.insert("ray".into(), json!({"origin": origin, "dir": dir}));
        }
        if let Some((keys, truncated)) = &self.units {
            o.insert("units".into(), json!({"keys": keys, "truncated": truncated}));
        }
        Value::Object(o)
    }

    /// The 248 B record.
    /// Its 248 B record, then, after a release that holds unit keys, their tail.
    pub fn bytes(&self) -> Vec<u8> {
        let mut b = vec![0u8; SIZE];
        let mut flags = 0;
        if let Some([cx, cy]) = self.cell {
            flags |= CELL;
            put(&mut b, 8, &[f64::from(cx), f64::from(cy), 0.0]);
        }
        if let Some(g) = self.ground {
            flags |= GROUND;
            put(&mut b, 8, &g);
        }
        if let Some((set, key)) = self.hit {
            flags |= HIT;
            b[32..36].copy_from_slice(&set.to_le_bytes());
            b[40..48].copy_from_slice(&key[0].to_le_bytes());
            b[48..56].copy_from_slice(&key[1].to_le_bytes());
        }
        if let Some(corners) = self.corners {
            // A corner whose ray met nothing stays zero, and the flag says the record holds
            // corners only when all four met: a step never reads a box from a zero corner.
            if corners.iter().all(Option::is_some) {
                flags |= CORNERS;
            }
            for (i, c) in corners.iter().enumerate() {
                if let Some(c) = c {
                    put(&mut b, 56 + 24 * i, c);
                }
            }
        }
        if let Some(s) = &self.surface {
            flags |= SURFACE;
            put(&mut b, 8, &s.point);
            if let Some(n) = s.normal {
                put(&mut b, 152, &n);
            }
            if let Some(uv) = s.uv {
                flags |= UV;
                put(&mut b, 176, &uv);
            }
            if let Some(face) = s.face {
                b[192..196].copy_from_slice(&face.to_le_bytes());
            }
        }
        if let Some([origin, dir]) = self.ray {
            flags |= RAY;
            put(&mut b, 200, &origin);
            put(&mut b, 224, &dir);
        }
        if let Some((keys, truncated)) = &self.units {
            flags |= UNITS;
            b.extend((keys.len() as u32).to_le_bytes());
            b.extend(u32::from(*truncated).to_le_bytes());
            for [slot, gen] in keys {
                b.extend(slot.to_le_bytes());
                b.extend(gen.to_le_bytes());
            }
        }
        b[0] = PHASES[self.phase].1;
        b[1] = BUTTONS[self.button].1;
        b[2] = self.mods;
        b[3] = flags;
        b
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::{Entry, Given};

    fn code(table: &[(&str, u8)], name: &str) -> u8 {
        table.iter().find(|(n, _)| *n == name).expect("a code").1
    }

    /// The record a test expects: its header, then each f64 run at its offset.
    fn record(header: [u8; 4], runs: &[(usize, &[f64])]) -> [u8; SIZE] {
        let mut b = [0u8; SIZE];
        b[..4].copy_from_slice(&header);
        for (at, xs) in runs {
            for (i, x) in xs.iter().enumerate() {
                b[at + 8 * i..at + 8 * i + 8].copy_from_slice(&x.to_le_bytes());
            }
        }
        b
    }

    /// #540: a release holding hit, corners, a surface with uv, and a ray fills every field at
    /// its offset in the 248 B record, read from its track form through the entry's value.
    #[test]
    fn a_full_entry_fills_every_offset() {
        let e = Entry::parse(&json!({"t": 0, "control": "aim", "value": {
            "phase": "release", "button": "secondary",
            "mods": {"shift": true, "ctrl": false, "alt": false, "meta": true},
            "hit": {"set": 3, "key": [-5, 9]},
            "corners": [[1.5, 2.5, 3.5], [4.5, 5.5, 6.5], [7.5, 8.5, 9.5], [10.5, 11.5, 12.5]],
            "surface": {"point": [0.25, 0.75, -0.5], "normal": [0.48, 0.6, 0.64], "uv": [0.625, 0.125], "face": 7},
            "ray": {"origin": [-1.25, 10.5, 3.25], "dir": [0.1, -0.9, -0.3]},
        }}))
        .expect("a point entry");
        let Given::Point(p) = &e.value else {
            panic!("a point value, not {:?}", e.value)
        };
        let mut want = record(
            [
                code(&PHASES, "release"),
                code(&BUTTONS, "secondary"),
                code(&MODS, "shift") | code(&MODS, "meta"),
                HIT | CORNERS | SURFACE | UV | RAY,
            ],
            &[
                (8, &[0.25, 0.75, -0.5]),
                (
                    56,
                    &[
                        1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5,
                    ],
                ),
                (152, &[0.48, 0.6, 0.64]),
                (176, &[0.625, 0.125]),
                (200, &[-1.25, 10.5, 3.25]),
                (224, &[0.1, -0.9, -0.3]),
            ],
        );
        want[32..36].copy_from_slice(&3u32.to_le_bytes());
        want[40..48].copy_from_slice(&(-5i64).to_le_bytes());
        want[48..56].copy_from_slice(&9i64.to_le_bytes());
        want[192..196].copy_from_slice(&7u32.to_le_bytes());
        assert_eq!(p.bytes(), want);
        // The region fill packs the value's bytes after the entry's player.
        assert_eq!(e.value.bytes(), want.to_vec());
    }

    /// A 2D cell lands at x, y as cx, cy with z 0, a ground point at x, y, z, each under its own
    /// flag; an entry naming both is refused, since the record holds one.
    #[test]
    fn a_cell_or_a_ground_point_lands_at_x_y_z() {
        let cell = Point::parse(&json!({"phase": "move", "button": "primary", "cell": [3, -2]}))
            .expect("a cell entry");
        let header = [code(&PHASES, "move"), code(&BUTTONS, "primary"), 0, CELL];
        assert_eq!(cell.bytes(), record(header, &[(8, &[3.0, -2.0, 0.0])]));
        let ground = Point::parse(&json!({"phase": "press", "button": "middle",
            "mods": {"ctrl": true}, "ground": [1.5, 0.25, -17.3205]}))
        .expect("a ground entry");
        let header = [
            code(&PHASES, "press"),
            code(&BUTTONS, "middle"),
            code(&MODS, "ctrl"),
            GROUND,
        ];
        assert_eq!(
            ground.bytes(),
            record(header, &[(8, &[1.5, 0.25, -17.3205])])
        );
        assert_eq!(
            Point::parse(
                &json!({"phase": "press", "button": "primary", "cell": [0, 0], "ground": [0, 0, 0]})
            ),
            None
        );
    }

    /// A press over nothing, its keys absent or null, holds only its phase and button; one
    /// without a button, or with a phase the design doesn't name, isn't a point.
    #[test]
    fn a_press_over_nothing_holds_only_its_header() {
        let header = [code(&PHASES, "press"), code(&BUTTONS, "secondary"), 0, 0];
        let bare = record(header, &[]);
        for v in [
            json!({"phase": "press", "button": "secondary"}),
            json!({"phase": "press", "button": "secondary", "mods": null, "cell": null, "hit": null,
                "corners": null, "surface": null, "ray": null}),
        ] {
            assert_eq!(Point::parse(&v).expect("a press").bytes(), bare, "{v}");
        }
        assert_eq!(Point::parse(&json!({"phase": "press"})), None);
        assert_eq!(
            Point::parse(&json!({"phase": "hold", "button": "primary"})),
            None
        );
    }

    /// A box whose corner ray met nothing keeps that corner zero and doesn't say it holds corners.
    #[test]
    fn a_corner_that_met_nothing_stays_zero() {
        let p = Point::parse(&json!({"phase": "release", "button": "primary",
            "corners": [[1.0, 0.0, 2.0], null, [3.0, 0.0, 4.0], [5.0, 0.0, 6.0]]}))
        .expect("a box release");
        let header = [code(&PHASES, "release"), code(&BUTTONS, "primary"), 0, 0];
        let want = record(
            header,
            &[
                (56, &[1.0, 0.0, 2.0]),
                (104, &[3.0, 0.0, 4.0, 5.0, 0.0, 6.0]),
            ],
        );
        assert_eq!(p.bytes(), want);
    }

    /// What `to_json` writes, `parse` reads back as the same value, nones and a null corner among
    /// them, through the entry's track form too.
    #[test]
    fn a_point_round_trips_through_its_json() {
        for v in [
            json!({"phase": "release", "button": "secondary", "mods": {"alt": true},
                "hit": {"set": 0, "key": [0, 0]},
                "corners": [null, [1.0, 0.0, 2.0], null, [5.0, 0.0, 6.0]],
                "surface": {"point": [0.25, 0.5, -0.5], "normal": [0, 1, 0], "uv": null, "face": 1},
                "ray": {"origin": [0.0, 10.5, 3.0], "dir": [0.0, -0.9, -0.3]}}),
            json!({"phase": "move", "button": "primary", "cell": [-4, 11]}),
            json!({"phase": "press", "button": "middle", "ground": [2.0, 0.0, -3.0],
                "surface": null}),
        ] {
            let p = Point::parse(&v).expect("a point");
            assert_eq!(Point::parse(&p.to_json()), Some(p.clone()), "{v}");
            let e = Entry::parse(&json!({"t": 5, "control": "aim", "value": v})).expect("an entry");
            assert_eq!(e.value, Given::Point(p));
            assert_eq!(Entry::parse(&e.to_json()), Some(e));
        }
    }
}
