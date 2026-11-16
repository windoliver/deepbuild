use super::*;

#[test]
fn a_trim_whose_start_wraps_past_the_end_keeps_its_window() {
    // #160: the loader's window late in its play, start 0.6, end 0.8 and offset 324°, on a
    // closed square of side 100 (400 u): both ends of the window pass the path's end, so
    // it's the 80 u from 200 u (1.5 × 400 − 400) to 280 u, one piece along the third side.
    let sq = |x: f64, y: f64| [x, y];
    let sub = Sub {
        segs: vec![
            Seg::Line(sq(0.0, 0.0), sq(100.0, 0.0)),
            Seg::Line(sq(100.0, 0.0), sq(100.0, 100.0)),
            Seg::Line(sq(100.0, 100.0), sq(0.0, 100.0)),
            Seg::Line(sq(0.0, 100.0), sq(0.0, 0.0)),
        ],
        closed: true,
    };
    let out = trim(&[sub], 0.6, 0.8, 324.0, false);
    let length: f64 = out.iter().map(Sub::length).sum();
    assert!(
        (length - 80.0).abs() < 1e-9,
        "the window is 80 u, got {length} in {out:?}"
    );
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].segs[0].start(), [100.0, 100.0]);
    assert_eq!(out[0].segs[0].end(), [20.0, 100.0]);
}

#[test]
fn a_curve_measures_its_arc_length_by_quadrature() {
    // A quarter circle of radius 100 as one cubic (handles 0.5523 r): its length by 200,000
    // chords is the reference; the quadrature lands within 1e-6 u, where a 128-chord sum
    // falls 1e-3 u short and the chord itself 11 u short.
    let k = 55.228_474_983_079_34;
    let arc = Seg::Cubic([100.0, 0.0], [100.0, k], [k, 100.0], [0.0, 100.0]);
    let n = 200_000;
    let fine: f64 = (1..=n)
        .map(|i| {
            let (a, b) = (
                arc.at((i - 1) as f64 / n as f64),
                arc.at(i as f64 / n as f64),
            );
            norm(vsub(b, a))
        })
        .sum();
    assert!(
        (arc.length() - fine).abs() < 1e-6,
        "{} vs {fine}",
        arc.length()
    );
    // A trim to the first half then ends half way along the arc by length.
    let sub = Sub {
        segs: vec![arc],
        closed: false,
    };
    let half = trim(&[sub], 0.0, 0.5, 0.0, false);
    let cut = half[0].segs[0].end();
    let to = |p: P, q: P| norm(vsub(q, p));
    let mid = arc.at(0.5);
    assert!(
        to(cut, mid) < 0.01,
        "{cut:?} vs the symmetric middle {mid:?}"
    );
}
use crate::path::parse;

fn square() -> Vec<Verb> {
    parse("M 0 0 L 100 0 L 100 100 L 0 100 Z").unwrap()
}

#[test]
fn a_closed_square_has_four_segments_and_a_length_of_400() {
    assert_eq!(segments(&square()), 4);
    assert!((length(&square()) - 400.0).abs() < 1e-9);
    let (p, a) = at(&square(), 0.375).unwrap();
    assert!((p[0] - 100.0).abs() < 1e-9 && (p[1] - 50.0).abs() < 1e-9);
    assert!((a - 90.0).abs() < 1e-9);
}

#[test]
fn zigzag_builds_its_declared_segments() {
    let ops = read(Some(&serde_json::json!([{"zigzag": {"ridges": 5}}])), "ops").unwrap();
    assert_eq!(declared(&ops, &square()), (24, None));
    let built = apply(&ops, &square());
    assert_eq!(built.len(), 1);
    assert_eq!(segments(&built[0].verbs), 24);
}

#[test]
fn a_repeater_past_the_budget_names_its_op() {
    let ops = read(
        Some(&serde_json::json!([{"zigzag": {"ridges": 256}}, {"repeater": {"copies": 64}}])),
        "ops",
    )
    .unwrap();
    let (n, over) = declared(&ops, &square());
    assert_eq!(over, Some(1));
    assert_eq!(n, 257 * 4 * 64);
}

#[test]
fn a_trim_of_a_quarter_from_a_right_angle_offset_follows_the_circle() {
    let circle = crate::outline::circle([0.0, 0.0], 100.0, 0.0);
    let ops = read(
        Some(&serde_json::json!([{"trim": {"start": 0, "end": 0.25, "offset": 90}}])),
        "ops",
    )
    .unwrap();
    let built = apply(&ops, &circle);
    let verbs = &built[0].verbs;
    let l = length(verbs);
    assert!((l - 50.0 * std::f64::consts::PI).abs() < 0.05, "{l}");
    // 90° round the circle on screen is straight down: (0, 100).
    let (p, _) = at(verbs, 0.0).unwrap();
    assert!((p[0]).abs() < 0.01 && (p[1] - 100.0).abs() < 0.01, "{p:?}");
    let same = apply(
        &read(
            Some(&serde_json::json!([{"trim": {"start": 0, "end": 0.25, "offset": 450}}])),
            "ops",
        )
        .unwrap(),
        &circle,
    );
    assert_eq!(same[0].verbs, built[0].verbs);
}

#[test]
fn a_repeater_with_three_and_a_half_copies_draws_four_the_last_at_half() {
    let ops = read(
        Some(
            &serde_json::json!([{"repeater": {"copies": 3.5, "at": {"pos": [10, 0], "rot": 30}}}]),
        ),
        "ops",
    )
    .unwrap();
    let built = apply(&ops, &square());
    assert_eq!(built.len(), 4);
    // Below: the first copy draws last, on top.
    assert_eq!(built[3].copy, Some((0, 0.0)));
    assert!((built[0].opacity - 0.5).abs() < 1e-12);
    let Op::Repeater(r) = &ops[0] else { panic!() };
    let twice = compose(r.power(1.0), r.power(1.0));
    let p2 = r.power(2.0);
    for i in 0..6 {
        assert!((twice[i] - p2[i]).abs() < 1e-9);
    }
}

#[test]
fn slide_eases_the_last_copy_between_the_whole_powers() {
    let ops = read(
            Some(&serde_json::json!([{"repeater": {"copies": 2.5, "at": {"rot": 30}, "partial": "slide", "ease": "out_cubic"}}])),
            "ops",
        )
        .unwrap();
    let built = apply(&ops, &square());
    let Some((2, power)) = built
        .iter()
        .find(|c| c.copy.map(|c| c.0) == Some(2))
        .unwrap()
        .copy
    else {
        panic!()
    };
    assert!((power - 1.875).abs() < 1e-12);
    let Op::Repeater(r) = &ops[0] else { panic!() };
    let mx = r.power(power);
    let angle = m::deg(m::atan2(mx[1], mx[0]));
    assert!((angle - 56.25).abs() < 1e-9, "{angle}");
}

#[test]
fn offset_path_grows_a_square_outward_whichever_way_it_winds() {
    let ops = read(
        Some(&serde_json::json!([{"offset_path": {"amount": 10}}])),
        "ops",
    )
    .unwrap();
    for d in [
        "M 0 0 L 100 0 L 100 100 L 0 100 Z",
        "M 0 0 L 0 100 L 100 100 L 100 0 Z",
    ] {
        let built = apply(&ops, &parse(d).unwrap());
        let subs = subs_of(&built[0].verbs);
        let mut lo = [f64::INFINITY; 2];
        let mut hi = [f64::NEG_INFINITY; 2];
        for s in &subs[0].segs {
            for p in [s.start(), s.end()] {
                lo = [lo[0].min(p[0]), lo[1].min(p[1])];
                hi = [hi[0].max(p[0]), hi[1].max(p[1])];
            }
        }
        assert!(
            (lo[0] + 10.0).abs() < 1e-9 && (hi[0] - 110.0).abs() < 1e-9,
            "{d}: {lo:?} {hi:?}"
        );
        // Mitred corners: the outline reaches each corner of the 120 u square.
        for corner in [
            [-10.0, -10.0],
            [110.0, -10.0],
            [110.0, 110.0],
            [-10.0, 110.0],
        ] {
            let reached = subs[0].segs.iter().any(|s| {
                [s.start(), s.end()]
                    .iter()
                    .any(|p| norm(vsub(*p, corner)) < 1e-9)
            });
            assert!(reached, "{d}: no point at {corner:?}");
        }
    }
}

#[test]
fn an_op_is_one_key_and_a_trim_with_each_declares_a_cut_per_sub_path() {
    let r = read(
        Some(&serde_json::json!([{"twist": {"angle": 10}, "angle": 40}])),
        "ops",
    )
    .unwrap_err();
    assert_eq!((r.code, r.path.as_str()), ("bad_doc", "ops/0"));
    let two = parse("M 0 0 L 10 0 L 10 10 Z M 20 0 L 30 0 L 30 10 Z").unwrap();
    let each = read(
        Some(&serde_json::json!([{"trim": {"start": 0.1, "end": 0.9, "each": true}}])),
        "ops",
    )
    .unwrap();
    let built: u64 = apply(&each, &two).iter().map(|c| segments(&c.verbs)).sum();
    assert_eq!(declared(&each, &two).0, 6 + 4);
    assert!(built <= 10, "{built}");
}

#[test]
fn round_corners_keeps_a_square_closed_with_eight_segments() {
    let ops = read(
        Some(&serde_json::json!([{"round_corners": {"radius": 10}}])),
        "ops",
    )
    .unwrap();
    let built = apply(&ops, &square());
    let subs = subs_of(&built[0].verbs);
    assert!(subs[0].closed);
    assert_eq!(subs[0].segs.len(), 8);
    // Every corner's arc stays inside the square, and the straight runs are 80 u.
    let lines: Vec<f64> = subs[0]
        .segs
        .iter()
        .filter(|s| matches!(s, Seg::Line(..)))
        .map(Seg::length)
        .collect();
    assert_eq!(lines.len(), 4);
    assert!(lines.iter().all(|l| (l - 80.0).abs() < 1e-9), "{lines:?}");
}

#[test]
fn more_than_eight_ops_or_an_unknown_op_is_refused() {
    let nine: Vec<Value> = (0..9).map(|_| serde_json::json!({"pucker": {}})).collect();
    assert_eq!(
        read(Some(&Value::Array(nine)), "ops").unwrap_err().code,
        "out_of_range"
    );
    let r = read(Some(&serde_json::json!([{"merge": {}}])), "ops").unwrap_err();
    assert_eq!((r.code, r.path.as_str()), ("bad_doc", "ops/0"));
}
