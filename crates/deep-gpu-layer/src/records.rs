//! Second-GPU index records (issue #1056; tests/acceptance/1056/README.md, Surfaces): a pixel
//! look's index targets on this GPU, written so another machine's can be compared with them.
//!
//! `index_record` `{fixture, doc, look, frames, fps?}` draws every frame as `film2d` does and writes
//! each frame's index target `<sha256>.u16` and the record `index-record-<fixture>-<family>.json`:
//! the GPU (`gpu.family`, `gpu.chip`, as #464's two-GPU criteria read them), the run's environment
//! fingerprint (canvas primitives: Determinism class), the tree hash of the checkout it ran in and
//! each frame's index hash, with `indices.<fixture>` frame 0's, the field #464's suite compares.
//!
//! `cross_index` `{records}` compares each fixture's records across GPU families, frame by frame.
//! Records of different trees are stale: BLOCKED, never compared, naming both trees. A fixture with
//! no record from a second family is BLOCKED with one unblock ask for the whole comparison, the
//! same question whichever fixtures are compared, so a person is asked once. A frame whose hashes
//! differ fails, naming the frame and its first differing target pixel. Never PASS from one family.

use std::collections::BTreeMap;
use std::fs::{self, File, FileTimes};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{json, Value};

use crate::{effects, film, golden, refused, steps_ref, App};

/// A fresh folder under the temporary folder, for this process alone.
fn scratch(what: &str) -> Option<PathBuf> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("deep-gpu-{what}-{}-{n}", std::process::id()));
    fs::create_dir_all(&dir).ok().map(|()| dir)
}

/// The tree hash of what is on disk in the checkout deep-gpu runs in, uncommitted and untracked
/// files too, so a clean checkout's is `HEAD^{tree}` (docs/parallel-proof.md; scripts/lanes.mjs's
/// `exactTree`), written from a copy of git's index so the real one is untouched. None outside git.
fn tree() -> Option<String> {
    let git = |args: &[&str], index: Option<&Path>| -> Option<String> {
        let mut c = Command::new("git");
        c.args(args);
        if let Some(i) = index {
            c.env("GIT_INDEX_FILE", i);
        }
        let o = c.output().ok().filter(|o| o.status.success())?;
        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    let source = PathBuf::from(git(&["rev-parse", "--git-path", "index"], None)?);
    let dir = scratch("tree")?;
    let copy = dir.join("index");
    // Git rechecks a file only if it isn't older than the index, so the copy keeps the index's
    // times; a repository nothing was added to has no index yet, and `git add -A` starts one.
    let copied = !source.exists()
        || fs::copy(&source, &copy).is_ok_and(|_| {
            let times = fs::metadata(&source).and_then(|m| {
                Ok(FileTimes::new()
                    .set_accessed(m.accessed()?)
                    .set_modified(m.modified()?))
            });
            times
                .and_then(|t| File::options().write(true).open(&copy)?.set_times(t))
                .is_ok()
        });
    let written = copied
        .then(|| git(&["add", "-A"], Some(&copy)).and_then(|_| git(&["write-tree"], Some(&copy))))
        .flatten();
    let _ = fs::remove_dir_all(&dir);
    written
}

/// `index_record`: the fixture's every frame drawn, its index targets and its record written.
pub fn index_record(app: &mut App, out: &str, call: &Value) -> Value {
    let Some(fixture) = call["fixture"]
        .as_str()
        .filter(|f| !f.is_empty() && !f.contains(['/', '\\']))
    else {
        return refused("bad_input", "fixture is a name");
    };
    let Some(frames) = call["frames"].as_u64().filter(|n| *n > 0) else {
        return refused("bad_input", "frames is a count");
    };
    let Some(tree) = tree() else {
        return refused(
            "no_tree",
            "deep-gpu runs outside a git checkout, so the record would name no tree",
        );
    };
    let Some(dir) = scratch("index-record") else {
        return refused("not_written", "no scratch folder");
    };
    // film2d writes each captured frame's PNG too; only the index targets are kept.
    let mut film = json!({"call": "film2d", "doc": call["doc"], "look": call["look"], "frames": frames,
        "capture": (0..frames).collect::<Vec<_>>(), "targets": ["indices"]});
    if let Some(fps) = call.get("fps") {
        film["fps"] = fps.clone();
    }
    let reply = film::film2d(app, &dir.to_string_lossy(), &film);
    let kept = keep(&reply, &dir, Path::new(out));
    let _ = fs::remove_dir_all(&dir);
    let hashes = match kept {
        Ok(h) => h,
        Err(e) => return e,
    };
    let fingerprint = golden::fingerprint(app);
    let chip = fingerprint["gpu"].as_str().unwrap_or("unknown").to_string();
    let family = effects::family(&chip);
    let record = json!({
        "format": 1,
        "fixture": fixture,
        "gpu": {"family": family, "chip": chip},
        "fingerprint": fingerprint,
        "tree": tree,
        "size": reply["indexed"]["size"],
        "frames": hashes.iter().enumerate().map(|(n, h)| json!({"frame": n, "indices": h})).collect::<Vec<_>>(),
        "indices": {fixture: hashes[0]},
    });
    let name = format!("index-record-{fixture}-{family}.json");
    let text = serde_json::to_string_pretty(&record).unwrap_or_default() + "\n";
    if let Err(e) = fs::write(Path::new(out).join(&name), text) {
        return refused("not_written", e.to_string());
    }
    json!({"record": name, "family": family, "tree": tree, "frames": hashes.len()})
}

/// Each frame's index hash from film2d's reply, its `.u16` copied from `from` into `to`.
fn keep(reply: &Value, from: &Path, to: &Path) -> Result<Vec<String>, Value> {
    if reply.get("code").is_some() {
        return Err(reply.clone());
    }
    let mut hashes = Vec::new();
    for f in reply["frames"].as_array().into_iter().flatten() {
        let Some(h) = f["indices"].as_str() else {
            return Err(refused(
                "not_indexed",
                "the look draws no index target: it has no indexed basis",
            ));
        };
        let file = format!("{h}.u16");
        fs::copy(from.join(&file), to.join(&file))
            .map_err(|e| refused("not_written", e.to_string()))?;
        hashes.push(h.to_string());
    }
    Ok(hashes)
}

/// A record as `cross_index` reads it.
struct Rec {
    path: String,
    dir: PathBuf,
    fixture: String,
    family: String,
    tree: String,
    width: Option<usize>,
    frames: Vec<String>,
}

fn read(path: &str) -> Option<Rec> {
    let r: Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    let p = Path::new(path);
    let fixture = r["fixture"].as_str().map(String::from).or_else(|| {
        let name = p.file_stem()?.to_str()?.strip_prefix("index-record-")?;
        Some(name.rsplit_once('-')?.0.to_string())
    })?;
    Some(Rec {
        path: path.to_string(),
        dir: p.parent().map_or_else(PathBuf::new, Path::to_path_buf),
        fixture,
        family: r["gpu"]["family"].as_str()?.to_string(),
        tree: r["tree"].as_str()?.to_string(),
        width: r["size"][0].as_u64().map(|w| w as usize),
        frames: r["frames"]
            .as_array()?
            .iter()
            .map(|f| f["indices"].as_str().map(String::from))
            .collect::<Option<_>>()?,
    })
}

/// A Mac that has the family missing beside `mine`.
fn mac_of(family: &str) -> &'static str {
    if family == "apple7" {
        "an M1"
    } else {
        "an M3 or an M4"
    }
}

/// `cross_index`: records of each fixture compared across GPU families, frame by frame.
pub fn cross_index(call: &Value) -> Value {
    let mut recs = Vec::new();
    for p in call["records"].as_array().into_iter().flatten() {
        match p.as_str().and_then(read) {
            Some(r) => recs.push(r),
            None => {
                return refused(
                    "bad_input",
                    format!("record {p} isn't a readable index record"),
                )
            }
        }
    }
    let Some(first) = recs.first() else {
        return refused("bad_input", "records names at least one index record");
    };
    // One tree, the first record's: a record of another is stale, refused and never compared.
    let tree = first.tree.clone();
    let stale: Vec<&Rec> = recs.iter().filter(|r| r.tree != tree).collect();
    if !stale.is_empty() {
        let mut families: Vec<&str> = stale.iter().map(|r| r.family.as_str()).collect();
        families.dedup();
        let made: Vec<String> = stale
            .iter()
            .map(|r| format!("{} on {} at tree {}", r.fixture, r.family, r.tree))
            .collect();
        return json!({
            "result": "BLOCKED",
            "reason": "stale",
            "tree": tree,
            "stale": stale.iter().map(|r| json!({"record": r.path, "family": r.family, "tree": r.tree})).collect::<Vec<_>>(),
            "asks": [{"kind": "unblock", "needs": "records of one tree", "gpu": families,
                "ask": format!("the records {} were made at another tree than {tree}: make them again on that GPU at tree {tree} and compare them here", made.join(", "))}],
        });
    }
    let mut by_fixture: BTreeMap<&str, Vec<&Rec>> = BTreeMap::new();
    for r in &recs {
        by_fixture.entry(&r.fixture).or_default().push(r);
    }
    let mut differs = Vec::new();
    let mut alone: Vec<&str> = Vec::new();
    for (fixture, rs) in &by_fixture {
        let a = rs[0];
        let others: Vec<&&Rec> = rs.iter().filter(|r| r.family != a.family).collect();
        if others.is_empty() {
            alone.push(&a.family);
        }
        for b in others {
            for n in 0..a.frames.len().max(b.frames.len()) {
                match (a.frames.get(n), b.frames.get(n)) {
                    (Some(x), Some(y)) if x == y => {}
                    (Some(x), Some(y)) => differs.push(differ(fixture, n, (a, x), (b, y))),
                    _ => differs.push(
                        json!({"fixture": fixture, "frame": n, "families": [a.family, b.family],
                        "reason": "one record has no such frame"}),
                    ),
                }
            }
        }
    }
    let mut families: Vec<&str> = recs.iter().map(|r| r.family.as_str()).collect();
    families.sort_unstable();
    families.dedup();
    if !differs.is_empty() {
        return json!({"result": "FAIL", "tree": tree, "families": families, "differs": differs});
    }
    if !alone.is_empty() {
        alone.sort_unstable();
        alone.dedup();
        let missing = steps_ref::missing_family(alone[0]);
        let ask = format!(
            "on a Mac whose GPU is another family than {} ({}'s {missing}, or the other reference Mac), at tree {tree}, write these fixtures' index records with deep-gpu's index_record (tests/acceptance/1056/records.test.ts writes #464's) and compare them here with cross_index",
            alone.join(" and "),
            mac_of(missing),
        );
        return json!({"result": "BLOCKED", "reason": "one_family", "tree": tree, "families": families,
            "asks": [{"kind": "unblock", "ask": ask, "needs": "a second GPU family", "gpu": missing}]});
    }
    json!({"result": "PASS", "tree": tree, "families": families})
}

/// A frame whose index hashes differ: its first differing target pixel, row by row.
fn differ(fixture: &str, frame: usize, (a, x): (&Rec, &String), (b, y): (&Rec, &String)) -> Value {
    let mut d = json!({"fixture": fixture, "frame": frame, "families": [a.family, b.family], "hashes": [x, y]});
    let target = |r: &Rec, h: &str| fs::read(r.dir.join(format!("{h}.u16"))).ok();
    let (Some(p), Some(q)) = (target(a, x), target(b, y)) else {
        d["reason"] = json!("an index target a record names isn't beside it");
        return d;
    };
    let (p, q) = (p.as_chunks::<2>().0, q.as_chunks::<2>().0);
    let at = p
        .iter()
        .zip(q)
        .position(|(i, j)| i != j)
        .unwrap_or(p.len().min(q.len()));
    let value = |s: &[[u8; 2]]| s.get(at).map(|v| u16::from_le_bytes(*v));
    d["values"] = json!([value(p), value(q)]);
    match a.width.filter(|w| *w > 0) {
        Some(w) => d["pixel"] = json!([at % w, at / w]),
        None => d["index"] = json!(at),
    }
    d
}
