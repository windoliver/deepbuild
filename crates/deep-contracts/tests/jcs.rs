use std::time::Instant;

fn canonical(text: &str) -> String {
    deep_contracts::jcs(&deep_contracts::parse(text).expect("JSON"))
}

#[test]
fn a_number_halfway_between_two_shortest_forms_prints_the_even_one_as_ecmascript_does() {
    // Each exact double ends in 5 one digit past its shortest form; Number::toString picks the even digit.
    assert_eq!(canonical("[120579864722102.12]"), "[120579864722102.12]");
    assert_eq!(canonical("[-2092466787231557.2]"), "[-2092466787231557.2]");
}

#[test]
fn a_unicode_escape_takes_four_hex_digits_and_nothing_else() {
    assert!(deep_contracts::parse(r#"["\u+041"]"#).is_err());
    assert_eq!(canonical(r#"["\u0041"]"#), r#"["A"]"#);
}

#[test]
fn an_object_with_many_keys_parses_in_linear_time() {
    let members: Vec<String> = (0..100_000).map(|i| format!("\"k{i}\":{i}")).collect();
    let text = format!("{{{}}}", members.join(","));
    let started = Instant::now();
    deep_contracts::parse(&text).expect("JSON");
    assert!(
        started.elapsed().as_secs_f64() < 2.0,
        "took {:?}",
        started.elapsed()
    );
}

#[test]
fn a_repeated_key_keeps_its_first_place_and_its_last_value_in_a_small_object_and_a_large_one() {
    use deep_contracts::Value;
    for count in [2, 16, 17, 18, 40] {
        // Every key twice over, then the first and the last a third time.
        let keys: Vec<String> = (0..count).map(|i| format!("k{i}")).collect();
        let mut members: Vec<String> = Vec::new();
        for round in 0..2 {
            members.extend(
                keys.iter()
                    .enumerate()
                    .map(|(i, k)| format!("\"{k}\":{}", round * 100 + i)),
            );
        }
        members.push(format!("\"{}\":-1", keys[0]));
        members.push(format!("\"{}\":-2", keys[count - 1]));
        let read = deep_contracts::parse(&format!("{{{}}}", members.join(","))).expect("JSON");
        let expected: Vec<(String, Value)> = keys
            .iter()
            .enumerate()
            .map(|(i, k)| {
                let last = match i {
                    0 => -1.0,
                    i if i == count - 1 => -2.0,
                    i => (100 + i) as f64,
                };
                (k.clone(), Value::Number(last))
            })
            .collect();
        assert_eq!(read, Value::Object(expected), "{count} keys");
    }
}

#[test]
fn a_seq_is_never_negative() {
    assert!(deep_contracts::Seq::new(-1).is_none());
    assert_eq!(
        deep_contracts::Seq::new(7).map(deep_contracts::Seq::get),
        Some(7)
    );
}

#[test]
fn an_integer_is_one_both_languages_hold_exactly() {
    use deep_contracts::Contract;
    let int =
        |text: &str| <i64 as Contract>::from_json(&deep_contracts::parse(text).expect("JSON"), "");
    assert_eq!(int("9007199254740991"), Ok(9007199254740991));
    assert_eq!(int("-9007199254740991"), Ok(-9007199254740991));
    for wide in ["9007199254740992", "-9007199254740992", "1e21", "9.3e18"] {
        assert!(int(wide).is_err(), "{wide}");
    }
}

#[test]
fn a_lone_surrogate_is_refused_by_parse_and_read_as_the_replacement_character_by_parse_lossy() {
    for (text, read) in [
        (r#"["\ud800"]"#, "\u{FFFD}"),
        (r#"["\udc00x"]"#, "\u{FFFD}x"),
        (r#"["\ud800\u0041"]"#, "\u{FFFD}A"),
        (r#"["git\ud800\u0020push"]"#, "git\u{FFFD} push"),
        (r#"["\ud800\ud800\udc00"]"#, "\u{FFFD}\u{10000}"),
    ] {
        assert!(deep_contracts::parse(text).is_err(), "{text}");
        assert_eq!(
            deep_contracts::parse_lossy(text),
            Ok(deep_contracts::Value::Array(vec![
                deep_contracts::Value::String(read.to_string())
            ])),
            "{text}"
        );
    }
    // Keys apart only by their lone halves would read as one key: a key with a lone half is refused.
    for text in [r#"{"\ud800":1,"\udc00":2}"#, r#"{"\ud800":1}"#] {
        assert!(deep_contracts::parse_lossy(text).is_err(), "{text}");
    }
    // A pair reads as its one character, whichever way it is read.
    assert_eq!(canonical(r#"["\ud83d\ude00"]"#), "[\"\u{1F600}\"]");
    assert_eq!(
        deep_contracts::parse_lossy(r#"["\ud83d\ude00"]"#),
        deep_contracts::parse(r#"["\ud83d\ude00"]"#)
    );
}
