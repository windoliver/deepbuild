use super::*;

#[test]
fn ease_zero_is_the_identity_and_ends_hold() {
    let e = Ease {
        high: 0.5,
        low: -0.3,
    };
    assert_eq!(Ease::default().apply(0.37), 0.37);
    assert_eq!(e.apply(0.0), 0.0);
    assert_eq!(e.apply(1.0), 1.0);
    // x(t) solved back: the parameter found reproduces x.
    let (x1, x2) = (0.0, 0.5);
    let t = t_for_x(0.42, x1, x2);
    assert!((cubic(t, x1, x2) - 0.42).abs() < 1e-14);
}

#[test]
fn triangle_peaks_mid_range() {
    // 10 units, 20%..70%: s = 2, e = 7; the peak sits at unit 4 (centre 4.5 = (2+7)/2).
    let a: Vec<f64> = (0..10)
        .map(|i| range_amount(Shape::Triangle, 2.0, 7.0, i as f64, Ease::default()))
        .collect();
    assert!((a[4] - 1.0).abs() < 1e-12, "{a:?}");
    assert_eq!(a[0], 0.0);
    assert_eq!(a[9], 0.0);
}

#[test]
fn noise_is_pure_in_unit_and_time() {
    let n = Noise {
        seed: 7,
        ..Noise::default()
    };
    assert_eq!(n.amount(3, 1.25), n.amount(3, 1.25));
    assert_ne!(n.amount(3, 1.25), n.amount(4, 1.25));
    let v = n.amount(2, 0.7);
    assert!((-1.0..=1.0).contains(&v));
}

struct TestHost(deep_text::Shaper);
impl Host for TestHost {
    fn shape(&mut self, text: &str) -> Arc<Shaped> {
        self.0.shape(&deep_text::Spec::label(text))
    }
    fn counter_text(&mut self, _: f64) -> Result<Option<String>, Refused> {
        Ok(None)
    }
}

fn lay(text: &str, params: Value, doc: Value) -> Result<Laid, Refused> {
    let mut host = TestHost(deep_text::Shaper::new());
    let run = host.shape(text);
    let Value::Object(params) = params else {
        panic!()
    };
    let Value::Object(doc) = doc else { panic!() };
    let input = Input {
        id: "t",
        params: &params,
        run: &run,
        origin: [0.0, 0.0],
        t: 0,
        doc: &doc,
        items: &Map::new(),
        bound: false,
        plant: Plant::None,
        reveal_times: &[],
        afterglow: None,
    };
    lay_out(&input, &mut host)
}

fn one(a: Value) -> Value {
    serde_json::json!({"animators": [a]})
}

#[test]
fn an_index_range_counts_units_and_no_space_units_skip_spaces() {
    let a = |units: &str, basis: &str, to: f64| {
        one(
            serde_json::json!({"units": units, "range": {"from": 0, "to": to, "basis": basis}, "props": {"y": 1}}),
        )
    };
    // Units 0 and 1 of five, by index.
    let c = &lay("ABCDE", a("grapheme", "index", 2.0), serde_json::json!({}))
        .unwrap()
        .coverage[0];
    assert_eq!(c, &vec![1.0, 1.0, 0.0, 0.0, 0.0]);
    // "A B": two units, not three; the space is in none.
    let c = &lay(
        "A B",
        a("grapheme_no_space", "fraction", 1.0),
        serde_json::json!({}),
    )
    .unwrap()
    .coverage[0];
    assert_eq!(c.len(), 2);
}

#[test]
fn five_selectors_are_refused_and_a_field_reads_its_unit() {
    let sel = serde_json::json!({"field": {"expr": "i / n"}, "mode": "max"});
    let many = one(
        serde_json::json!({"props": {"y": 1}, "range": {"from": 0, "to": 0}, "selectors": [sel, sel, sel, sel]}),
    );
    assert_eq!(
        lay("ABCD", many, serde_json::json!({})).unwrap_err().code,
        "out_of_range"
    );
    let field = one(
        serde_json::json!({"props": {"y": 1}, "range": {"from": 0, "to": 0}, "selectors": [sel]}),
    );
    let c = &lay("ABCD", field, serde_json::json!({})).unwrap().coverage[0];
    assert_eq!(c, &vec![0.0, 0.25, 0.5, 0.75]);
}

#[test]
fn a_roll_over_a_source_with_no_stepped_keys_is_refused_naming_it() {
    let params =
        serde_json::json!({"text": {"counter": {"source": "data/n", "roll": {"span": "0.3s"}}}});
    let doc = serde_json::json!({"channels": {"c": {"target": "data/n", "keys": {
            "a": {"t": "0s", "value": 0, "interp": "linear"}, "b": {"t": "1s", "value": 9, "interp": "linear"}}}}});
    let r = lay("0", params, doc).unwrap_err();
    assert_eq!(r.code, "roll_source");
    assert!(r.path.contains("data/n"), "{}", r.path);
}

#[test]
fn a_turn_is_about_the_advance_midpoint_moved_by_the_pivot() {
    let turn = |pivot: [f64; 2]| {
        let l = lay(
            "I",
            one(serde_json::json!({"props": {"rotate": 180, "pivot": pivot}})),
            serde_json::json!({}),
        )
        .unwrap();
        let p = &l.glyphs[0];
        let mid = f64::from(p.glyph.advance) / 2.0 + pivot[0];
        // The pivot maps to itself.
        let t = p.transform;
        let at = [
            t[0] * mid + t[2] * pivot[1] + t[4],
            t[1] * mid + t[3] * pivot[1] + t[5],
        ];
        let rest = [f64::from(p.glyph.x) + mid, f64::from(p.glyph.y) + pivot[1]];
        assert!(
            (at[0] - rest[0]).abs() < 1e-9 && (at[1] - rest[1]).abs() < 1e-9,
            "{at:?} {rest:?}"
        );
        assert!((t[0] + 1.0).abs() < 1e-12);
    };
    turn([0.0, 0.0]);
    turn([3.0, -5.0]);
}
