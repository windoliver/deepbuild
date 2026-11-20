//! mods.lib@1's reference library, mods.tree (#953; canvas primitives: Logic: library interfaces:
//! mods.lib@1): stat modifiers on a tree of nodes. A row from a source node reaches down (the
//! source's descendants), side (every node under the source's side) or all (every node in the tree),
//! takes a node only when each of its filters holds on that node's catalog row, and stacks as
//! (base + Σ add) × (100 + Σ percent), or 100 × the last set by (source, id), then the lowest cap ×
//! 100 if lower, divided by 100 toward zero once. Each total is cached; a change marks only the
//! totals it can affect, and a marked total is recomputed when it is read, so a read is never stale.
//! Built with `--cfg planted`, it is mods.lib@1's planted library: moving or detaching a node marks
//! that node's own totals but not its descendants', which keep the totals they had.
//!
//! Everything lives in the 1 MiB tree at `t` in the caller's memory, past the program's 128-byte
//! header, laid out as the constants below say (`+1` marks an index stored plus one, so the zeroed
//! tree is the empty one). Down rows hang off a list per source and stat; side and all rows off a
//! list per source, and, while their source is in the tree, off a group list per side and stat (or
//! per stat for all), whose aggregate is cached per catalog row a filter reads. The library calls
//! nothing: a relocatable object of functions only, built by scripts/modslib-pack.mjs:
//!
//! ```text
//! rustc --target wasm32-unknown-unknown --crate-type=lib --crate-name mods --edition 2021
//!   --emit=obj -C opt-level=3 -C panic=abort -C target-cpu=mvp -C debuginfo=0
//!   -C target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint [--cfg planted] mods.rs
//! ```

#![no_std]
#![allow(clippy::missing_safety_doc)]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[inline(always)]
fn l32(a: u32) -> u32 {
    unsafe { (a as usize as *const u32).read_unaligned() }
}
#[inline(always)]
fn s32(a: u32, v: u32) {
    unsafe { (a as usize as *mut u32).write_unaligned(v) }
}
#[inline(always)]
fn l64(a: u32) -> i64 {
    unsafe { (a as usize as *const i64).read_unaligned() }
}
#[inline(always)]
fn s64(a: u32, v: i64) {
    unsafe { (a as usize as *mut i64).write_unaligned(v) }
}

const NODES: u32 = 512;
const STATS: u32 = 16;
const ADDS: u32 = 4096;
/// The group of all rows: one past the last side.
const ALL: u32 = NODES;

// The header the program writes.
const H_CATALOG: u32 = 0;
const H_TABLE: u32 = 4;
const H_ID: u32 = 8;
const H_STATS: u32 = 12;
const H_BASES: u32 = 16;
// The library's own, from +128: whether the catalog is resolved, the next id, the node table's row
// count, its ID column's values, its first column entry and column count, the last version handed
// out, the stat count, each stat's base column's values (0: none), whether a group was touched.
const RESOLVED: u32 = 128;
const NEXT: u32 = 132;
const ROWS_N: u32 = 136;
const IDS: u32 = 140;
const COLS: u32 = 144;
const NCOLS: u32 = 148;
const STAMP: u32 = 152;
const NS: u32 = 156;
const BASES: u32 = 160;
const ANY_TOUCHED: u32 = 224;
/// Nodes, 32 bytes each: state (0 never attached, 1 attached, 2 detached), parent+1, catalog row+1,
/// first child+1, next sibling+1, previous sibling+1, side+1 (0: outside the tree), first side or
/// all row of this source+1.
const NODE: u32 = 256;
const N_STATE: u32 = 0;
const N_PARENT: u32 = 4;
const N_ROW: u32 = 8;
const N_CHILD: u32 = 12;
const N_NEXT: u32 = 16;
const N_PREV: u32 = 20;
const N_SIDE: u32 = 24;
const N_ROWS: u32 = 28;
/// Cached totals, 16 bytes per node and stat: the total, then 1 when it is current.
const TOTAL: u32 = NODE + NODES * 32;
/// Down rows' list heads per source and stat (row+1).
const DOWN: u32 = TOTAL + NODES * STATS * 16;
/// Group list heads per group and stat (row+1); then each group and stat's version (0: never had a row).
const GROUP: u32 = DOWN + NODES * STATS * 4;
const VERSION: u32 = GROUP + (NODES + 1) * STATS * 4;
/// One bit per group and stat touched by the change under way.
const TOUCHED: u32 = VERSION + (NODES + 1) * STATS * 4;
const TOUCHED_WORDS: u32 = ((NODES + 1) * STATS).div_ceil(32);
/// Rows, 128 bytes each: source, stat, op, reach, value (i64), duration (0 none, 1 turns, 2
/// rounds), boundaries left, filter count, alive, the source or down list's previous+1 and next+1,
/// the group list's previous+1 and next+1, group+1; then the filters, 16 bytes each: the column's
/// values (0: no such i32 column), cmp, value (i64).
const ROW: u32 = TOUCHED + TOUCHED_WORDS * 4 + 64;
const ROW_BYTES: u32 = 128;
const R_SOURCE: u32 = 0;
const R_STAT: u32 = 4;
const R_OP: u32 = 8;
const R_REACH: u32 = 12;
const R_VALUE: u32 = 16;
const R_DURATION: u32 = 24;
const R_LEFT: u32 = 28;
const R_FILTERS: u32 = 32;
const R_ALIVE: u32 = 36;
const R_PREV: u32 = 40;
const R_NEXT: u32 = 44;
const R_GPREV: u32 = 48;
const R_GNEXT: u32 = 52;
const R_GROUP: u32 = 56;
const R_FILTER: u32 = 64;
/// Aggregates of a group and stat for one catalog row, 64 bytes in 2,048 slots: the version they
/// were taken at, (group × 16 + stat)+1, catalog row+1, the set's key+1, Σ add, Σ percent, the set,
/// the cap, whether there is a cap.
const AGG: u32 = ROW + ADDS * ROW_BYTES;
const AGG_SLOTS: u32 = 2048;
const _FITS: () = assert!(AGG + AGG_SLOTS * 64 <= 1 << 20);

#[inline(always)]
fn node(t: u32, n: u32) -> u32 {
    t + NODE + n * 32
}
#[inline(always)]
fn row(t: u32, id: u32) -> u32 {
    t + ROW + id * ROW_BYTES
}
#[inline(always)]
fn cached(t: u32, n: u32, s: u32) -> u32 {
    t + TOTAL + (n * STATS + s) * 16
}
#[inline(always)]
fn group_head(t: u32, g: u32, s: u32) -> u32 {
    t + GROUP + (g * STATS + s) * 4
}

// ---------------------------------------------------------------------------------------------
// The catalog, read by hash: the node table, its columns, a row by its ID's hash.

/// The values of the node table's i32 column `hash`, or 0.
fn column(t: u32, hash: u32) -> u32 {
    let (cols, n) = (l32(t + COLS), l32(t + NCOLS));
    let mut j = 0;
    while j < n {
        let e = cols + j * 16;
        if l32(e) == hash {
            return if l32(e + 4) == 0 {
                l32(t + H_CATALOG) + l32(e + 8)
            } else {
                0
            };
        }
        j += 1;
    }
    0
}

/// Finds the node table and the columns the header names, once.
fn resolve(t: u32) {
    if l32(t + RESOLVED) == 1 {
        return;
    }
    s32(t + RESOLVED, 1);
    let ns = l32(t + H_STATS);
    s32(t + NS, if ns > STATS { STATS } else { ns });
    let cat = l32(t + H_CATALOG);
    if l32(cat) != 0x454c_4254 || l32(cat + 4) != 1 {
        return;
    }
    let mut p = cat + 20;
    let mut i = 0;
    while i < l32(cat + 8) {
        let cc = l32(p + 8);
        if l32(p) == l32(t + H_TABLE) {
            s32(t + COLS, p + 12);
            s32(t + NCOLS, cc);
            let ids = column(t, l32(t + H_ID));
            s32(t + IDS, ids);
            s32(t + ROWS_N, if ids == 0 { 0 } else { l32(p + 4) });
            let mut s = 0;
            while s < l32(t + NS) {
                s32(t + BASES + s * 4, column(t, l32(t + H_BASES + s * 4)));
                s += 1;
            }
            return;
        }
        p += 12 + cc * 16;
        i += 1;
    }
}

/// The node table's row whose ID hashes to `hash`, +1, or 0: a binary search on the ID column.
fn find(t: u32, hash: u32) -> u32 {
    let ids = l32(t + IDS);
    let (mut lo, mut hi) = (0, l32(t + ROWS_N));
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        let h = l32(ids + mid * 4);
        if h == hash {
            return mid + 1;
        }
        if h < hash {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    0
}

/// A cell of catalog row `cr` (+1) in the column whose values are at `col`.
#[inline(always)]
fn cell(col: u32, cr: u32) -> i64 {
    l32(col + (cr - 1) * 4) as i32 as i64
}

/// Every filter of row `r` holds on catalog row `cr` (+1; 0: the node has none).
fn holds(r: u32, cr: u32) -> bool {
    let n = l32(r + R_FILTERS);
    if n == 0 {
        return true;
    }
    if cr == 0 {
        return false;
    }
    let mut i = 0;
    while i < n {
        let f = r + R_FILTER + i * 16;
        let col = l32(f);
        if col == 0 {
            return false;
        }
        let (v, want) = (cell(col, cr), l64(f + 8));
        let ok = match l32(f + 4) {
            0 => v == want,
            1 => v >= want,
            _ => v <= want,
        };
        if !ok {
            return false;
        }
        i += 1;
    }
    true
}

// ---------------------------------------------------------------------------------------------
// Stacking.

struct Acc {
    add: i64,
    pct: i64,
    /// The set's (source × 4,096 + id)+1, 0 with no set.
    key: u32,
    set: i64,
    cap: i64,
    capped: bool,
}
const EMPTY: Acc = Acc {
    add: 0,
    pct: 0,
    key: 0,
    set: 0,
    cap: 0,
    capped: false,
};

impl Acc {
    #[inline(always)]
    fn take(&mut self, r: u32, id: u32) {
        let v = l64(r + R_VALUE);
        match l32(r + R_OP) {
            0 => self.add = self.add.wrapping_add(v),
            1 => self.pct = self.pct.wrapping_add(v),
            2 => {
                let key = l32(r + R_SOURCE) * ADDS + id + 1;
                if key > self.key {
                    self.key = key;
                    self.set = v;
                }
            }
            _ => {
                if !self.capped || v < self.cap {
                    self.cap = v;
                    self.capped = true;
                }
            }
        }
    }
    #[inline(always)]
    fn merge(&mut self, o: &Acc) {
        self.add = self.add.wrapping_add(o.add);
        self.pct = self.pct.wrapping_add(o.pct);
        if o.key > self.key {
            self.key = o.key;
            self.set = o.set;
        }
        if o.capped && (!self.capped || o.cap < self.cap) {
            self.cap = o.cap;
            self.capped = true;
        }
    }
    #[inline(always)]
    fn total(&self, base: i64) -> i64 {
        let mut x = if self.key != 0 {
            self.set.wrapping_mul(100)
        } else {
            base.wrapping_add(self.add)
                .wrapping_mul(self.pct.wrapping_add(100))
        };
        if self.capped && self.cap.wrapping_mul(100) < x {
            x = self.cap.wrapping_mul(100);
        }
        x / 100
    }
}

/// Adds group `g`'s rows of stat `s` that take catalog row `cr` (+1) to `acc`, from the slot that
/// holds them when it was taken at the group's version.
#[inline(always)]
fn group(t: u32, g: u32, s: u32, cr: u32, acc: &mut Acc) {
    let version = l32(t + VERSION + (g * STATS + s) * 4);
    if version == 0 {
        return;
    }
    let key = g * STATS + s + 1;
    let slot = (key.wrapping_mul(0x9e37_79b1) ^ cr.wrapping_mul(0x85eb_ca77)) >> (32 - AGG_SLOTS.ilog2());
    let e = t + AGG + slot * 64;
    if l32(e) == version && l32(e + 4) == key && l32(e + 8) == cr {
        acc.merge(&Acc {
            key: l32(e + 12),
            add: l64(e + 16),
            pct: l64(e + 24),
            set: l64(e + 32),
            cap: l64(e + 40),
            capped: l32(e + 48) == 1,
        });
        return;
    }
    let mut a = EMPTY;
    let mut id = l32(group_head(t, g, s));
    while id != 0 {
        let r = row(t, id - 1);
        if holds(r, cr) {
            a.take(r, id - 1);
        }
        id = l32(r + R_GNEXT);
    }
    s32(e, version);
    s32(e + 4, key);
    s32(e + 8, cr);
    s32(e + 12, a.key);
    s64(e + 16, a.add);
    s64(e + 24, a.pct);
    s64(e + 32, a.set);
    s64(e + 40, a.cap);
    s32(e + 48, a.capped as u32);
    acc.merge(&a);
}

/// Node `n`'s total of stat `s`, from the whole tree as it stands.
#[inline(always)]
fn compute(t: u32, n: u32, s: u32) -> i64 {
    let x = node(t, n);
    let cr = l32(x + N_ROW);
    let bases = l32(t + BASES + s * 4);
    let base = if cr == 0 || bases == 0 {
        0
    } else {
        cell(bases, cr)
    };
    let side = l32(x + N_SIDE);
    if side == 0 {
        return base;
    }
    let mut acc = EMPTY;
    let mut a = l32(x + N_PARENT);
    while a != 0 {
        let mut id = l32(t + DOWN + ((a - 1) * STATS + s) * 4);
        while id != 0 {
            let r = row(t, id - 1);
            if holds(r, cr) {
                acc.take(r, id - 1);
            }
            id = l32(r + R_NEXT);
        }
        a = l32(node(t, a - 1) + N_PARENT);
    }
    if side - 1 != n {
        group(t, side - 1, s, cr, &mut acc);
    }
    group(t, ALL, s, cr, &mut acc);
    acc.total(base)
}

// ---------------------------------------------------------------------------------------------
// Marking.

#[inline(always)]
fn mark(t: u32, n: u32, s: u32) {
    s32(cached(t, n, s) + 8, 0);
}

/// The node after `y` in `root`'s subtree, depth first, +1, or 0 past its last.
fn next_under(t: u32, root: u32, y: u32) -> u32 {
    let c = l32(node(t, y) + N_CHILD);
    if c != 0 {
        return c;
    }
    let mut y = y;
    while y != root {
        let s = l32(node(t, y) + N_NEXT);
        if s != 0 {
            return s;
        }
        y = l32(node(t, y) + N_PARENT) - 1;
    }
    0
}

/// Marks stat `s` of every descendant of `x`.
fn mark_under(t: u32, x: u32, s: u32) {
    let mut y = l32(node(t, x) + N_CHILD);
    while y != 0 {
        mark(t, y - 1, s);
        y = next_under(t, x, y - 1);
    }
}

/// Group `g` and stat `s` changed: their aggregates and the totals they reach are marked when the
/// change is done.
fn touch(t: u32, g: u32, s: u32) {
    let b = g * STATS + s;
    let w = t + TOUCHED + (b / 32) * 4;
    s32(w, l32(w) | 1 << (b % 32));
    s32(t + ANY_TOUCHED, 1);
}

/// Gives each touched group and stat a new version and marks the totals it reaches: a side's
/// descendants, or for all every node in the tree.
fn flush(t: u32) {
    if l32(t + ANY_TOUCHED) == 0 {
        return;
    }
    s32(t + ANY_TOUCHED, 0);
    let mut w = 0;
    while w < TOUCHED_WORDS {
        let mut bits = l32(t + TOUCHED + w * 4);
        s32(t + TOUCHED + w * 4, 0);
        while bits != 0 {
            let b = w * 32 + bits.trailing_zeros();
            bits &= bits - 1;
            let (g, s) = (b / STATS, b % STATS);
            let stamp = l32(t + STAMP) + 1;
            s32(t + STAMP, stamp);
            s32(t + VERSION + b * 4, stamp);
            if g == ALL {
                let mut n = 0;
                while n < NODES {
                    if l32(node(t, n) + N_SIDE) != 0 {
                        mark(t, n, s);
                    }
                    n += 1;
                }
            } else {
                mark_under(t, g, s);
            }
        }
        w += 1;
    }
}

// ---------------------------------------------------------------------------------------------
// Lists: a row's source or down list, and its group list.

fn home(t: u32, r: u32) -> u32 {
    let src = l32(r + R_SOURCE);
    if l32(r + R_REACH) == 0 {
        t + DOWN + (src * STATS + l32(r + R_STAT)) * 4
    } else {
        node(t, src) + N_ROWS
    }
}

fn link(t: u32, id: u32) {
    let (r, head) = (row(t, id), home(t, row(t, id)));
    let first = l32(head);
    s32(r + R_PREV, 0);
    s32(r + R_NEXT, first);
    if first != 0 {
        s32(row(t, first - 1) + R_PREV, id + 1);
    }
    s32(head, id + 1);
}

fn unlink(t: u32, id: u32) {
    let r = row(t, id);
    let (prev, next) = (l32(r + R_PREV), l32(r + R_NEXT));
    if prev == 0 {
        s32(home(t, r), next);
    } else {
        s32(row(t, prev - 1) + R_NEXT, next);
    }
    if next != 0 {
        s32(row(t, next - 1) + R_PREV, prev);
    }
}

fn join(t: u32, id: u32, g: u32) {
    let r = row(t, id);
    let s = l32(r + R_STAT);
    let head = group_head(t, g, s);
    let first = l32(head);
    s32(r + R_GPREV, 0);
    s32(r + R_GNEXT, first);
    if first != 0 {
        s32(row(t, first - 1) + R_GPREV, id + 1);
    }
    s32(head, id + 1);
    s32(r + R_GROUP, g + 1);
    touch(t, g, s);
}

fn leave(t: u32, id: u32) {
    let r = row(t, id);
    let g = l32(r + R_GROUP);
    if g == 0 {
        return;
    }
    let (g, s) = (g - 1, l32(r + R_STAT));
    let (prev, next) = (l32(r + R_GPREV), l32(r + R_GNEXT));
    if prev == 0 {
        s32(group_head(t, g, s), next);
    } else {
        s32(row(t, prev - 1) + R_GNEXT, next);
    }
    if next != 0 {
        s32(row(t, next - 1) + R_GPREV, prev);
    }
    s32(r + R_GROUP, 0);
    touch(t, g, s);
}

/// Row `id` comes into effect (`on`) or goes: a down row marks its source's descendants, a side or
/// all row joins or leaves its group, while its source is in the tree.
fn effect(t: u32, id: u32, on: bool) {
    let r = row(t, id);
    let side = l32(node(t, l32(r + R_SOURCE)) + N_SIDE);
    match l32(r + R_REACH) {
        0 => {
            if side != 0 {
                mark_under(t, l32(r + R_SOURCE), l32(r + R_STAT));
            }
        }
        reach => {
            if !on {
                leave(t, id);
            } else if side != 0 {
                join(t, id, if reach == 1 { side - 1 } else { ALL });
            }
        }
    }
}

fn kill(t: u32, id: u32) {
    s32(row(t, id) + R_ALIVE, 0);
    unlink(t, id);
    effect(t, id, false);
}

// ---------------------------------------------------------------------------------------------
// The tree.

/// `n` has the strict ancestor `a`, through parent links as they stand.
fn under(t: u32, n: u32, a: u32) -> bool {
    let mut p = l32(node(t, n) + N_PARENT);
    let mut guard = 0;
    while p != 0 && guard < NODES {
        if p - 1 == a {
            return true;
        }
        p = l32(node(t, p - 1) + N_PARENT);
        guard += 1;
    }
    false
}

fn adopt(t: u32, n: u32, p: u32) {
    let x = node(t, n);
    let first = l32(node(t, p) + N_CHILD);
    s32(x + N_PREV, 0);
    s32(x + N_NEXT, first);
    if first != 0 {
        s32(node(t, first - 1) + N_PREV, n + 1);
    }
    s32(node(t, p) + N_CHILD, n + 1);
}

/// Takes attached `n` off its parent's children.
fn orphan(t: u32, n: u32) {
    let x = node(t, n);
    let p = l32(x + N_PARENT);
    if p == 0 {
        return;
    }
    let (prev, next) = (l32(x + N_PREV), l32(x + N_NEXT));
    if prev == 0 {
        s32(node(t, p - 1) + N_CHILD, next);
    } else {
        s32(node(t, prev - 1) + N_NEXT, next);
    }
    if next != 0 {
        s32(node(t, next - 1) + N_PREV, prev);
    }
}

/// `n` and its subtree moved from side `old` to side `new` (+1; 0 outside the tree): their totals
/// are marked, and their side and all rows leave and join groups as their sources' sides change.
fn moved(t: u32, n: u32, old: u32, new: u32) {
    let mut y = n + 1;
    while y != 0 {
        let x = node(t, y - 1);
        if cfg!(not(planted)) || y - 1 == n {
            let mut s = 0;
            while s < STATS {
                mark(t, y - 1, s);
                s += 1;
            }
        }
        s32(x + N_SIDE, new);
        if old != new {
            let mut id = l32(x + N_ROWS);
            while id != 0 {
                let r = row(t, id - 1);
                if l32(r + R_REACH) == 1 || old == 0 || new == 0 {
                    leave(t, id - 1);
                    if new != 0 {
                        join(t, id - 1, if l32(r + R_REACH) == 1 { new - 1 } else { ALL });
                    }
                }
                id = l32(r + R_NEXT);
            }
        }
        y = next_under(t, n, y - 1);
    }
}

// ---------------------------------------------------------------------------------------------
// mods.lib@1's exports.

/// Puts `n` under `parent` (−1: at the top, a side of its own), with the catalog row whose ID
/// hashes to `hash`; an attached node moves, its subtree with it.
#[no_mangle]
pub unsafe extern "C" fn attach(t: i32, n: i32, parent: i32, hash: i32) {
    let t = t as u32;
    resolve(t);
    if !(0..NODES as i32).contains(&n) || !(-1..NODES as i32).contains(&parent) {
        return;
    }
    let n = n as u32;
    if parent >= 0 && (parent as u32 == n || under(t, parent as u32, n)) {
        return;
    }
    let x = node(t, n);
    let old = l32(x + N_SIDE);
    if l32(x + N_STATE) == 1 {
        orphan(t, n);
    }
    s32(x + N_STATE, 1);
    s32(x + N_ROW, find(t, hash as u32));
    let new = if parent < 0 {
        s32(x + N_PARENT, 0);
        n + 1
    } else {
        let p = parent as u32;
        s32(x + N_PARENT, p + 1);
        adopt(t, n, p);
        l32(node(t, p) + N_SIDE)
    };
    moved(t, n, old, new);
    flush(t);
}

/// Takes attached `n` out of the tree, its descendants with it.
#[no_mangle]
pub unsafe extern "C" fn detach(t: i32, n: i32) {
    let t = t as u32;
    resolve(t);
    if !(0..NODES as i32).contains(&n) || l32(node(t, n as u32) + N_STATE) != 1 {
        return;
    }
    let (n, x) = (n as u32, node(t, n as u32));
    let old = l32(x + N_SIDE);
    orphan(t, n);
    s32(x + N_STATE, 2);
    s32(x + N_PARENT, 0);
    moved(t, n, old, 0);
    flush(t);
}

/// Copies the 104-byte modifier row at `at` and returns its id, or −1 for a field out of range or
/// past the 4,096th add.
#[no_mangle]
pub unsafe extern "C" fn add(t: i32, at: i32) -> i32 {
    let (t, at) = (t as u32, at as u32);
    resolve(t);
    let id = l32(t + NEXT);
    let (source, stat, op, reach) = (l32(at), l32(at + 4), l32(at + 8), l32(at + 12));
    let (duration, count, filters) = (l32(at + 24), l32(at + 28), l32(at + 32));
    let mut ok = id < ADDS
        && source < NODES
        && stat < l32(t + NS)
        && op < 4
        && reach < 3
        && duration < 3
        && (duration == 0 || (1..=65_535).contains(&count))
        && filters <= 4;
    let mut i = 0;
    while ok && i < filters {
        ok = l32(at + 44 + i * 16) < 3;
        i += 1;
    }
    if !ok {
        return -1;
    }
    let r = row(t, id);
    s32(r + R_SOURCE, source);
    s32(r + R_STAT, stat);
    s32(r + R_OP, op);
    s32(r + R_REACH, reach);
    s64(r + R_VALUE, l64(at + 16));
    s32(r + R_DURATION, duration);
    s32(r + R_LEFT, count);
    s32(r + R_FILTERS, filters);
    s32(r + R_ALIVE, 1);
    s32(r + R_GROUP, 0);
    let mut i = 0;
    while i < filters {
        let (f, from) = (r + R_FILTER + i * 16, at + 40 + i * 16);
        s32(f, column(t, l32(from)));
        s32(f + 4, l32(from + 4));
        s64(f + 8, l64(from + 8));
        i += 1;
    }
    s32(t + NEXT, id + 1);
    link(t, id);
    effect(t, id, true);
    flush(t);
    id as i32
}

/// Row `id` is gone; an id never returned, or removed, changes nothing.
#[no_mangle]
pub unsafe extern "C" fn remove(t: i32, id: i32) {
    let t = t as u32;
    resolve(t);
    if id < 0 || id as u32 >= l32(t + NEXT) || l32(row(t, id as u32) + R_ALIVE) != 1 {
        return;
    }
    kill(t, id as u32);
    flush(t);
}

/// A turn's boundary (0) or a round's (1) passes: each row lasting that many of them counts it,
/// and the rows whose count runs out end, in id order.
#[no_mangle]
pub unsafe extern "C" fn tick(t: i32, boundary: i32) {
    let t = t as u32;
    resolve(t);
    if boundary != 0 && boundary != 1 {
        return;
    }
    let unit = boundary as u32 + 1;
    let mut id = 0;
    while id < l32(t + NEXT) {
        let r = row(t, id);
        if l32(r + R_ALIVE) == 1 && l32(r + R_DURATION) == unit {
            let left = l32(r + R_LEFT) - 1;
            s32(r + R_LEFT, left);
            if left == 0 {
                kill(t, id);
            }
        }
        id += 1;
    }
    flush(t);
}

/// Node `n`'s total of stat `s`, recomputed when a change marked it.
#[no_mangle]
pub unsafe extern "C" fn total(t: i32, n: i32, s: i32) -> i64 {
    let t = t as u32;
    resolve(t);
    if !(0..NODES as i32).contains(&n) || s < 0 || s as u32 >= l32(t + NS) {
        return 0;
    }
    let (n, s) = (n as u32, s as u32);
    let c = cached(t, n, s);
    if l32(c + 8) == 1 {
        return l64(c);
    }
    let v = compute(t, n, s);
    s64(c, v);
    s32(c + 8, 1);
    v
}
