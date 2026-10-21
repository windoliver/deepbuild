//! The shaper and the atlas on the bundled fonts: only the bundled families, the mono role by
//! column, each glyph rasterized once, and a full atlas starting over. The fit check and tabular
//! figures are proven through the CLI in tests/acceptance/390.

use deep_text::{Atlas, Role, Shaper, Spec, PAGES};

#[test]
fn bundled_families_only() {
    let mut shaper = Shaper::new();
    let mut families = shaper.families();
    families.sort();
    assert_eq!(families, ["Inter", "JetBrains Mono"]);
}

#[test]
fn mono_lines_up_by_column() {
    let mut shaper = Shaper::new();
    let spec = Spec {
        role: Role::Mono,
        ..Spec::label("iiii")
    };
    let narrow = shaper.shape(&spec).width;
    let wide = shaper
        .shape(&Spec {
            text: "MMMM",
            ..spec
        })
        .width;
    assert!((narrow - wide).abs() < 0.01);
}

#[test]
fn atlas_rasterizes_each_glyph_once() {
    let mut shaper = Shaper::new();
    let mut atlas = Atlas::new();
    let shaped = shaper.shape(&Spec::label("Hello, 390"));
    let mut placed = Vec::new();
    for glyph in &shaped.glyphs {
        placed.push(atlas.glyph(&glyph.font, glyph.id, glyph.size * 2.));
    }
    let drawn = placed.iter().flatten().count();
    assert_eq!(drawn, 9, "a space is blank; the rest are drawn: {placed:?}");
    let once = atlas.rasterized();
    assert_eq!(
        once, 9,
        "nine distinct glyphs, the space and the second l among them"
    );
    for glyph in &shaped.glyphs {
        atlas.glyph(&glyph.font, glyph.id, glyph.size * 2.);
    }
    assert_eq!(
        atlas.rasterized(),
        once,
        "a second frame rasterizes nothing"
    );
    assert_eq!(atlas.pages().len(), 1);
    let page = &atlas.pages()[0];
    assert!(page.bytes().contains(&255), "a solid pixel somewhere");
    let h = placed[0].unwrap();
    assert!(h.w > 0 && h.h > 10 && h.top < 0, "{h:?}");
}

#[test]
fn a_full_atlas_starts_over_at_a_new_generation() {
    let mut shaper = Shaper::new();
    let mut atlas = Atlas::new();
    let shaped = shaper.shape(&Spec::label("WMQ@&%"));
    let glyph = &shaped.glyphs[0];
    assert!(!atlas.make_room(), "an empty atlas has room");
    // Each glyph at each device size is a raster of its own; large ones fill pages fast.
    let mut size = 200.;
    'fill: loop {
        for glyph in &shaped.glyphs {
            if atlas.glyph(&glyph.font, glyph.id, size).is_none() {
                break 'fill;
            }
        }
        size += 1.;
        assert!(size < 256., "the pages never fill");
    }
    assert_eq!(atlas.pages().len(), PAGES, "no page beyond the cap");
    assert!(
        atlas.glyph(&glyph.font, glyph.id, size + 1.).is_none(),
        "still no room, and the refusal is not remembered as a blank glyph"
    );
    let before = atlas
        .pages()
        .iter()
        .map(|page| page.generation())
        .max()
        .unwrap();
    assert!(atlas.make_room(), "{PAGES} pages are full");
    assert_eq!(atlas.pages().len(), 0);
    let placed = atlas.glyph(&glyph.font, glyph.id, size + 1.).unwrap();
    assert_eq!(
        (placed.page, placed.x, placed.y),
        (0, 1, 1),
        "page 0, from its corner"
    );
    assert!(
        atlas.pages()[0].generation() > before,
        "a generation no page had, so GPUI never mistakes the new page for one it holds"
    );
}
