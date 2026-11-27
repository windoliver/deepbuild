//! #2044: the live view's decode worker, `deep-canvas-render decode-worker-live <file> <w> <h>`,
//! ends on a movie whose file can't back a count it states, printing the refusal.

#![cfg(target_os = "macos")]

use std::process::{Command, Stdio};

fn boxed(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut b = ((body.len() + 8) as u32).to_be_bytes().to_vec();
    b.extend_from_slice(kind);
    b.extend_from_slice(body);
    b
}

fn full(kind: &[u8; 4], words: &[u32]) -> Vec<u8> {
    let body: Vec<u8> = [&[0][..], words]
        .concat()
        .iter()
        .flat_map(|w| w.to_be_bytes())
        .collect();
    boxed(kind, &body)
}

#[test]
fn a_movie_whose_file_cannot_back_its_sample_count_ends_the_live_worker_naming_the_box() {
    let stbl = [
        full(b"stsz", &[1, 1000]),
        full(b"stco", &[1, 0]),
        full(b"stsc", &[1, 1, 4, 1]),
        full(b"stts", &[1, 4, 1]),
    ];
    let mdhd = full(b"mdhd", &[0; 4]);
    let hdlr = boxed(b"hdlr", b"\0\0\0\0\0\0\0\0vide");
    let minf = boxed(b"minf", &boxed(b"stbl", &stbl.concat()));
    let trak = boxed(b"trak", &boxed(b"mdia", &[mdhd, hdlr, minf].concat()));
    let movie = boxed(b"moov", &trak);
    let path = std::env::temp_dir().join(format!("deep-live-count-{}.mp4", std::process::id()));
    std::fs::write(&path, &movie).unwrap();
    let ran = Command::new(env!("CARGO_BIN_EXE_deep-canvas-render"))
        .arg("decode-worker-live")
        .arg(&path)
        .args(["0", "0"])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    std::fs::remove_file(&path).unwrap();
    let said = String::from_utf8_lossy(&ran.stderr);
    assert_eq!(ran.status.code(), Some(1), "{said}");
    let limit = movie.len().to_string();
    for named in ["count_unbacked", "\"stsz\"", "1000", &limit] {
        assert!(said.contains(named), "{said}");
    }
}
