//! The shaper and the atlas on the bundled fonts: only the bundled families, the mono role by
//! column, each glyph rasterized once, and a full atlas starting over. The fit check and tabular
//! figures are proven through the CLI in tests/acceptance/390.

use deep_text::{raster_size, Atlas, Role, Shaper, Spec, PAGES};

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

#[test]
fn a_ticking_atlas_evicts_the_page_least_recently_drawn_from() {
    let mut shaper = Shaper::new();
    let mut atlas = Atlas::new();
    let shaped = shaper.shape(&Spec::label("WMQ@&%"));
    // One device size a frame, each a raster of its own, so pages fill in frame order.
    let mut size = 150.;
    let frame = |atlas: &mut Atlas, size: f32| {
        atlas.tick();
        shaped
            .glyphs
            .iter()
            .map(|g| atlas.glyph(&g.font, g.id, size))
            .collect::<Vec<_>>()
    };
    while atlas.pages().len() < PAGES {
        frame(&mut atlas, size);
        size += 1.;
    }
    let first = atlas.pages()[0].generation();
    let mut last = Vec::new();
    while atlas.pages()[0].generation() == first {
        assert!(size < 256., "page 0 never started over");
        last = frame(&mut atlas, size);
        assert!(
            last.iter().all(Option::is_some),
            "a full atlas evicts instead of refusing"
        );
        size += 1.;
    }
    assert!(
        !atlas.make_room(),
        "nothing was refused, so nothing starts over whole"
    );
    let again = frame(&mut atlas, size - 1.);
    assert_eq!(
        again, last,
        "the page this frame drew from keeps its glyphs"
    );
}

#[test]
fn raster_sizes_step_by_about_twelve_percent() {
    let sizes: Vec<f32> = (8..=64).map(|px| raster_size(f64::from(px))).collect();
    let mut steps: Vec<f32> = sizes.clone();
    steps.dedup();
    for pair in steps.windows(2) {
        let ratio = pair[1] / pair[0];
        assert!((ratio - 1.1225).abs() < 0.001, "{pair:?}");
    }
    for (px, s) in (8..=64).zip(&sizes) {
        assert!(
            (s / px as f32 - 1.).abs() < 0.062,
            "{px} px rasterizes at {s}"
        );
    }
}
