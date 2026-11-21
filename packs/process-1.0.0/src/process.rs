//! process@1's reference library, process.ref (#980; canvas primitives: Logic: library interfaces:
//! process@1): a process model of entities that sources make, queues hold first in, first out (or
//! by the column `made`), requests hold on a resource's units, conveyors carry at belt speed with a
//! minimum spacing, packs load onto a carrier and unpacks unload, and sinks take out and record.
//! The model's clock counts ticks; every time it is given in seconds becomes ticks by rounding to
//! the nearest, and every time and cumulative time is kept in ticks and written as ticks × tick, so
//! a share of two of them is exact. Each tick: sources make what is due, then the settle moves the
//! ready entity with the smallest (ask tick, entity ID) whose target takes it now, again and again
//! until none moves; then counts are added to their areas, and belts move. `stats` runs n ticks and
//! writes the arrays (statistics over a sliding window past the warm-up included). Draws are
//! SplitMix64 hashes of the seed, the drawing station and the draw's number, and the exponential's
//! inverse with a logarithm of plain IEEE operations, so every host gives the same bits.
//!
//! Built with `--cfg planted_drop` it is process@1's planted library `drop`: a conveyor's lead that
//! is at the end and wasn't taken in a tick's settle is removed from the belt, its row freed with no
//! sink and no record. With `--cfg planted_over` it is `over`: a request station takes an entity
//! while a resource among its own has busy ≤ capacity, one unit past it.
//!
//! The state, `process.state@1`, lives in the caller's memory from `s`: the program's 64-byte
//! header (tick, seed, rows, kinds, ring, window, warm-up), then the library's scalars, the station
//! and resource tables, the entity rows and, laid out at the first `stats`, each station's ring of
//! departures, the records' ring and scratch, as the constants below say. The library calls
//! nothing: a relocatable object of functions only, built by scripts/process-pack.mjs:
//!
//! ```text
//! rustc --target wasm32-unknown-unknown --crate-type=lib --crate-name process --edition 2021
//!   --emit=obj -C opt-level=3 -C panic=abort -C target-cpu=mvp -C debuginfo=0
//!   -C target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint [--cfg planted_drop | --cfg planted_over] process.rs
//! ```

#![no_std]
#![allow(clippy::missing_safety_doc, unexpected_cfgs)]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// ---------------------------------------------------------------------------------------------
// Memory: every address is the caller's, an i32 into its linear memory.

#[inline(always)]
fn li(a: u32) -> i32 {
    unsafe { (a as usize as *const i32).read_unaligned() }
}
#[inline(always)]
fn si(a: u32, x: i32) {
    unsafe { (a as usize as *mut i32).write_unaligned(x) }
}
#[inline(always)]
fn ll(a: u32) -> i64 {
    unsafe { (a as usize as *const i64).read_unaligned() }
}
#[inline(always)]
fn sl(a: u32, x: i64) {
    unsafe { (a as usize as *mut i64).write_unaligned(x) }
}
#[inline(always)]
fn lf(a: u32) -> f64 {
    unsafe { (a as usize as *const f64).read_unaligned() }
}
#[inline(always)]
fn sf(a: u32, x: f64) {
    unsafe { (a as usize as *mut f64).write_unaligned(x) }
}
#[inline(always)]
fn trap() -> ! {
    core::arch::wasm32::unreachable()
}

// ---------------------------------------------------------------------------------------------
// Numbers, by plain IEEE operations only.

const NEVER: i64 = i64::MAX;
const LN2: f64 = 0.6931471805599453;
const SQRT2: f64 = 1.4142135623730951;

#[inline(always)]
fn mn(a: i64, b: i64) -> i64 {
    if a < b {
        a
    } else {
        b
    }
}
#[inline(always)]
fn mx(a: i64, b: i64) -> i64 {
    if a > b {
        a
    } else {
        b
    }
}
/// Seconds to ticks, rounded to the nearest (half up); never below 0.
#[inline(always)]
fn ticks(seconds: f64, tick: f64) -> i64 {
    let x = seconds / tick + 0.5;
    if x > 0.0 {
        x as i64
    } else {
        0
    }
}
/// `a mod m` for a ring of m entries, 0 for none.
#[inline(always)]
fn rem(a: i64, m: i64) -> i64 {
    a.checked_rem(m).unwrap_or(0)
}
/// ln x for x > 0: x = m·2^e with m in [√½, √2), ln x = e·ln 2 + 2·atanh((m − 1)/(m + 1)).
#[inline(never)]
fn ln(x: f64) -> f64 {
    if !(x > 0.0) {
        return -1e300;
    }
    let bits = x.to_bits();
    let mut e = ((bits >> 52) & 0x7ff) as i64 - 1023;
    let mut m = f64::from_bits((bits & 0x000f_ffff_ffff_ffff) | 0x3ff0_0000_0000_0000);
    if m > SQRT2 {
        m *= 0.5;
        e += 1;
    }
    let z = (m - 1.0) / (m + 1.0);
    let z2 = z * z;
    let mut s = 0.0;
    let mut k = 41i64;
    while k >= 1 {
        s = 1.0 / k as f64 + z2 * s;
        k -= 2;
    }
    2.0 * z * s + e as f64 * LN2
}
/// Station `stream`'s draw number n, exponential of mean `mean` (README: Random draws).
#[inline(never)]
fn draw(s: u32, stream: i32, n: i64, mean: f64) -> f64 {
    let key = ((stream as u64) << 32).wrapping_add(n as u64).wrapping_add(1);
    let mut x = (ll(s + H_SEED) as u64).wrapping_add(0x9E37_79B9_7F4A_7C15u64.wrapping_mul(key));
    x ^= x >> 30;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x >> 31;
    let u = (x >> 11) as f64 * (1.0 / 9_007_199_254_740_992.0);
    -mean * ln(1.0 - u)
}

// ---------------------------------------------------------------------------------------------
// process.state@1. The program's header, then the library's scalars from s + 64.

const H_TICK: u32 = 0;
const H_SEED: u32 = 8;
const H_ROWS: u32 = 16;
const H_KINDS: u32 = 20;
const H_RING: u32 = 24;
const H_WINDOW: u32 = 32;
const H_WARMUP: u32 = 40;

/// i32: 1 once the first `stats` laid the state out (builders refuse from then on).
const BUILT: u32 = 64;
/// i32: stations and resources built.
const NST: u32 = 68;
const NRES: u32 = 72;
/// i32: live entities.
const LIVE: u32 = 76;
/// i64: ticks run.
const TICKS: u32 = 80;
/// i64: ∫ live dt, the entities taken out and their times in system, in ticks.
const AREA_ALL: u32 = 88;
const DWELL_ALL: u32 = 96;
const LEFT_ALL: u32 = 104;
/// i32: 1 once the warm-up's snapshot is taken; i32: the lowest row that may be free.
const SNAPPED: u32 = 112;
const LOFREE: u32 = 116;
/// i64: LEFT_ALL, DWELL_ALL and AREA_ALL at the warm-up's end.
const SNAP_LEFT: u32 = 120;
const SNAP_DWELL: u32 = 128;
const SNAP_AREA: u32 = 136;
/// i64: the window and the warm-up in ticks.
const WT: u32 = 144;
const UT: u32 = 152;
/// The records' p90 cache: f64 value, then i64 departures and i64 kept count it was taken at.
const P90_ALL: u32 = 160;
const P90_ALL_LEFT: u32 = 168;
/// A candidate's ask tick and target, the settle's scratch.
const CAND_ASK: u32 = 184;
const CAND_TO: u32 = 192;
/// i32 × 16: made and taken out, by kind.
const MADE_N: u32 = 256;
const OUT_N: u32 = 320;

/// The stations' table: 128 of 192 bytes.
const STATIONS: u32 = 512;
const SMAX: i32 = 128;
const STN: u32 = 192;
/// The resources' table: 64 of {capacity i32, busy i32, busy area i64}.
const RESOURCES: u32 = STATIONS + SMAX as u32 * STN;
const RMAX: i32 = 64;
const RES: u32 = 16;
/// The entity rows, then (from the first `stats`) the rings.
const ROWS: u32 = RESOURCES + RMAX as u32 * RES;
const ROW: u32 = 80;
const EMAX: i32 = 4096;

// A station's fields.
const S_TYPE: u32 = 0;
const S_TO: u32 = 4;
const S_COUNT: u32 = 8;
/// Its list (queue, holders, belt from the lead) or, at a pack or unpack, its carrier.
const S_HEAD: u32 = 12;
const S_TAIL: u32 = 16;
/// source: kind, mode, table | queue: order, capacity | request: first resource, resources,
/// hold mode | pack: n, into, members loaded | unpack: members' target, carrier's target.
const S_A: u32 = 20;
const S_B: u32 = 24;
const S_C: u32 = 28;
/// f64: source every or mean gap | request mean hold | conveyor speed.
const S_X: u32 = 32;
/// i64: request hold ticks | conveyor P.
const S_Y: u32 = 40;
/// i64: source next due tick | request next hold end | conveyor S | pack full tick | unpack
/// last member's leaving tick.
const S_Z: u32 = 48;
/// i64: source draws or table index | request draws | unpack carrier's arrival tick.
const S_W: u32 = 56;
/// f64: source next arrival time.
const S_T: u32 = 64;
const S_LEFT: u32 = 72;
const S_AREA: u32 = 80;
const S_DWELL: u32 = 88;
const S_LEFT_U: u32 = 96;
const S_AREA_U: u32 = 104;
const S_DWELL_U: u32 = 112;
/// f64: the p90 cache, then i64 departures and i64 kept count it was taken at.
const S_P90: u32 = 120;
const S_P90_LEFT: u32 = 128;
/// f64: source until (−1: no end); i32: source table count.
const S_UNTIL: u32 = 144;
const S_TN: u32 = 152;

const SOURCE: i32 = 0;
const QUEUE: i32 = 1;
const REQUEST: i32 = 2;
const CONVEYOR: i32 = 3;
const PACK: i32 = 4;
const UNPACK: i32 = 5;
const SINK: i32 = 6;

// An entity row's fields.
const R_KIND: u32 = 0;
const R_GEN: u32 = 4;
const R_AT: u32 = 8;
const R_BATCH: u32 = 12;
const R_HOLDS: u32 = 16;
const R_NEXT: u32 = 20;
const R_MADE: u32 = 24;
const R_CAME: u32 = 32;
const R_ASK: u32 = 40;
const R_END: u32 = 48;
const R_PROG: u32 = 56;
/// A carrier's members, in load order (linked through R_NEXT), their count; a member's place.
const R_MEMBERS: u32 = 64;
const R_MTAIL: u32 = 68;
const R_NMEM: u32 = 72;
const R_LOAD: u32 = 76;

#[inline(always)]
fn st(s: u32, i: i32) -> u32 {
    s + STATIONS + i as u32 * STN
}
#[inline(always)]
fn res(s: u32, j: i32) -> u32 {
    s + RESOURCES + j as u32 * RES
}
#[inline(always)]
fn row(s: u32, r: i32) -> u32 {
    s + ROWS + r as u32 * ROW
}
#[inline(always)]
fn tick(s: u32) -> f64 {
    lf(s + H_TICK)
}
#[inline(always)]
fn ring_m(s: u32) -> i64 {
    li(s + H_RING) as i64
}
/// Station i's ring of departures (i = N: the records), each {out tick, time there} in ticks.
#[inline(always)]
fn ring(s: u32, i: i32) -> u32 {
    let rings = s + ROWS + li(s + H_ROWS) as u32 * ROW;
    rings + i as u32 * li(s + H_RING) as u32 * 16
}
/// Scratch past the rings: M i64 for a percentile, then N + 1 i64 of occupants' overlap.
#[inline(always)]
fn scratch(s: u32) -> u32 {
    ring(s, li(s + NST) + 1)
}

// ---------------------------------------------------------------------------------------------
// Builders.

#[inline(always)]
fn building(s: u32) -> bool {
    li(s + BUILT) == 0
}
/// A `to` that names nowhere (−1) or a station already built.
#[inline(always)]
fn target_ok(s: u32, to: i32) -> bool {
    to == -1 || (to >= 0 && to < li(s + NST))
}
/// A new station of type `ty`, or −1 past the limit.
fn station(s: u32, ty: i32, to: i32) -> i32 {
    let n = li(s + NST);
    if n >= SMAX {
        return -1;
    }
    let a = st(s, n);
    si(a + S_TYPE, ty);
    si(a + S_TO, to);
    si(a + S_COUNT, 0);
    si(a + S_HEAD, -1);
    si(a + S_TAIL, -1);
    sl(a + S_P90_LEFT, -1);
    si(s + NST, n + 1);
    n
}

#[no_mangle]
pub unsafe extern "C" fn source(
    s: i32,
    kind: i32,
    every: f64,
    mean_gap: f64,
    at: i32,
    until: f64,
    to: i32,
) -> i32 {
    let s = s as u32;
    let given = (every > 0.0) as i32 + (mean_gap > 0.0) as i32 + (at >= 0) as i32;
    if !building(s)
        || kind < 0
        || kind >= li(s + H_KINDS)
        || given != 1
        || every < 0.0
        || mean_gap < 0.0
        || to < 0
        || to >= li(s + NST)
        || li(st(s, to) + S_TYPE) != QUEUE
        || li(st(s, to) + S_B) != -1
    {
        return -1;
    }
    let i = station(s, SOURCE, to);
    if i < 0 {
        return -1;
    }
    let a = st(s, i);
    si(a + S_A, kind);
    sf(a + S_UNTIL, until);
    sl(a + S_W, 0);
    if every > 0.0 {
        si(a + S_B, 0);
        sf(a + S_X, every);
        sf(a + S_T, 0.0);
    } else if mean_gap > 0.0 {
        si(a + S_B, 1);
        sf(a + S_X, mean_gap);
        sf(a + S_T, draw(s, i, 0, mean_gap));
        sl(a + S_W, 1);
    } else {
        si(a + S_B, 2);
        si(a + S_C, at);
        si(a + S_TN, li(at as u32));
        sf(a + S_T, lf(at as u32 + 8));
    }
    schedule(s, a);
    i
}
/// A source's next due tick from its next arrival time: never once its table ends or the time
/// passes `until`.
fn schedule(s: u32, a: u32) {
    let t = lf(a + S_T);
    let until = lf(a + S_UNTIL);
    let done = (li(a + S_B) == 2 && ll(a + S_W) >= li(a + S_TN) as i64) || (until >= 0.0 && t > until);
    sl(a + S_Z, if done { NEVER } else { ticks(t, tick(s)) });
}

#[no_mangle]
pub unsafe extern "C" fn queue(s: i32, order: i32, capacity: i32, to: i32) -> i32 {
    let s = s as u32;
    if !building(s) || !(order == 0 || order == 1) || capacity < -1 || !target_ok(s, to) {
        return -1;
    }
    let i = station(s, QUEUE, to);
    if i >= 0 {
        si(st(s, i) + S_A, order);
        si(st(s, i) + S_B, capacity);
    }
    i
}

#[no_mangle]
pub unsafe extern "C" fn resource(s: i32, capacity: i32) -> i32 {
    let s = s as u32;
    let j = li(s + NRES);
    if !building(s) || !(0..=65_535).contains(&capacity) || j >= RMAX {
        return -1;
    }
    si(res(s, j), capacity);
    si(res(s, j) + 4, 0);
    sl(res(s, j) + 8, 0);
    si(s + NRES, j + 1);
    j
}

#[no_mangle]
pub unsafe extern "C" fn request(s: i32, r: i32, n: i32, hold: f64, mean_hold: f64, to: i32) -> i32 {
    let s = s as u32;
    let mode = if hold >= 0.0 && mean_hold == 0.0 {
        0
    } else if hold == 0.0 && mean_hold > 0.0 {
        1
    } else if hold == -1.0 && mean_hold == 0.0 {
        2
    } else {
        -1
    };
    if !building(s) || mode < 0 || r < 0 || n < 1 || r + n > li(s + NRES) || !target_ok(s, to) {
        return -1;
    }
    let i = station(s, REQUEST, to);
    if i >= 0 {
        let a = st(s, i);
        si(a + S_A, r);
        si(a + S_B, n);
        si(a + S_C, mode);
        sf(a + S_X, mean_hold);
        sl(a + S_Y, if mode == 0 { ticks(hold, tick(s)) } else { 0 });
        sl(a + S_Z, NEVER);
        sl(a + S_W, 0);
    }
    i
}

#[no_mangle]
pub unsafe extern "C" fn release(s: i32, e: i32) -> i32 {
    let s = s as u32;
    if building(s) || e < 0 || e >= li(s + H_ROWS) {
        return 0;
    }
    let x = row(s, e);
    if li(x + R_KIND) < 0 || li(x + R_HOLDS) < 0 {
        return 0;
    }
    let c = ll(s + TICKS);
    sl(x + R_END, mn(ll(x + R_END), c));
    let a = st(s, li(x + R_AT));
    sl(a + S_Z, mn(ll(a + S_Z), c));
    1
}

#[no_mangle]
pub unsafe extern "C" fn conveyor(s: i32, length: f64, speed: f64, spacing: f64, to: i32) -> i32 {
    let s = s as u32;
    if !building(s) || !(length >= 0.0) || !(speed > 0.0) || !(spacing >= 0.0) || !target_ok(s, to) {
        return -1;
    }
    let i = station(s, CONVEYOR, to);
    if i >= 0 {
        let a = st(s, i);
        let per = speed * tick(s);
        sf(a + S_X, speed);
        sl(a + S_Y, ticks(length / per, 1.0));
        sl(a + S_Z, ticks(spacing / per, 1.0));
    }
    i
}

#[no_mangle]
pub unsafe extern "C" fn pack(s: i32, n: i32, into: i32, to: i32) -> i32 {
    let s = s as u32;
    if !building(s) || !(0..=65_535).contains(&n) || into < 0 || into >= li(s + H_KINDS) || !target_ok(s, to) {
        return -1;
    }
    let i = station(s, PACK, to);
    if i >= 0 {
        si(st(s, i) + S_A, n);
        si(st(s, i) + S_B, into);
        si(st(s, i) + S_C, 0);
    }
    i
}

#[no_mangle]
pub unsafe extern "C" fn unpack(s: i32, members: i32, carrier: i32) -> i32 {
    let s = s as u32;
    if !building(s) || !target_ok(s, members) || !target_ok(s, carrier) {
        return -1;
    }
    let i = station(s, UNPACK, -1);
    if i >= 0 {
        si(st(s, i) + S_A, members);
        si(st(s, i) + S_B, carrier);
    }
    i
}

#[no_mangle]
pub unsafe extern "C" fn sink(s: i32) -> i32 {
    let s = s as u32;
    if !building(s) {
        return -1;
    }
    station(s, SINK, -1)
}

// ---------------------------------------------------------------------------------------------
// Entities.

/// A new entity of `kind` made at tick `tau`, in the lowest free row at its next generation.
fn make(s: u32, kind: i32, tau: i64) -> i32 {
    let e = li(s + H_ROWS);
    let mut r = li(s + LOFREE);
    while r < e && li(row(s, r) + R_KIND) >= 0 {
        r += 1;
    }
    if r >= e {
        trap();
    }
    si(s + LOFREE, r + 1);
    let x = row(s, r);
    si(x + R_KIND, kind);
    si(x + R_GEN, li(x + R_GEN) + 1);
    si(x + R_AT, -1);
    si(x + R_BATCH, -1);
    si(x + R_HOLDS, -1);
    si(x + R_NEXT, -1);
    sl(x + R_MADE, tau);
    sl(x + R_CAME, tau);
    sl(x + R_ASK, tau);
    sl(x + R_END, NEVER);
    sl(x + R_PROG, 0);
    si(x + R_MEMBERS, -1);
    si(x + R_MTAIL, -1);
    si(x + R_NMEM, 0);
    si(x + R_LOAD, 0);
    si(s + LIVE, li(s + LIVE) + 1);
    let m = s + MADE_N + 4 * kind as u32;
    si(m, li(m) + 1);
    r
}
/// Row r is free again; its generation stays.
fn free(s: u32, r: i32) {
    let x = row(s, r);
    si(x + R_KIND, -1);
    si(x + R_AT, -1);
    si(x + R_BATCH, -1);
    si(x + R_HOLDS, -1);
    si(x + R_NEXT, -1);
    si(s + LIVE, li(s + LIVE) - 1);
    if r < li(s + LOFREE) {
        si(s + LOFREE, r);
    }
}
/// A departure from station i at tick tau after `dwell` ticks there.
fn depart(s: u32, i: i32, tau: i64, dwell: i64) {
    let a = st(s, i);
    let left = ll(a + S_LEFT);
    let e = ring(s, i) + 16 * rem(left, ring_m(s)) as u32;
    sl(e, tau);
    sl(e + 8, dwell);
    sl(a + S_LEFT, left + 1);
    sl(a + S_DWELL, ll(a + S_DWELL) + dwell);
}

/// Whether row x sorts before row y in a list ordered by (made, came, ID) or (came, ID).
#[inline(always)]
fn before(s: u32, x: i32, y: i32, by_made: bool) -> bool {
    let (a, b) = (row(s, x), row(s, y));
    if by_made && ll(a + R_MADE) != ll(b + R_MADE) {
        return ll(a + R_MADE) < ll(b + R_MADE);
    }
    if ll(a + R_CAME) != ll(b + R_CAME) {
        return ll(a + R_CAME) < ll(b + R_CAME);
    }
    x < y
}
/// Row r into station a's list in order; whether it became the head.
fn insert(s: u32, a: u32, r: i32, by_made: bool) -> bool {
    let x = row(s, r);
    let head = li(a + S_HEAD);
    let tail = li(a + S_TAIL);
    if head < 0 {
        si(x + R_NEXT, -1);
        si(a + S_HEAD, r);
        si(a + S_TAIL, r);
        return true;
    }
    if before(s, tail, r, by_made) {
        si(row(s, tail) + R_NEXT, r);
        si(x + R_NEXT, -1);
        si(a + S_TAIL, r);
        return false;
    }
    if before(s, r, head, by_made) {
        si(x + R_NEXT, head);
        si(a + S_HEAD, r);
        return true;
    }
    let mut p = head;
    loop {
        let n = li(row(s, p) + R_NEXT);
        if n < 0 || before(s, r, n, by_made) {
            si(x + R_NEXT, n);
            si(row(s, p) + R_NEXT, r);
            if n < 0 {
                si(a + S_TAIL, r);
            }
            return false;
        }
        p = n;
    }
}
/// Row r out of station a's list.
fn unlink(s: u32, a: u32, r: i32) {
    let head = li(a + S_HEAD);
    let next = li(row(s, r) + R_NEXT);
    if head == r {
        si(a + S_HEAD, next);
        if next < 0 {
            si(a + S_TAIL, -1);
        }
    } else {
        let mut p = head;
        while p >= 0 {
            let n = li(row(s, p) + R_NEXT);
            if n == r {
                si(row(s, p) + R_NEXT, next);
                if next < 0 {
                    si(a + S_TAIL, p);
                }
                break;
            }
            p = n;
        }
    }
    si(row(s, r) + R_NEXT, -1);
}
/// The earliest hold end among a request station's holders.
fn next_end(s: u32, a: u32) {
    let mut z = NEVER;
    let mut p = li(a + S_HEAD);
    while p >= 0 {
        z = mn(z, ll(row(s, p) + R_END));
        p = li(row(s, p) + R_NEXT);
    }
    sl(a + S_Z, z);
}

// ---------------------------------------------------------------------------------------------
// The settle (README: The step contract, 3).

/// A unit of a request station's resources: the lowest-numbered with one free, or −1.
fn unit(s: u32, a: u32) -> i32 {
    let r0 = li(a + S_A);
    let mut j = r0;
    while j < r0 + li(a + S_B) {
        let busy = li(res(s, j) + 4);
        let cap = li(res(s, j));
        #[cfg(not(planted_over))]
        let free = busy < cap;
        #[cfg(planted_over)]
        let free = busy <= cap;
        if free {
            return j;
        }
        j += 1;
    }
    -1
}
/// Whether station t takes row r now.
fn takes(s: u32, t: i32, r: i32) -> bool {
    if t < 0 {
        return false;
    }
    let a = st(s, t);
    match li(a + S_TYPE) {
        QUEUE => li(a + S_B) < 0 || li(a + S_COUNT) < li(a + S_B),
        REQUEST => unit(s, a) >= 0,
        CONVEYOR => {
            let tail = li(a + S_TAIL);
            tail < 0 || ll(row(s, tail) + R_PROG) >= ll(a + S_Z)
        }
        PACK => {
            if li(row(s, r) + R_KIND) == li(a + S_B) {
                li(a + S_HEAD) < 0
            } else {
                li(a + S_HEAD) >= 0 && li(a + S_C) < li(a + S_A)
            }
        }
        UNPACK => li(a + S_HEAD) < 0,
        SINK => true,
        _ => false,
    }
}
/// Station i's ready entity with the smallest (ask tick, ID) whose target takes it now, with its
/// ask tick and target at CAND_ASK and CAND_TO; or −1.
fn candidate(s: u32, i: i32, tau: i64) -> i32 {
    let a = st(s, i);
    let to = li(a + S_TO);
    match li(a + S_TYPE) {
        QUEUE => {
            let h = li(a + S_HEAD);
            if h >= 0 && takes(s, to, h) {
                sl(s + CAND_ASK, ll(row(s, h) + R_ASK));
                si(s + CAND_TO, to);
                return h;
            }
            -1
        }
        REQUEST => {
            if ll(a + S_Z) > tau || to < 0 {
                return -1;
            }
            let (mut best, mut ask) = (-1, NEVER);
            let mut p = li(a + S_HEAD);
            while p >= 0 {
                let end = ll(row(s, p) + R_END);
                if end <= tau && (end < ask || (end == ask && p < best)) && takes(s, to, p) {
                    best = p;
                    ask = end;
                }
                p = li(row(s, p) + R_NEXT);
            }
            sl(s + CAND_ASK, ask);
            si(s + CAND_TO, to);
            best
        }
        CONVEYOR => {
            let h = li(a + S_HEAD);
            if h >= 0 && ll(row(s, h) + R_PROG) >= ll(a + S_Y) && takes(s, to, h) {
                sl(s + CAND_ASK, ll(row(s, h) + R_ASK));
                si(s + CAND_TO, to);
                return h;
            }
            -1
        }
        PACK => {
            let c = li(a + S_HEAD);
            if c >= 0 && li(a + S_C) >= li(a + S_A) && takes(s, to, c) {
                sl(s + CAND_ASK, ll(a + S_Z));
                si(s + CAND_TO, to);
                return c;
            }
            -1
        }
        UNPACK => {
            let c = li(a + S_HEAD);
            if c < 0 {
                return -1;
            }
            let x = row(s, c);
            if li(x + R_NMEM) > 0 {
                let t = li(a + S_A);
                let mut best = -1;
                let mut m = li(x + R_MEMBERS);
                while m >= 0 {
                    if (best < 0 || m < best) && takes(s, t, m) {
                        best = m;
                    }
                    m = li(row(s, m) + R_NEXT);
                }
                sl(s + CAND_ASK, ll(a + S_W));
                si(s + CAND_TO, t);
                return best;
            }
            let t = li(a + S_B);
            if takes(s, t, c) {
                sl(s + CAND_ASK, ll(a + S_Z));
                si(s + CAND_TO, t);
                return c;
            }
            -1
        }
        _ => -1,
    }
}

/// Row r leaves station i at tick tau (a member leaving its carrier at an unpack station leaves
/// no station).
fn leave(s: u32, i: i32, r: i32, tau: i64) {
    let a = st(s, i);
    let x = row(s, r);
    if li(x + R_BATCH) >= 0 {
        // A member of the carrier at unpack station i.
        let c = li(a + S_HEAD);
        let cx = row(s, c);
        let mut p = li(cx + R_MEMBERS);
        let next = li(x + R_NEXT);
        if p == r {
            si(cx + R_MEMBERS, next);
        } else {
            while p >= 0 {
                let n = li(row(s, p) + R_NEXT);
                if n == r {
                    si(row(s, p) + R_NEXT, next);
                    if next < 0 {
                        si(cx + R_MTAIL, p);
                    }
                    break;
                }
                p = n;
            }
        }
        if li(cx + R_MEMBERS) < 0 {
            si(cx + R_MTAIL, -1);
        }
        si(x + R_NEXT, -1);
        si(x + R_BATCH, -1);
        si(cx + R_NMEM, li(cx + R_NMEM) - 1);
        if li(cx + R_NMEM) == 0 {
            sl(a + S_Z, tau);
        }
        return;
    }
    match li(a + S_TYPE) {
        QUEUE => {
            unlink(s, a, r);
            let h = li(a + S_HEAD);
            if h >= 0 {
                sl(row(s, h) + R_ASK, tau);
            }
        }
        REQUEST => {
            unlink(s, a, r);
            let j = li(x + R_HOLDS);
            si(res(s, j) + 4, li(res(s, j) + 4) - 1);
            si(x + R_HOLDS, -1);
            next_end(s, a);
        }
        CONVEYOR => {
            unlink(s, a, r);
            sl(x + R_PROG, 0);
        }
        PACK => {
            si(a + S_HEAD, -1);
            si(a + S_C, 0);
        }
        UNPACK => si(a + S_HEAD, -1),
        _ => {}
    }
    si(a + S_COUNT, li(a + S_COUNT) - 1);
    si(x + R_AT, -1);
    depart(s, i, tau, tau - ll(x + R_CAME));
}

/// Row r out of the model at sink i at tick tau, recorded.
fn out(s: u32, i: i32, r: i32, tau: i64) {
    let x = row(s, r);
    let w = tau - ll(x + R_MADE);
    let n = ll(s + LEFT_ALL);
    let e = ring(s, li(s + NST)) + 16 * rem(n, ring_m(s)) as u32;
    sl(e, tau);
    sl(e + 8, w);
    sl(s + LEFT_ALL, n + 1);
    sl(s + DWELL_ALL, ll(s + DWELL_ALL) + w);
    let o = s + OUT_N + 4 * li(x + R_KIND) as u32;
    si(o, li(o) + 1);
    depart(s, i, tau, 0);
    free(s, r);
}

/// Row r and, before it in load order, its members (and theirs) out at sink i.
fn take_out(s: u32, i: i32, r: i32, tau: i64) {
    let mut m = li(row(s, r) + R_MEMBERS);
    while m >= 0 {
        let n = li(row(s, m) + R_NEXT);
        take_out(s, i, m, tau);
        m = n;
    }
    out(s, i, r, tau);
}

/// Row r arrives at station t at tick tau.
fn arrive(s: u32, t: i32, r: i32, tau: i64) {
    let a = st(s, t);
    let x = row(s, r);
    sl(x + R_CAME, tau);
    match li(a + S_TYPE) {
        QUEUE => {
            si(x + R_AT, t);
            if insert(s, a, r, li(a + S_A) == 1) {
                sl(x + R_ASK, tau);
            }
        }
        REQUEST => {
            let j = unit(s, a);
            si(res(s, j) + 4, li(res(s, j) + 4) + 1);
            si(x + R_HOLDS, j);
            si(x + R_AT, t);
            let hold = match li(a + S_C) {
                0 => ll(a + S_Y),
                1 => {
                    let n = ll(a + S_W);
                    sl(a + S_W, n + 1);
                    ticks(draw(s, t, n, lf(a + S_X)), tick(s))
                }
                _ => NEVER - tau,
            };
            sl(x + R_END, tau + hold);
            insert(s, a, r, false);
            sl(a + S_Z, mn(ll(a + S_Z), tau + hold));
        }
        CONVEYOR => {
            si(x + R_AT, t);
            sl(x + R_PROG, 0);
            sl(x + R_ASK, tau);
            let tail = li(a + S_TAIL);
            si(x + R_NEXT, -1);
            if tail < 0 {
                si(a + S_HEAD, r);
            } else {
                si(row(s, tail) + R_NEXT, r);
            }
            si(a + S_TAIL, r);
        }
        PACK => {
            if li(x + R_KIND) == li(a + S_B) {
                si(a + S_HEAD, r);
                si(x + R_AT, t);
                si(a + S_C, 0);
                if li(a + S_A) == 0 {
                    sl(a + S_Z, tau);
                }
            } else {
                let c = li(a + S_HEAD);
                let cx = row(s, c);
                let k = li(a + S_C);
                si(x + R_AT, -1);
                si(x + R_BATCH, c);
                si(x + R_LOAD, k);
                si(x + R_NEXT, -1);
                let tail = li(cx + R_MTAIL);
                if tail < 0 {
                    si(cx + R_MEMBERS, r);
                } else {
                    si(row(s, tail) + R_NEXT, r);
                }
                si(cx + R_MTAIL, r);
                si(cx + R_NMEM, li(cx + R_NMEM) + 1);
                si(a + S_C, k + 1);
                if k + 1 >= li(a + S_A) {
                    sl(a + S_Z, tau);
                }
                return;
            }
        }
        UNPACK => {
            si(a + S_HEAD, r);
            si(x + R_AT, t);
            sl(a + S_W, tau);
            if li(x + R_NMEM) == 0 {
                sl(a + S_Z, tau);
            }
        }
        SINK => {
            take_out(s, t, r, tau);
            return;
        }
        _ => trap(),
    }
    si(a + S_COUNT, li(a + S_COUNT) + 1);
}

/// One tick of the model (README: The step contract).
fn run_tick(s: u32) {
    let tau = ll(s + TICKS);
    let n = li(s + NST);
    if li(s + SNAPPED) == 0 && tau >= ll(s + UT) {
        si(s + SNAPPED, 1);
        let mut i = 0;
        while i < n {
            let a = st(s, i);
            sl(a + S_LEFT_U, ll(a + S_LEFT));
            sl(a + S_AREA_U, ll(a + S_AREA));
            sl(a + S_DWELL_U, ll(a + S_DWELL));
            i += 1;
        }
        sl(s + SNAP_LEFT, ll(s + LEFT_ALL));
        sl(s + SNAP_DWELL, ll(s + DWELL_ALL));
        sl(s + SNAP_AREA, ll(s + AREA_ALL));
    }
    // 2. Sources, in station order.
    let mut i = 0;
    while i < n {
        let a = st(s, i);
        if li(a + S_TYPE) == SOURCE {
            while ll(a + S_Z) <= tau {
                let r = make(s, li(a + S_A), tau);
                depart(s, i, tau, 0);
                arrive(s, li(a + S_TO), r, tau);
                let k = ll(a + S_W) + 1;
                match li(a + S_B) {
                    0 => sf(a + S_T, k as f64 * lf(a + S_X)),
                    1 => sf(a + S_T, lf(a + S_T) + draw(s, i, k - 1, lf(a + S_X))),
                    _ => {
                        if k < li(a + S_TN) as i64 {
                            sf(a + S_T, lf(li(a + S_C) as u32 + 8 + 8 * k as u32));
                        }
                    }
                }
                sl(a + S_W, k);
                schedule(s, a);
            }
        }
        i += 1;
    }
    // 3. The settle.
    loop {
        let (mut best, mut ask, mut from, mut to) = (-1, NEVER, -1, -1);
        let mut i = 0;
        while i < n {
            let c = candidate(s, i, tau);
            if c >= 0 {
                let k = ll(s + CAND_ASK);
                if k < ask || (k == ask && c < best) {
                    best = c;
                    ask = k;
                    from = i;
                    to = li(s + CAND_TO);
                }
            }
            i += 1;
        }
        if best < 0 {
            break;
        }
        leave(s, from, best, tau);
        arrive(s, to, best, tau);
    }
    // 4. Counts into their areas.
    let mut i = 0;
    while i < n {
        let a = st(s, i);
        sl(a + S_AREA, ll(a + S_AREA) + li(a + S_COUNT) as i64);
        i += 1;
    }
    sl(s + AREA_ALL, ll(s + AREA_ALL) + li(s + LIVE) as i64);
    let mut j = 0;
    while j < li(s + NRES) {
        let b = res(s, j);
        sl(b + 8, ll(b + 8) + li(b + 4) as i64);
        j += 1;
    }
    // 5. Belts move, from the lead back.
    let mut i = 0;
    while i < n {
        let a = st(s, i);
        if li(a + S_TYPE) == CONVEYOR {
            let p_end = ll(a + S_Y);
            let gap = ll(a + S_Z);
            #[cfg(planted_drop)]
            {
                let h = li(a + S_HEAD);
                if h >= 0 && ll(row(s, h) + R_PROG) >= p_end {
                    unlink(s, a, h);
                    si(a + S_COUNT, li(a + S_COUNT) - 1);
                    free(s, h);
                }
            }
            let mut ahead = -1i64;
            let mut x = li(a + S_HEAD);
            while x >= 0 {
                let xr = row(s, x);
                let p = ll(xr + R_PROG);
                let np = mx(p, if ahead < 0 { mn(p + 1, p_end) } else { mn(p + 1, ahead - gap) });
                if ahead < 0 && np >= p_end && p < p_end {
                    sl(xr + R_ASK, tau + 1);
                }
                sl(xr + R_PROG, np);
                ahead = np;
                x = li(xr + R_NEXT);
            }
        }
        i += 1;
    }
    sl(s + TICKS, tau + 1);
}

// ---------------------------------------------------------------------------------------------
// Statistics and the arrays (README: Arrays).

/// The k-th smallest (0-based) of the n i64 at `v`, which it reorders.
fn select(v: u32, n: i64, k: i64) -> i64 {
    let at = |i: i64| v + 8 * i as u32;
    let (mut lo, mut hi) = (0i64, n - 1);
    while lo < hi {
        let pivot = ll(at(lo + ((hi - lo) >> 1)));
        let (mut i, mut j) = (lo, hi);
        while i <= j {
            while ll(at(i)) < pivot {
                i += 1;
            }
            while ll(at(j)) > pivot {
                j -= 1;
            }
            if i <= j {
                let t = ll(at(i));
                sl(at(i), ll(at(j)));
                sl(at(j), t);
                i += 1;
                j -= 1;
            }
        }
        if k <= j {
            hi = j;
        } else if k >= i {
            lo = i;
        } else {
            return ll(at(k));
        }
    }
    ll(at(k))
}

/// Station i's (or, i = N, the records') window statistics at now = c ticks, written at
/// thru/mean/p90/wip + 8i. `occupied`: its occupants' ticks inside the window.
#[allow(clippy::too_many_arguments)]
fn window(s: u32, i: i32, c: i64, occupied: i64, thru: u32, mean: u32, p90: u32, wip: u32) {
    let o = 8 * i as u32;
    let n_st = li(s + NST);
    let (w, u) = (ll(s + WT), ll(s + UT));
    let tk = tick(s);
    sf(thru + o, 0.0);
    sf(mean + o, 0.0);
    sf(p90 + o, 0.0);
    sf(wip + o, 0.0);
    if c <= u {
        return;
    }
    let a0 = mx(c - w, u);
    let all = i == n_st;
    let (left, left_u, dwell, dwell_u, area, area_u, cache) = if all {
        (
            ll(s + LEFT_ALL),
            ll(s + SNAP_LEFT),
            ll(s + DWELL_ALL),
            ll(s + SNAP_DWELL),
            ll(s + AREA_ALL),
            ll(s + SNAP_AREA),
            s + P90_ALL,
        )
    } else {
        let a = st(s, i);
        (
            ll(a + S_LEFT),
            ll(a + S_LEFT_U),
            ll(a + S_DWELL),
            ll(a + S_DWELL_U),
            ll(a + S_AREA),
            ll(a + S_AREA_U),
            a + S_P90,
        )
    };
    let m = ring_m(s);
    let base = ring(s, i);
    let oldest = mx(left - m, 0);
    let cumulative = c - w <= u;
    // The kept departures inside the window, newest first; in a window from the warm-up, read only
    // when the percentile's cache is stale, since its counts come from the cumulative ones.
    let (mut deps, mut dw, mut ov) = (0i64, 0i64, 0i64);
    let kept = if cumulative && ll(cache + 8) == left {
        ll(cache + 16)
    } else {
        let mut k = left - 1;
        while k >= oldest {
            let e = base + 16 * rem(k, m) as u32;
            let t = ll(e);
            if t < a0 {
                break;
            }
            let d = ll(e + 8);
            deps += 1;
            dw += d;
            ov += mn(d, t - a0);
            k -= 1;
        }
        deps
    };
    if cumulative {
        // From the warm-up on: the cumulative counts, exact at any length.
        deps = left - left_u;
        dw = dwell - dwell_u;
        ov = area - area_u;
    } else {
        ov += occupied;
    }
    let span = (c - a0) as f64 * tk;
    sf(thru + o, deps as f64 * 3600.0 / span);
    if deps > 0 {
        sf(mean + o, dw as f64 * tk / deps as f64);
    }
    sf(wip + o, ov as f64 / (c - a0) as f64);
    // The 90th percentile, nearest rank, of the kept departures inside the window.
    if kept > 0 {
        if ll(cache + 8) != left || ll(cache + 16) != kept {
            let v = scratch(s);
            let mut j = 0i64;
            while j < kept {
                sl(v + 8 * j as u32, ll(base + 16 * rem(left - 1 - j, m) as u32 + 8));
                j += 1;
            }
            let rank = (9 * kept as u64).div_ceil(10) as i64;
            sf(cache, select(v, kept, rank - 1) as f64 * tk);
            sl(cache + 8, left);
            sl(cache + 16, kept);
        }
        sf(p90 + o, lf(cache));
    }
}

#[inline(always)]
fn align8(o: u32) -> u32 {
    (o + 7) & !7
}

/// The arrays at `out` (README: Arrays).
fn write(s: u32, out: u32) {
    let e = li(s + H_ROWS);
    let k = li(s + H_KINDS);
    let n = li(s + NST);
    let r = li(s + NRES);
    let rh = if r > 0 { r } else { 1 };
    let m = li(s + H_RING);
    let c = ll(s + TICKS);
    let tk = tick(s);
    let eu = e as u32;
    let n1 = (n + 1) as u32;
    let o_kind = out;
    let o_gen = align8(o_kind + 4 * eu);
    let o_at = align8(o_gen + 4 * eu);
    let o_batch = align8(o_at + 4 * eu);
    let o_holds = align8(o_batch + 4 * eu);
    let o_rank = align8(o_holds + 4 * eu);
    let o_made = align8(o_rank + 4 * eu);
    let o_d = align8(o_made + 8 * eu);
    let o_made_n = align8(o_d + 8 * eu);
    let o_out_n = align8(o_made_n + 4 * k as u32);
    let o_count = align8(o_out_n + 4 * k as u32);
    let o_left = align8(o_count + 4 * n1);
    let o_area = align8(o_left + 4 * n1);
    let o_dwell = align8(o_area + 8 * n1);
    let o_busy = align8(o_dwell + 8 * n1);
    let o_cap = align8(o_busy + 4 * rh as u32);
    let o_busy_area = align8(o_cap + 4 * rh as u32);
    let o_thru = align8(o_busy_area + 8 * rh as u32);
    let o_mean = align8(o_thru + 8 * n1);
    let o_p90 = align8(o_mean + 8 * n1);
    let o_wip = align8(o_p90 + 8 * n1);
    let o_clock = align8(o_wip + 8 * n1);
    let o_rec_n = align8(o_clock + 24);
    let o_rec_t = align8(o_rec_n + 4);
    let o_rec_w = align8(o_rec_t + 8 * m as u32);

    let occ = scratch(s) + 8 * m as u32;
    let mut i = 0;
    while i <= n {
        sl(occ + 8 * i as u32, 0);
        i += 1;
    }
    let a0 = mx(c - ll(s + WT), ll(s + UT));
    let mut x = 0;
    while x < e {
        let xr = row(s, x);
        let xo = 4 * x as u32;
        let kind = li(xr + R_KIND);
        si(o_gen + xo, li(xr + R_GEN));
        si(o_rank + xo, 0);
        if kind < 0 {
            si(o_kind + xo, -1);
            si(o_at + xo, -1);
            si(o_batch + xo, -1);
            si(o_holds + xo, -1);
            sf(o_made + 2 * xo, 0.0);
            sf(o_d + 2 * xo, 0.0);
        } else {
            let at = li(xr + R_AT);
            si(o_kind + xo, kind);
            si(o_at + xo, at);
            si(o_batch + xo, li(xr + R_BATCH));
            si(o_holds + xo, li(xr + R_HOLDS));
            if li(xr + R_BATCH) >= 0 {
                si(o_rank + xo, li(xr + R_LOAD));
            }
            sf(o_made + 2 * xo, ll(xr + R_MADE) as f64 * tk);
            let mut d = 0.0;
            if at >= 0 {
                let a = st(s, at);
                if li(a + S_TYPE) == CONVEYOR {
                    d = ll(xr + R_PROG) as f64 * lf(a + S_X) * tk;
                }
                let q = occ + 8 * at as u32;
                sl(q, ll(q) + c - mx(ll(xr + R_CAME), a0));
            }
            sf(o_d + 2 * xo, d);
            let q = occ + 8 * n as u32;
            sl(q, ll(q) + c - mx(ll(xr + R_MADE), a0));
        }
        x += 1;
    }
    // Ranks along each station's list.
    let mut i = 0;
    while i < n {
        let a = st(s, i);
        let ty = li(a + S_TYPE);
        if ty == QUEUE || ty == REQUEST || ty == CONVEYOR {
            let mut p = li(a + S_HEAD);
            let mut q = 0;
            while p >= 0 {
                si(o_rank + 4 * p as u32, q);
                q += 1;
                p = li(row(s, p) + R_NEXT);
            }
        }
        i += 1;
    }
    let mut j = 0;
    while j < k {
        si(o_made_n + 4 * j as u32, li(s + MADE_N + 4 * j as u32));
        si(o_out_n + 4 * j as u32, li(s + OUT_N + 4 * j as u32));
        j += 1;
    }
    let mut i = 0;
    while i < n {
        let a = st(s, i);
        let io = i as u32;
        si(o_count + 4 * io, li(a + S_COUNT));
        si(o_left + 4 * io, ll(a + S_LEFT) as i32);
        sf(o_area + 8 * io, ll(a + S_AREA) as f64 * tk);
        sf(o_dwell + 8 * io, ll(a + S_DWELL) as f64 * tk);
        let occupied = if c > a0 { ll(occ + 8 * io) } else { 0 };
        window(s, i, c, occupied, o_thru, o_mean, o_p90, o_wip);
        i += 1;
    }
    let no = n as u32;
    si(o_count + 4 * no, li(s + LIVE));
    si(o_left + 4 * no, ll(s + LEFT_ALL) as i32);
    sf(o_area + 8 * no, ll(s + AREA_ALL) as f64 * tk);
    sf(o_dwell + 8 * no, ll(s + DWELL_ALL) as f64 * tk);
    let occupied = if c > a0 { ll(occ + 8 * no) } else { 0 };
    window(s, n, c, occupied, o_thru, o_mean, o_p90, o_wip);
    let mut j = 0;
    while j < rh {
        let jo = 4 * j as u32;
        if j < r {
            si(o_busy + jo, li(res(s, j) + 4));
            si(o_cap + jo, li(res(s, j)));
            sf(o_busy_area + 2 * jo, ll(res(s, j) + 8) as f64 * tk);
        } else {
            si(o_busy + jo, 0);
            si(o_cap + jo, 0);
            sf(o_busy_area + 2 * jo, 0.0);
        }
        j += 1;
    }
    let win = lf(s + H_WINDOW);
    sf(o_clock, c as f64 * tk);
    sf(o_clock + 8, if win == 0.0 { 3600.0 } else { win });
    sf(o_clock + 16, lf(s + H_WARMUP));
    si(o_rec_n, ll(s + LEFT_ALL) as i32);
    let base = ring(s, n);
    let mut j = 0u32;
    while j < m as u32 {
        sf(o_rec_t + 8 * j, ll(base + 16 * j) as f64 * tk);
        sf(o_rec_w + 8 * j, ll(base + 16 * j + 8) as f64 * tk);
        j += 1;
    }
}

/// The state laid out at the first `stats`: no more builders, every row free, the window and the
/// warm-up in ticks.
fn lay_out(s: u32) {
    si(s + BUILT, 1);
    let e = li(s + H_ROWS);
    if e < 1 || e > EMAX || li(s + H_KINDS) < 1 || li(s + H_KINDS) > 16 || li(s + H_RING) < 1 || !(tick(s) > 0.0) {
        trap();
    }
    let mut r = 0;
    while r < e {
        let x = row(s, r);
        si(x + R_KIND, -1);
        si(x + R_AT, -1);
        si(x + R_BATCH, -1);
        si(x + R_HOLDS, -1);
        si(x + R_NEXT, -1);
        r += 1;
    }
    let win = lf(s + H_WINDOW);
    sl(s + WT, ticks(if win == 0.0 { 3600.0 } else { win }, tick(s)));
    sl(s + UT, ticks(lf(s + H_WARMUP), tick(s)));
    sl(s + P90_ALL_LEFT, -1);
}

#[no_mangle]
pub unsafe extern "C" fn stats(s: i32, n: i32, out: i32) {
    let s = s as u32;
    if building(s) {
        lay_out(s);
    }
    let mut k = 0;
    while k < n {
        run_tick(s);
        k += 1;
    }
    write(s, out as u32);
}
