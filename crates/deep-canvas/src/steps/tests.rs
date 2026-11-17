use super::*;

#[test]
fn sorted_for_lookup() {
    let names: Vec<&str> = TABLE.iter().map(|d| d.name).collect();
    let mut sorted = names.clone();
    sorted.sort_unstable();
    assert_eq!(names, sorted);
}

#[test]
fn every_base_step_holds_its_fixture_and_refuses_its_twin() {
    let all = base_entries();
    assert_eq!(all.len(), TABLE.len());
    for (name, value) in &all {
        assert_eq!(exactness(value, ""), Ok(()), "{name}");
        let twin = value["twin"]["perturb"].as_str().unwrap_or_default();
        assert!(exactness(value, twin).is_err(), "{name}'s twin passes");
    }
}

#[test]
fn the_i32_add_wraps_as_the_cts_says_and_its_saturating_twin_fails() {
    let (_, add) = base_entries()
        .into_iter()
        .find(|(n, _)| *n == "add@1")
        .expect("add@1");
    let got = eval(
        &add,
        &[V::I(2_147_483_647), V::I(1)],
        &Value::Null,
        None,
        "",
    )
    .expect("runs");
    assert_eq!(got, V::I(-2_147_483_648));
    let twin = eval(
        &add,
        &[V::I(2_147_483_647), V::I(1)],
        &Value::Null,
        None,
        "saturate",
    )
    .expect("runs");
    assert_eq!(twin, V::I(2_147_483_647));
    assert!(exactness(&add, "saturate")
        .unwrap_err()
        .contains("2147483647"));
}
