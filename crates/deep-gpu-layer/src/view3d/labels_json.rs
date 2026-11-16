use super::*;

/// Each label's glyphs, with their places in the core's glyph atlas, and the pages they sample,
/// each written as an 8-bit grayscale PNG of its alpha named by its SHA-256.
/// #468: each overlay's leader over the frame `bgra` (`size` px, premultiplied BGRA), its straight
/// RGBA picture laid on by its coverage.
pub(super) fn leaders_over(
    overlays: &[deep_canvas_scene3d::scene::Overlay],
    bgra: &mut [u8],
    size: [u32; 2],
) {
    for l in overlays.iter().filter_map(|o| o.leader.as_ref()) {
        let Some(p) = deep_canvas_scene3d::overlay::leader_picture(l) else {
            continue;
        };
        let w = i64::from(p.size[0]);
        for (k, s) in p.rgba.as_chunks::<4>().0.iter().enumerate() {
            let (dx, dy) = (p.at[0] + k as i64 % w, p.at[1] + k as i64 / w);
            let a = u32::from(s[3]);
            if a == 0 || dx < 0 || dy < 0 || dx >= i64::from(size[0]) || dy >= i64::from(size[1]) {
                continue;
            }
            let o = ((dy * i64::from(size[0]) + dx) * 4) as usize;
            let d = &mut bgra[o..o + 4];
            let over = |src: u8, dst: u8| {
                ((u32::from(src) * a + u32::from(dst) * (255 - a) + 127) / 255) as u8
            };
            d[0] = over(s[2], d[0]);
            d[1] = over(s[1], d[1]);
            d[2] = over(s[0], d[2]);
            d[3] = over(255, d[3]);
        }
    }
}

pub(super) fn labels_json(scene: &Scene, out: &str) -> Result<(Value, Value), Value> {
    let mut labels = Vec::new();
    let mut sampled = BTreeSet::new();
    for l in scene.layers.iter().flat_map(|layer| &layer.labels) {
        let glyphs: Vec<Value> = l
            .glyphs
            .iter()
            .map(|g| {
                let atlas = g.atlas.map(|a| {
                    sampled.insert(a.page);
                    json!({"page": a.page, "x": a.x, "y": a.y, "w": a.w, "h": a.h, "raster": g.raster})
                });
                json!({
                    "font": format!("crates/deep-text/fonts/{}", g.file), "size": g.size, "id": g.id,
                    "x": g.x, "y": g.y, "grapheme": g.grapheme, "atlas": atlas,
                })
            })
            .collect();
        labels.push(json!({"item": l.id, "glyphs": glyphs}));
    }
    let mut pages = Vec::new();
    for page in sampled {
        let bytes = &scene.pages[page as usize].bytes;
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(bytes, PAGE, PAGE, image::ExtendedColorType::L8)
            .map_err(|e| refused("not_written", e.to_string()))?;
        pages.push(json!({"page": page, "png": write_named(out, &png, "png")?}));
    }
    Ok((json!(labels), json!(pages)))
}
