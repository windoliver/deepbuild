//! #2660 criterion 6: 1 MB of colored terminal output allocates at most half of what it allocates
//! on the merge base, and the grid it leaves is cell for cell the same.
//!
//! The output feeds `deep_canvas_cells::emulator::Terminal` in 4 KiB reads, as a PTY hands it over;
//! allocations are counted as `crates/deep-marks-render/tests/no_alloc.rs` counts them. The merge
//! base's count and the digest of the grid it leaves are `fixtures/terminal-base.json`, read at the
//! base (README). The digest covers every visible cell's grapheme, colors, attributes and link,
//! the cursor and the scrollback's length.

mod alloc;

#[global_allocator]
static ALLOCATOR: alloc::Counting = alloc::Counting;

use deep_canvas_cells::emulator::Terminal;
use serde_json::Value;

const BYTES: usize = 1_000_000;

/// 1 MB of colored output: words in the 16 ANSI colors, the 256-color cube and truecolor, bold
/// and reset runs, lines ended by CR LF.
fn output() -> Vec<u8> {
    let mut out = Vec::with_capacity(BYTES + 256);
    let mut k: u32 = 0;
    while out.len() < BYTES {
        let word = ["build", "ok", "warn", "error:", "src/lib.rs:42", "passed", "12.5ms"][k as usize % 7];
        let color = match k % 4 {
            0 => format!("\x1b[{}m", 31 + k % 7),
            1 => format!("\x1b[38;5;{}m", k % 256),
            2 => format!("\x1b[1;38;2;{};{};{}m", k % 256, (k * 7) % 256, (k * 13) % 256),
            _ => format!("\x1b[48;5;{};{}m", k % 256, 90 + k % 8),
        };
        out.extend_from_slice(color.as_bytes());
        out.extend_from_slice(word.as_bytes());
        out.extend_from_slice(b"\x1b[0m ");
        if k % 9 == 8 {
            out.extend_from_slice(b"\r\n");
        }
        k += 1;
    }
    out.truncate(BYTES);
    out
}

/// FNV-1a over the grid the terminal leaves: each visible cell, the cursor, the scrollback length.
fn digest(t: &Terminal) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |bytes: &[u8]| {
        for b in bytes {
            h ^= u64::from(*b);
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for y in 0..t.rows() {
        for c in t.row(y) {
            eat(format!("{}|{:?}|{:?}|{}|{};", c.g.text(), c.fg, c.bg, c.attrs, c.link).as_bytes());
        }
        eat(b"\n");
    }
    eat(format!("{:?}|{}", t.cursor(), t.history_len()).as_bytes());
    format!("{h:016x}")
}

fn base() -> Value {
    let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/acceptance/2660/fixtures/terminal-base.json");
    serde_json::from_str(&std::fs::read_to_string(file).expect("the base reading")).unwrap()
}

// AC6 #2660.8d2a770c
#[test]
fn ac6_a_megabyte_of_colored_output_allocates_half_the_base_and_leaves_the_same_grid() {
    let bytes = output();
    let mut t = Terminal::new(120, 40, 2_000);
    let ((), counted) = alloc::counted(|| {
        for chunk in bytes.chunks(4096) {
            t.feed(chunk);
        }
    });
    let got = digest(&t);
    let shown: String = (0..t.rows())
        .map(|y| Terminal::text_of(t.row(y)))
        .collect::<Vec<_>>()
        .join("\n");
    eprintln!(
        "1 MB of colored output: {} allocations, {} bytes; grid {got}",
        counted.count, counted.bytes
    );
    // The grid has the text: the last lines are the output's words, colored.
    assert!(
        shown.contains("src/lib.rs:42") && shown.contains("passed"),
        "the grid shows the output: {shown}"
    );
    assert!(
        t.row(t.rows() - 2).iter().any(|c| c.fg != t.row(t.rows() - 2)[0].fg || c.bg != t.row(t.rows() - 2)[0].bg),
        "the grid's cells are colored"
    );
    let base = base();
    assert_eq!(
        got,
        base["grid"].as_str().unwrap(),
        "the grid differs from the merge base's"
    );
    let was = base["allocations"].as_u64().unwrap();
    assert!(
        counted.count * 2 <= was,
        "1 MB of colored output made {} heap allocations; the merge base made {was}, and at most {} (half) are owed",
        counted.count,
        was / 2
    );
}
