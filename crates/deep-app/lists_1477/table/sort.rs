//! Issue #1477: sorting orders a row index and never moves the data. One pass turns each row's cell into an
//! order-preserving u64, an LSD radix sort orders (key, row) pairs, and a run of equal text prefixes is finished by
//! comparing the whole strings, stably. Keys are made in parallel above 2^18 rows.

use std::cmp::Ordering;

use super::Value;

/// Rows above which the keys are made on several threads.
pub const PARALLEL_ABOVE: usize = 1 << 18;

/// The u64 whose unsigned order is the value's order: numbers by value (-inf first, every NaN last),
/// text by its first 8 bytes, and every number before every text, empty cells last.
fn key(value: &Value<'_>) -> (u64, u8) {
    match value {
        Value::Number(n) => {
            // Every NaN sorts after every number, and -0 ties with 0, as a plain comparator by value has them.
            if n.is_nan() {
                return (u64::MAX, 0);
            }
            let bits = (if *n == 0. { 0f64 } else { *n }).to_bits();
            let flipped = if bits >> 63 == 1 {
                !bits
            } else {
                bits | 1 << 63
            };
            (flipped, 0)
        }
        Value::Text(t) => {
            let mut prefix = [0u8; 8];
            let bytes = t.as_bytes();
            let n = bytes.len().min(8);
            prefix[..n].copy_from_slice(&bytes[..n]);
            (u64::from_be_bytes(prefix), 1)
        }
        Value::Empty => (u64::MAX, 2),
    }
}

/// The order a plain comparator gives, which the typed path equals.
pub fn compare(a: &Value<'_>, b: &Value<'_>) -> Ordering {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.is_nan(), y.is_nan()) {
            (true, true) => Ordering::Equal,
            (true, false) => Ordering::Greater,
            (false, true) => Ordering::Less,
            _ => x.partial_cmp(y).unwrap_or(Ordering::Equal),
        },
        (Value::Text(x), Value::Text(y)) => x.as_bytes().cmp(y.as_bytes()),
        _ => kind(a).cmp(&kind(b)),
    }
}

fn kind(v: &Value<'_>) -> u8 {
    match v {
        Value::Number(_) => 0,
        Value::Text(_) => 1,
        Value::Empty => 2,
    }
}

/// The rows of `rows` that `keep` passes, ordered by `cell(row)` ascending (descending when `descending`), ties in
/// row order. The data never moves; the result is row indices.
pub fn order<'a>(
    rows: usize,
    cell: impl Fn(usize) -> Value<'a> + Sync,
    keep: impl Fn(usize) -> bool + Sync,
    descending: bool,
) -> Vec<u32> {
    assert!(
        rows <= u32::MAX as usize,
        "a table holds at most u32::MAX rows"
    );
    let make = |range: std::ops::Range<usize>| {
        let mut out = Vec::with_capacity(range.len());
        for row in range {
            if keep(row) {
                let (k, kind) = key(&cell(row));
                // The kind takes the top 2 bits only through a stable pre-pass below; most columns hold one kind.
                out.push((k, kind, row as u32));
            }
        }
        out
    };
    let mut keyed: Vec<(u64, u8, u32)> = if rows > PARALLEL_ABOVE {
        let threads = std::thread::available_parallelism()
            .map_or(4, |n| n.get())
            .min(16);
        let chunk = rows.div_ceil(threads);
        std::thread::scope(|s| {
            let handles: Vec<_> = (0..threads)
                .map(|t| {
                    let make = &make;
                    s.spawn(move || make(t * chunk..((t + 1) * chunk).min(rows)))
                })
                .collect();
            let mut all = Vec::with_capacity(rows);
            for h in handles {
                all.extend(h.join().expect("a key thread"));
            }
            all
        })
    } else {
        make(0..rows)
    };
    radix(&mut keyed);
    // Kinds: numbers, then text, then empty, each block keeping its order (a stable pass).
    if keyed.iter().any(|k| k.1 != keyed[0].1) {
        let mut by_kind: Vec<(u64, u8, u32)> = Vec::with_capacity(keyed.len());
        for kind in 0..3 {
            by_kind.extend(keyed.iter().filter(|k| k.1 == kind));
        }
        keyed = by_kind;
    }
    // Equal text prefixes: finish by the whole string, stably, so equal strings keep row order.
    let mut i = 0;
    while i < keyed.len() {
        let mut j = i + 1;
        while j < keyed.len() && keyed[j].0 == keyed[i].0 && keyed[j].1 == keyed[i].1 {
            j += 1;
        }
        if j - i > 1 && keyed[i].1 == 1 {
            // #1477's planted twin stops at the first 8 bytes, without the stable fix for equal prefixes.
            if !cfg!(feature = "plant-unstable-text-sort") {
                keyed[i..j].sort_by(|a, b| compare(&cell(a.2 as usize), &cell(b.2 as usize)));
            }
        }
        i = j;
    }
    let mut out: Vec<u32> = keyed.into_iter().map(|k| k.2).collect();
    if descending {
        // Reverse by groups of equal values, so ties still read in row order.
        let mut groups: Vec<&[u32]> = Vec::new();
        let mut i = 0;
        while i < out.len() {
            let mut j = i + 1;
            while j < out.len()
                && compare(&cell(out[i] as usize), &cell(out[j] as usize)) == Ordering::Equal
            {
                j += 1;
            }
            groups.push(&out[i..j]);
            i = j;
        }
        out = groups.into_iter().rev().flatten().copied().collect();
    }
    out
}

/// A stable LSD radix sort on the u64 key, a byte at a time, skipping bytes every key shares.
fn radix(items: &mut Vec<(u64, u8, u32)>) {
    let mut scratch = items.clone();
    for byte in 0..8 {
        let shift = byte * 8;
        let mut counts = [0usize; 256];
        for item in items.iter() {
            counts[(item.0 >> shift) as usize & 0xff] += 1;
        }
        if counts.contains(&items.len()) {
            continue;
        }
        let mut at = 0;
        for c in counts.iter_mut() {
            let n = *c;
            *c = at;
            at += n;
        }
        for item in items.iter() {
            let b = (item.0 >> shift) as usize & 0xff;
            scratch[counts[b]] = *item;
            counts[b] += 1;
        }
        std::mem::swap(items, &mut scratch);
    }
}
