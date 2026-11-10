//! Issue #1653: atlas tiles drawn (canvas primitives: Mark set: atlas tiles). A `marks@1` set with
//! `mark: image` and `atlas` draws each row's atlas cell as a w × h quad centred on its grid cell,
//! on a square grid or an isometric one, where the centre of cell (cx, cy) with cell [w, h] is
//! x = (cx − cy) × w ÷ 2, y = (cx + cy) × h ÷ 2, or on a hex grid at its layout's centre (Mark
//! set: hex grid; the floor #467's terrain recipe lays). Rows draw in order of centre y, then
//! centre x. A hex grid's picks, hits and edge rules are #536's, and free rows #535's.
//!
//! An animated row shows frame ⌊t × frame_rate + phase × frames⌋ mod frames, drawn as atlas cell
//! `tile + frame`: [`apply`] resolves it at the record's time before the frame is built, as the
//! parallax fields do, so seeking equals playing.

use serde_json::{json, Map, Value};

use crate::data::Column;
use crate::paint::Adjust;
use crate::scene::{num, AtlasCell, ImageFit, ImageSampling, Mark, Planted, Refused};
use crate::story::Rows;

/// Flicks a second.
const FLICKS: i64 = 705_600_000;

/// Whether a set draws atlas tiles: `mark: image` with an `atlas`.
pub fn is_atlas(params: &Map<String, Value>) -> bool {
    params.get("mark").and_then(Value::as_str) == Some("image") && params.contains_key("atlas")
}

fn refused(code: &'static str, path: impl Into<String>) -> Refused {
    Refused {
        code,
        path: path.into(),
    }
}

fn pair(v: Option<&Value>, default: [f64; 2], path: &str) -> Result<[f64; 2], Refused> {
    match v {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Array(l)) if l.len() == 2 => match (num(l.first()), num(l.get(1))) {
            (Some(a), Some(b)) if a >= 0.0 && b >= 0.0 => Ok([a, b]),
            _ => Err(refused("bad_doc", path)),
        },
        Some(_) => Err(refused("bad_doc", path)),
    }
}

/// How a grid lays its cells out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Square,
    Isometric,
    /// `hex {orient, offset}`: flat or pointy, and whether the odd rows (or columns) shift.
    Hex {
        flat: bool,
        odd: bool,
    },
}

/// `grid {shape: square | isometric | hex, cell: [u, u], hex?}`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Grid {
    pub shape: Shape,
    pub cell: [f64; 2],
}

impl Grid {
    pub fn read(params: &Map<String, Value>, path: &str) -> Result<Grid, Refused> {
        let g = params.get("grid").and_then(Value::as_object);
        let at = |f: &str| format!("{path}/grid/{f}");
        let shape = match g.and_then(|g| g.get("shape")) {
            None | Some(Value::Null) => Shape::Square,
            Some(Value::String(s)) if s == "square" => Shape::Square,
            Some(Value::String(s)) if s == "isometric" => Shape::Isometric,
            Some(Value::String(s)) if s == "hex" => {
                let hex = g.and_then(|g| g.get("hex"));
                let word = |name: &str, words: [&str; 2]| match hex.and_then(|h| h.get(name)) {
                    None | Some(Value::Null) => Ok(false),
                    Some(Value::String(w)) if w == words[0] => Ok(false),
                    Some(Value::String(w)) if w == words[1] => Ok(true),
                    Some(_) => Err(refused("bad_doc", at(&format!("hex/{name}")))),
                };
                Shape::Hex {
                    flat: word("orient", ["pointy", "flat"])?,
                    odd: !word("offset", ["odd", "even"])?,
                }
            }
            Some(_) => return Err(refused("bad_doc", at("shape"))),
        };
        let Some(cell) = g.and_then(|g| g.get("cell")) else {
            return Err(refused("bad_doc", at("cell")));
        };
        let cell = pair(Some(cell), [0.0, 0.0], &at("cell"))?;
        if cell.iter().any(|v| *v <= 0.0) {
            return Err(refused("out_of_range", at("cell")));
        }
        Ok(Grid { shape, cell })
    }

    /// The centre of cell (cx, cy) in the set's u. `square`: the planted layout that places an
    /// isometric grid's cells as a square one's.
    pub fn centre(&self, cx: f64, cy: f64, square: bool) -> [f64; 2] {
        let [w, h] = self.cell;
        // A shifted row (pointy) or column (flat): the odd ones with offset odd, else the even.
        let shifted = |line: f64| {
            f64::from(u8::from(
                (line.rem_euclid(2.0) == 1.0) == odd_of(self.shape),
            ))
        };
        match self.shape {
            _ if square => [cx * w, cy * h],
            Shape::Square => [cx * w, cy * h],
            Shape::Isometric => [(cx - cy) * w / 2.0, (cx + cy) * h / 2.0],
            Shape::Hex { flat: false, .. } => [w * (cx + shifted(cy) / 2.0), 0.75 * h * cy],
            Shape::Hex { flat: true, .. } => [0.75 * w * cx, h * (cy + shifted(cx) / 2.0)],
        }
    }
}

fn odd_of(shape: Shape) -> bool {
    matches!(shape, Shape::Hex { odd: true, .. })
}

/// #535: `grid.size: [cols, rows]` on an atlas set, which lays row i at cell (i mod cols,
/// ⌊i ÷ cols⌋); `None` without one or for a size that isn't two whole numbers from 1 to 65,535.
pub fn size_of(params: &Map<String, Value>) -> Option<[usize; 2]> {
    let size = params.get("grid")?.get("size")?.as_array()?;
    let side = |i: usize| {
        let v = size.get(i)?.as_u64()?;
        (1..=u64::from(u16::MAX)).contains(&v).then_some(v as usize)
    };
    (size.len() == 2 && is_atlas(params)).then_some([side(0)?, side(1)?])
}

/// One row as it draws: its key, its grid cell (a free row's centre), its centre, the atlas cell
/// it shows, and its turn (deg) and scale about its centre (#535).
#[derive(Clone, Debug, PartialEq)]
pub struct Tile {
    pub key: String,
    pub cell: [f64; 2],
    pub centre: [f64; 2],
    pub index: u64,
    pub flip: u8,
    pub angle: f64,
    pub scale: f64,
}

fn whole(c: Option<&Column>, i: usize, default: f64, max: f64, path: &str) -> Result<f64, Refused> {
    let v = match c {
        None => default,
        Some(c) => c.number(i).ok_or_else(|| refused("bad_column", path))?,
    };
    if v.fract() != 0.0 || v < 0.0 || v > max {
        return Err(refused("out_of_range", path));
    }
    Ok(v)
}

/// The set's rows as tiles, in draw order: by centre y, then centre x, then as written.
/// `planted` may place an isometric grid's cells as a square one's, or keep the rows as written.
pub fn tiles(
    id: &str,
    params: &Map<String, Value>,
    rows: &Rows,
    planted: Planted,
) -> Result<Vec<Tile>, Refused> {
    let path = format!("items/{id}/params");
    // #535: a free row sits at its own centre (x, y) rather than on a grid cell.
    let free = match params.get("place") {
        None | Some(Value::Null) => false,
        Some(Value::String(p)) if p == "cell" => false,
        Some(Value::String(p)) if p == "free" => true,
        Some(_) => return Err(refused("bad_doc", format!("{path}/place"))),
    };
    let grid = Grid::read(params, &path)?;
    let size = size_of(params);
    if let Some([cols, rs]) = size {
        if rows.keys.len() != cols * rs {
            return Err(refused("out_of_range", format!("{path}/grid/size")));
        }
    } else if params.get("grid").and_then(|g| g.get("size")).is_some() {
        return Err(refused("out_of_range", format!("{path}/grid/size")));
    }
    let column = |name: &str| rows.columns.get(name);
    let col = |name: &str| format!("{path}/columns/{name}");
    let mut out = Vec::new();
    for (i, key) in rows.keys.iter().enumerate() {
        if rows.hidden.contains(&i) {
            continue;
        }
        let at = |name: &str, whole: bool| -> Result<f64, Refused> {
            let v = column(name).and_then(|c| c.number(i));
            v.filter(|v| v.is_finite() && (!whole || v.fract() == 0.0))
                .ok_or_else(|| refused("bad_column", col(name)))
        };
        let or = |name: &str, default: f64| match column(name) {
            None => Ok(default),
            Some(_) => at(name, false),
        };
        let (cell, centre) = match size {
            _ if free => {
                let c = [at("x", false)?, at("y", false)?];
                (c, c)
            }
            Some([cols, _]) => {
                let c = [(i % cols) as f64, (i / cols) as f64];
                (c, grid.centre(c[0], c[1], planted == Planted::AtlasSquareLayout))
            }
            None => {
                let c = [at("cx", true)?, at("cy", true)?];
                (c, grid.centre(c[0], c[1], planted == Planted::AtlasSquareLayout))
            }
        };
        let scale = or("scale", 1.0)?;
        if scale <= 0.0 {
            return Err(refused("out_of_range", col("scale")));
        }
        out.push(Tile {
            key: key.clone(),
            cell,
            centre,
            index: whole(column("tile"), i, 0.0, f64::from(u16::MAX), &col("tile"))? as u64,
            flip: whole(column("flip"), i, 0.0, 7.0, &col("flip"))? as u8,
            angle: or("angle", 0.0)?,
            scale,
        });
    }
    if planted != Planted::AtlasRowOrder {
        out.sort_by(|a, b| {
            a.centre[1]
                .total_cmp(&b.centre[1])
                .then(a.centre[0].total_cmp(&b.centre[0]))
        });
    }
    Ok(out)
}

/// The set's marks: each tile's atlas cell as a w × h quad centred on its cell, named
/// `<id>#<key>`, at `pos`.
pub fn marks(
    id: &str,
    params: &Map<String, Value>,
    rows: &Rows,
    pos: [f64; 2],
    planted: Planted,
) -> Result<Vec<Mark>, Refused> {
    let path = format!("items/{id}/params/atlas");
    let atlas = params
        .get("atlas")
        .and_then(Value::as_object)
        .ok_or_else(|| refused("bad_doc", path.as_str()))?;
    let asset = atlas.get("asset").and_then(Value::as_str).unwrap_or("");
    if asset.len() != 64 || !asset.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(refused("bad_asset", format!("{path}/asset")));
    }
    let cell = pair(atlas.get("cell"), [0.0, 0.0], &format!("{path}/cell"))?;
    if cell.iter().any(|v| *v < 1.0) {
        return Err(refused("out_of_range", format!("{path}/cell")));
    }
    let margin = pair(atlas.get("margin"), [0.0, 0.0], &format!("{path}/margin"))?;
    let separation = pair(
        atlas.get("separation"),
        [0.0, 0.0],
        &format!("{path}/separation"),
    )?;
    let [w, h] = Grid::read(params, &format!("items/{id}/params"))?.cell;
    Ok(tiles(id, params, rows, planted)?
        .into_iter()
        .map(|t| {
            let [w, h] = [w * t.scale, h * t.scale];
            let mut centre = [pos[0] + t.centre[0], pos[1] + t.centre[1]];
            if planted == Planted::AtlasTurnsAboutCorner {
                // The planted renderer: the quad turns about its top-left corner.
                let corner = [centre[0] - w / 2.0, centre[1] - h / 2.0];
                let (s, c) = crate::scene::sin_cos(t.angle);
                let d = [w / 2.0, h / 2.0];
                centre = [corner[0] + c * d[0] - s * d[1], corner[1] + s * d[0] + c * d[1]];
            }
            (t, [centre[0] - w / 2.0, centre[1] - h / 2.0, w, h])
        })
        .map(|(t, bounds)| Mark::Image {
            item: format!("{id}#{}", t.key),
            asset: asset.to_ascii_lowercase(),
            bounds,
            turn: t.angle,
            fit: ImageFit::Fill,
            sampling: ImageSampling::Linear,
            crop: None,
            opacity: 1.0,
            adjust: Adjust::default(),
            tile: Some(AtlasCell {
                index: t.index,
                cell,
                margin,
                separation,
                flip: t.flip,
            }),
        })
        .collect())
}

/// `frame_rate` as a rational p/q: a whole number, `"p/q"` or `[p, q]`.
fn rational(v: &Value) -> Option<(i128, i128)> {
    let whole = |v: &Value| {
        let f = v.as_f64().filter(|f| *f >= 0.0 && f.fract() == 0.0)?;
        Some(f as i128)
    };
    let (p, q) = match v {
        Value::Array(pq) if pq.len() == 2 => (whole(&pq[0])?, whole(&pq[1])?),
        Value::Number(_) => (whole(v)?, 1),
        Value::String(s) => {
            let (p, q) = s.split_once('/').unwrap_or((s, "1"));
            (p.trim().parse().ok()?, q.trim().parse().ok()?)
        }
        _ => return None,
    };
    (q > 0).then_some((p, q))
}

/// The frame a row shows at `t` flicks: ⌊t × p/q + phase × frames⌋ mod frames, the whole part of
/// t × p/q taken exactly, so every time draws the same seeked as played.
pub fn frame(t: i64, (p, q): (i128, i128), phase: f64, frames: u64) -> u64 {
    let n = i128::from(t) * p;
    let d = q * i128::from(FLICKS);
    let (whole, rest) = (n.div_euclid(d), n.rem_euclid(d));
    let extra = (rest as f64 / d as f64 + phase * frames as f64).floor() as i128;
    (whole + extra).rem_euclid(i128::from(frames)) as u64
}

/// A column's value at row `i`.
fn cell_of(column: &Column, i: usize) -> Option<Value> {
    match column {
        Column::Const(c) => Some(c.clone()),
        Column::Texts(_) => column.text(i).map(Value::String),
        Column::Numbers(_) => column.number(i).map(|n| json!(n)),
    }
}

/// Numbers as an f64 column.
fn numbers(values: &[f64]) -> Value {
    let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
    json!({"dtype": "f64", "len": values.len(), "data": deep_canvas::base64::encode(&bytes)})
}

/// `items` at `t` flicks with each terrain recipe replaced by the atlas set it expands into, and
/// each animated atlas row's `tile` moved on to the cell of the frame it shows, its `frames`,
/// `frame_rate` and `phase` resolved; `None` when there's nothing to resolve.
pub fn apply(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    t: i64,
) -> Result<Option<Map<String, Value>>, Refused> {
    let animated = |item: &Value| {
        item.get("kind").and_then(Value::as_str) == Some("marks@1")
            && item.pointer("/params/columns/frames").is_some()
            && item
                .get("params")
                .and_then(Value::as_object)
                .is_some_and(is_atlas)
    };
    let terrain =
        |item: &Value| item.get("kind").and_then(Value::as_str) == Some(crate::terrain::KIND);
    if !items.values().any(|i| animated(i) || terrain(i)) {
        return Ok(None);
    }
    let seed = doc.get("seed").and_then(Value::as_u64).unwrap_or(0);
    let mut out = Map::new();
    for (id, item) in items {
        if terrain(item) {
            let (name, set) = crate::terrain::drawn(id, item)?;
            out.insert(name, set);
            continue;
        }
        if !animated(item) {
            out.insert(id.clone(), item.clone());
            continue;
        }
        let path = format!("items/{id}/params/columns");
        let rows = crate::data::base_rows(id, item, &Default::default())?;
        let at = |name: &str, i: usize| rows.columns.get(name).and_then(|c| cell_of(c, i));
        let mut shown = Vec::new();
        for (i, key) in rows.keys.iter().enumerate() {
            let tile = at("tile", i).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let frames = match at("frames", i) {
                None => 1,
                Some(v) => match v.as_f64() {
                    Some(f) if (1.0..=255.0).contains(&f) && f.fract() == 0.0 => f as u64,
                    _ => return Err(refused("out_of_range", format!("{path}/frames"))),
                },
            };
            if frames == 1 {
                shown.push(tile);
                continue;
            }
            let Some(rate) = at("frame_rate", i).as_ref().and_then(rational) else {
                return Err(refused("bad_column", format!("{path}/frame_rate")));
            };
            let phase = match at("phase", i) {
                None => 0.0,
                Some(Value::String(s)) if s == "none" => 0.0,
                Some(Value::String(s)) if s == "hashed" => {
                    deep_canvas_drawn::geometry::seeded(seed, key, 0)
                }
                Some(_) => return Err(refused("bad_column", format!("{path}/phase"))),
            };
            shown.push(tile + frame(t, rate, phase, frames) as f64);
        }
        let mut item = item.clone();
        let cols = item
            .pointer_mut("/params/columns")
            .and_then(Value::as_object_mut);
        if let Some(cols) = cols {
            for name in ["frames", "frame_rate", "phase"] {
                cols.remove(name);
            }
            cols.insert("tile".into(), numbers(&shown));
        }
        out.insert(id.clone(), item);
    }
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_is_the_same_at_every_time_however_it_is_reached() {
        let rate = (12, 1);
        // Half a second at 12 a second is frame 6 of 8, and a phase of a half moves it four on.
        assert_eq!(frame(FLICKS / 2, rate, 0.0, 8), 6);
        assert_eq!(frame(FLICKS / 2, rate, 0.5, 8), 2);
        // Just before a frame's start it still shows the one before.
        assert_eq!(frame(FLICKS / 12 - 1, rate, 0.0, 8), 0);
        assert_eq!(frame(FLICKS / 12, rate, 0.0, 8), 1);
    }

    #[test]
    fn an_isometric_cell_centres_on_its_diamond() {
        let g = Grid {
            shape: Shape::Isometric,
            cell: [32.0, 16.0],
        };
        assert_eq!(g.centre(1.0, 0.0, false), [16.0, 8.0]);
        assert_eq!(g.centre(0.0, 1.0, false), [-16.0, 8.0]);
        assert_eq!(g.centre(2.0, 1.0, false), [16.0, 24.0]);
        assert_eq!(g.centre(1.0, 0.0, true), [32.0, 0.0]);
    }

    /// #535: a free row scaled 2 about its centre covers twice its cell there, unturned or
    /// turned; a scale of 0 is refused, naming the column.
    #[test]
    fn a_free_row_scales_about_its_centre() {
        let params = json!({"mark": "image", "place": "free", "grid": {"cell": [4, 2]},
            "atlas": {"asset": "a".repeat(64), "cell": [8, 4]}});
        let params = params.as_object().expect("an object");
        let rows = |scale: f64, angle: f64| Rows {
            keys: vec!["0".into()],
            columns: [("x", 10.0), ("y", 3.0), ("scale", scale), ("angle", angle)]
                .into_iter()
                .map(|(k, v)| (k.to_string(), Column::Numbers(vec![v])))
                .collect(),
            ..Rows::default()
        };
        let bounds = |scale, angle| match &marks("s", params, &rows(scale, angle), [0.0, 0.0], Planted::None)
            .expect("drawn")[0]
        {
            Mark::Image { bounds, turn, .. } => (*bounds, *turn),
            _ => unreachable!("an image"),
        };
        assert_eq!(bounds(2.0, 0.0), ([6.0, 1.0, 8.0, 4.0], 0.0));
        assert_eq!(bounds(2.0, 90.0), ([6.0, 1.0, 8.0, 4.0], 90.0));
        let refused = tiles("s", params, &rows(0.0, 0.0), Planted::None).expect_err("refused");
        assert_eq!((refused.code, refused.path.as_str()), ("out_of_range", "items/s/params/columns/scale"));
    }
}
