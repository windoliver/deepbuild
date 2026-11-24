//! #2660 criterion 5, the text half: a warm `shape` of a text that fits builds its key once,
//! counted by the test.
//!
//! A run's cache key holds a copy of its text, so each key `shape` builds asks the heap for exactly
//! the text's length in bytes, and nothing else a warm shape does asks for that size: the test
//! counts the allocations of exactly that many bytes (see `alloc.rs`). On the merge base a text
//! that fits builds two keys, its fitted run's and its whole run's.

mod alloc;

#[global_allocator]
static ALLOCATOR: alloc::Counting = alloc::Counting;

use std::sync::Arc;

use deep_text::{Shaper, Spec};

/// 48 bytes, a length nothing else in a warm shape allocates.
const TEXT: &str = "A warm label shaped from the cache, fits its box";

// AC5 #2660.732be9a5
#[test]
fn ac5_a_warm_shape_of_a_text_that_fits_builds_its_key_once() {
    let mut shaper = Shaper::new();
    let spec = Spec {
        width: Some(600.0),
        max_lines: Some(1),
        ..Spec::label(TEXT)
    };
    let cold = shaper.shape(&spec);
    assert!(!cold.glyphs.is_empty(), "the text has glyphs");
    assert!(
        !cold.ellipsized && cold.width < 600.0,
        "the text fits its box: {} px",
        cold.width
    );
    let (warm, counted) = alloc::counted_watching(TEXT.len(), || shaper.shape(&spec));
    eprintln!(
        "warm shape: {} key builds (allocations of the text's {} bytes), {} allocations in all",
        counted.watched,
        TEXT.len(),
        counted.count
    );
    assert!(
        Arc::ptr_eq(&cold, &warm),
        "the warm shape is the cached run"
    );
    assert!(
        counted.watched <= 1,
        "a warm shape of a text that fits built its key {} times (copies of its {} bytes); once is owed",
        counted.watched,
        TEXT.len()
    );
}
