//! A frame uploads each atlas page once, however many labels add glyphs to it: every label is
//! prepared before the first paint, so two labels of different text on one page are one upload a
//! frame, not one per label. A label that fills the atlas is drawn whole on fresh pages, and the
//! labels around it too. A number that isn't finite, or a side that isn't above zero, is refused.

#![cfg(target_os = "macos")]

use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::Value;

fn render(lines: &str) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-text-render"))
        .arg("render")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-text-render starts");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(lines.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn label(text: &str, y: u32) -> String {
    tinted(text, y, 24, [255, 255, 255])
}

fn tinted(text: &str, y: u32, size: u32, color: [u8; 3]) -> String {
    format!(
        r#"{{"text":"{text}","x":10,"y":{y},"size":{size},"weight":400,"font":"body","color":{color:?}}}"#
    )
}

/// The sprites the draws of the label in `color` add up to.
fn sprites(answer: &Value, color: [u8; 3]) -> u64 {
    answer["draws"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|draw| draw["color"] == serde_json::json!(color))
        .map(|draw| draw["glyphs"].as_u64().unwrap())
        .sum()
}

#[test]
fn two_labels_of_different_text_on_one_page_are_one_upload() {
    let dir = std::env::temp_dir().join(format!("deep-text-render-uploads-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out = dir.join("card.png");
    let card = r#""card":{"w":240,"h":120,"color":[20,20,20]}"#;
    let answers = render(&format!(
        "{{\"out\":{:?},{card},\"labels\":[{},{}]}}\n{{\"out\":{:?},{card},\"labels\":[{}]}}\n{{\"out\":{:?},\"card\":{{\"w\":0,\"h\":120,\"color\":[0,0,0]}},\"labels\":[]}}\n",
        out.to_str().unwrap(),
        label("Ready", 10),
        label("xqzj 0987", 70),
        out.to_str().unwrap(),
        label("Ready", 10).replace("\"size\":24", "\"size\":1e300"),
        out.to_str().unwrap(),
    ));
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(answers.len(), 3, "{answers:?}");
    let first = &answers[0];
    assert_eq!(first["ok"], true, "{first}");
    assert_eq!(first["pages"], serde_json::json!([0]), "{first}");
    assert_eq!(first["shaped"], 2, "{first}");
    assert_eq!(
        first["uploads"], 1,
        "both labels added glyphs to page 0, yet no frame uploaded it twice: {first}"
    );
    assert_eq!(
        answers[1]["code"], "bad_input",
        "an infinite size: {}",
        answers[1]
    );
    assert_eq!(
        answers[2]["code"], "bad_input",
        "a card with no width: {}",
        answers[2]
    );
}

#[test]
fn a_label_that_fills_the_atlas_is_drawn_whole_and_so_are_its_neighbors() {
    // 175 distinct letters and digits, Latin, Greek and Cyrillic, eight times over so each glyph
    // meets all eight sub-pixel phases: 1,400 rasters a label. Glyphs above 64 device px draw as
    // paths (#1479), so the big labels stay at 64 px and under, one size each; drawn alone they
    // take 11 pages between them, more than the atlas's eight, so a later one starts it over.
    let alphabet: String = (0x41..0x5b)
        .chain(0x61..0x7b)
        .chain(0x30..0x3a)
        .chain((0x391..0x3aa).filter(|c| *c != 0x3a2))
        .chain(0x3b1..0x3ca)
        .chain(0x410..0x450)
        .map(|c| char::from_u32(c).unwrap())
        .collect();
    assert_eq!(alphabet.chars().count(), 175);
    let text = alphabet.repeat(8);
    let big: Vec<(u32, u32, [u8; 3])> = vec![
        (300, 64, [255, 0, 0]),
        (390, 60, [0, 255, 0]),
        (480, 56, [0, 0, 255]),
        (570, 52, [255, 255, 0]),
    ];
    let dir =
        std::env::temp_dir().join(format!("deep-text-render-rollover-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out = dir.join("card.png");
    let card = |labels: &[String]| {
        format!(
            "{{\"out\":{:?},\"card\":{{\"w\":400,\"h\":400,\"color\":[0,0,0]}},\"labels\":[{}]}}\n",
            out.to_str().unwrap(),
            labels.join(","),
        )
    };
    // Each big label alone, in a fresh process: together they need more pages than there are.
    let alone: usize = big
        .iter()
        .map(|&(y, size, color)| {
            let answer = &render(&card(&[tinted(&text, y, size, color)]))[0];
            assert_eq!(answer["ok"], true, "{answer}");
            answer["pages"].as_array().unwrap().len()
        })
        .sum();
    assert!(
        alone > 8,
        "the big labels alone take {alone} pages, so drawn together they must start the atlas over"
    );
    let mut labels = vec![tinted("Ready", 10, 64, [255, 255, 255])];
    labels.extend(
        big.iter()
            .map(|&(y, size, color)| tinted(&text, y, size, color)),
    );
    let answers = render(&card(&labels));
    let _ = std::fs::remove_dir_all(&dir);
    let answer = &answers[0];
    assert_eq!(answer["ok"], true, "{answer}");
    assert_eq!(
        sprites(answer, [255, 255, 255]),
        5,
        "the label before the rollover: {answer}"
    );
    for &(_, size, color) in &big {
        assert_eq!(
            sprites(answer, color),
            1_400,
            "the {size} px label is drawn whole: {answer}"
        );
    }
    assert!(
        answer["pages"].as_array().unwrap().len() <= 8,
        "no frame draws from more pages than the atlas holds: {answer}"
    );
}
