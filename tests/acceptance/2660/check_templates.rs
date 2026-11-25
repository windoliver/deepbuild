//! #2660 criterion 3: a check of a document with 200 template items and 4 MiB of description
//! allocates under 8 MiB. On the merge base it allocates at least 200 copies of the document.
//!
//! The check is the marks module's, `deep_canvas_marks::check::check`, in the shipped clean look.
//! The bytes are those its heap allocations ask for, counted as
//! `crates/deep-marks-render/tests/no_alloc.rs` counts allocations.

mod alloc;

#[global_allocator]
static ALLOCATOR: alloc::Counting = alloc::Counting;

use serde_json::{json, Map, Value};

const TEMPLATES: usize = 200;
const MIB: u64 = 1024 * 1024;

fn document() -> Value {
    let mut items = Map::new();
    for i in 0..TEMPLATES {
        let id = format!("c{i:03}");
        items.insert(
            id.clone(),
            json!({"id": id, "kind": "text@1", "layer": "main", "name": id, "order": format!("a{i:03}"),
                   "params": {"template": "Count: {data/count}", "font": "body", "size": 12,
                              "box": {"w": 120, "h": 16}},
                   "at": {"pos": [(i % 10) * 128, (i / 10) * 20, 0]}}),
        );
    }
    // A reading bound elsewhere on the board: each template's story number is then unsourced, an
    // issue the check names by the template's item.
    items.insert(
        "live".into(),
        json!({"id": "live", "kind": "text@1", "layer": "main", "name": "live", "order": "b0",
               "params": {"text": "", "font": "body", "size": 12, "box": {"w": 120, "h": 16}},
               "at": {"pos": [0, 380, 0]}}),
    );
    // 4 MiB of description, in words.
    let description = "a long description ".repeat(4 * MIB as usize / 19 + 1);
    json!({"format": 1, "profile": "board", "title": "Counts", "description": description,
           "size": [1280, 400], "layers": {"main": {"order": "a0"}},
           "data": {"count": {"value": 3, "source": "story"}},
           "bound_values": {"v": {"target": "items/live/params/text",
                                  "source": "reading:01JB0000000000000000000001"}},
           "items": items})
}

// AC3 #2660.c8534ab1
#[test]
fn ac3_a_check_of_200_templates_beside_4_mib_of_description_allocates_under_8_mib() {
    let def = deep_canvas_marks::look::shipped("clean").expect("the clean look ships");
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    let look = deep_canvas_marks::look::resolve(&def, &bundled).expect("the clean look resolves");
    let doc = document();
    let doc = doc.as_object().unwrap();
    let size = serde_json::to_string(doc).unwrap().len() as u64;
    assert!(size >= 4 * MIB, "the document is {size} bytes");
    let (issues, counted) = alloc::counted(|| deep_canvas_marks::check::check(doc, &look, None));
    eprintln!(
        "check: {} bytes in {} allocations ({:.1} copies of the {size}-byte document); {} issues",
        counted.bytes,
        counted.count,
        counted.bytes as f64 / size as f64,
        issues.len()
    );
    // The check read every template: each one's story number is named unsourced.
    let named = (0..TEMPLATES)
        .filter(|i| {
            let id = format!("c{i:03}");
            issues
                .iter()
                .any(|x| x.code == "number_unsourced" && x.ids.contains(&id))
        })
        .count();
    assert_eq!(named, TEMPLATES, "the check names each template's story number");
    assert!(
        counted.bytes < 8 * MIB,
        "the check allocated {} bytes in {} allocations, {:.1} times the document's {size} bytes; under {} bytes are owed",
        counted.bytes,
        counted.count,
        counted.bytes as f64 / size as f64,
        8 * MIB
    );
}
