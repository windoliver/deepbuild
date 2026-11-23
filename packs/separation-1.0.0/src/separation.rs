//! separation@1's reference library (#1255; canvas primitives: Logic: library interfaces): movers
//! that must keep apart. A mover flies straight between the fixes of its route at the speed given
//! from each, so its position at any time is linear between two times the state holds. On every
//! stretch where two movers each keep one velocity their squared distance is a quadratic in time:
//! its least value gives the closest approach, and its two roots, cut by the two times their
//! levels come within the vertical minimum, give the window in which the pair is under its
//! minimum, with no time ever sampled. A by-pair row that holds always raises the lateral minimum
//! of each pair of its two classes; one measured at a fix is read at the instant its leader
//! passes that fix. `delay` gives the control that makes a mover's next leg take the
//! seconds asked longer: a speed inside the band at the leg's first fix, else a stretch of the
//! leg, else a hold for a mover not yet started, else a refusal naming why; `apply` flies the
//! mover again under a control.
//!
//! Built with `--cfg sampler`, it is the planted library that looks at each pair once a second;
//! with `--cfg solver`, the planted one whose `delay` gives the speed without reading the band.
//!
//! The state, `separation.state@1`, and the built table's bytes are laid out as LAYOUT.md says.
//! The library keeps everything in the caller's memory and calls nothing: a relocatable object of
//! functions only, built by scripts/separation-pack.mjs:
//!
//! ```text
//! rustc --target wasm32-unknown-unknown --crate-type=lib --crate-name separation --edition 2021
//!   --emit=obj -C opt-level=3 -C panic=abort -C target-cpu=mvp -C debuginfo=0
//!   -C target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint [--cfg sampler | --cfg solver]
//!   separation.rs
//! ```

#![cfg_attr(target_arch = "wasm32", no_std)]
#![allow(
    clippy::missing_safety_doc,
    clippy::too_many_arguments,
    static_mut_refs,
    unexpected_cfgs
)]

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// ---------------------------------------------------------------------------------------------
// Memory: every address is the caller's, an i32 into its linear memory.

#[cfg(target_arch = "wasm32")]
#[inline(always)]
fn at(a: u32) -> *mut u8 {
    a as usize as *mut u8
}
/// Off wasm (a host's tests), addresses are offsets from this memory.
#[cfg(not(target_arch = "wasm32"))]
pub static mut BASE: *mut u8 = core::ptr::null_mut();
#[cfg(not(target_arch = "wasm32"))]
#[inline(always)]
fn at(a: u32) -> *mut u8 {
    unsafe { BASE.wrapping_add(a as usize) }
}
#[inline(always)]
fn lf(a: u32) -> f64 {
    unsafe { (at(a) as *const f64).read_unaligned() }
}
#[inline(always)]
fn sf(a: u32, x: f64) {
    unsafe { (at(a) as *mut f64).write_unaligned(x) }
}
#[inline(always)]
fn li(a: u32) -> i32 {
    unsafe { (at(a) as *const i32).read_unaligned() }
}
#[inline(always)]
fn si(a: u32, x: i32) {
    unsafe { (at(a) as *mut i32).write_unaligned(x) }
}

// ---------------------------------------------------------------------------------------------
// Numbers, by plain IEEE operations only, so every host gives the same bits.

#[inline(always)]
fn mn(a: f64, b: f64) -> f64 {
    if a < b {
        a
    } else {
        b
    }
}
#[inline(always)]
fn mx(a: f64, b: f64) -> f64 {
    if a > b {
        a
    } else {
        b
    }
}
#[inline(always)]
fn ab(a: f64) -> f64 {
    if a < 0.0 {
        -a
    } else {
        a
    }
}
/// √x by Newton's steps from the exponent's guess; the last two agree or neighbour, the smaller kept.
#[inline(never)]
fn sqrt(x: f64) -> f64 {
    if !(x > 0.0) {
        return 0.0;
    }
    let mut r = f64::from_bits((x.to_bits() >> 1) + (1023u64 << 51));
    let mut i = 0;
    while i < 7 {
        r = 0.5 * (r + x / r);
        i += 1;
    }
    let s = 0.5 * (r + x / r);
    if s < r {
        s
    } else {
        r
    }
}

// ---------------------------------------------------------------------------------------------
// The built table (LAYOUT.md: The built table), from `g`.

const SLOTS: i32 = 8;
const WINDOWS: i32 = 64;
const MOVERS: i32 = 64;

#[cfg(not(sampler))]
#[inline(always)]
fn t_rows(g: u32) -> i32 {
    li(g + 8)
}
#[inline(always)]
fn t_lateral(g: u32) -> f64 {
    lf(g + 16)
}
#[inline(always)]
fn t_vertical(g: u32) -> f64 {
    lf(g + 24)
}
/// Mover m's row: i32 class, i32 fixes, f64 start, then its fixes.
#[inline(always)]
fn t_mover(g: u32, m: i32) -> u32 {
    g + li(g + 32) as u32 + 464 * m as u32
}
/// Fix j of a mover's row: f64 x, y, z, the speed from it, its band's min and max, i32 its name.
#[inline(always)]
fn t_fix(tm: u32, j: i32) -> u32 {
    tm + 16 + 56 * j as u32
}
/// Row r: i32 leader class, follower class, the fix it is measured at (−1 always), basis, f64 min.
#[cfg(not(sampler))]
#[inline(always)]
fn t_row(g: u32, r: i32) -> u32 {
    g + li(g + 36) as u32 + 24 * r as u32
}

// ---------------------------------------------------------------------------------------------
// The state (LAYOUT.md: separation.state@1): its head, the arrays a piece publishes, then from
// OWN the library's own part: the table, the movers' count, each array's address, and for each
// mover the delay last asked of it (f64 seconds, i32 the fix it is wanted at, −1 none).

const OWN: u32 = 32768;
const FIX_COUNT: u32 = 0;
const FIX_REF: u32 = 1;
const FIX_POS: u32 = 2;
const FIX_SPEED: u32 = 3;
const FIX_TIME: u32 = 4;
const DELAY_S: u32 = 5;
const DELAY_FIX: u32 = 6;
const WIN_COUNT: u32 = 7;
const WIN_A: u32 = 8;
const WIN_B: u32 = 9;
const WIN_FROM: u32 = 10;
const WIN_TO: u32 = 11;
const WIN_MIN: u32 = 12;
const WIN_ROW: u32 = 13;
const WIN_BASIS: u32 = 14;
const CLOSEST_A: u32 = 15;
const CLOSEST_B: u32 = 16;
const CLOSEST_DIST: u32 = 17;
const CLOSEST_TIME: u32 = 18;
const ARRAYS: u32 = 19;

#[inline(always)]
fn table(s: u32) -> u32 {
    li(s + OWN) as u32
}
#[inline(always)]
fn movers(s: u32) -> i32 {
    li(s + OWN + 4)
}
#[inline(always)]
fn arr(s: u32, k: u32) -> u32 {
    li(s + OWN + 8 + 4 * k) as u32
}
#[inline(always)]
fn asked(s: u32, m: i32) -> u32 {
    s + OWN + 8 + 4 * ARRAYS + 4 + 16 * m as u32
}

// A mover as flown: its slots, each a fix of its route (`ref`, its index there) or the off-route
// point a stretch added (−1), with its position, the speed from it and its time.
#[inline(always)]
fn count(s: u32, m: i32) -> i32 {
    li(arr(s, FIX_COUNT) + 4 * m as u32)
}
#[inline(always)]
fn slot(m: i32, q: i32) -> u32 {
    (SLOTS * m + q) as u32
}
#[inline(always)]
fn s_ref(s: u32, m: i32, q: i32) -> i32 {
    li(arr(s, FIX_REF) + 4 * slot(m, q))
}
#[inline(always)]
fn s_pos(s: u32, m: i32, q: i32, c: u32) -> f64 {
    lf(arr(s, FIX_POS) + 24 * slot(m, q) + 8 * c)
}
#[inline(always)]
fn s_speed(s: u32, m: i32, q: i32) -> f64 {
    lf(arr(s, FIX_SPEED) + 8 * slot(m, q))
}
#[inline(always)]
fn s_time(s: u32, m: i32, q: i32) -> f64 {
    lf(arr(s, FIX_TIME) + 8 * slot(m, q))
}
#[inline(always)]
fn put_slot(s: u32, m: i32, q: i32, r: i32, x: f64, y: f64, z: f64, speed: f64, time: f64) {
    let k = slot(m, q);
    si(arr(s, FIX_REF) + 4 * k, r);
    let p = arr(s, FIX_POS) + 24 * k;
    sf(p, x);
    sf(p + 8, y);
    sf(p + 16, z);
    sf(arr(s, FIX_SPEED) + 8 * k, speed);
    sf(arr(s, FIX_TIME) + 8 * k, time);
}
/// The straight-line length of the leg from slot q to the next.
#[inline(always)]
fn length(s: u32, m: i32, q: i32) -> f64 {
    let (dx, dy, dz) = (
        s_pos(s, m, q + 1, 0) - s_pos(s, m, q, 0),
        s_pos(s, m, q + 1, 1) - s_pos(s, m, q, 1),
        s_pos(s, m, q + 1, 2) - s_pos(s, m, q, 2),
    );
    sqrt(dx * dx + dy * dy + dz * dz)
}
/// Each slot's time from the one before it: the leg's length ÷ the speed from its first slot.
#[inline(never)]
fn retime(s: u32, m: i32) {
    let n = count(s, m);
    let mut q = 1;
    while q < n {
        let t = s_time(s, m, q - 1) + length(s, m, q - 1) / s_speed(s, m, q - 1);
        sf(arr(s, FIX_TIME) + 8 * slot(m, q), t);
        q += 1;
    }
}
/// The leg a mover is on at t: the last slot q whose time is at or before t, at most its last leg's.
#[inline(always)]
fn leg(s: u32, m: i32, t: f64) -> i32 {
    let n = count(s, m);
    let mut q = 0;
    while q < n - 2 && s_time(s, m, q + 1) <= t {
        q += 1;
    }
    q
}
/// Component c of its velocity on leg q.
#[inline(always)]
fn vel(s: u32, m: i32, q: i32, c: u32) -> f64 {
    let dt = s_time(s, m, q + 1) - s_time(s, m, q);
    if dt > 0.0 {
        (s_pos(s, m, q + 1, c) - s_pos(s, m, q, c)) / dt
    } else {
        0.0
    }
}
/// Component c of its position at t on leg q.
#[inline(always)]
fn pos(s: u32, m: i32, q: i32, c: u32, t: f64) -> f64 {
    s_pos(s, m, q, c) + vel(s, m, q, c) * (t - s_time(s, m, q))
}
#[inline(always)]
fn first(s: u32, m: i32) -> f64 {
    s_time(s, m, 0)
}
#[inline(always)]
fn last(s: u32, m: i32) -> f64 {
    s_time(s, m, count(s, m) - 1)
}
#[inline(always)]
fn flown(s: u32, m: i32) -> bool {
    m >= 0 && m < movers(s) && count(s, m) >= 2
}

// ---------------------------------------------------------------------------------------------
// Windows: the state keeps the first 64 by start, then pair.

#[inline(always)]
fn w_get(s: u32, k: u32, i: i32) -> u32 {
    arr(s, k)
        + if k == WIN_FROM || k == WIN_TO || k == WIN_MIN {
            8
        } else {
            4
        } * i as u32
}
/// Adds the n-th window found, in its place among those kept.
#[inline(never)]
fn window(s: u32, n: i32, a: i32, b: i32, from: f64, to: f64, min: f64, row: i32, basis: i32) {
    let kept = if n < WINDOWS { n } else { WINDOWS };
    let mut p = kept;
    while p > 0 {
        let (f, wa, wb) = (
            lf(w_get(s, WIN_FROM, p - 1)),
            li(w_get(s, WIN_A, p - 1)),
            li(w_get(s, WIN_B, p - 1)),
        );
        if !(from < f || (from == f && (a < wa || (a == wa && b < wb)))) {
            break;
        }
        p -= 1;
    }
    if p >= WINDOWS {
        return;
    }
    let mut q = if kept < WINDOWS { kept } else { WINDOWS - 1 };
    while q > p {
        si(w_get(s, WIN_A, q), li(w_get(s, WIN_A, q - 1)));
        si(w_get(s, WIN_B, q), li(w_get(s, WIN_B, q - 1)));
        sf(w_get(s, WIN_FROM, q), lf(w_get(s, WIN_FROM, q - 1)));
        sf(w_get(s, WIN_TO, q), lf(w_get(s, WIN_TO, q - 1)));
        sf(w_get(s, WIN_MIN, q), lf(w_get(s, WIN_MIN, q - 1)));
        si(w_get(s, WIN_ROW, q), li(w_get(s, WIN_ROW, q - 1)));
        si(w_get(s, WIN_BASIS, q), li(w_get(s, WIN_BASIS, q - 1)));
        q -= 1;
    }
    si(w_get(s, WIN_A, p), a);
    si(w_get(s, WIN_B, p), b);
    sf(w_get(s, WIN_FROM, p), from);
    sf(w_get(s, WIN_TO, p), to);
    sf(w_get(s, WIN_MIN, p), min);
    si(w_get(s, WIN_ROW, p), row);
    si(w_get(s, WIN_BASIS, p), basis);
}

/// The windows in which the pair a < b is under its minima within [t0, t1], `lat` being the
/// table's lateral minimum (row −1) or the `always` row's that raises it, each added after the n
/// found so far; returns the count found then. On each stretch where both keep one velocity, with
/// p the position of b from a at its start and v its rate: laterally (x and z) |p + vτ|² < L²
/// between the quadratic's two roots, vertically (y) |p + vτ| < V between the line's two
/// crossings, both strict. Pieces that meet where a stretch ends are one window.
#[cfg(not(sampler))]
#[inline(never)]
fn pair(
    s: u32,
    a: i32,
    b: i32,
    t0: f64,
    t1: f64,
    lat: f64,
    vert: f64,
    row: i32,
    mut n: i32,
) -> i32 {
    let basis = if row < 0 {
        0
    } else {
        li(t_row(table(s), row) + 12)
    };
    let lo = mx(t0, mx(first(s, a), first(s, b)));
    let hi = mn(t1, mn(last(s, a), last(s, b)));
    if !(lo < hi) {
        return n;
    }
    let (na, nb) = (count(s, a), count(s, b));
    let (mut ka, mut kb, mut t) = (leg(s, a, lo), leg(s, b, lo), lo);
    let (mut open, mut from, mut to) = (false, 0.0, 0.0);
    loop {
        let te = mn(hi, mn(s_time(s, a, ka + 1), s_time(s, b, kb + 1)));
        if te > t {
            let (px, py, pz) = (
                pos(s, b, kb, 0, t) - pos(s, a, ka, 0, t),
                pos(s, b, kb, 1, t) - pos(s, a, ka, 1, t),
                pos(s, b, kb, 2, t) - pos(s, a, ka, 2, t),
            );
            let (vx, vy, vz) = (
                vel(s, b, kb, 0) - vel(s, a, ka, 0),
                vel(s, b, kb, 1) - vel(s, a, ka, 1),
                vel(s, b, kb, 2) - vel(s, a, ka, 2),
            );
            let (mut x, mut y, mut under) = (0.0, te - t, true);
            // vv τ² + 2 pv τ + (pp − L²) < 0.
            let (vv, pv, c) = (
                vx * vx + vz * vz,
                px * vx + pz * vz,
                px * px + pz * pz - lat * lat,
            );
            if vv > 0.0 {
                let disc = pv * pv - vv * c;
                if disc > 0.0 {
                    let r = sqrt(disc);
                    x = mx(x, (-pv - r) / vv);
                    y = mn(y, (-pv + r) / vv);
                } else {
                    under = false;
                }
            } else if !(c < 0.0) {
                under = false;
            }
            if under {
                if vy != 0.0 {
                    let (r1, r2) = ((-vert - py) / vy, (vert - py) / vy);
                    x = mx(x, mn(r1, r2));
                    y = mn(y, mx(r1, r2));
                } else if !(ab(py) < vert) {
                    under = false;
                }
            }
            if under && x < y {
                if open && t + x - to <= 1e-9 {
                    to = t + y;
                } else {
                    if open {
                        window(s, n, a, b, from, to, lat, row, basis);
                        n += 1;
                    }
                    open = true;
                    from = t + x;
                    to = t + y;
                }
            } else if open {
                window(s, n, a, b, from, to, lat, row, basis);
                n += 1;
                open = false;
            }
        }
        if !(te < hi) {
            break;
        }
        if ka < na - 2 && s_time(s, a, ka + 1) <= te {
            ka += 1;
        }
        if kb < nb - 2 && s_time(s, b, kb + 1) <= te {
            kb += 1;
        }
        t = te;
    }
    if open {
        window(s, n, a, b, from, to, lat, row, basis);
        n += 1;
    }
    n
}

/// The planted library's: the pair looked at on each whole second of the span, a window running
/// from the first second in a row it is under its minima to the last.
#[cfg(sampler)]
#[inline(never)]
fn pair(
    s: u32,
    a: i32,
    b: i32,
    t0: f64,
    t1: f64,
    lat: f64,
    vert: f64,
    _row: i32,
    mut n: i32,
) -> i32 {
    let lo = mx(t0, mx(first(s, a), first(s, b)));
    let hi = mn(t1, mn(last(s, a), last(s, b)));
    let whole = |x: f64| x as i64 as f64;
    let mut k = if whole(lo) < lo {
        whole(lo) + 1.0
    } else {
        whole(lo)
    };
    let end = if whole(hi) > hi {
        whole(hi) - 1.0
    } else {
        whole(hi)
    };
    let (mut open, mut from, mut to) = (false, 0.0, 0.0);
    while k <= end {
        let (ka, kb) = (leg(s, a, k), leg(s, b, k));
        let (dx, dy, dz) = (
            pos(s, b, kb, 0, k) - pos(s, a, ka, 0, k),
            pos(s, b, kb, 1, k) - pos(s, a, ka, 1, k),
            pos(s, b, kb, 2, k) - pos(s, a, ka, 2, k),
        );
        if sqrt(dx * dx + dz * dz) < lat && ab(dy) < vert {
            if !open {
                open = true;
                from = k;
            }
            to = k;
        } else if open {
            window(s, n, a, b, from, to, lat, -1, 0);
            n += 1;
            open = false;
        }
        k += 1.0;
    }
    if open {
        window(s, n, a, b, from, to, lat, -1, 0);
        n += 1;
    }
    n
}

/// The time mover m passes the fix named `name`, or `none` when its route as flown holds none.
#[cfg(not(sampler))]
#[inline(always)]
fn passes(s: u32, m: i32, name: i32, none: f64) -> f64 {
    let tm = t_mover(table(s), m);
    let (mut j, fixes) = (0, li(tm + 4));
    while j < fixes && li(t_fix(tm, j) + 48) != name {
        j += 1;
    }
    let (mut q, n) = (0, count(s, m));
    while q < n && s_ref(s, m, q) != j {
        q += 1;
    }
    if j < fixes && q < n {
        s_time(s, m, q)
    } else {
        none
    }
}

/// The rows measured at a fix: for each leader and follower of a row's classes that both pass
/// its fix, the leader first and within [t0, t1], the instant the leader passes it, when the
/// follower is on its route, laterally under the row's minimum and vertically under the table's.
#[cfg(not(sampler))]
#[inline(never)]
fn rows(s: u32, t0: f64, t1: f64, mut n: i32) -> i32 {
    const NONE: f64 = 1e300;
    let g = table(s);
    let (mm, vert) = (movers(s), t_vertical(g));
    let mut r = 0;
    while r < t_rows(g) {
        let row = t_row(g, r);
        let (name, min) = (li(row + 8), lf(row + 16));
        let mut i = 0;
        while name >= 0 && i < mm {
            if flown(s, i) && li(t_mover(g, i)) == li(row) {
                let ti = passes(s, i, name, NONE);
                let mut j = 0;
                while ti >= t0 && ti <= t1 && j < mm {
                    if j != i && flown(s, j) && li(t_mover(g, j)) == li(row + 4) {
                        let tj = passes(s, j, name, NONE);
                        if tj != NONE && ti < tj && ti >= first(s, j) && ti <= last(s, j) {
                            let (ki, kj) = (leg(s, i, ti), leg(s, j, ti));
                            let (dx, dy, dz) = (
                                pos(s, j, kj, 0, ti) - pos(s, i, ki, 0, ti),
                                pos(s, j, kj, 1, ti) - pos(s, i, ki, 1, ti),
                                pos(s, j, kj, 2, ti) - pos(s, i, ki, 2, ti),
                            );
                            if sqrt(dx * dx + dz * dz) < min && ab(dy) < vert {
                                let (a, b) = if i < j { (i, j) } else { (j, i) };
                                window(s, n, a, b, ti, ti, min, r, li(row + 12));
                                n += 1;
                            }
                        }
                    }
                    j += 1;
                }
            }
            i += 1;
        }
        r += 1;
    }
    n
}

/// Every window within [t0, t1], the first 64 kept by start, then pair; returns how many.
#[inline(never)]
fn find(s: u32, t0: f64, t1: f64) -> i32 {
    let g = table(s);
    let (mm, lat, vert) = (movers(s), t_lateral(g), t_vertical(g));
    let mut n = 0;
    let mut a = 0;
    while a < mm {
        let mut b = a + 1;
        while flown(s, a) && b < mm {
            if flown(s, b) {
                // The pair's lateral minimum: the table's, raised by the `always` row that asks
                // the most of its two classes, whichever of the two leads.
                #[cfg(sampler)]
                let (min, row) = (lat, -1);
                #[cfg(not(sampler))]
                let (min, row) = {
                    let (ca, cb) = (li(t_mover(g, a)), li(t_mover(g, b)));
                    let (mut min, mut row, mut r) = (lat, -1, 0);
                    while r < t_rows(g) {
                        let x = t_row(g, r);
                        let fits =
                            (li(x) == ca && li(x + 4) == cb) || (li(x) == cb && li(x + 4) == ca);
                        if li(x + 8) < 0 && fits && lf(x + 16) > min {
                            min = lf(x + 16);
                            row = r;
                        }
                        r += 1;
                    }
                    (min, row)
                };
                n = pair(s, a, b, t0, t1, min, vert, row, n);
            }
            b += 1;
        }
        a += 1;
    }
    #[cfg(not(sampler))]
    {
        n = rows(s, t0, t1, n);
    }
    n
}

/// Writes the count of windows found and clears the slots past those kept.
#[inline(always)]
fn publish(s: u32, n: i32) {
    si(arr(s, WIN_COUNT), n);
    let mut i = if n < WINDOWS { n } else { WINDOWS };
    while i < WINDOWS {
        si(w_get(s, WIN_A, i), 0);
        si(w_get(s, WIN_B, i), 0);
        sf(w_get(s, WIN_FROM, i), 0.0);
        sf(w_get(s, WIN_TO, i), 0.0);
        sf(w_get(s, WIN_MIN, i), 0.0);
        si(w_get(s, WIN_ROW, i), 0);
        si(w_get(s, WIN_BASIS, i), 0);
        i += 1;
    }
}

// ---------------------------------------------------------------------------------------------
// separation@1's exports.

/// Starts the state at `s` from the built table at `g`: no mover flown, no window, no closest
/// pair; returns the state's size in bytes, or −1 for a table it can't read.
#[no_mangle]
pub unsafe extern "C" fn minima(s: i32, g: i32) -> i32 {
    let (s, g) = (s as u32, g as u32);
    let m = li(g + 4);
    if li(g) != 1 || m < 1 || m > MOVERS {
        return -1;
    }
    let mu = m as u32;
    let al = |x: u32| (x + 7) & !7;
    // Each array of the head 8-aligned, in the order a piece declares them.
    let (four, eight) = (al(4 * mu), 8 * mu);
    let slots = SLOTS as u32;
    let (w4, w8) = (4 * WINDOWS as u32, 8 * WINDOWS as u32);
    let mut a = s;
    let mut k = 0;
    while k < ARRAYS {
        si(s + OWN + 8 + 4 * k, a as i32);
        a += match k {
            FIX_COUNT | DELAY_FIX => four,
            FIX_REF => 4 * slots * mu,
            FIX_POS => 24 * slots * mu,
            FIX_SPEED | FIX_TIME => 8 * slots * mu,
            DELAY_S => eight,
            WIN_A | WIN_B | WIN_ROW | WIN_BASIS => w4,
            WIN_FROM | WIN_TO | WIN_MIN => w8,
            _ => 8,
        };
        k += 1;
    }
    si(s + OWN, g as i32);
    si(s + OWN + 4, m);
    let mut o = s;
    while o < a {
        sf(o, 0.0);
        o += 8;
    }
    let mut i = 0;
    while i < SLOTS * m {
        si(arr(s, FIX_REF) + 4 * i as u32, -1);
        i += 1;
    }
    let mut i = 0;
    while i < m {
        si(arr(s, DELAY_FIX) + 4 * i as u32, -1);
        sf(asked(s, i), 0.0);
        si(asked(s, i) + 8, -1);
        si(asked(s, i) + 12, 0);
        i += 1;
    }
    si(arr(s, CLOSEST_A), -1);
    si(arr(s, CLOSEST_B), -1);
    (asked(s, m) - s) as i32
}

/// Adds mover i of the table, flown as its route, speeds and start give it; returns i, or −1
/// when the table has no such mover or the state holds it already.
#[no_mangle]
pub unsafe extern "C" fn mover(s: i32, i: i32) -> i32 {
    let s = s as u32;
    if i < 0 || i >= movers(s) || count(s, i) != 0 {
        return -1;
    }
    let tm = t_mover(table(s), i);
    let n = li(tm + 4);
    let mut j = 0;
    while j < n {
        let f = t_fix(tm, j);
        put_slot(
            s,
            i,
            j,
            j,
            lf(f),
            lf(f + 8),
            lf(f + 16),
            lf(f + 24),
            lf(tm + 8),
        );
        j += 1;
    }
    si(arr(s, FIX_COUNT) + 4 * i as u32, n);
    retime(s, i);
    i
}

/// The smallest straight-line distance between movers a and b while both are on their routes
/// within [t0, t1], and its time, the earliest such: written as the state's closest pair and
/// returned, or −1 when the two share no time in the span. On each stretch the squared distance
/// is |p + vτ|², least at τ = −p·v ÷ v·v, held to the stretch.
#[no_mangle]
pub unsafe extern "C" fn closest(s: i32, a: i32, b: i32, t0: f64, t1: f64) -> f64 {
    let s = s as u32;
    if !flown(s, a) || !flown(s, b) {
        return -1.0;
    }
    let lo = mx(t0, mx(first(s, a), first(s, b)));
    let hi = mn(t1, mn(last(s, a), last(s, b)));
    if !(lo < hi) {
        return -1.0;
    }
    let (na, nb) = (count(s, a), count(s, b));
    let (mut ka, mut kb, mut t) = (leg(s, a, lo), leg(s, b, lo), lo);
    let (mut best, mut best_t) = (-1.0, lo);
    loop {
        let te = mn(hi, mn(s_time(s, a, ka + 1), s_time(s, b, kb + 1)));
        if te > t {
            let (px, py, pz) = (
                pos(s, b, kb, 0, t) - pos(s, a, ka, 0, t),
                pos(s, b, kb, 1, t) - pos(s, a, ka, 1, t),
                pos(s, b, kb, 2, t) - pos(s, a, ka, 2, t),
            );
            let (vx, vy, vz) = (
                vel(s, b, kb, 0) - vel(s, a, ka, 0),
                vel(s, b, kb, 1) - vel(s, a, ka, 1),
                vel(s, b, kb, 2) - vel(s, a, ka, 2),
            );
            let vv = vx * vx + vy * vy + vz * vz;
            let tau = if vv > 0.0 {
                mn(mx(-(px * vx + py * vy + pz * vz) / vv, 0.0), te - t)
            } else {
                0.0
            };
            let (dx, dy, dz) = (px + vx * tau, py + vy * tau, pz + vz * tau);
            let d = sqrt(dx * dx + dy * dy + dz * dz);
            if best < 0.0 || d < best {
                best = d;
                best_t = t + tau;
            }
        }
        if !(te < hi) {
            break;
        }
        if ka < na - 2 && s_time(s, a, ka + 1) <= te {
            ka += 1;
        }
        if kb < nb - 2 && s_time(s, b, kb + 1) <= te {
            kb += 1;
        }
        t = te;
    }
    si(arr(s, CLOSEST_A), if a < b { a } else { b });
    si(arr(s, CLOSEST_B), if a < b { b } else { a });
    sf(arr(s, CLOSEST_DIST), best);
    sf(arr(s, CLOSEST_TIME), best_t);
    best
}

/// Every window within [t0, t1] where a pair is under its minimum, written as the state's
/// windows; returns how many there are.
#[no_mangle]
pub unsafe extern "C" fn conflicts(s: i32, t0: f64, t1: f64) -> i32 {
    let s = s as u32;
    let n = find(s, t0, t1);
    publish(s, n);
    n
}

/// The first window that starts at or after t, written as the state's one window; returns 1, or
/// 0 when there is none.
#[no_mangle]
pub unsafe extern "C" fn next_conflict(s: i32, t: f64) -> i32 {
    let s = s as u32;
    let n = if find(s, t, 1e300) > 0 { 1 } else { 0 };
    publish(s, n);
    n
}

const REFUSED: i32 = 0;
const SPEED: i32 = 1;
const STRETCH: i32 = 2;
const HOLD: i32 = 3;
const BAND: i32 = 1;
const ROUTE: i32 = 2;

/// Writes a control record: i32 kind, mover, from, to, f64 value, i32 why, each in 8 bytes.
#[inline(always)]
fn record(c: u32, kind: i32, m: i32, from: i32, to: i32, value: f64, why: i32) -> i32 {
    si(c, kind);
    si(c + 4, 0);
    si(c + 8, m);
    si(c + 12, 0);
    si(c + 16, from);
    si(c + 20, 0);
    si(c + 24, to);
    si(c + 28, 0);
    sf(c + 32, value);
    si(c + 40, why);
    si(c + 44, 0);
    kind
}

/// The control that delays mover m by `seconds` over its next leg, asked at time t, written at
/// `c`; returns its kind. The leg runs from the first slot the mover has not left at t to the
/// next. In order: the speed that takes `seconds` longer over the leg, when the band at the
/// leg's first fix allows it; a stretch of the leg, unless it is the route's last; a hold, for a
/// mover not yet started; else a refusal: the band's, or the route's when no leg is left.
#[no_mangle]
pub unsafe extern "C" fn delay(s: i32, m: i32, seconds: f64, t: f64, c: i32) -> i32 {
    let (s, c) = (s as u32, c as u32);
    if m < 0 || m >= movers(s) {
        return record(c, REFUSED, m, -1, -1, 0.0, ROUTE);
    }
    let n = count(s, m);
    let mut j = 0;
    while j < n && !(s_time(s, m, j) >= t) {
        j += 1;
    }
    if j >= n - 1 {
        return record(c, REFUSED, m, -1, -1, 0.0, ROUTE);
    }
    let (from, to) = (s_ref(s, m, j), s_ref(s, m, j + 1));
    let (len, v) = (length(s, m, j), s_speed(s, m, j));
    let needs = len / (len / v + seconds);
    // The band at the leg's first fix; an off-route point takes the fix before it.
    let mut q = j;
    while q > 0 && s_ref(s, m, q) < 0 {
        q -= 1;
    }
    let f = t_fix(
        t_mover(table(s), m),
        if s_ref(s, m, q) < 0 {
            0
        } else {
            s_ref(s, m, q)
        },
    );
    let allowed = cfg!(solver) || (needs >= lf(f + 32) && needs <= lf(f + 40));
    let kind = if allowed {
        record(c, SPEED, m, from, to, needs, 0)
    } else if j + 1 < n - 1 {
        let far = len + v * seconds;
        record(
            c,
            STRETCH,
            m,
            from,
            to,
            sqrt(far * far - len * len) / 2.0,
            0,
        )
    } else if t < first(s, m) {
        record(c, HOLD, m, -1, -1, seconds, 0)
    } else {
        return record(c, REFUSED, m, from, -1, needs, BAND);
    };
    sf(asked(s, m), seconds);
    si(asked(s, m) + 8, to);
    kind
}

/// Flies the control's mover again under the control at `c`, as given: a speed holds from its
/// `from` fix to its `to` fix; a stretch adds an off-route point, the leg's midpoint moved its
/// offset to the left of travel in the lateral plane; a hold moves every time. The state then
/// shows the mover's last delay that gave a control: the seconds asked and the fix they were
/// wanted at. Returns 1, or 0, changing nothing, for a refusal's record or a control it can't fly.
#[no_mangle]
pub unsafe extern "C" fn apply(s: i32, c: i32) -> i32 {
    let (s, c) = (s as u32, c as u32);
    let (kind, m, from, to, value) = (li(c), li(c + 8), li(c + 16), li(c + 24), lf(c + 32));
    if !flown(s, m) {
        return 0;
    }
    let n = count(s, m);
    let mut i = 0;
    while i < n && s_ref(s, m, i) != from {
        i += 1;
    }
    if kind == HOLD {
        let mut q = 0;
        while q < n {
            sf(arr(s, FIX_TIME) + 8 * slot(m, q), s_time(s, m, q) + value);
            q += 1;
        }
    } else if kind == SPEED {
        let mut k = 0;
        while k < n && s_ref(s, m, k) != to {
            k += 1;
        }
        if i >= n || k >= n || k <= i || !(value > 0.0) {
            return 0;
        }
        while i < k {
            sf(arr(s, FIX_SPEED) + 8 * slot(m, i), value);
            i += 1;
        }
        retime(s, m);
    } else if kind == STRETCH {
        if i >= n - 1 || n >= SLOTS {
            return 0;
        }
        let (px, py, pz) = (s_pos(s, m, i, 0), s_pos(s, m, i, 1), s_pos(s, m, i, 2));
        let (qx, qy, qz) = (
            s_pos(s, m, i + 1, 0),
            s_pos(s, m, i + 1, 1),
            s_pos(s, m, i + 1, 2),
        );
        let along = sqrt((qx - px) * (qx - px) + (qz - pz) * (qz - pz));
        if !(along > 0.0) {
            return 0;
        }
        let mut q = n;
        while q > i + 1 {
            put_slot(
                s,
                m,
                q,
                s_ref(s, m, q - 1),
                s_pos(s, m, q - 1, 0),
                s_pos(s, m, q - 1, 1),
                s_pos(s, m, q - 1, 2),
                s_speed(s, m, q - 1),
                0.0,
            );
            q -= 1;
        }
        put_slot(
            s,
            m,
            i + 1,
            -1,
            (px + qx) / 2.0 + value * (qz - pz) / along,
            (py + qy) / 2.0,
            (pz + qz) / 2.0 - value * (qx - px) / along,
            s_speed(s, m, i),
            0.0,
        );
        si(arr(s, FIX_COUNT) + 4 * m as u32, n + 1);
        retime(s, m);
    } else {
        return 0;
    }
    if li(asked(s, m) + 8) >= 0 {
        sf(arr(s, DELAY_S) + 8 * m as u32, lf(asked(s, m)));
        si(arr(s, DELAY_FIX) + 4 * m as u32, li(asked(s, m) + 8));
    }
    1
}
