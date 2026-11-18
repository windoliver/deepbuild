use super::*;
use serde_json::json;

#[test]
fn a_linear_scale_ticks_on_one_two_five_and_maps_its_nice_domain() {
    let s = Scale::read(
        "s",
        &json!({"params": {"domain": [3, 97], "range": [0, 200]}}),
        &Map::new(),
    )
    .unwrap();
    assert_eq!(s.step, 20.0);
    assert_eq!(s.domain, [0.0, 100.0]);
    assert_eq!(s.map(50.0), 100.0);
    let labels: Vec<String> = s.ticks().into_iter().map(|t| t.1).collect();
    assert_eq!(labels, ["0", "20", "40", "60", "80", "100"]);
}

#[test]
fn a_symlog_scale_passes_through_zero_and_a_log_scale_ticks_on_decades() {
    let scale = |p: Value| scale_of("s", &json!({"params": p})).unwrap();
    let sym = scale(json!({"type": "symlog", "domain": [-100, 100], "range": [0, 100]}));
    assert_eq!(sym.map(0.0), 50.0);
    assert!(sym.map(1.0) > 50.0 && sym.map(10.0) - sym.map(1.0) < sym.map(1.0));
    let ticks: Vec<f64> = sym.ticks().iter().map(|t| t.0).collect();
    assert_eq!(ticks, [-100.0, -10.0, -1.0, 0.0, 1.0, 10.0, 100.0]);
    let log = scale(json!({"type": "log", "domain": [2, 300], "range": [0, 300]}));
    assert_eq!(log.domain, [1.0, 1000.0]);
    assert!((log.map(10.0) - 100.0).abs() < 1e-9);
}

#[test]
fn an_axis_through_zero_crosses_at_the_other_scales_zero_clamped_to_the_pane() {
    let items = |domain: Value| {
        json!({
            "xs": {"kind": "scale@1", "params": {"domain": [0, 10], "range": [0, 100], "nice": false}},
            "ys": {"kind": "scale@1", "params": {"domain": domain, "range": [100, 0], "nice": false}},
            "dots": {"kind": "marks@1", "params": {"encode": {
                "x": {"column": "x", "scale": "xs"}, "y": {"column": "y", "scale": "ys"}}}},
        })
    };
    let line_y = |domain: Value| {
        let all = items(domain);
        let axis = json!({"params": {"scale": "xs", "side": "zero", "role": "ink"}});
        let palette = Palette::from([("ink".to_string(), [0, 0, 0])]);
        let drawn = super::axis(
            "a",
            &axis,
            (all.as_object().unwrap(), None),
            &palette,
            [0.0, 0.0],
            [640.0, 480.0],
        );
        match drawn.unwrap().marks[0] {
            Mark::Rect { bounds, .. } => bounds[1] + bounds[3] / 2.0,
            _ => panic!("an axis line along x is a rect"),
        }
    };
    assert_eq!(line_y(json!([-10, 10])), 50.0);
    assert_eq!(line_y(json!([5, 10])), 100.0);
}

#[test]
fn a_time_scale_ticks_on_calendar_units_in_utc() {
    // 2026-10-21 14:00 to 14:20 UTC.
    let start = 1_792_591_200_000.0;
    let s = Scale::read("t", &json!({"params": {"type": "time", "domain": [start, start + 1_200_000.0], "range": [0, 400]}}), &Map::new()).unwrap();
    assert_eq!(s.step, 300_000.0, "five-minute ticks");
    let labels: Vec<String> = s.ticks().into_iter().map(|t| t.1).collect();
    assert_eq!(labels, ["14:00", "14:05", "14:10", "14:15", "14:20"]);
    assert_eq!(time_label(1_792_591_200_000, 864e5), "2026-10-21");
}

#[test]
fn a_mark_set_draws_a_point_per_row_through_its_scale() {
    let items = json!({"x": {"kind": "scale@1", "params": {"domain": [0, 10], "range": [0, 100], "nice": false}}});
    let items = items.as_object().unwrap();
    // [2.0, 5.0] as little-endian f64.
    let set = json!({"params": {"mark": "point", "n": 2, "key": "k",
            "columns": {"v": {"dtype": "f64", "len": 2, "data": "AAAAAAAAAEAAAAAAAAAUQA=="},
                        "k": {"dtype": "str", "len": 2, "data": ["a", "b"]}},
            "encode": {"x": {"column": "v", "scale": "x"}, "y": 30, "size": 8}}});
    let palette: Palette = [("ink".to_string(), [0, 0, 0])].into();
    let marks = mark_set("dots", &set, items, &palette, [0.0, 0.0], &BoundRows::new())
        .unwrap()
        .marks;
    let centers: Vec<(String, [f64; 2])> = marks
        .iter()
        .map(|m| match m {
            Mark::Circle { item, center, .. } => (item.clone(), *center),
            _ => panic!("a point"),
        })
        .collect();
    assert_eq!(
        centers,
        vec![
            ("dots#a".to_string(), [20.0, 30.0]),
            ("dots#b".to_string(), [50.0, 30.0])
        ]
    );
}

#[test]
fn a_bound_cell_draws_its_reading_and_a_row_without_one_is_left_out() {
    let items = json!({"x": {"kind": "scale@1", "params": {"domain": [0, 10], "range": [0, 100], "nice": false}}});
    let items = items.as_object().unwrap();
    // [2.0, 5.0] as little-endian f64; row "a" writes 2, its reading is 7.
    let set = json!({"params": {"mark": "point", "n": 2, "key": "k",
            "columns": {"v": {"dtype": "f64", "len": 2, "data": "AAAAAAAAAEAAAAAAAAAUQA=="},
                        "k": {"dtype": "str", "len": 2, "data": ["a", "b"]}},
            "encode": {"x": {"column": "v", "scale": "x"}, "y": 30, "size": 8}}});
    let palette: Palette = [("ink".to_string(), [0, 0, 0])].into();
    let centers = |bound: &BoundRows| -> Vec<(String, f64)> {
        mark_set("dots", &set, items, &palette, [0.0, 0.0], bound)
            .unwrap()
            .marks
            .iter()
            .map(|m| match m {
                Mark::Circle { item, center, .. } => (item.clone(), center[0]),
                _ => panic!("a point"),
            })
            .collect()
    };
    let read: BoundRows = [(("a".into(), "v".into()), Some(7.0))].into();
    assert_eq!(
        centers(&read),
        vec![("dots#a".to_string(), 70.0), ("dots#b".to_string(), 50.0)]
    );
    let missing: BoundRows = [(("a".into(), "v".into()), None)].into();
    assert_eq!(centers(&missing), vec![("dots#b".to_string(), 50.0)]);
}

#[test]
fn an_axis_draws_its_line_ticks_and_labels_and_thins_crowded_labels() {
    let items =
        json!({"x": {"kind": "scale@1", "params": {"domain": [0, 100], "range": [0, 400]}}});
    let items = items.as_object().unwrap();
    let palette: Palette = [("muted".to_string(), [9, 9, 9])].into();
    let marks = axis(
        "ax",
        &json!({"params": {"scale": "x", "side": "bottom", "at": 50}}),
        (items, None),
        &palette,
        [0.0, 0.0],
        [640.0, 480.0],
    )
    .unwrap()
    .marks;
    let labels = marks
        .iter()
        .filter(|m| matches!(m, Mark::Text { .. }))
        .count();
    let ticks = marks.iter().filter(|m| m.item().contains("#tick")).count();
    assert_eq!((ticks, labels), (6, 6));
    // Squeezed into 40 u the same six ticks keep fewer labels, the first and the last among them.
    let items =
        json!({"x": {"kind": "scale@1", "params": {"domain": [0, 100000], "range": [0, 60]}}});
    let marks = axis(
        "ax",
        &json!({"params": {"scale": "x"}}),
        (items.as_object().unwrap(), None),
        &palette,
        [0.0, 0.0],
        [640.0, 480.0],
    )
    .unwrap()
    .marks;
    let kept: Vec<&str> = marks
        .iter()
        .filter_map(|m| match m {
            Mark::Text { item, .. } => Some(item.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        kept.len() < 6 && kept.first() == Some(&"ax#label0"),
        "{kept:?}"
    );
}

#[test]
fn an_axis_draws_its_title_past_the_far_end_of_its_line() {
    let items =
        json!({"y": {"kind": "scale@1", "params": {"domain": [0, 50], "range": [300, 40]}}});
    let palette: Palette = [("muted".to_string(), [9, 9, 9])].into();
    let marks = axis(
        "ax",
        &json!({"params": {"scale": "y", "side": "left", "at": 48, "title": "Sales"}}),
        (items.as_object().unwrap(), None),
        &palette,
        [0.0, 0.0],
        [640.0, 480.0],
    )
    .unwrap()
    .marks;
    let title = marks.iter().find_map(|m| match m {
        Mark::Text { spec, origin, .. } if spec.text == "Sales" => Some(*origin),
        _ => None,
    });
    let Some([_, y]) = title else {
        panic!(
            "the axis draws its title: {:?}",
            marks.iter().map(Mark::item).collect::<Vec<_>>()
        );
    };
    // Above the top tick's label, which centers on the line's top end at 40.
    assert!(
        y + LABEL_SIZE * 1.3 <= 40.0 - LABEL_SIZE * 0.65,
        "title at y {y}"
    );
}

#[test]
fn a_scale_from_categories_to_roles_draws_its_legend_with_each_series_line() {
    let series = |id: &str, category: &str, dash: Option<[f64; 2]>| {
        let mut stroke = json!({"width": 3});
        if let Some(d) = dash {
            stroke["dash"] = json!(d);
        }
        // x [40, 520] and y [200, 120] as little-endian f32.
        json!({"id": id, "kind": "marks@1", "layer": "main", "order": "a1",
                "params": {"mark": "path", "n": 2,
                    "columns": {"x": {"dtype": "f32", "len": 2, "data": "AAAgQgAAAkQ="},
                                "y": {"dtype": "f32", "len": 2, "data": "AABIQwAA8EI="},
                                "series": {"const": category}},
                    "encode": {"x": {"column": "x"}, "y": {"column": "y"},
                               "role": {"column": "series", "scale": "colors"}},
                    "paint": {"stroke": stroke}}})
    };
    let doc = json!({"format": 1, "size": [600, 320], "layers": {"main": {"writer": "a", "order": "a0"}},
    "items": {
        "colors": {"id": "colors", "kind": "scale@1", "layer": "main", "order": "a0",
            "params": {"type": "ordinal", "domain": ["north", "south"], "range": ["blue", "orange"]}},
        "north": series("north", "north", None),
        "south": series("south", "south", Some([6.0, 4.0])),
    }});
    let doc = doc.as_object().unwrap();
    let palette: Palette = [
        ("ground".to_string(), [255, 255, 255]),
        ("ink".to_string(), [1, 1, 1]),
        ("blue".to_string(), [0, 0, 200]),
        ("orange".to_string(), [250, 120, 0]),
    ]
    .into();
    let frame = crate::scene::frame(
        doc,
        object_or_empty(doc.get("items")),
        &palette,
        &crate::scene::Record::default(),
        1.0,
    )
    .unwrap();
    let marks: Vec<Mark> = frame
        .layers
        .iter()
        .flat_map(|l| l.marks.iter().map(|d| d.mark.clone()))
        .collect();
    let legend: Vec<&Mark> = marks
        .iter()
        .filter(|m| m.item().starts_with("colors#"))
        .collect();
    // Each category's name in ink, and its swatch: the series' line in its role, dashed as the
    // series is.
    for (category, color, dashed) in [
        ("north", [0, 0, 200], false),
        ("south", [250, 120, 0], true),
    ] {
        assert!(
            legend.iter().any(
                |m| matches!(m, Mark::Text { spec, color: [1, 1, 1], .. } if spec.text == category)
            ),
            "the legend names {category}: {legend:?}"
        );
        let swatch = legend.iter().find_map(|m| match m {
            Mark::Path { d, color: c, .. } if *c == color => Some(d.matches('M').count()),
            _ => None,
        });
        assert_eq!(
            swatch.map(|subpaths| subpaths > 1),
            Some(dashed),
            "{category}'s swatch is its line, dashed as it is: {legend:?}"
        );
    }
}

#[test]
fn an_empty_series_with_a_last_window_keeps_no_rows() {
    let empty = |dtype: &str| json!({"dtype": dtype, "len": 0, "data": ""});
    let series = json!({"params": {"t": empty("i64"), "v": empty("f32"),
            "window": {"last": 5}, "box": [0, 0, 3, 60]}});
    let d = decimated("s", &series, Decimate::M4).unwrap();
    assert_eq!(d.rows(), Vec::<usize>::new());
    assert_eq!(d.window, (0.0, 0.0));
}

#[test]
fn a_log_scale_whose_domain_reaches_zero_is_refused() {
    for domain in [[0, 100], [-5, 100]] {
        let scale = json!({"params": {"type": "log", "domain": domain, "range": [0, 300]}});
        let r = scale_of("s", &scale).expect_err("a log scale holds no value at or below 0");
        assert_eq!(
            (r.code, r.path.as_str()),
            ("out_of_range", "items/s/params/domain")
        );
    }
}

/// A log scale `ys` and a bar set of two years through it, whose bars start at zero.
fn bars_on_a_log_scale(domain: Value, n: usize) -> Value {
    let i32s = |v: &[i32]| {
        let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
        json!({"dtype": "i32", "len": v.len(), "data": deep_canvas::base64::encode(&bytes)})
    };
    let mut ys = json!({"kind": "scale@1", "params": {"type": "log", "range": [180, 20]}});
    if !domain.is_null() {
        ys["params"]["domain"] = domain;
    }
    json!({
        "ys": ys,
        "bars": {"kind": "marks@1", "params": {
            "mark": "bar", "n": n, "key": "key",
            "columns": {"year": i32s(&[2000, 2001][..n]),
                        "key": {"dtype": "str", "len": n, "data": vec!["a"; n]},
                        "value": i32s(&[10, 40][..n])},
            "transforms": [{"periods": {"by": "year", "at": 2000}}],
            "encode": {"x": 0, "y": {"column": "value", "scale": "ys"}}}},
    })
}

#[test]
fn a_log_scale_a_bar_widens_to_zero_is_refused() {
    for domain in [Value::Null, json!("periods")] {
        let items = bars_on_a_log_scale(domain.clone(), 2);
        let items = items.as_object().unwrap();
        let r = Scale::read("ys", &items["ys"], items).expect_err("a bar starts at zero");
        let found = (r.code, r.path.as_str());
        assert_eq!(
            found,
            ("out_of_range", "items/ys/params/domain"),
            "{domain}"
        );
    }
}

#[test]
fn a_scale_that_follows_the_periods_of_a_set_with_no_rows_is_refused() {
    let items = bars_on_a_log_scale(json!("periods"), 0);
    let items = items.as_object().unwrap();
    let r = Scale::read("ys", &items["ys"], items).expect_err("no period gives a domain");
    assert_eq!(
        (r.code, r.path.as_str()),
        ("bad_scale", "items/ys/params/domain")
    );
}
