use serde_json::json;

use super::*;

#[test]
fn a_reading_groups_its_thousands() {
    let show = |n| Format::default().show(Some(n));
    assert_eq!(show(1234.0), "1,234");
    assert_eq!(show(98765.0), "98,765");
    assert_eq!(show(12.0), "12");
    assert_eq!(show(0.5), "0.5");
}

#[test]
fn a_format_sets_precision_notation_sign_unit_and_grouping() {
    let f = |v: Value| Format::read(Some(&v), None, "f").unwrap();
    assert_eq!(f(json!({"precision": 2})).show(Some(1234.5)), "1,234.50");
    assert_eq!(
        f(json!({"notation": "percent", "precision": 1})).show(Some(0.256)),
        "25.6%"
    );
    assert_eq!(
        f(json!({"sign": "always", "unit": "ms"})).show(Some(12.0)),
        "+12 ms"
    );
    assert_eq!(f(json!({"group": "none"})).show(Some(-98765.0)), "−98765");
    assert_eq!(f(json!({})).show(None), "—");
    let compact = f(json!({"notation": "compact"}));
    assert_eq!(compact.show(Some(950.0)), "950");
    assert_eq!(compact.show(Some(1234.0)), "1.2K");
    assert_eq!(compact.show(Some(-3_456_789.0)), "−3.5M");
    assert_eq!(compact.show(Some(999_950.0)), "1.0M");
    let duration = f(json!({"notation": "duration"}));
    assert_eq!(duration.show(Some(0.45)), "450 ms");
    assert_eq!(duration.show(Some(3.5)), "3.5 s");
    assert_eq!(duration.show(Some(2.0)), "2 s");
    assert_eq!(duration.show(Some(125.0)), "2 min 05 s");
    assert_eq!(duration.show(Some(3720.0)), "1 h 02 min");
    assert_eq!(
        f(json!({"notation": "duration", "unit": "ms"})).show(Some(1500.0)),
        "1.5 s"
    );
    assert_eq!(
        Format::read(None, Some(&json!("hide")), "f")
            .unwrap()
            .show(None),
        ""
    );
    assert_eq!(
        Format::read(Some(&json!({"notation": "engineering"})), None, "f")
            .unwrap_err()
            .code,
        "format_notation"
    );
}

#[test]
fn a_counter_formats_its_bound_value_s_reading_with_tabular_figures() {
    let doc = json!({
        "size": [100, 40],
        "layers": {"main": {"order": "a0"}},
        "items": {"n": {"id": "n", "kind": "text@1", "layer": "main",
            "params": {"text": {"counter": {"source": "passed", "format": {"notation": "percent"}}}}}},
        "bound_values": {"passed": {"target": "items/other/params/text", "source": "reading:01JB0000000000000000000001"}},
    });
    let doc = doc.as_object().unwrap();
    let items = doc["items"].as_object().unwrap();
    let record = Record {
        readings: [("reading:01JB0000000000000000000001".to_string(), 0.75)].into(),
        ..Record::default()
    };
    let f = frame(doc, items, &palette(), &record, 1.0).unwrap();
    let Mark::Text { spec, .. } = &f.layers[0].marks[0].mark else {
        panic!("a text mark")
    };
    assert_eq!(spec.text, "75%");
    assert!(spec.bound, "a counter shapes with tabular figures");
}

/// #466's build, as a frame draws it: a path of four strokes at progress 0.3 draws its first
/// strokes only, and at 0 none, as `<item>.build` times them (found by #155's demo film).
#[test]
fn a_frame_draws_only_the_strokes_its_build_has_reached() {
    let moves = |progress: f64| {
        let doc = json!({
            "size": [100, 100],
            "layers": {"main": {"order": "a0"}},
            "items": {"p": {"id": "p", "kind": "path@1", "layer": "main", "params": {
                "d": "M 0 10 L 90 10 M 0 30 L 90 30 M 0 50 L 90 50 M 0 70 L 90 70",
                "build": {"progress": progress}, "paint": {"stroke": {"role": "ink", "width": 2}}}}},
        });
        let doc = doc.as_object().unwrap();
        let f = frame(
            doc,
            doc["items"].as_object().unwrap(),
            &palette(),
            &Record::default(),
            1.0,
        )
        .unwrap();
        f.layers
            .iter()
            .flat_map(|l| &l.marks)
            .map(|m| match &m.mark {
                Mark::Shape { verbs, .. } => {
                    verbs.iter().filter(|v| matches!(v, Verb::Move(_))).count()
                }
                Mark::Path { d, .. } => d.matches('M').count(),
                _ => 0,
            })
            .sum::<usize>()
    };
    assert_eq!(moves(1.0), 4);
    assert_eq!(moves(0.3), 2, "stroke 0 whole and stroke 1 a fifth drawn");
    assert_eq!(moves(0.0), 0);
}

fn board(items: Value) -> Value {
    json!({
        "size": [200, 100],
        "layers": {"main": {"order": "a0"}, "other": {"order": "a1"}},
        "items": items,
        "collections": {"clipped": {"members": ["b"]}},
    })
}

fn palette() -> Palette {
    [
        ("ground".to_string(), [255, 255, 255]),
        ("ink".to_string(), [0, 0, 0]),
    ]
    .into()
}

fn draw(doc: &Value) -> Result<Frame, Refused> {
    let doc = doc.as_object().unwrap();
    frame(
        doc,
        doc["items"].as_object().unwrap(),
        &palette(),
        &Record::default(),
        1.0,
    )
}

fn clip_of(f: &Frame, item: &str) -> Option<[f64; 4]> {
    f.layers
        .iter()
        .flat_map(|l| &l.marks)
        .find(|d| d.mark.item() == item)
        .and_then(|d| d.clip)
}

#[test]
fn a_rect_mask_clips_its_children_and_a_collection_to_its_box() {
    let doc = board(json!({
        "m": {"kind": "mask@1", "layer": "main", "params": {"box": [10, 10, 50, 50], "applies_to": "children"}},
        "inner": {"kind": "mask@1", "layer": "main", "parent": "m", "params": {"box": [30, 0, 100, 100], "applies_to": "children"}},
        "a": {"kind": "rect@1", "layer": "main", "parent": "inner", "params": {"box": [0, 0, 200, 100], "paint": {"fill": {"role": "ink"}}}},
        "b": {"kind": "rect@1", "layer": "main", "params": {"box": [0, 0, 200, 100], "paint": {"fill": {"role": "ink"}}}},
        "c": {"kind": "rect@1", "layer": "main", "params": {"box": [0, 0, 200, 100], "paint": {"fill": {"role": "ink"}}}},
        "n": {"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 20, 20], "applies_to": "clipped"}},
    }));
    let f = draw(&doc).unwrap();
    // a is under both masks: their intersection.
    assert_eq!(clip_of(&f, "a"), Some([30.0, 10.0, 30.0, 50.0]));
    assert_eq!(clip_of(&f, "b"), Some([0.0, 0.0, 20.0, 20.0]));
    assert_eq!(clip_of(&f, "c"), None);
    // A mask draws nothing itself.
    assert!(f
        .layers
        .iter()
        .flat_map(|l| &l.marks)
        .all(|d| !d.mark.item().starts_with('m')));
}

#[test]
fn a_mask_never_clips_another_writer_s_items_and_nests_at_most_four_deep() {
    let doc = board(json!({
        "m": {"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 10, 10]}},
        "x": {"kind": "rect@1", "layer": "other", "parent": "m", "params": {"box": [0, 0, 5, 5], "paint": {"fill": {"role": "ink"}}}},
    }));
    assert_eq!(draw(&doc).unwrap_err().code, "mask_writer");
    let mut items = Map::new();
    for k in 0..5 {
        let mut m = json!({"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 100, 100]}});
        if k > 0 {
            m["parent"] = json!(format!("m{}", k - 1));
        }
        items.insert(format!("m{k}"), m);
    }
    items.insert("deep".into(), json!({"kind": "rect@1", "layer": "main", "parent": "m4", "params": {"box": [0, 0, 1, 1], "paint": {"fill": {"role": "ink"}}}}));
    assert_eq!(
        draw(&board(Value::Object(items))).unwrap_err().code,
        "mask_depth"
    );
    // #385 draws a feathered mask; an inverted one still waits.
    let inverted = board(
        json!({"m": {"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 1, 1], "invert": true}}}),
    );
    assert_eq!(draw(&inverted).unwrap_err().code, "mask_r2");
}

fn mark_of<'a>(f: &'a Frame, item: &str) -> &'a Mark {
    &f.layers
        .iter()
        .flat_map(|l| &l.marks)
        .find(|d| d.mark.item() == item)
        .expect("the item draws")
        .mark
}

fn solid(f: &Frame, item: &str) -> Rgb {
    match mark_of(f, item) {
        Mark::Rect {
            fill: Fill::Solid(c),
            ..
        } => *c,
        other => panic!("{item} is not a solid rect: {other:?}"),
    }
}

/// Three 10 u squares under `g` at x 0, 50 and 100, ordered c, b, a, each stepped by `steps`.
fn stepped(steps: Value) -> Frame {
    let sq = |x: i32, order: &str| {
        json!({"kind": "rect@1", "layer": "main", "parent": "g", "order": order,
            "params": {"box": [x, 0, 10, 10], "paint": {"fill": {"steps": steps.clone()}}}})
    };
    let mut doc = board(json!({
        "g": {"kind": "group@1", "layer": "main", "params": {}},
        "a": sq(0, "a2"), "b": sq(50, "a1"), "c": sq(100, "a0"),
    }));
    doc["collections"]["ends"] = json!({"members": ["a", "c"]});
    draw(&doc).unwrap()
}

#[test]
fn steps_place_a_member_by_its_box_or_its_rank_among_a_collection_s_members() {
    let stops = json!([{"at": 0, "role": "ink"}, {"at": 1, "role": "ground"}]);
    let (ink, ground) = ([0, 0, 0], [255, 255, 255]);
    // By order, a ranks last of the three; by x it stands first.
    let f = stepped(json!({"over": "children", "stops": stops, "by": "order"}));
    assert_eq!((solid(&f, "a"), solid(&f, "c")), (ground, ink));
    let f = stepped(json!({"over": "children", "stops": stops, "by": "x"}));
    assert_eq!((solid(&f, "a"), solid(&f, "c")), (ink, ground));
    let mid = solid(&f, "b");
    assert!(mid != ink && mid != ground && mid[0] == mid[1] && mid[1] == mid[2]);
    // By distance from a's center, 100 u out reaches the last stop.
    let by = json!({"distance": {"from": [5, 5], "radius": 100}});
    let f = stepped(json!({"over": "children", "stops": stops, "by": by}));
    assert_eq!(
        (solid(&f, "a"), solid(&f, "b"), solid(&f, "c")),
        (ink, mid, ground)
    );
    // Over a collection of two, c ranks first and a last; b isn't a member.
    let ends = json!({"over": "ends", "stops": stops, "by": "order"});
    let mut doc = board(json!({
        "a": {"kind": "rect@1", "layer": "main", "order": "a1", "params": {"box": [0, 0, 10, 10], "paint": {"fill": {"steps": ends}}}},
        "c": {"kind": "rect@1", "layer": "main", "order": "a0", "params": {"box": [100, 0, 10, 10], "paint": {"fill": {"steps": ends}}}},
        "b": {"kind": "rect@1", "layer": "main", "params": {"box": [50, 0, 10, 10], "paint": {"fill": {"steps": ends}}}},
    }));
    doc["collections"]["ends"] = json!({"members": ["a", "c"]});
    let r = draw(&doc).unwrap_err();
    assert_eq!(
        (r.code, r.path.as_str()),
        ("bad_paint", "items/b/params/paint/fill/steps/over")
    );
    doc["items"].as_object_mut().unwrap().remove("b");
    let f = draw(&doc).unwrap();
    assert_eq!((solid(&f, "a"), solid(&f, "c")), (ground, ink));
}

#[test]
fn a_gradient_spans_another_item_s_box_and_runs_along_strokes_alone() {
    let gradient = |span: &str| json!({"gradient": {"span": span, "stops": [{"at": 0, "role": "ink"}, {"at": 1, "role": "ground"}]}});
    let doc = board(json!({
        "g": {"kind": "group@1", "layer": "main", "params": {}},
        "p": {"kind": "rect@1", "layer": "main", "parent": "g", "params": {"box": [20, 10, 30, 30]}},
        "q": {"kind": "rect@1", "layer": "main", "parent": "g", "params": {"box": [120, 30, 40, 30]}},
        "r": {"kind": "rect@1", "layer": "main", "params": {"box": [0, 0, 10, 10], "paint": {"fill": gradient("g")}}},
    }));
    // p and q draw nothing, yet the group's box is theirs: x 20 to 160, y 10 to 60.
    let doc = {
        let mut d = doc;
        for k in ["p", "q"] {
            d["items"][k]["params"]["paint"] = json!({"fill": {"role": "ink"}});
        }
        d
    };
    let f = draw(&doc).unwrap();
    let Mark::Rect {
        fill: Fill::Ramp(r),
        ..
    } = mark_of(&f, "r")
    else {
        panic!("r's fill is a ramp")
    };
    assert_eq!(
        r.geometry,
        paint::Geometry::Linear {
            from: [20.0, 35.0],
            to: [160.0, 35.0]
        }
    );
    let mut missing = doc.clone();
    missing["items"]["r"]["params"]["paint"] = json!({"fill": gradient("nowhere")});
    assert_eq!(draw(&missing).unwrap_err().code, "ref_unresolved");
    let mut fill_along = doc.clone();
    fill_along["items"]["r"]["params"]["paint"]["fill"]["gradient"]["kind"] = json!("along");
    assert_eq!(draw(&fill_along).unwrap_err().code, "gradient_kind");
}

#[test]
fn a_path_draws_at_most_10_000_dashes() {
    let dashed = |count: u64| {
        board(json!({"o": {"kind": "circle@1", "layer": "main",
            "params": {"center": [50, 50], "r": 40, "paint": {"stroke": {"role": "ink", "dash": {"count": count}}}}}}))
    };
    let most = draw(&dashed(10_000)).unwrap();
    let Mark::Shape {
        stroke: Some(line), ..
    } = mark_of(&most, "o")
    else {
        panic!("a stroked circle is an outline")
    };
    assert_eq!(line.dashes, Some(10_000));
    let r = draw(&dashed(10_001)).unwrap_err();
    assert_eq!(
        (r.code, r.path.as_str()),
        ("out_of_range", "items/o/params/paint/stroke/dash/count")
    );
}

#[test]
fn a_document_s_mark_sets_hold_at_most_16m_rows_together() {
    let set = |k: usize| {
        (
            format!("s{k:02}"),
            json!({"kind": "marks@1", "layer": "main", "params": {"mark": "point", "n": 1_000_000}}),
        )
    };
    let items: Map<_, _> = (0..17).map(set).collect();
    let r = draw(&board(Value::Object(items))).unwrap_err();
    assert_eq!(
        (r.code, r.path.as_str()),
        ("out_of_range", "items/s16/params/n")
    );
}

#[test]
fn an_image_is_named_by_its_hash_and_needs_its_alt_text() {
    let hash = "ab".repeat(32);
    let ok = board(json!({"shot": {"kind": "image@1", "layer": "main",
        "params": {"asset": hash, "box": [0, 0, 100, 50], "fit": "cover", "alt": "The failing step"}}}));
    let f = draw(&ok).unwrap();
    let Mark::Image { asset, fit, .. } = &f.layers[0].marks[0].mark else {
        panic!("an image")
    };
    assert_eq!((asset.as_str(), *fit), (hash.as_str(), ImageFit::Cover));
    let mut no_alt = ok.clone();
    no_alt["items"]["shot"]["params"]["alt"] = json!("");
    assert_eq!(draw(&no_alt).unwrap_err().code, "alt_missing");
    let mut by_path = ok.clone();
    by_path["items"]["shot"]["params"]["asset"] = json!("/tmp/shot.png");
    assert_eq!(draw(&by_path).unwrap_err().code, "bad_asset");
}
/// The non-zero winding of `verbs` about `p`, from its sub-paths flattened at 64 points a
/// segment.
fn winding(verbs: &[Verb], p: [f64; 2]) -> i32 {
    let mut w = 0;
    for sub in pathops::subs_of(verbs) {
        let mut pts: Vec<[f64; 2]> = Vec::new();
        for seg in &sub.segs {
            for i in 0..64 {
                pts.push(seg.at(i as f64 / 64.0));
            }
        }
        let n = pts.len();
        for i in 0..n {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            if a[1] <= p[1] {
                if b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) > (p[0] - a[0]) * (b[1] - a[1]) {
                    w += 1;
                }
            } else if b[1] <= p[1] && (b[0] - a[0]) * (p[1] - a[1]) < (p[0] - a[0]) * (b[1] - a[1])
            {
                w -= 1;
            }
        }
    }
    w
}

#[test]
fn a_crescent_shade_sits_on_the_far_side_and_its_highlight_on_the_near_side() {
    // #160, Paint: shade: a 40 u circle lit from the left (light 180°) shaded by 8 u with a
    // 10 u highlight. The shade covers a point near the right edge and none near the left
    // edge; the highlight the other way round; the middle keeps the fill.
    let doc = board(json!({
        "ball": {"kind": "circle@1", "layer": "main", "order": "a0", "params": {
            "center": [100, 50], "r": 40,
            "paint": {"fill": {"role": "ink"}, "shade": {"kind": "crescent", "role": "ink", "offset": 8, "light": 180,
                "highlight": {"role": "ground", "offset": 10}}}}},
    }));
    let f = draw(&doc).unwrap();
    let verbs_of = |item: &str| -> Vec<Verb> {
        f.layers[0]
            .marks
            .iter()
            .find_map(|m| match &m.mark {
                Mark::Shape { item: i, verbs, .. } if i == item => Some(verbs.clone()),
                _ => None,
            })
            .unwrap_or_else(|| panic!("{item} is drawn"))
    };
    let (shade, highlight) = (verbs_of("ball#shade"), verbs_of("ball#highlight"));
    let (far, near, middle) = ([136.0, 50.0], [64.0, 50.0], [100.0, 50.0]);
    assert_ne!(winding(&shade, far), 0, "the shade covers the far side");
    assert_eq!(winding(&shade, near), 0, "the shade leaves the near side");
    assert_eq!(winding(&shade, middle), 0, "the shade leaves the middle");
    assert_ne!(
        winding(&highlight, near),
        0,
        "the highlight covers the near side"
    );
    assert_eq!(
        winding(&highlight, far),
        0,
        "the highlight leaves the far side"
    );
    assert_eq!(
        winding(&highlight, middle),
        0,
        "the highlight leaves the middle"
    );
}

#[test]
fn marks_draw_by_z_then_by_the_tree_not_by_flat_order_keys() {
    // #160: a group's child draws with its group, after an earlier top-level item, whatever
    // its own order key says; a z above lifts it over everything in the layer.
    let doc = |z: f64| {
        board(json!({
            "r": {"kind": "rect@1", "layer": "main", "order": "a3", "params": {"box": [0, 0, 10, 10], "paint": {"fill": {"role": "ink"}}}},
            "g": {"kind": "group@1", "layer": "main", "order": "a5", "params": {}},
            "c": {"kind": "rect@1", "layer": "main", "order": "a0", "parent": "g", "params": {"box": [5, 5, 10, 10], "z": z, "paint": {"fill": {"role": "ink"}}}},
            "d": {"kind": "rect@1", "layer": "main", "order": "a1", "params": {"box": [50, 50, 10, 10], "z": -1, "paint": {"fill": {"role": "ink"}}}},
        }))
    };
    let order = |z: f64| -> Vec<String> {
        draw(&doc(z)).unwrap().layers[0]
            .marks
            .iter()
            .map(|m| m.mark.item().to_string())
            .collect()
    };
    assert_eq!(order(0.0), ["d", "r", "c"]);
    assert_eq!(order(1.0), ["d", "r", "c"]);
    let mut below = doc(0.0);
    below["items"]["r"]["params"]["z"] = json!(2);
    let marks: Vec<String> = draw(&below).unwrap().layers[0]
        .marks
        .iter()
        .map(|m| m.mark.item().to_string())
        .collect();
    assert_eq!(marks, ["d", "c", "r"]);
}
