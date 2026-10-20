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
    assert_eq!(canonical(r#"["A"]"#), r#"["A"]"#);
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
fn a_seq_is_never_negative() {
    assert!(deep_contracts::Seq::new(-1).is_none());
    assert_eq!(
        deep_contracts::Seq::new(7).map(deep_contracts::Seq::get),
        Some(7)
    );
}
