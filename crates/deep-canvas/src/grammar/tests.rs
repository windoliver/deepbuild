//! Round trips, refused mutants and the design's worked examples.

use std::collections::BTreeMap;

use super::*;

const CASES: u64 = 10_000;

fn round_trips(
    seed: u64,
    gen: fn(&mut Seeded) -> String,
    parse_print: fn(&str) -> Result<String, Refusal>,
) {
    let mut rng = Seeded::new(seed);
    for _ in 0..CASES {
        let text = gen(&mut rng);
        match parse_print(&text) {
            Ok(printed) => assert_eq!(printed, text, "round trip of `{text}`"),
            Err(r) => panic!("generated `{text}` refused: {} {}", r.code, r.what),
        }
    }
}

fn all_refused(
    seed: u64,
    gen: fn(&mut Seeded) -> String,
    parse_print: fn(&str) -> Result<String, Refusal>,
    codes: &[&str],
) {
    let mut rng = Seeded::new(seed);
    for _ in 0..CASES {
        let text = gen(&mut rng);
        match parse_print(&text) {
            Ok(_) => panic!("mutant `{text}` was accepted"),
            Err(r) => assert!(
                codes.contains(&r.code),
                "mutant `{text}` refused with {}, not one of {codes:?}",
                r.code
            ),
        }
    }
}

fn id_pp(s: &str) -> Result<String, Refusal> {
    Id::parse(s).map(|v| v.print())
}
fn path_pp(s: &str) -> Result<String, Refusal> {
    Path::parse(s).map(|v| v.print())
}
fn handle_pp(s: &str) -> Result<String, Refusal> {
    Handle::parse(s).map(|v| v.print())
}
fn time_pp(s: &str) -> Result<String, Refusal> {
    Time::parse(s).map(|v| v.print())
}
fn unit_pp(s: &str) -> Result<String, Refusal> {
    UnitLiteral::parse(s).map(|v| v.print())
}

#[test]
fn ids_round_trip() {
    round_trips(0x1d, gen_id, id_pp);
}

#[test]
fn id_mutants_are_refused() {
    all_refused(0x1d_bad, gen_id_mutant, id_pp, &["bad_id"]);
}

#[test]
fn paths_round_trip() {
    round_trips(0x9a7, gen_path, path_pp);
}

#[test]
fn path_mutants_are_refused() {
    // A path whose ID part is malformed carries the ID grammar's code.
    all_refused(0x9a7_bad, gen_path_mutant, path_pp, &["bad_path", "bad_id"]);
}

#[test]
fn handles_round_trip() {
    round_trips(0x4a, gen_handle, handle_pp);
}

#[test]
fn handle_mutants_are_refused() {
    all_refused(0x4a_bad, gen_handle_mutant, handle_pp, &["bad_handle"]);
}

#[test]
fn times_round_trip() {
    round_trips(0x71, gen_time, time_pp);
}

#[test]
fn time_mutants_are_refused() {
    all_refused(0x71_bad, gen_time_mutant, time_pp, &["bad_time"]);
}

#[test]
fn units_round_trip() {
    round_trips(0x0a, gen_unit, unit_pp);
}

#[test]
fn unit_mutants_are_refused() {
    all_refused(0x0a_bad, gen_unit_mutant, unit_pp, &["bad_unit"]);
}

/// A reference evaluator for spans: exact i128 arithmetic on the literal's digits.
fn reference_span(text: &str, p: i128, q: i128) -> Option<i128> {
    if let Some(body) = text.strip_suffix('f') {
        let k: i128 = body.parse().ok()?;
        return Some(k * 705_600_000 * q / p);
    }
    let body = text.strip_suffix('s')?;
    let (neg, body) = match body.strip_prefix('-') {
        Some(b) => (true, b),
        None => (false, body),
    };
    let (int, frac) = body.split_once('.').unwrap_or((body, ""));
    let scale = 10i128.pow(frac.len() as u32);
    let int: i128 = int.parse().ok()?;
    let frac: i128 = if frac.is_empty() {
        0
    } else {
        frac.parse().ok()?
    };
    let num = (int * scale + frac) * 705_600_000;
    if num % scale != 0 {
        return None;
    }
    let v = num / scale;
    Some(if neg { -v } else { v })
}

#[test]
fn generated_spans_resolve_to_the_reference_value() {
    let ctx = TimeContext {
        frame_rate: (24_000, 1_001),
        markers: BTreeMap::new(),
    };
    let mut rng = Seeded::new(0x5a);
    let mut seen = 0;
    while seen < CASES {
        let text = gen_time(&mut rng);
        let time = Time::parse(&text).unwrap();
        if !matches!(time, Time::Span(_)) {
            continue;
        }
        seen += 1;
        let expected = reference_span(&text, 24_000, 1_001).unwrap();
        assert_eq!(time.resolve(&ctx).unwrap() as i128, expected, "`{text}`");
    }
}

#[test]
fn frame_195_at_30_fps_is_the_design_value() {
    let ctx = TimeContext {
        frame_rate: (30, 1),
        markers: BTreeMap::new(),
    };
    assert_eq!(
        Time::parse("195f").unwrap().resolve(&ctx).unwrap(),
        4_586_400_000
    );
    assert_eq!(
        Time::parse("1.25s").unwrap().resolve(&ctx).unwrap(),
        882_000_000
    );
    assert_eq!(Time::parse("-195f").unwrap_err().code, "bad_time");
    assert_eq!(Time::parse("1.123456s").unwrap_err().code, "bad_time");
}

#[test]
fn a_bare_integer_is_not_a_time() {
    assert_eq!(Time::parse("0").unwrap_err().code, "bad_time");
    assert_eq!(Time::parse("195").unwrap_err().code, "bad_time");
    assert_eq!(Time::parse("0.000000001s").unwrap_err().code, "bad_time");
}

#[test]
fn times_refuse_by_code_what_the_context_lacks() {
    let mut markers = BTreeMap::new();
    markers.insert("intro".to_string(), (1_000, 5_000));
    let ctx = TimeContext {
        frame_rate: (30, 1),
        markers,
    };
    assert_eq!(Time::parse("@intro").unwrap().resolve(&ctx).unwrap(), 1_000);
    assert_eq!(
        Time::parse("@intro.end").unwrap().resolve(&ctx).unwrap(),
        5_000
    );
    assert_eq!(
        Time::parse("@intro+1.25s").unwrap().resolve(&ctx).unwrap(),
        1_000 + 882_000_000
    );
    assert_eq!(
        Time::parse("@intro.end-195f")
            .unwrap()
            .resolve(&ctx)
            .unwrap(),
        5_000 - 4_586_400_000
    );
    for text in ["2:1b", "@outro", "@intro.word:hello#2", "@intro.word:hello"] {
        let time = Time::parse(text).unwrap();
        assert_eq!(time.print(), text);
        assert_eq!(
            time.resolve(&ctx).unwrap_err().code,
            "time_unresolved",
            "{text}"
        );
    }
    let invalid_rate = TimeContext {
        frame_rate: (85, 1),
        markers: BTreeMap::new(),
    };
    assert_eq!(
        Time::parse("1f")
            .unwrap()
            .resolve(&invalid_rate)
            .unwrap_err()
            .code,
        "time_unresolved"
    );
}

#[test]
fn a_frame_fraction_at_1920_wide_is_6_4_u() {
    let ctx = UnitContext {
        frame: (1920, 1080),
        frame_rate: (30, 1),
    };
    let convert = |text: &str, to: &str| UnitLiteral::parse(text).unwrap().convert(to, &ctx);
    let value = convert("1/300fw", "u").unwrap();
    assert_eq!(value, Rational::new(32, 5).unwrap());
    assert_eq!(value.to_f64(), 6.4);
    assert_eq!(
        convert("300 mm", "m").unwrap(),
        Rational::new(3, 10).unwrap()
    );
    assert_eq!(convert("2km", "m").unwrap(), Rational::integer(2000));
    assert_eq!(UnitLiteral::parse("1.50m").unwrap().print(), "1.5m");
    assert_eq!(UnitLiteral::parse("300 mm").unwrap().print(), "300mm");
    assert_eq!(UnitLiteral::parse("1/2m").unwrap_err().code, "bad_unit");
    assert_eq!(UnitLiteral::parse("300  mm").unwrap_err().code, "bad_unit");
    assert_eq!(convert("0.5turn", "deg").unwrap(), Rational::integer(180));
    assert_eq!(
        convert("1.25s", "flick").unwrap(),
        Rational::integer(882_000_000)
    );
    assert_eq!(convert("37f", "s").unwrap(), Rational::new(37, 30).unwrap());
    assert_eq!(convert("50%", "").unwrap(), Rational::new(1, 2).unwrap());
    assert_eq!(convert("45", "deg").unwrap(), Rational::integer(45));
}

#[test]
fn degrees_in_a_length_field_are_refused_listing_only_length_forms() {
    let ctx = UnitContext {
        frame: (1920, 1080),
        frame_rate: (30, 1),
    };
    let refusal = UnitLiteral::parse("45deg")
        .unwrap()
        .convert("u", &ctx)
        .unwrap_err();
    assert_eq!(refusal.code, "bad_unit");
    assert_eq!(refusal.forms, ["1u", "1px", "1fw", "1fh"]);
    assert_eq!(refusal.forms, forms_for("u"));
    assert!(refusal.forms.iter().all(|f| !f.contains("deg")));
    assert_eq!(forms_for("m"), ["1m", "1cm", "1mm", "1km"]);
    assert_eq!(forms_for("rad"), ["1rad"]);
    assert_eq!(forms_for("furlong"), Vec::<String>::new());
    // Lossy or cross-family conversions are refused too.
    for (text, to) in [
        ("1rad", "deg"),
        ("1m", "u"),
        ("1u", "m"),
        ("0.000000001s", "flick"),
        ("1u", "furlong"),
    ] {
        let refusal = UnitLiteral::parse(text).unwrap().convert(to, &ctx);
        assert_eq!(refusal.unwrap_err().code, "bad_unit", "{text} to {to}");
    }
}

#[test]
fn an_id_with_a_slash_is_refused() {
    let refusal = Id::parse("items/box").unwrap_err();
    assert_eq!(refusal.code, "bad_id");
    assert!(refusal.what.contains('/'));
    assert_eq!(Id::parse("a.b.c.d.e.f.g.h.i").unwrap_err().code, "bad_id");
    assert_eq!(Id::parse("~1").unwrap_err().code, "bad_id");
    assert_eq!(PatchId::parse("~1").unwrap(), PatchId::Temporary(1));
    assert_eq!(PatchId::parse("~0").unwrap_err().code, "bad_id");
    assert_eq!(PatchId::parse("plank.01").unwrap().print(), "plank.01");
    let sub = SubAddress::parse("banner#r0c27").unwrap();
    assert_eq!(
        (sub.id().as_str(), sub.sub(), sub.print().as_str()),
        ("banner", "r0c27", "banner#r0c27")
    );
    assert_eq!(SubAddress::parse("banner#").unwrap_err().code, "bad_id");
}

#[test]
fn the_design_examples_parse() {
    let path = Path::parse("items/box/at/rot/1").unwrap();
    assert_eq!(path.section(), Section::Items);
    assert_eq!(path.id().as_str(), "box");
    assert_eq!(path.fields(), ["at", "rot", "1"]);
    assert_eq!(Path::parse("items/trees#42/at").unwrap().sub(), Some("42"));
    for text in [
        "items/box/params/width",
        "controls/dial/value",
        "data/speed/value",
        "items/trees#r0.c27/_x/007",
    ] {
        assert_eq!(Path::parse(text).unwrap().print(), text);
    }
    assert_eq!(Path::parse("layers/box").unwrap_err().code, "bad_path");
    assert_eq!(Path::parse("data/speed").unwrap_err().code, "bad_path");
    assert_eq!(Path::parse("items/box/-x").unwrap_err().code, "bad_path");
    assert_eq!(Path::parse("items/box#.x/y").unwrap_err().code, "bad_path");
    assert_eq!(Path::parse("items/B/x/y").unwrap_err().code, "bad_id");
    assert_eq!(Path::parse("items/box/Width").unwrap_err().code, "bad_path");

    let handle = Handle::parse("doc:01ARZ3NDEKTSV4RRFFQ69G5FAV#row.m14").unwrap();
    assert_eq!(handle.scheme(), Scheme::Doc);
    assert_eq!(handle.fragment(), Some("row.m14"));
    let hash = "a".repeat(64);
    let handle = Handle::parse(&format!("req:{hash}#R2")).unwrap();
    assert_eq!(handle.id(), &HandleId::Hash(hash));
    assert_eq!(
        Handle::parse("job:01ARZ3NDEKTSV4RRFFQ69G5FAV")
            .unwrap_err()
            .code,
        "bad_handle"
    );
    assert_eq!(
        Handle::parse("ev:81ARZ3NDEKTSV4RRFFQ69G5FAV")
            .unwrap_err()
            .code,
        "bad_handle"
    );
}

#[test]
fn a_frame_unit_without_a_frame_size_is_refused_not_zero() {
    let none = UnitContext::default();
    for text in ["1fw", "1fh", "1/2fw"] {
        let literal = UnitLiteral::parse(text).unwrap();
        assert_eq!(
            literal.convert("u", &none).unwrap_err().code,
            "bad_unit",
            "{text}"
        );
    }
    let frame = UnitContext {
        frame: (1920, 1080),
        frame_rate: (60, 1),
    };
    let value = UnitLiteral::parse("1fh")
        .unwrap()
        .convert("u", &frame)
        .unwrap();
    assert_eq!((value.num(), value.den()), (1080, 1));
}
