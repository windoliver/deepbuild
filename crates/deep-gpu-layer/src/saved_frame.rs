use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{self, Drawn, Fill, Geometry, Line, Mark, Record, Rgb, Scope};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::Program;
use deep_marks_render::gpu::{Options, Vello2d};
use deep_marks_render::layer;
use deep_text::{Atlas, Shaper, MAX_DEVICE_SIZE, PAGE, PHASES};
use serde_json::{json, Value};

use crate::live::pair;
use crate::view3d::{png, write_named};
use crate::{parity, refused, App};

const DRAWS: &str = "draws.json";
const ATLAS: &str = "atlas.bin";

struct Sprite {
    at: [i64; 2],
    size: [u32; 2],
    color: Rgb,
    opacity: f64,
    bytes: usize,
}

enum Draw {
    Mark(Arc<Drawn>),
    Sprites(Vec<Sprite>),
}

struct Saved {
    size: [u32; 2],
    draws: Vec<Draw>,
}

pub fn save(app: &App, out: &str, call: &Value) -> Value {
    let run = || -> Result<Value, Value> {
        let folder = call["frame"]
            .as_str()
            .filter(|f| !f.is_empty())
            .ok_or_else(|| refused("bad_input", "frame is a folder"))?;
        let (size, marks) = evaluate(app, call)?;
        let mut atlas_bytes = Vec::new();
        let draws = draws_of(&marks, &mut atlas_bytes)?;
        let text = serde_json::to_vec_pretty(&json!({"size": size, "draws": draws}))
            .map_err(|e| refused("not_written", e.to_string()))?;
        let folder = Path::new(folder);
        std::fs::create_dir_all(folder)
            .and_then(|()| std::fs::write(folder.join(DRAWS), &text))
            .and_then(|()| std::fs::write(folder.join(ATLAS), &atlas_bytes))
            .map_err(|e| refused("not_written", format!("{}: {e}", folder.display())))?;
        let saved = read_draws(&text, atlas_bytes.len())?;
        reply(app, out, &saved, &atlas_bytes)
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}

pub fn replay(app: &App, out: &str, call: &Value) -> Value {
    let run = || -> Result<Value, Value> {
        let folder = call["frame"]
            .as_str()
            .filter(|f| !f.is_empty())
            .ok_or_else(|| refused("bad_input", "frame is a folder"))?;
        let folder = Path::new(folder);
        let unreadable = |name: &str, e: std::io::Error| {
            refused(
                "frame_unreadable",
                format!("{name} of the saved frame can't be read: {e}"),
            )
        };
        let text = std::fs::read(folder.join(DRAWS)).map_err(|e| unreadable(DRAWS, e))?;
        let atlas_bytes = std::fs::read(folder.join(ATLAS)).map_err(|e| unreadable(ATLAS, e))?;
        let saved = read_draws(&text, atlas_bytes.len())?;
        reply(app, out, &saved, &atlas_bytes)
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}

fn reply(app: &App, out: &str, saved: &Saved, atlas_bytes: &[u8]) -> Result<Value, Value> {
    let rgba = render(app, saved, atlas_bytes)?;
    let name = write_named(out, &png(&rgba, saved.size)?, "png")?;
    let path = Path::new(out).join(format!("{name}.png"));
    Ok(json!({"png": path.to_string_lossy()}))
}

fn evaluate(app: &App, call: &Value) -> Result<([u32; 2], Vec<Arc<Drawn>>), Value> {
    let bad = |what: &str| refused("bad_input", what);
    let doc = call["doc"]
        .as_object()
        .ok_or_else(|| bad("doc is an object"))?;
    let size = pair(&doc["size"]).ok_or_else(|| bad("doc: size is [w, h]"))?;
    let t = call["t"].as_i64().unwrap_or(0);
    let record = Record {
        pinned: t,
        ..deep_marks_render::record(call.as_object().expect("a call is an object"))
            .ok_or_else(|| bad("states"))?
    };
    let program = Program::compile(doc).map_err(|r| refused(r.code, r.path))?;
    let mut state = program.state();
    program.evaluate(t, eval::Validity::Full, &mut state);
    let items = eval::items(doc, &program, &state);
    if let Some((id, _)) = items.iter().find(|(_, v)| parity::three_d(v)) {
        return Err(refused(
            "not_saved",
            format!("items/{id}: a saved frame holds 2D writer layers only"),
        ));
    }
    let mut palette = layer::palette(&call["look"], "light")?;
    let names_ground = serde_json::to_string(&items)
        .map_err(|e| refused("bad_input", e.to_string()))?
        .contains("\"ground\"");
    if !names_ground {
        palette.entry("ground".into()).or_insert([0, 0, 0]);
    }
    let ty = crate::marks2d::drawn_type(app, &call["look"], doc)?;
    let frame = scene::frame_planted(
        doc,
        &items,
        (&palette, &ty),
        &record,
        1.0,
        scene::Planted::None,
    )
    .map_err(|r| refused(r.code, r.path))?;
    let marks = frame
        .layers
        .iter()
        .flat_map(|l| l.marks.iter().cloned())
        .collect();
    Ok((size, marks))
}

fn unsaved(item: &str, what: &str) -> Value {
    refused(
        "not_saved",
        format!("items/{item}: a saved frame doesn't hold {what}"),
    )
}

fn draws_of(marks: &[Arc<Drawn>], atlas_bytes: &mut Vec<u8>) -> Result<Vec<Value>, Value> {
    let mut shaper = Shaper::new();
    let mut atlas = Atlas::new();
    let mut copied = BTreeMap::new();
    let mut draws = Vec::new();
    for d in marks {
        let item = d.mark.item();
        if let Mark::Text {
            spec,
            origin,
            role,
            color,
            runs,
            ..
        } = &d.mark
        {
            if d.clip.is_some() || !d.scopes.is_empty() {
                return Err(unsaved(item, "a text inside a clip, mask or group"));
            }
            let spec = spec
                .shaper_spec()
                .ok_or_else(|| refused("bad_font", format!("items/{item}/params/font")))?;
            let shaped = shaper.shape(&spec);
            let mut sprites = Vec::new();
            for g in &shaped.glyphs {
                if g.size > MAX_DEVICE_SIZE {
                    return Err(unsaved(item, "a glyph above the atlas's largest size"));
                }
                let (x, px) = pen(g.x + origin[0] as f32);
                let (y, py) = pen(g.y + origin[1] as f32);
                let place = |atlas: &mut Atlas| {
                    atlas.glyph_turned(
                        &g.font,
                        (g.id, &g.coords),
                        g.size,
                        [px, py],
                        (g.skew, g.turn),
                    )
                };
                let placed = match place(&mut atlas) {
                    None if atlas.make_room() => place(&mut atlas),
                    p => p,
                };
                let Some(p) = placed else {
                    continue;
                };
                let page = &atlas.pages()[p.page as usize];
                let key = (page.generation(), p.x, p.y);
                let at = *copied.entry(key).or_insert_with(|| {
                    let at = atlas_bytes.len();
                    for row in 0..p.h {
                        let from = ((p.y + row) * PAGE + p.x) as usize;
                        atlas_bytes.extend_from_slice(&page.bytes()[from..from + p.w as usize]);
                    }
                    at
                });
                let (_, color) = scene::run_paint(runs, g.grapheme, role.as_deref(), *color);
                sprites.push(json!({
                    "at": [i64::from(x) + i64::from(p.left), i64::from(y) + i64::from(p.top)],
                    "size": [p.w, p.h], "color": color,
                    "opacity": scene::run_opacity(runs, g.grapheme), "bytes": at,
                }));
            }
            draws.push(json!({"text": item, "sprites": sprites}));
            for dec in &shaped.decorations {
                let (_, color) = scene::run_paint(runs, dec.grapheme, role.as_deref(), *color);
                let [x, y, w, h] = dec.rect.map(f64::from);
                let (x, y) = (origin[0] + x, origin[1] + y);
                let verbs = vec![
                    Verb::Move([x, y]),
                    Verb::Line([x + w, y]),
                    Verb::Line([x + w, y + h]),
                    Verb::Line([x, y + h]),
                    Verb::Close,
                ];
                let mark = Mark::Shape {
                    item: item.to_string(),
                    verbs,
                    fill: Some((Fill::Solid(color), scene::run_opacity(runs, dec.grapheme))),
                    stroke: None,
                };
                draws.push(json!({"mark": mark_json(&mark)?, "clip": null, "scopes": []}));
            }
            continue;
        }
        draws.push(json!({
            "mark": mark_json(&d.mark)?, "clip": d.clip, "scopes": scopes_json(item, &d.scopes)?,
        }));
    }
    Ok(draws)
}

fn pen(at: f32) -> (i32, u8) {
    let steps = (at * f32::from(PHASES)).round() as i32;
    let whole = steps.div_euclid(i32::from(PHASES));
    (whole, (steps - whole * i32::from(PHASES)) as u8)
}

fn scopes_json(item: &str, scopes: &[Scope]) -> Result<Value, Value> {
    let listed = scopes
        .iter()
        .map(|s| match s {
            Scope::Clip { item, rect, radius } => {
                Ok(json!({"item": item, "rect": rect, "radius": radius}))
            }
            _ => Err(unsaved(item, "a mark inside a mask, matte or group")),
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Array(listed))
}

fn fill_json(item: &str, fill: &Fill) -> Result<Value, Value> {
    match fill {
        Fill::Solid(c) => Ok(json!({"solid": c})),
        Fill::Linear { from, to, at } => Ok(json!({"linear": {"from": from, "to": to, "at": at}})),
        Fill::Ramp(_) => Err(unsaved(item, "a ramp fill")),
    }
}

fn verbs_json(verbs: &[Verb]) -> Value {
    let row = |v: &Verb| match v {
        Verb::Move([x, y]) => json!(["M", x, y]),
        Verb::Line([x, y]) => json!(["L", x, y]),
        Verb::Quad([a, b], [x, y]) => json!(["Q", a, b, x, y]),
        Verb::Cubic([a, b], [c, d], [x, y]) => json!(["C", a, b, c, d, x, y]),
        Verb::Close => json!(["Z"]),
    };
    Value::Array(verbs.iter().map(row).collect())
}

fn line_json(item: &str, line: &Line) -> Result<Value, Value> {
    if line.profile.is_some() {
        return Err(unsaved(item, "a stroke whose width varies"));
    }
    Ok(json!({
        "width": line.width, "paint": fill_json(item, &line.paint)?,
        "opacity": line.opacity, "dashes": line.dashes,
    }))
}

fn mark_json(mark: &Mark) -> Result<Value, Value> {
    Ok(match mark {
        Mark::Rect {
            item,
            bounds,
            radius,
            fill,
        } => json!({
            "kind": "rect", "item": item, "bounds": bounds, "radius": radius,
            "fill": fill_json(item, fill)?,
        }),
        Mark::Circle {
            item,
            center,
            r,
            inner_r,
            color,
        } => json!({
            "kind": "circle", "item": item, "center": center, "r": r, "inner_r": inner_r,
            "color": color,
        }),
        Mark::Path {
            item,
            d,
            geometry,
            offset,
            color,
        } => json!({
            "kind": "path", "item": item, "d": d, "verbs": verbs_json(&geometry.verbs),
            "stroke": geometry.stroke, "fill": geometry.fill, "offset": offset, "color": color,
        }),
        Mark::Shape {
            item,
            verbs,
            fill,
            stroke,
        } => {
            let fill = match fill {
                Some((paint, opacity)) => {
                    json!({"paint": fill_json(item, paint)?, "opacity": opacity})
                }
                None => Value::Null,
            };
            let stroke = match stroke {
                Some(line) => line_json(item, line)?,
                None => Value::Null,
            };
            json!({
                "kind": "shape", "item": item, "verbs": verbs_json(verbs), "fill": fill,
                "stroke": stroke,
            })
        }
        Mark::Text { item, .. } => return Err(unsaved(item, "a text outside its glyphs")),
        Mark::Image { item, .. } => return Err(unsaved(item, "an image")),
    })
}

fn broken(what: &str) -> Value {
    refused(
        "frame_unreadable",
        format!("{DRAWS} of the saved frame: {what}"),
    )
}

fn number(v: &Value, what: &str) -> Result<f64, Value> {
    v.as_f64().ok_or_else(|| broken(what))
}

fn numbers<const N: usize>(v: &Value, what: &str) -> Result<[f64; N], Value> {
    let listed = v
        .as_array()
        .filter(|a| a.len() == N)
        .ok_or_else(|| broken(what))?;
    let mut out = [0.0; N];
    for (o, n) in out.iter_mut().zip(listed) {
        *o = number(n, what)?;
    }
    Ok(out)
}

fn rgb(v: &Value, what: &str) -> Result<Rgb, Value> {
    let listed = v
        .as_array()
        .filter(|a| a.len() == 3)
        .ok_or_else(|| broken(what))?;
    let mut out = [0u8; 3];
    for (o, n) in out.iter_mut().zip(listed) {
        *o = n
            .as_u64()
            .and_then(|n| u8::try_from(n).ok())
            .ok_or_else(|| broken(what))?;
    }
    Ok(out)
}

fn text<'a>(v: &'a Value, what: &str) -> Result<&'a str, Value> {
    v.as_str().ok_or_else(|| broken(what))
}

fn fill_of(v: &Value) -> Result<Fill, Value> {
    if let Some(c) = v.get("solid") {
        return Ok(Fill::Solid(rgb(c, "a solid fill's color")?));
    }
    let l = v.get("linear").ok_or_else(|| broken("a fill"))?;
    Ok(Fill::Linear {
        from: rgb(&l["from"], "a linear fill's from")?,
        to: rgb(&l["to"], "a linear fill's to")?,
        at: numbers(&l["at"], "a linear fill's at")?,
    })
}

fn verbs_of(v: &Value) -> Result<Vec<Verb>, Value> {
    let rows = v.as_array().ok_or_else(|| broken("verbs"))?;
    rows.iter()
        .map(|row| {
            let r = row.as_array().ok_or_else(|| broken("a verb"))?;
            let at = |i: usize| number(&r[i], "a verb's point");
            let point = |i: usize| -> Result<[f64; 2], Value> { Ok([at(i)?, at(i + 1)?]) };
            match (r.first().and_then(Value::as_str), r.len()) {
                (Some("M"), 3) => Ok(Verb::Move(point(1)?)),
                (Some("L"), 3) => Ok(Verb::Line(point(1)?)),
                (Some("Q"), 5) => Ok(Verb::Quad(point(1)?, point(3)?)),
                (Some("C"), 7) => Ok(Verb::Cubic(point(1)?, point(3)?, point(5)?)),
                (Some("Z"), 1) => Ok(Verb::Close),
                _ => Err(broken("a verb")),
            }
        })
        .collect()
}

fn line_of(v: &Value) -> Result<Line, Value> {
    let dashes = match &v["dashes"] {
        Value::Null => None,
        n => Some(
            n.as_u64()
                .and_then(|n| u16::try_from(n).ok())
                .ok_or_else(|| broken("a stroke's dashes"))?,
        ),
    };
    Ok(Line {
        width: number(&v["width"], "a stroke's width")?,
        paint: fill_of(&v["paint"])?,
        opacity: number(&v["opacity"], "a stroke's opacity")?,
        dashes,
        profile: None,
    })
}

fn mark_of(v: &Value) -> Result<Mark, Value> {
    let item = text(&v["item"], "a mark's item")?.to_string();
    Ok(match text(&v["kind"], "a mark's kind")? {
        "rect" => Mark::Rect {
            item,
            bounds: numbers(&v["bounds"], "a rect's bounds")?,
            radius: number(&v["radius"], "a rect's radius")?,
            fill: fill_of(&v["fill"])?,
        },
        "circle" => Mark::Circle {
            item,
            center: numbers(&v["center"], "a circle's center")?,
            r: number(&v["r"], "a circle's r")?,
            inner_r: number(&v["inner_r"], "a circle's inner_r")?,
            color: rgb(&v["color"], "a circle's color")?,
        },
        "path" => Mark::Path {
            item,
            d: text(&v["d"], "a path's d")?.to_string(),
            geometry: Geometry {
                verbs: verbs_of(&v["verbs"])?,
                stroke: match &v["stroke"] {
                    Value::Null => None,
                    w => Some(number(w, "a path's stroke")?),
                },
                fill: v["fill"].as_bool().ok_or_else(|| broken("a path's fill"))?,
            },
            offset: numbers(&v["offset"], "a path's offset")?,
            color: rgb(&v["color"], "a path's color")?,
        },
        "shape" => Mark::Shape {
            item,
            verbs: verbs_of(&v["verbs"])?,
            fill: match &v["fill"] {
                Value::Null => None,
                f => Some((
                    fill_of(&f["paint"])?,
                    number(&f["opacity"], "a shape's fill opacity")?,
                )),
            },
            stroke: match &v["stroke"] {
                Value::Null => None,
                l => Some(line_of(l)?),
            },
        },
        _ => return Err(broken("a mark's kind")),
    })
}

fn drawn_of(v: &Value) -> Result<Drawn, Value> {
    let clip = match &v["clip"] {
        Value::Null => None,
        c => Some(numbers(c, "a mark's clip")?),
    };
    let scopes = v["scopes"]
        .as_array()
        .ok_or_else(|| broken("a mark's scopes"))?
        .iter()
        .map(|s| {
            Ok(Scope::Clip {
                item: text(&s["item"], "a clip's item")?.to_string(),
                rect: numbers(&s["rect"], "a clip's rect")?,
                radius: number(&s["radius"], "a clip's radius")?,
            })
        })
        .collect::<Result<_, Value>>()?;
    Ok(Drawn {
        mark: mark_of(&v["mark"])?,
        clip,
        scopes,
    })
}

fn sprite_of(v: &Value, atlas_len: usize) -> Result<Sprite, Value> {
    let [x, y] = numbers(&v["at"], "a glyph's at")?;
    let [w, h] = numbers(&v["size"], "a glyph's size")?;
    let whole = |n: f64| n.fract() == 0.0 && n >= 0.0 && n <= f64::from(PAGE);
    if !(whole(w) && whole(h) && x.fract() == 0.0 && y.fract() == 0.0) {
        return Err(broken("a glyph's place"));
    }
    let bytes = v["bytes"]
        .as_u64()
        .and_then(|b| usize::try_from(b).ok())
        .ok_or_else(|| broken("a glyph's bytes"))?;
    let size = [w as u32, h as u32];
    let reads = bytes + (size[0] * size[1]) as usize;
    if reads > atlas_len {
        return Err(refused(
            "frame_unreadable",
            format!("{ATLAS} of the saved frame holds {atlas_len} bytes; a glyph of {DRAWS} reads to byte {reads}"),
        ));
    }
    Ok(Sprite {
        at: [x as i64, y as i64],
        size,
        color: rgb(&v["color"], "a glyph's color")?,
        opacity: number(&v["opacity"], "a glyph's opacity")?,
        bytes,
    })
}

fn read_draws(bytes: &[u8], atlas_len: usize) -> Result<Saved, Value> {
    let v: Value = serde_json::from_slice(bytes).map_err(|e| broken(&e.to_string()))?;
    let size = pair(&v["size"]).ok_or_else(|| broken("size"))?;
    let rows = v["draws"].as_array().ok_or_else(|| broken("draws"))?;
    let mut draws = Vec::with_capacity(rows.len());
    for row in rows {
        draws.push(match row.get("sprites") {
            Some(s) => Draw::Sprites(
                s.as_array()
                    .ok_or_else(|| broken("sprites"))?
                    .iter()
                    .map(|s| sprite_of(s, atlas_len))
                    .collect::<Result<_, _>>()?,
            ),
            None => Draw::Mark(Arc::new(drawn_of(row)?)),
        });
    }
    Ok(Saved { size, draws })
}

fn render(app: &App, saved: &Saved, atlas_bytes: &[u8]) -> Result<Vec<u8>, Value> {
    let size = saved.size;
    let mut canvas = vec![0u8; (size[0] * size[1] * 4) as usize];
    let mut pending: Vec<Arc<Drawn>> = Vec::new();
    for d in &saved.draws {
        match d {
            Draw::Mark(m) => pending.push(m.clone()),
            Draw::Sprites(sprites) => {
                shapes(app, &mut canvas, std::mem::take(&mut pending), size)?;
                for s in sprites {
                    sprite(&mut canvas, size, s, atlas_bytes);
                }
            }
        }
    }
    shapes(app, &mut canvas, pending, size)?;
    Ok(canvas)
}

fn shapes(
    app: &App,
    canvas: &mut [u8],
    marks: Vec<Arc<Drawn>>,
    size: [u32; 2],
) -> Result<(), Value> {
    if marks.is_empty() {
        return Ok(());
    }
    let picture = app.worker.call(move |state| {
        let device = state.gpu.recover().map_err(|e| refused("no_device", e))?;
        let vello = state
            .vello2d
            .get_or_insert_with(|| Vello2d::new(&device.device, wgpu::TextureFormat::Rgba8Unorm));
        let marks: Vec<&Drawn> = marks.iter().map(|m| &**m).collect();
        vello.picture(
            &device.device,
            &device.queue,
            &marks,
            size,
            Options::default(),
        )
    })?;
    for (dst, src) in canvas
        .as_chunks_mut::<4>()
        .0
        .iter_mut()
        .zip(picture.as_raw().as_chunks::<4>().0)
    {
        over(dst, [src[0], src[1], src[2]], f64::from(src[3]) / 255.0);
    }
    Ok(())
}

fn sprite(canvas: &mut [u8], size: [u32; 2], s: &Sprite, atlas_bytes: &[u8]) {
    for row in 0..s.size[1] {
        for col in 0..s.size[0] {
            let (x, y) = (s.at[0] + i64::from(col), s.at[1] + i64::from(row));
            if x < 0 || y < 0 || x >= i64::from(size[0]) || y >= i64::from(size[1]) {
                continue;
            }
            let coverage = atlas_bytes[s.bytes + (row * s.size[0] + col) as usize];
            if coverage == 0 {
                continue;
            }
            let i = ((y as u32 * size[0] + x as u32) * 4) as usize;
            let dst = (&mut canvas[i..i + 4]).try_into().expect("four bytes");
            over(dst, s.color, f64::from(coverage) / 255.0 * s.opacity);
        }
    }
}

fn over(dst: &mut [u8; 4], color: Rgb, alpha: f64) {
    let a = alpha.clamp(0.0, 1.0);
    if a <= 0.0 {
        return;
    }
    let below = f64::from(dst[3]) / 255.0 * (1.0 - a);
    let out = a + below;
    for (c, &src) in color.iter().enumerate() {
        let mixed = (f64::from(src) * a + f64::from(dst[c]) * below) / out;
        dst[c] = mixed.round().clamp(0.0, 255.0) as u8;
    }
    dst[3] = (out * 255.0).round().clamp(0.0, 255.0) as u8;
}
