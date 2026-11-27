//! #2044's reader: one of the four readers of outside bytes, run on one fixture in a process of
//! its own, with what it answered printed as one line of JSON for the tests to judge
//! (helpers.mjs; README.md beside this file).
//!
//!   reader mp4 <file>      the decode worker's reply to a probe of the file (`deep_codecs::run`)
//!   reader gltf <file>     the mesh import of the file's first scene (`gltf::import`)
//!   reader svg <file>      the SVG import of the file (`svg::import`)
//!   reader terminal <cols>x<rows> <step>...
//!                          a terminal of that size after its steps, each `feed=<hex bytes>` or
//!                          `resize=<cols>x<rows>` (`emulator::Terminal`)
//!
//! It is test code and no target of a crate: helpers.mjs builds it with rustc against the
//! libraries cargo built for the four crates, so it names only what those crates make public at
//! the base, and no JSON crate. It decides nothing. A panic in the code under test ends the
//! process as a panic does (exit 101); arguments it can't read end it with exit 64.

use std::alloc::{GlobalAlloc, Layout, System};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use deep_canvas_cells::emulator::Terminal;
use deep_canvas_scene3d::gltf;
use deep_canvas_vector::svg;

/// The most heap a reader may hold at once: 4 GiB. A bound for the machine's sake and no
/// criterion: a reader that sizes a table from a count its file states ends here, saying so,
/// instead of taking the memory of a machine other work shares.
const HEAP_CAP: usize = 4 << 30;
static HELD: AtomicUsize = AtomicUsize::new(0);
static OVER: AtomicBool = AtomicBool::new(false);

struct Capped;

/// Counts `bytes` more of heap; past the cap it says so and ends the process. Nothing here
/// allocates.
fn hold(bytes: usize) {
    let held = HELD.fetch_add(bytes, Ordering::Relaxed).saturating_add(bytes);
    if held <= HEAP_CAP || OVER.swap(true, Ordering::Relaxed) {
        return;
    }
    let mut digits = [0u8; 20];
    let mut at = digits.len();
    let mut left = held;
    loop {
        at -= 1;
        digits[at] = b'0' + (left % 10) as u8;
        left /= 10;
        if left == 0 {
            break;
        }
    }
    let mut err = std::io::stderr();
    let _ = err.write_all(b"reader: the heap passed its cap of 4294967296 bytes: asked to hold ");
    let _ = err.write_all(&digits[at..]);
    let _ = err.write_all(b" bytes\n");
    std::process::abort();
}

// SAFETY: every request goes to the system allocator unchanged, with the layout it came with;
// this only counts the bytes held.
unsafe impl GlobalAlloc for Capped {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        hold(layout.size());
        System.alloc(layout)
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        hold(layout.size());
        System.alloc_zeroed(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        HELD.fetch_sub(layout.size(), Ordering::Relaxed);
        System.dealloc(ptr, layout)
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if new_size > layout.size() {
            hold(new_size - layout.size());
        } else {
            HELD.fetch_sub(layout.size() - new_size, Ordering::Relaxed);
        }
        System.realloc(ptr, layout, new_size)
    }
}

#[global_allocator]
static HEAP: Capped = Capped;

/// The most rows of a list the reader prints; a list's length is printed whole.
const SHOWN: usize = 64;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    let line = match words.as_slice() {
        ["mp4", file] => mp4(file),
        ["gltf", file] => bytes_of(file).map(|bytes| mesh(&bytes)),
        ["svg", file] => bytes_of(file).map(|bytes| vector(&bytes)),
        ["terminal", size, steps @ ..] => terminal(size, steps),
        _ => Err("it takes mp4 <file>, gltf <file>, svg <file> or terminal <cols>x<rows> <step>...".to_string()),
    };
    match line {
        Ok(line) => println!("{line}"),
        Err(why) => {
            eprintln!("reader: {why}");
            std::process::exit(64);
        }
    }
}

fn bytes_of(file: &str) -> Result<Vec<u8>, String> {
    std::fs::read(file).map_err(|e| format!("{file}: {e}"))
}

/// `text` as a JSON string.
fn quoted(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if u32::from(c) < 0x20 => out.push_str(&format!("\\u{:04x}", u32::from(c))),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `items` as a JSON list.
fn list(items: impl Iterator<Item = String>) -> String {
    format!("[{}]", items.collect::<Vec<String>>().join(","))
}

/// A number as JSON; one that isn't finite as null.
fn number(v: f64) -> String {
    if v.is_finite() {
        format!("{v:?}")
    } else {
        "null".to_string()
    }
}

/// The first rows of `rows` as a JSON list of lists.
fn rows<const N: usize>(rows: &[[f64; N]]) -> String {
    list(rows.iter().take(SHOWN).map(|row| list(row.iter().map(|v| number(*v)))))
}

/// The decode worker's reply to a probe of `file`, as `deep_codecs::run` gives it: the job a
/// worker is sent, `{"op": "probe", "path": <file>}`, run in this process.
fn mp4(file: &str) -> Result<String, String> {
    if !std::path::Path::new(file).is_file() {
        return Err(format!("{file} is no file"));
    }
    let caps = deep_codecs::Caps::default();
    // The job is written into the JSON object the caps give, emptied first, so this file names
    // no JSON crate of its own.
    let mut job = caps.json();
    let Some(job) = job.as_object_mut() else {
        return Err("the caps' JSON is no object".to_string());
    };
    job.clear();
    job.insert("op".to_string(), "probe".into());
    job.insert("path".to_string(), file.into());
    let (reply, _) = deep_codecs::run(job, &caps, &deep_codecs::Planted::default());
    Ok(reply.to_string())
}

/// The import of a glTF's first scene: `{"refused": <the fault, as its Debug text>}`, or
/// `{"imported": ...}` with each node (its index, name, world matrix and primitives: material,
/// vertex count, the first positions, normals and indices, and how many uv0, uv1 and tangent
/// rows it has) and how many lights, materials, images and dropped inputs came with them.
fn mesh(bytes: &[u8]) -> String {
    let scene = match gltf::import(bytes, "fixture", 0, &|_| None) {
        Ok(scene) => scene,
        Err(fault) => return format!("{{\"refused\":{}}}", quoted(&format!("{fault:?}"))),
    };
    let nodes = scene.nodes.iter().map(|node| {
        let primitives = node.primitives.iter().map(|primitive| {
            let m = &primitive.mesh;
            format!(
                "{{\"material\":{},\"vertices\":{},\"positions\":{},\"normals\":{},\"indices\":{},\"uv0\":{},\"uv1\":{},\"tangents\":{}}}",
                primitive.material.map_or("null".to_string(), |i| i.to_string()),
                m.positions.len(),
                rows(m.positions.as_slice()),
                rows(m.normals.as_slice()),
                list(m.indices.iter().take(3 * SHOWN).map(|i| i.to_string())),
                m.uv0.len(),
                m.uv1.len(),
                m.tangents.len(),
            )
        });
        format!(
            "{{\"index\":{},\"name\":{},\"world\":{},\"primitives\":{}}}",
            node.index,
            quoted(&node.name),
            rows(node.world.as_slice()),
            list(primitives),
        )
    });
    format!(
        "{{\"imported\":{{\"nodes\":{},\"lights\":{},\"materials\":{},\"images\":{},\"dropped\":{}}}}}",
        list(nodes),
        scene.lights.len(),
        scene.materials.len(),
        scene.images.len(),
        scene.dropped.len(),
    )
}

/// The import of an SVG by the honest importer, with no part classes: `{"imported": <what it
/// read, as its Debug text>}`, or `{"refused": {"code": ..., "found": ...}}`.
fn vector(bytes: &[u8]) -> String {
    match svg::import(bytes, &[], svg::Twin::Honest) {
        Ok(read) => format!("{{\"imported\":{}}}", quoted(&format!("{read:?}"))),
        Err(refusal) => format!(
            "{{\"refused\":{{\"code\":{},\"found\":{}}}}}",
            quoted(refusal.code()),
            quoted(&refusal.found()),
        ),
    }
}

fn size_of(text: &str) -> Result<(u16, u16), String> {
    let size: Option<(u16, u16)> = text
        .split_once('x')
        .and_then(|(cols, rows)| Some((cols.parse().ok()?, rows.parse().ok()?)));
    size.ok_or_else(|| format!("{text} is no <cols>x<rows>"))
}

fn hex(text: &str) -> Result<Vec<u8>, String> {
    if !text.is_ascii() || text.len() % 2 != 0 {
        return Err(format!("{text} is not hex bytes"));
    }
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).map_err(|_| format!("{text} is not hex bytes")))
        .collect()
}

/// A terminal of `size` with no scrollback after `steps`: its size, its cursor and every cell
/// that isn't blank, each by its row and column counted from 1 and its text.
fn terminal(size: &str, steps: &[&str]) -> Result<String, String> {
    let (cols, rows) = size_of(size)?;
    let mut t = Terminal::new(cols, rows, 0);
    for step in steps {
        if let Some(bytes) = step.strip_prefix("feed=") {
            t.feed(&hex(bytes)?);
        } else if let Some(size) = step.strip_prefix("resize=") {
            let (cols, rows) = size_of(size)?;
            t.resize(cols, rows);
        } else {
            return Err(format!("{step} is no step"));
        }
    }
    let mut cells = Vec::new();
    for y in 0..t.rows() {
        let row = t.row(y);
        for x in 0..row.len() {
            let text = Terminal::text_of(&row[x..=x]);
            if !text.is_empty() {
                cells.push(format!(
                    "{{\"row\":{},\"column\":{},\"text\":{}}}",
                    u32::from(y) + 1,
                    x + 1,
                    quoted(&text),
                ));
            }
        }
    }
    let (x, y) = t.cursor();
    Ok(format!(
        "{{\"cols\":{},\"rows\":{},\"cursor\":{{\"row\":{},\"column\":{}}},\"cells\":{}}}",
        t.cols(),
        t.rows(),
        u32::from(y) + 1,
        u32::from(x) + 1,
        list(cells.into_iter()),
    ))
}
