use std::path::Path;

use serde_json::{json, Value};

const DEPTH: usize = 16;
const WRITTEN_AT_FETCH: [&str; 5] = ["url", "fetched", "title", "publisher", "edition"];

fn kept(evidence: Option<&Path>, hash: &str) -> Option<std::path::PathBuf> {
    evidence
        .filter(|_| hash.len() == 64 && hash.is_ascii())
        .map(|e| e.join(&hash[..2]).join(&hash[2..]))
}

fn json_at(path: std::path::PathBuf) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn file(sha: &str, written: &Value, bytes: Value, license: &Value) -> Value {
    let mut file = json!({
        "sha256": sha, "bytes": bytes, "license": license["id"], "credit": license["credit"],
    });
    for field in WRITTEN_AT_FETCH {
        file[field] = written[field].clone();
    }
    file
}

fn walk(record: &Value, sha: &str, evidence: Option<&Path>, depth: usize, out: &mut Vec<Value>) {
    let source = &record["source"];
    let mut add = |found: Value| {
        if !out.iter().any(|f| f["sha256"] == found["sha256"]) {
            out.push(found);
        }
    };
    if source["url"].is_string() {
        let size = kept(evidence, sha)
            .and_then(|p| std::fs::metadata(p).ok())
            .map(|m| m.len());
        add(file(sha, source, json!(size), &Value::Null));
        return;
    }
    let job = &source["job"];
    if job["kind"] == "table.derive" {
        let lineage = record["lineage"]
            .as_str()
            .and_then(|hash| kept(evidence, hash))
            .and_then(json_at);
        let inputs = lineage.as_ref().and_then(|l| l["inputs"].as_object());
        for input in inputs.into_iter().flatten().map(|(_, i)| &i["sha256"]) {
            let read = input.as_str().filter(|_| depth < DEPTH).and_then(|sha| {
                let record = evidence.map(|e| e.join("tables").join(format!("{sha}.json")));
                Some((sha, record.and_then(json_at)?))
            });
            if let Some((sha, record)) = read {
                walk(&record, sha, evidence, depth + 1, out);
            }
        }
        return;
    }
    let listed = job["input"]
        .as_object()
        .into_iter()
        .flat_map(|i| i.values());
    for entry in listed.flat_map(|files| files.as_array().into_iter().flatten()) {
        if let (Some(sha), true) = (entry["sha256"].as_str(), entry["url"].is_string()) {
            add(file(sha, entry, entry["bytes"].clone(), &entry["license"]));
        }
    }
}

pub fn files(record: &Value, sha: &str, evidence: Option<&Path>) -> Vec<Value> {
    let mut out = Vec::new();
    walk(record, sha, evidence, 0, &mut out);
    out
}

pub fn wrote(record: &Value, lineage: &Value, column: &str, key: &str) -> Option<String> {
    let steps = record["source"]["job"]["params"]["steps"].as_array()?;
    let read = lineage["rows"][key].as_object()?;
    let rows = read
        .values()
        .filter_map(|keys| keys.as_array().map(Vec::len))
        .max()?;
    steps.iter().rev().find_map(|step| {
        if let Some(agg) = step["group"]["agg"][column].as_str() {
            let name = agg.split('(').next().unwrap_or(agg).trim();
            let plural = if rows == 1 { "" } else { "s" };
            return Some(format!("{name} of {rows} row{plural}"));
        }
        step["derive"][column]
            .is_object()
            .then(|| "derive of 1 row".to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::{files, wrote};
    use serde_json::json;

    #[test]
    fn a_table_the_hub_fetched_itself_is_its_own_file_with_the_size_the_store_holds() {
        let sha = "ab".repeat(32);
        let evidence = std::env::temp_dir().join(format!("deep-fetched-{}", std::process::id()));
        std::fs::create_dir_all(evidence.join(&sha[..2])).unwrap();
        std::fs::write(evidence.join(&sha[..2]).join(&sha[2..]), b"metro,people\n").unwrap();
        let source = json!({"url": "https://example.test/t.csv", "fetched": 7, "title": "People"});
        let found = files(&json!({"source": source}), &sha, Some(&evidence));
        std::fs::remove_dir_all(&evidence).unwrap();
        assert_eq!(
            found,
            vec![json!({
                "sha256": sha, "bytes": 13, "license": null, "credit": null,
                "url": "https://example.test/t.csv", "fetched": 7, "title": "People",
                "publisher": null, "edition": null,
            })]
        );
    }

    #[test]
    fn a_cell_names_the_last_step_that_wrote_its_column_and_the_rows_that_step_read() {
        let steps = json!([
            {"group": {"by": ["metro"], "agg": {"employed": "sum(jobs)"}}},
            {"derive": {"share": {"expr": "employed / 2"}}},
        ]);
        let record = json!({"source": {"job": {"params": {"steps": steps}}}});
        let lineage = json!({"rows": {"Northfold": {"county": ["1", "2", "3"], "metro": ["9"]}}});
        let of = |column: &str| wrote(&record, &lineage, column, "Northfold");
        assert_eq!(of("employed").as_deref(), Some("sum of 3 rows"));
        assert_eq!(of("share").as_deref(), Some("derive of 1 row"));
        assert_eq!(of("metro"), None);
    }
}
