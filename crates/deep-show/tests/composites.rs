//! The composites pack and the castle (#420: "Composites (house, tower, lamp, island, cloud bank)
//! as recipes in a plug-in pack; the castle rebuilt as a document"): the pack in
//! `packs/composites-1.0.0` installs, the castle in `packs/examples/castle.json` presents with no
//! error and nothing skipped, and every item it expands to builds, each solid one closed.
//! Drives `deep-show run` as the acceptance tests do.
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const DOC: &str = "01JB420C0000000000000000001";

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn run(calls: Vec<Value>) -> Vec<Value> {
    let evidence =
        std::env::temp_dir().join(format!("deep-show-composites-{}", std::process::id()));
    let scenario = json!({
        "evidence": evidence,
        "sessions": {"sess-alpha": {"thread": "thread-alpha", "name": "Alpha", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
        "panels": {"p1": {"rect": [0, 0, 1280, 800]}},
        "docs": {DOC: {"panel": "p1"}},
        "packs": [{"id": "deepbuild/composites", "dir": repo().join("packs/composites-1.0.0")}],
        "calls": calls,
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show exits");
    let _ = std::fs::remove_dir_all(&evidence);
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON line");
    assert_eq!(answer["ok"], json!(true), "{answer}");
    answer["replies"].as_array().expect("replies").clone()
}

#[test]
fn the_castle_presents_from_the_composites_pack_and_every_part_builds() {
    let castle: Value = serde_json::from_slice(
        &std::fs::read(repo().join("packs/examples/castle.json")).expect("the castle"),
    )
    .expect("JSON");
    let replies = run(vec![
        json!({"call": "packs"}),
        json!({"call": "deep_show", "session": "sess-alpha", "doc": DOC, "document": castle, "include": ["issues"]}),
        json!({"call": "geometry", "doc": DOC}),
    ]);
    let pack = replies[0]["packs"]
        .as_array()
        .expect("pack rows")
        .iter()
        .find(|p| p["pack"] == json!("deepbuild/composites"))
        .cloned()
        .expect("the pack is in the store");
    assert_eq!(pack["state"], json!("installed"), "{pack}");
    let shown = &replies[1];
    let errors: Vec<&Value> = shown["issues"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|i| i["severity"] == json!("error"))
        .collect();
    assert!(errors.is_empty(), "the castle has no error: {errors:?}");
    let skipped: Vec<&Value> = shown["notices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|n| n["code"] == json!("unknown_kind"))
        .collect();
    assert!(skipped.is_empty(), "no item is skipped: {skipped:?}");
    assert_eq!(shown["outcome"], json!("presented"), "{shown}");
    // Every instance expanded, and every recipe of the pack is used.
    let expansions = shown["expansions"].as_array().expect("expansions");
    let kinds: std::collections::BTreeSet<&str> = expansions
        .iter()
        .filter_map(|e| e["kind"].as_str())
        .collect();
    for k in [
        "composites.house@1",
        "composites.tower@1",
        "composites.lamp@1",
        "composites.island@1",
        "composites.cloud_bank@1",
    ] {
        assert!(kinds.contains(k), "{k} expands in the castle: {kinds:?}");
    }
    let derived: Vec<String> = expansions
        .iter()
        .flat_map(|e| {
            e["derived"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(k, _)| k.clone())
        })
        .collect();
    let geometry = &replies[2];
    assert!(geometry.get("code").is_none(), "{geometry}");
    let built: std::collections::BTreeMap<&str, &Value> = geometry["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|i| (i["id"].as_str().expect("an id"), i))
        .collect();
    for id in &derived {
        let item = built
            .get(id.as_str())
            .unwrap_or_else(|| panic!("{id} builds"));
        let positions = item["positions"].as_array().map_or(0, Vec::len);
        assert!(positions > 0, "{id} builds vertices");
        let open = item["kind"] == json!("plate@1");
        let closed = item["closed"].as_object().is_some_and(|c| !c.is_empty());
        assert_eq!(closed, !open, "{id} is closed unless it is a plate");
    }
    // The curtain walls, the gate and the towers' merlons among them: the castle's own parts.
    for id in [
        "wall_front",
        "gate",
        "tower_nw.north.0",
        "keep.front",
        "clouds.puff.9",
    ] {
        assert!(built.contains_key(id), "{id} builds");
    }
}
