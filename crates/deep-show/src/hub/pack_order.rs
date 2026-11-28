use std::path::PathBuf;

use serde_json::Value;

pub(super) fn required_first(packs: &[(String, PathBuf)]) -> Vec<&(String, PathBuf)> {
    let read = |dir: &PathBuf| -> (String, Vec<String>) {
        let manifest: Value = std::fs::read(dir.join("pack.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(Value::Null);
        let name = manifest["name"].as_str().unwrap_or("").to_string();
        let needs = manifest["requires"]["packs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter_map(|t| t.rsplit_once('@'))
            .map(|(n, _)| n.rsplit_once('/').map_or(n, |(_, n)| n).to_string())
            .collect();
        (name, needs)
    };
    let read: Vec<(String, Vec<String>)> = packs.iter().map(|(_, dir)| read(dir)).collect();
    let mut out: Vec<usize> = Vec::new();
    fn visit(i: usize, read: &[(String, Vec<String>)], out: &mut Vec<usize>, depth: usize) {
        if out.contains(&i) || depth > read.len() {
            return;
        }
        for need in &read[i].1 {
            if let Some(j) = read.iter().position(|(n, _)| n == need) {
                visit(j, read, out, depth + 1);
            }
        }
        if !out.contains(&i) {
            out.push(i);
        }
    }
    for i in 0..packs.len() {
        visit(i, &read, &mut out, 0);
    }
    out.into_iter().map(|i| &packs[i]).collect()
}
