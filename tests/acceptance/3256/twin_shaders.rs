//! #3256.7baa6339 (AC2): "naga validates the twin and its `Frame` is the size `FrameUniform` is,
//! which is all a pipeline and a binding check, and the test shows both".
//!
//! The twin is `twins/frame-fields-swapped/lines.json`: `scene3d.wgsl` with `sky_top` and
//! `sky_low` swapped in `Frame`. This test lays those lines over the checkout's own
//! `scene3d.wgsl` as the proof lanes lay a twin (each `find` matched at exactly one place), joins
//! the scene's module as `lib.rs` joins it (`const SHADER: &str = concat!(include_str!(…), …)`),
//! and has naga parse and validate it and lay out its `Frame`. It reaches nothing of the crate
//! but those files, and it compares no host struct: that is the lane's, which
//! `layout.test.mjs` reads beside this (README.md).

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

const ID: &str = "#3256.7baa6339";
const TWIN: &str = "frame-fields-swapped";
const SHADER: &str = "crates/deep-scene3d-render/src/scene3d.wgsl";
/// `FrameUniform`'s size, by hand from the struct at the base (`lib.rs`): every field is an
/// array of `f32` or `u32`, so nothing is padded; a `[[f32; 4]; 4]` is 64 bytes and a `[f32; 4]`
/// 16. clip 64, right to sky_low 7 × 16, inverse_clip 64, eye 16, cut 4 × 16 (`cut::MAX_PLANES`
/// is 4), cut_info 16, cap 16: 352.
const FRAME_UNIFORM_BYTES: u32 = 352;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A file of the checkout, by its path from the root.
fn text(path: &str) -> String {
    let at = root().join(path);
    fs::read_to_string(&at).unwrap_or_else(|e| panic!("{ID}: {} reads: {e}", at.display()))
}

/// An edit's `find` or `wrong` lines.
fn lines(edit: &Value, key: &str) -> Vec<String> {
    let list = edit[key]
        .as_array()
        .unwrap_or_else(|| panic!("{ID}: an edit of the twin's lines.json has `{key}` lines"));
    list.iter()
        .map(|line| line.as_str().unwrap_or_default().to_string())
        .collect()
}

/// Where `find` matches in `held`: that many lines in a row equal to its lines.
fn places(held: &[String], find: &[String]) -> Vec<usize> {
    let last = (held.len() + 1).saturating_sub(find.len());
    (0..last)
        .filter(|&at| !find.is_empty() && held[at..at + find.len()] == *find)
        .collect()
}

/// `scene3d.wgsl` with the twin's lines laid, and whether the checkout already holds them (as
/// when this runs where the twin is laid).
fn laid() -> (String, bool) {
    let json = text(&format!("tests/acceptance/3256/twins/{TWIN}/lines.json"));
    let twin: Value = serde_json::from_str(&json)
        .unwrap_or_else(|e| panic!("{ID}: the twin's lines.json is JSON: {e}"));
    let edits = twin[SHADER]
        .as_array()
        .unwrap_or_else(|| panic!("{ID}: the twin's lines.json edits {SHADER}"));
    let own = text(SHADER);
    let mut held: Vec<String> = own.split('\n').map(str::to_string).collect();
    let mut already = false;
    for edit in edits {
        let find = lines(edit, "find");
        let wrong = lines(edit, "wrong");
        let found = places(&held, &find);
        if found.len() == 1 {
            let at = found[0];
            let mut next = held[..at].to_vec();
            next.extend(wrong);
            next.extend_from_slice(&held[at + find.len()..]);
            held = next;
        } else if found.is_empty() && places(&held, &wrong).len() == 1 {
            already = true;
        } else {
            panic!(
                "{ID}: the twin's lines match at {} places in {SHADER}, not one: it is stale",
                found.len()
            );
        }
    }
    (held.join("\n"), already)
}

/// The files of the scene's module, in the order `lib.rs` joins them.
fn scene_files() -> Vec<String> {
    let lib = text("crates/deep-scene3d-render/src/lib.rs");
    let from = lib
        .find("const SHADER: &str = concat!(")
        .unwrap_or_else(|| panic!("{ID}: lib.rs joins the scene's module in `const SHADER`"));
    let rest = &lib[from..];
    let to = rest
        .find(");")
        .unwrap_or_else(|| panic!("{ID}: lib.rs's `const SHADER` ends"));
    rest[..to]
        .split("include_str!(\"")
        .skip(1)
        .map(|part| part.split('"').next().unwrap_or_default().to_string())
        .collect()
}

/// The scene's module with `scene3d` in `scene3d.wgsl`'s place.
fn module(files: &[String], scene3d: &str) -> String {
    let mut source = String::new();
    for name in files {
        if name == "scene3d.wgsl" {
            source.push_str(scene3d);
        } else {
            source.push_str(&text(&format!("crates/deep-scene3d-render/src/{name}")));
        }
    }
    source
}

/// `source` parsed and validated by naga, then its `Frame` as naga lays it out: its size and
/// each field's offset.
fn frame(source: &str, which: &str) -> (u32, Vec<(String, u32)>) {
    let parsed = naga::front::wgsl::parse_str(source)
        .unwrap_or_else(|e| panic!("{ID}: naga parses {which}: {}", e.emit_to_string(source)));
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    )
    .validate(&parsed)
    .unwrap_or_else(|e| panic!("{ID}: naga validates {which}: {}", e.emit_to_string(source)));
    for (_, ty) in parsed.types.iter() {
        if ty.name.as_deref() != Some("Frame") {
            continue;
        }
        if let naga::TypeInner::Struct { members, span } = &ty.inner {
            let offsets = members
                .iter()
                .map(|member| (member.name.clone().unwrap_or_default(), member.offset))
                .collect();
            return (*span, offsets);
        }
    }
    panic!("{ID}: {which} declares a struct Frame");
}

fn offset(offsets: &[(String, u32)], field: &str) -> u32 {
    offsets
        .iter()
        .find(|(name, _)| name.as_str() == field)
        .map(|(_, at)| *at)
        .unwrap_or_else(|| panic!("{ID}: Frame has a field {field}"))
}

#[test]
fn the_frame_twin_validates_at_the_size_frame_uniform_is() {
    let files = scene_files();
    assert_eq!(
        files.first().map(String::as_str),
        Some("scene3d.wgsl"),
        "{ID}: the scene's module starts with scene3d.wgsl"
    );
    let (twin, already) = laid();
    let which = "the scene's module with sky_top and sky_low swapped in Frame";
    let (bytes, offsets) = frame(&module(&files, &twin), which);
    assert_eq!(
        bytes, FRAME_UNIFORM_BYTES,
        "{ID}: the twin's Frame is the size FrameUniform is"
    );
    assert_eq!(
        (offset(&offsets, "sky_low"), offset(&offsets, "sky_top")),
        (144, 160),
        "{ID}: the twin's Frame has sky_low at 144 and sky_top at 160"
    );
    println!(
        "{ID} twin {TWIN}: naga validates {which}; its Frame is {bytes} bytes, FrameUniform \
         {FRAME_UNIFORM_BYTES}; sky_low@144 sky_top@160"
    );
    if already {
        println!("{ID} twin {TWIN}: the checkout's scene3d.wgsl already holds the twin's lines");
        return;
    }
    let which = "the scene's module as the checkout holds it";
    let (bytes, offsets) = frame(&module(&files, &text(SHADER)), which);
    assert_eq!(
        bytes, FRAME_UNIFORM_BYTES,
        "{ID}: the checkout's Frame is the size FrameUniform is"
    );
    assert_eq!(
        (offset(&offsets, "sky_top"), offset(&offsets, "sky_low")),
        (144, 160),
        "{ID}: the checkout's Frame has sky_top at 144 and sky_low at 160"
    );
    println!(
        "{ID} twin {TWIN}: naga validates {which}; its Frame is {bytes} bytes; sky_top@144 \
         sky_low@160"
    );
}
