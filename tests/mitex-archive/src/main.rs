use std::collections::BTreeMap;

fn equal_commands(before: &serde_json::Value, after: &serde_json::Value) -> bool {
    before == after
}

fn main() {
    let original = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/expected.json")).unwrap();
    let bytes: &[u8] = include!("../../../vendor/mitex-spec-gen/assets/default.rs");
    let new = new_spec::CommandSpec::from_bytes(bytes);
    let original: serde_json::Value = serde_json::from_slice(&original).unwrap();
    let before = original["commands"].clone();
    let after = serde_json::to_value(new.items().collect::<BTreeMap<_, _>>()).unwrap();
    assert!(before.as_object().unwrap().len() > 100, "empty/trivial archive proves nothing");
    assert!(equal_commands(&before, &after), "MiTeX command, alias, argument shape or environment changed");
    let mut planted = after.clone();
    let first = planted.as_object().unwrap().keys().next().unwrap().clone();
    planted.as_object_mut().unwrap().remove(&first);
    assert!(!equal_commands(&before, &planted), "a missing command must be rejected");
    println!("{} command values equal, including aliases, argument shapes and environments", before.as_object().unwrap().len());
}
