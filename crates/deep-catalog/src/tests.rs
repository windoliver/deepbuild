use super::*;
use serde_json::json;

fn csv(name: &str, text: &str) -> Source {
    Source {
        name: name.into(),
        format: Format::Csv,
        bytes: text.as_bytes().to_vec(),
    }
}

fn jsonl(name: &str, text: &str) -> Source {
    Source {
        name: name.into(),
        format: Format::Jsonl,
        bytes: text.as_bytes().to_vec(),
    }
}

fn schema() -> serde_json::Value {
    json!({
        "items": {"id": "id", "inherit": "base", "columns": {
            "weight": {"type": "f64", "unit": "kg", "range": [0, 50]},
            "name": {"type": "copy items"},
            "stack": {"type": "i32"},
            "sharp": {"type": "bool"}}},
        "recipes": {"id": "id", "columns": {
            "inputs": {"type": "refs items"},
            "outputs": {"type": "refs items"},
            "tool": {"type": "ref items"}}}
    })
}

#[test]
fn a_row_is_found_by_its_id_hash_and_its_column_by_its_name_hash() {
    let items = "id,base,weight,name,stack,sharp\ncudgel,,1.8,1042,1,false\nknife,,0.4,1043,1,true\nplank,,2.0,1044,20,false\n";
    let recipes = "id,inputs,outputs,tool\nboard,plank;plank,board_x,knife\n";
    let p = pack(
        &[csv("items", items), csv("recipes", recipes)],
        &schema(),
        Planted::None,
    )
    .unwrap();
    let dir = read::directory(&p.bytes).unwrap();
    let t = read::table(&dir, "items").unwrap();
    let row = t.row(&p.bytes, "id", "cudgel").unwrap();
    assert_eq!(
        read::f64_at(&p.bytes, t.column("weight").unwrap(), row),
        Some(1.8)
    );
    assert_eq!(p.record["missing"][0]["ref"], "board_x");
    // Rows lie in the order of their ID hashes.
    let ids = p.record["tables"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "items")
        .unwrap()["ids"]
        .clone();
    let hashes: Vec<u32> = ids
        .as_array()
        .unwrap()
        .iter()
        .map(|i| fnv1a(i.as_str().unwrap()))
        .collect();
    assert!(hashes.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn an_inheriting_row_packs_as_the_row_written_out_in_full() {
    let short =
        "id,base,weight,name,stack,sharp\nclub,,1.8,1042,1,false\nspiked,club,,1045,,true\n";
    let full = "id,base,weight,name,stack,sharp\nclub,,1.8,1042,1,false\nspiked,,1.8,1045,1,true\n";
    let recipes = "id,inputs,outputs,tool\n";
    let a = pack(
        &[csv("items", short), csv("recipes", recipes)],
        &schema(),
        Planted::None,
    )
    .unwrap();
    let b = pack(
        &[csv("items", full), csv("recipes", recipes)],
        &schema(),
        Planted::None,
    )
    .unwrap();
    assert_eq!(a.bytes, b.bytes);
}

#[test]
fn csv_and_json_lines_pack_to_the_same_bytes_and_the_planted_reader_does_not() {
    let items = "id,base,weight,name,stack,sharp\nzeta,,1.5,1,2,true\nalpha,,\"2.25\",2,3,false\n";
    let lines = "{\"id\":\"zeta\",\"weight\":1.5,\"name\":1,\"stack\":2,\"sharp\":true}\n{\"id\":\"alpha\",\"weight\":2.25,\"name\":2,\"stack\":3,\"sharp\":false}\n";
    let recipes_csv = "id,inputs,outputs,tool\nr,zeta;alpha,alpha,\n";
    let recipes_jsonl = "{\"id\":\"r\",\"inputs\":[\"zeta\",\"alpha\"],\"outputs\":[\"alpha\"]}\n";
    let a = pack(
        &[csv("items", items), csv("recipes", recipes_csv)],
        &schema(),
        Planted::None,
    )
    .unwrap();
    let b = pack(
        &[jsonl("items", lines), jsonl("recipes", recipes_jsonl)],
        &schema(),
        Planted::None,
    )
    .unwrap();
    assert_eq!(a.sha256, b.sha256);
    let c = pack(
        &[jsonl("items", lines), jsonl("recipes", recipes_jsonl)],
        &schema(),
        Planted::JsonlFileOrder,
    )
    .unwrap();
    assert_ne!(a.sha256, c.sha256);
}

#[test]
fn colliding_ids_and_an_inheritance_cycle_are_refused_naming_both() {
    // FNV-1a 32 collides on these two (found by search).
    let (x, y) = collision();
    let recipes = "id,inputs,outputs,tool\n";
    let items = format!("id,base,weight,name,stack,sharp\n{x},,1,1,1,false\n{y},,1,1,1,false\n");
    let r = pack(
        &[csv("items", &items), csv("recipes", recipes)],
        &schema(),
        Planted::None,
    )
    .unwrap_err();
    assert_eq!(r["code"], "hash_collision");
    let mut both = vec![x.clone(), y.clone()];
    both.sort();
    assert_eq!(r["ids"], json!(both));
    let cycle = "id,base,weight,name,stack,sharp\na,b,1,1,1,false\nb,a,1,1,1,false\n";
    let r = pack(
        &[csv("items", cycle), csv("recipes", recipes)],
        &schema(),
        Planted::None,
    )
    .unwrap_err();
    assert_eq!(r["code"], "inherit_cycle");
    assert_eq!(r["rows"], json!(["a", "b"]));
}

/// Two short IDs whose FNV-1a hashes are equal.
fn collision() -> (String, String) {
    let mut seen = std::collections::HashMap::new();
    for n in 0u64.. {
        let id = format!("k{n:x}");
        if let Some(other) = seen.insert(fnv1a(&id), id.clone()) {
            return (other, id);
        }
    }
    unreachable!()
}
