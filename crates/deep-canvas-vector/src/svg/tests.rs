use super::*;

#[test]
fn a_half_circle_arc_ends_where_it_says_and_bulges_by_its_radius() {
    let ((verbs, _), complete) = path_data("M 0 0 A 10 10 0 0 1 20 0");
    assert!(complete);
    assert!(matches!(verbs.last(), Some(Verb::Cubic(_, _, [20.0, 0.0]))));
    let b = bounds(&verbs).unwrap();
    assert!(
        (b[0] - 0.0).abs() < 1e-6 && (b[2] - 20.0).abs() < 1e-6,
        "{b:?}"
    );
    assert!(
        (b[1] + 10.0).abs() < 0.01 && (b[3] - 10.0).abs() < 0.01,
        "{b:?}"
    );
}

fn read(svg: &str) -> Svg {
    import(svg.as_bytes(), &[], Twin::Honest).unwrap()
}

#[test]
fn a_user_space_mask_with_no_region_covers_the_viewport() {
    let svg = read(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <mask id="m" maskUnits="userSpaceOnUse"><rect width="100" height="100" fill="white"/></mask>
            <rect x="10" y="10" width="50" height="50" mask="url(#m)"/></svg>"#,
    );
    let region = &svg.clips[svg.clips[svg.paths[0].clip.unwrap()].parent.unwrap()];
    assert_eq!(bounds(&region.verbs), Some([-10.0, -10.0, 120.0, 120.0]));
}

#[test]
fn a_style_rule_and_an_attribute_set_one_opacity_the_last_winning() {
    let svg = read(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
            <style>rect { opacity: 0.5 }</style><rect width="5" height="5" opacity="0.5"/></svg>"#,
    );
    assert_eq!(svg.paths[0].fill.unwrap().opacity, 0.5);
}

#[test]
fn a_marker_draws_at_the_opacity_of_the_element_it_marks() {
    let svg = read(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <marker id="k" markerUnits="userSpaceOnUse" markerWidth="4" markerHeight="4">
            <rect width="4" height="4"/></marker>
            <path d="M 10 10 L 50 10" stroke="black" opacity="0.5" marker-end="url(#k)"/></svg>"#,
    );
    assert_eq!(svg.paths[1].fill.unwrap().opacity, 0.5);
}

fn doc(body: &str) -> String {
    format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">{body}</svg>"#)
}

#[test]
fn a_marker_that_marks_itself_refuses_instead_of_doubling_each_level() {
    let svg = doc(
        r#"<marker id="m" overflow="visible" markerUnits="userSpaceOnUse">
            <path d="M0 0 L1 0" marker-start="url(#m)" marker-end="url(#m)"/></marker>
            <path d="M0 0 L1 0" marker-start="url(#m)" marker-end="url(#m)"/>"#,
    );
    let found = import(svg.as_bytes(), &[], Twin::Honest);
    assert!(
        matches!(found, Err(Refusal::Malformed(_))),
        "{:?}",
        found.map(|s| s.paths.len())
    );
}

#[test]
fn a_pattern_inside_its_own_tiles_refuses_instead_of_multiplying_them() {
    let svg = doc(
        r#"<pattern id="p" patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="1" height="1"/><rect width="64" height="64" fill="url(#p)"/></pattern>
            <rect width="64" height="64" fill="url(#p)"/>"#,
    );
    let found = import(svg.as_bytes(), &[], Twin::Honest);
    assert!(
        matches!(found, Err(Refusal::Malformed(_))),
        "{:?}",
        found.map(|s| s.paths.len())
    );
}

#[test]
fn an_alpha_mask_takes_its_shapes_alpha_not_their_luminance() {
    let svg = read(&doc(
        r##"<mask id="k" style="mask-type:alpha"><rect width="64" height="64" fill="#D9D9D9"/></mask>
            <rect width="64" height="64" fill="red" mask="url(#k)"/>"##,
    ));
    assert_eq!(svg.clips[svg.paths[0].clip.unwrap()].alpha, 1.0);
}

#[test]
fn a_style_rule_hiding_an_element_hides_it() {
    let svg = read(&doc(
        r#"<style>.st0{display:none}</style><rect class="st0" width="64" height="64"/>"#,
    ));
    assert!(svg.paths.is_empty(), "{:?}", svg.paths);
}

#[test]
fn a_css_transform_is_named_not_dropped() {
    let svg = read(&doc(
        r#"<style>rect{transform:translate(10px,0)}</style><rect width="4" height="4"/>"#,
    ));
    assert!(
        svg.unread.contains(&"transform".to_string()),
        "{:?}",
        svg.unread
    );
}

#[test]
fn a_style_reference_outside_the_svg_refuses_it() {
    for body in [
        r#"<style>rect{fill:url(https://x.test/a.svg#p)}</style><rect width="4" height="4"/>"#,
        r#"<rect width="4" height="4" style="fill:url(#a);stroke:url(https://x.test/b.svg#q)"/>"#,
    ] {
        let found = import(doc(body).as_bytes(), &[], Twin::Honest);
        assert!(
            matches!(found, Err(Refusal::External(_))),
            "{body}: {found:?}"
        );
    }
}

#[test]
fn a_paint_server_with_a_fallback_color_draws_the_server_or_the_color() {
    let tiles = read(&doc(
        r#"<pattern id="p" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="4" height="4" fill="blue"/></pattern>
            <rect width="64" height="64" fill="url(#p) red"/>"#,
    ));
    assert_eq!(tiles.paths.len(), 64);
    let fallback = read(&doc(
        r#"<rect width="4" height="4" fill="url(#none) red"/>"#,
    ));
    assert_eq!(
        fallback.paths[0].fill.unwrap().color,
        Color::Rgb([255, 0, 0])
    );
}

#[test]
fn an_even_odd_rule_the_clips_cannot_carry_is_named() {
    let pattern = read(&doc(
        r#"<pattern id="p" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="8" height="8" fill="blue"/></pattern>
            <path fill-rule="evenodd" d="M0 0H64V64H0Z M16 16H48V48H16Z" fill="url(#p)"/>"#,
    ));
    assert!(
        pattern.unread.contains(&"fill-rule".to_string()),
        "{:?}",
        pattern.unread
    );
    let clip = read(&doc(
        r#"<g clip-rule="evenodd"><clipPath id="c"><path d="M0 0H64V64H0Z M16 16H48V48H16Z"/>
            </clipPath></g><rect width="64" height="64" clip-path="url(#c)"/>"#,
    ));
    assert!(
        clip.unread.contains(&"clipPath".to_string()),
        "{:?}",
        clip.unread
    );
}

#[test]
fn a_bounding_box_clip_on_an_element_with_tiles_or_markers_is_named() {
    let svg = read(&doc(
        r#"<pattern id="p" patternUnits="userSpaceOnUse" width="7" height="7">
            <rect width="7" height="7" fill="blue"/></pattern>
            <clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="0.5" height="1"/></clipPath>
            <rect width="10" height="10" fill="url(#p)" clip-path="url(#c)"/>"#,
    ));
    assert!(
        svg.unread.contains(&"clipPath".to_string()),
        "{:?}",
        svg.unread
    );
}

#[test]
fn a_pattern_inherits_what_its_ancestors_set() {
    let svg = read(&doc(
        r#"<g fill="blue"><pattern id="p" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="4" height="4"/></pattern></g>
            <rect width="8" height="8" fill="url(#p)"/>"#,
    ));
    assert_eq!(svg.paths[0].fill.unwrap().color, Color::Rgb([0, 0, 255]));
}

#[test]
fn numbers_run_together_as_svg_writes_them() {
    assert_eq!(numbers("1-2.5.5e1,3"), vec![1.0, -2.5, 5.0, 3.0]);
    let ((verbs, _), _) = path_data("m1 1l2 0h1v1z");
    assert_eq!(verbs[3], Verb::Line([4.0, 2.0]));
}

/// A rect inside `n` groups, each opened by `open`.
fn nested(open: &str, n: usize) -> String {
    let (opens, closes) = (open.repeat(n), "</g>".repeat(n));
    doc(&format!(r#"{opens}<rect width="4" height="4"/>{closes}"#))
}

#[test]
fn groups_nested_past_the_limit_are_refused() {
    for open in ["<g>", r#"<g a="/>">"#, "<g a='>'\n>"] {
        let found = import(nested(open, 300).as_bytes(), &[], Twin::Honest);
        assert!(
            matches!(&found, Err(Refusal::Malformed(what)) if what.contains("nest")),
            "{open}: {:?}",
            found.map(|s| s.paths.len())
        );
    }
}

/// `chain` groups that each hold the next through a `<use>`, `deep` groups down; the last
/// holds a rect, and `first` names the first.
fn chained(deep: usize, chain: usize, first: &str) -> String {
    let (opens, closes) = ("<g>".repeat(deep), "</g>".repeat(deep));
    let groups: String = (0..chain)
        .map(|k| {
            let held = if k + 1 < chain {
                format!(r##"<use href="#u{}"/>"##, k + 1)
            } else {
                r#"<rect width="4" height="4" fill="white"/>"#.to_string()
            };
            format!(r#"<g id="u{k}">{opens}{held}{closes}</g>"#)
        })
        .collect();
    doc(&format!("<defs>{groups}</defs>{first}"))
}

#[test]
fn groups_nested_past_the_limit_through_uses_are_refused() {
    let svg = chained(50, 16, r##"<use href="#u0"/>"##);
    let found = import(svg.as_bytes(), &[], Twin::Honest);
    assert!(
        matches!(&found, Err(Refusal::Malformed(what)) if what.contains("nest")),
        "{:?}",
        found.map(|s| s.paths.len())
    );
    assert_eq!(
        read(&chained(1, 16, r##"<use href="#u0"/>"##)).paths.len(),
        1
    );
}

#[test]
fn a_mask_nested_past_the_limit_through_uses_is_left_unread() {
    let masked =
        r##"<mask id="m"><use href="#u0"/></mask><rect width="9" height="9" mask="url(#m)"/>"##;
    let svg = read(&chained(60, 15, masked));
    assert!(svg.unread.iter().any(|u| u == "mask"), "{:?}", svg.unread);
    let svg = read(&chained(1, 15, masked));
    assert!(!svg.unread.iter().any(|u| u == "mask"), "{:?}", svg.unread);
}

#[test]
fn nesting_inside_the_limit_still_imports() {
    // The `<svg>`, 62 groups and the rect stand 64 deep; one group more is over.
    assert_eq!(read(&nested("<g>", 62)).paths.len(), 1);
    assert!(import(nested("<g>", 63).as_bytes(), &[], Twin::Honest).is_err());
    // Tags inside a comment, a CDATA section or an instruction open nothing.
    let opens = "<g>".repeat(300);
    for held in [
        format!("<!-- {opens} -->"),
        format!("<desc><![CDATA[{opens}]]></desc>"),
        format!("<?note {opens}?>"),
    ] {
        let svg = read(&doc(&format!(r#"{held}<rect width="4" height="4"/>"#)));
        assert_eq!(svg.paths.len(), 1, "{}", &held[..12]);
    }
    // Siblings that close, with and without a tag of their own, never add up.
    let flat = r#"<g><rect width="4" height="4"/></g><g/>"#.repeat(300);
    assert_eq!(read(&doc(&flat)).paths.len(), 300);
}
