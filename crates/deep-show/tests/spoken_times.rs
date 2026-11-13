//! #509: a time that names a narration line (`@l1.end`) resolves only once the line's words are
//! baked. Before that the document is refused naming what the line waits on, the words bake and
//! the PCM's hash, rather than a bare `bad_time`; with the words record attached it is presented
//! and the key sits at the line's last word's end. Drives `deep-show run` as the acceptance tests do.
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const FLICKS: i64 = 705_600_000;
const RATE: usize = 48_000;
const DOC: &str = "01JB509T0000000000000000001";

fn hex(d: impl AsRef<[u8]>) -> String {
    d.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// Bytes kept in the evidence folder by their SHA-256.
fn put(evidence: &Path, bytes: &[u8]) -> String {
    let sha = hex(Sha256::digest(bytes));
    let dir = evidence.join(&sha[..2]);
    std::fs::create_dir_all(&dir).expect("the evidence folder");
    std::fs::write(dir.join(&sha[2..]), bytes).expect("the file");
    sha
}

/// Half a second of a 440 Hz tone, mono f32 at 48 kHz: its WAV and its PCM's bytes.
fn take() -> (Vec<u8>, Vec<u8>) {
    let samples: Vec<f32> = (0..RATE / 2)
        .map(|i| 0.2 * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / RATE as f32).sin())
        .collect();
    let pcm: Vec<u8> = samples.iter().flat_map(|x| x.to_le_bytes()).collect();
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&3u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&(RATE as u32).to_le_bytes());
    wav.extend_from_slice(&(RATE as u32 * 4).to_le_bytes());
    wav.extend_from_slice(&4u16.to_le_bytes());
    wav.extend_from_slice(&32u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(&pcm);
    (wav, pcm)
}

/// A film whose one line, at 0.2 s, plays the take, and whose channel key sits at `@l1.end`.
fn film(asset: &str, attached: &[String]) -> Value {
    let license =
        json!({"id": "CC0-1.0", "shareable": true, "credit": "A tone for deep-show's tests."});
    json!({"format": 1, "id": "film", "profile": "film", "title": "A line's end", "description": "A film whose key sits at a narration line's end.",
        "size": [320, 180], "camera": "cam", "transport": {"frame_rate": [24, 1], "span": "1s", "sample_rate": RATE},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0", "params": {"projection": "orthographic", "target": [160, 90, 0], "view_width": 320}},
            "mover": {"id": "mover", "kind": "rect@1", "name": "Mover", "order": "a1", "params": {"box": [0, 60, 40, 40], "paint": {"fill": {"role": "accent"}}}},
        },
        "channels": {"slide": {"target": "items/mover/params/box/0", "type": "f32",
            "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"}, "k1": {"t": "@l1.end", "value": 100, "interp": "linear"}}}},
        "assets": {"voice": {"sha256": asset, "license": license.clone(), "attached": attached}},
        "script": {"narrator": {"name": "A tone", "license": license}, "lines": {"l1": {"t": "0.2s", "text": "one two", "recording": {"asset": "voice"}}},
            "captions": {"profile": "netflix-en-adult"}}})
}

/// `deep-show run` on the film presented from your shell, then `calls`: every reply.
fn run(root: &Path, document: Value, calls: Vec<Value>) -> Vec<Value> {
    let mut all = vec![
        json!({"call": "deep show", "peer": {"pid": 3002, "start": 3000}, "doc": DOC, "document": document, "include": ["issues"]}),
    ];
    all.extend(calls);
    let scenario = json!({
        "evidence": root.join("evidence"), "sessions": {},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 3000, "ppid": 1, "start": 100}, {"pid": 3001, "ppid": 3000, "start": 110}, {"pid": 3002, "ppid": 3001, "start": 3000}],
        "panels": {"p": {"rect": [0, 0, 640, 360]}}, "docs": {DOC: {"panel": "p"}}, "calls": all,
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-show"))
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-show starts");
    writeln!(child.stdin.take().expect("stdin"), "{scenario}").expect("written");
    let out = child.wait_with_output().expect("deep-show exits");
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON line");
    assert_eq!(answer["ok"], json!(true), "{answer}");
    answer["replies"].as_array().expect("replies").clone()
}

fn root(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("deep-show-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("evidence")).expect("the root");
    root
}

#[test]
fn a_time_naming_an_unbaked_line_is_refused_naming_the_words_bake_and_resolves_once_baked() {
    let root = root("spoken-times");
    let evidence = root.join("evidence");
    let (wav, pcm) = take();
    let asset = put(&evidence, &wav);
    let pcm_sha = hex(Sha256::digest(&pcm));

    let unbaked = run(&root, film(&asset, &[]), vec![]);
    let issues = unbaked[0]["issues"].as_array().cloned().unwrap_or_default();
    let waits = issues
        .iter()
        .find(|i| i["code"] == "narration.words_unbaked");
    assert_ne!(unbaked[0]["outcome"], json!("presented"), "{}", unbaked[0]);
    let waits = waits.unwrap_or_else(|| {
        panic!(
            "the refusal names the words bake the line waits on: {}",
            unbaked[0]
        )
    });
    assert_eq!(waits["ids"], json!(["l1"]), "{waits}");
    assert_eq!(
        (&waits["actual"]["job"], &waits["actual"]["pcm_sha256"]),
        (&json!("bake.words"), &json!(pcm_sha)),
        "{waits}"
    );

    let record = json!({"kind": "bake.words", "analyzer": "charsiu-aligner@1.0.0", "weights": [], "pcm_sha256": pcm_sha, "frame": FLICKS / 100,
        "words": [{"text": "one", "start": FLICKS / 20, "end": FLICKS / 5, "phonemes": []}, {"text": "two", "start": FLICKS / 4, "end": 2 * FLICKS / 5, "phonemes": []}]});
    let words = put(&evidence, record.to_string().as_bytes());
    let baked = run(
        &root,
        film(&asset, &[words]),
        vec![json!({"call": "time", "doc": DOC, "text": "@l1.end"})],
    );
    let _ = std::fs::remove_dir_all(&root);
    assert_eq!(baked[0]["outcome"], json!("presented"), "{}", baked[0]);
    assert_eq!(
        baked[1]["t"],
        json!(FLICKS / 5 + 2 * FLICKS / 5),
        "@l1.end is 0.2 s plus the last word's end: {}",
        baked[1]
    );
}
