//! lanes@1's reference library (#981; canvas primitives: Logic: library interfaces): vehicles on
//! a lane graph the check built from a piece's floor paths. Each vehicle holds the zones it reserved
//! and those its footprint covers, asks for the next zones of its route within its horizon (a
//! junction only together with the zone after it), moves time-optimally toward the first zone it
//! doesn't hold or its goal, each phase in closed form so a step lands on the continuous profile,
//! and releases a zone once its rear passes the zone's end. A loop of vehicles each waiting on the
//! next is broken at the ask that closes it: its lowest-ID vehicle takes its next quickest route
//! that avoids the zone it waits for. Forks lift at a set speed; a load rides them until it is set
//! down. Built with `--cfg planted`, it is lanes@1's planted library: a vehicle takes a junction and
//! the zone after it whether or not another vehicle holds them.
//!
//! The state, `lanes.state@1`, and the built graph's bytes are laid out as LAYOUT.md says. The
//! library keeps everything in the caller's memory and calls nothing: a relocatable object of
//! functions only, built by scripts/lanes-pack.mjs:
//!
//! ```text
//! rustc --target wasm32-unknown-unknown --crate-type=lib --crate-name lanes --edition 2021
//!   --emit=obj -C opt-level=3 -C panic=abort -C target-cpu=mvp -C debuginfo=0
//!   -C target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint [--cfg planted] lanes.rs
//! ```

#![cfg_attr(target_arch = "wasm32", no_std)]
#![allow(clippy::missing_safety_doc, static_mut_refs)]

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

const INF: f64 = 1e300;
const PI: f64 = 3.141592653589793;
#[inline(always)]
fn mn(a: f64, b: f64) -> f64 {
    if a < b {
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
#[inline(always)]
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
/// atan z for |z| ≤ tan(π/8), its series to z⁴⁵.
#[inline(always)]
fn atan_small(z: f64) -> f64 {
    let z2 = z * z;
    let mut s = 1.0 / 45.0;
    let mut n = 22;
    while n > 0 {
        n -= 1;
        s = 1.0 / (2 * n + 1) as f64 - z2 * s;
    }
    z * s
}
/// atan x for 0 ≤ x ≤ 1.
#[inline(always)]
fn atan_unit(x: f64) -> f64 {
    if x > 0.41421356237309503 {
        PI / 4.0 + atan_small((x - 1.0) / (x + 1.0))
    } else {
        atan_small(x)
    }
}
#[inline(never)]
fn atan2(y: f64, x: f64) -> f64 {
    let (ax, ay) = (ab(x), ab(y));
    if ax == 0.0 && ay == 0.0 {
        return 0.0;
    }
    let a = if ay <= ax { atan_unit(ay / ax) } else { PI / 2.0 - atan_unit(ax / ay) };
    let a = if x < 0.0 { PI - a } else { a };
    if y < 0.0 {
        -a
    } else {
        a
    }
}

// ---------------------------------------------------------------------------------------------
// The built graph (LAYOUT.md: The built graph), read through the state's copies of its section
// addresses; and the state's header (LAYOUT.md: lanes.state@1).

const VMAX: i32 = 64;
/// A route's most arcs, a vehicle's most held zones, a step's most speed segments ahead.
const RMAX: u32 = 256;
const HMAX: i32 = 32;
const SEG: u32 = 64;
const HEAD: u32 = 192;
const ROW: u32 = 152 + 8 * RMAX + 8 * (RMAX + 1) + 24 * HMAX as u32;

/// The graph's counts, as the state copies them: nodes, edges, arcs, zones and bays.
#[inline(always)]
fn nodes(s: u32) -> i32 {
    li(s + 8)
}
#[inline(always)]
fn bays(s: u32) -> i32 {
    li(s + 24)
}
/// The address of a graph section or a state area, as the state's header holds it.
#[inline(always)]
fn addr(s: u32, k: u32) -> u32 {
    li(s + 32 + 4 * k) as u32
}
const NODES: u32 = 0;
const EDGES: u32 = 1;
const ARCS: u32 = 2;
const ZONES: u32 = 3;
const BAYS: u32 = 4;
const POINTS: u32 = 5;
const OUT: u32 = 6;
const INC: u32 = 7;
const HOLD: u32 = 8;
const VEH: u32 = 9;
const BEST: u32 = 10;
const VIA: u32 = 11;
const DONE: u32 = 12;
const HEAP: u32 = 13;
const ENDS: u32 = 14;
const CAPS: u32 = 15;
const TMP: u32 = 16;
/// The vehicle kind's numbers, from S+112.
#[inline(always)]
fn kind(s: u32, k: u32) -> f64 {
    lf(s + 112 + 8 * k)
}
const LENGTH: u32 = 0;
const SPEED: u32 = 3;
const ACCEL: u32 = 4;
const DECEL: u32 = 5;
const LIFT_MAX: u32 = 6;
const LIFT_SPEED: u32 = 7;
#[inline(always)]
fn reach(s: u32) -> f64 {
    lf(s + 176)
}
#[inline(always)]
fn half(s: u32) -> f64 {
    lf(s + 184)
}

#[inline(always)]
fn node(s: u32, n: i32) -> u32 {
    addr(s, NODES) + 32 * n as u32
}
#[inline(always)]
fn jzone(s: u32, n: i32) -> i32 {
    li(node(s, n) + 20)
}
#[inline(always)]
fn edge(s: u32, e: i32) -> u32 {
    addr(s, EDGES) + 48 * e as u32
}
#[inline(always)]
fn e_len(s: u32, e: i32) -> f64 {
    lf(edge(s, e) + 32)
}
#[inline(always)]
fn e_limit(s: u32, e: i32) -> f64 {
    lf(edge(s, e) + 40)
}
#[inline(always)]
fn e_zfirst(s: u32, e: i32) -> i32 {
    li(edge(s, e) + 12)
}
#[inline(always)]
fn e_zcount(s: u32, e: i32) -> i32 {
    li(edge(s, e) + 16)
}
#[inline(always)]
fn arc(s: u32, a: i32) -> u32 {
    addr(s, ARCS) + 24 * a as u32
}
#[inline(always)]
fn a_edge(s: u32, a: i32) -> i32 {
    li(arc(s, a))
}
#[inline(always)]
fn a_back(s: u32, a: i32) -> bool {
    li(arc(s, a) + 4) != 0
}
#[inline(always)]
fn a_from(s: u32, a: i32) -> i32 {
    li(arc(s, a) + 8)
}
#[inline(always)]
fn a_to(s: u32, a: i32) -> i32 {
    li(arc(s, a) + 12)
}
#[inline(always)]
fn zone(s: u32, z: i32) -> u32 {
    addr(s, ZONES) + 24 * z as u32
}
#[inline(always)]
fn bay(s: u32, b: i32) -> u32 {
    addr(s, BAYS) + 32 * b as u32
}
#[inline(always)]
fn holder(s: u32, z: i32) -> i32 {
    li(addr(s, HOLD) + 4 * z as u32)
}
#[inline(always)]
fn set_holder(s: u32, z: i32, v: i32) {
    si(addr(s, HOLD) + 4 * z as u32, v)
}

// A vehicle's row (LAYOUT.md: Vehicle rows).
#[inline(always)]
fn row(s: u32, v: i32) -> u32 {
    addr(s, VEH) + ROW * v as u32
}
const C: u32 = 0;
const V: u32 = 8;
const X: u32 = 16;
const Y: u32 = 24;
const HEADING: u32 = 32;
const HX: u32 = 40;
const HY: u32 = 48;
const FORK: u32 = 56;
const FORK_TO: u32 = 64;
const LOAD: u32 = 72;
const L: u32 = 96;
const AT_NODE: u32 = 104;
const NROUTE: u32 = 108;
const KARC: u32 = 112;
const CARRYING: u32 = 116;
const WAITS_ON: u32 = 120;
const WAIT_ZONE: u32 = 124;
const Q: u32 = 128;
const QK: u32 = 132;
const NSLOTS: u32 = 136;
const NHELD: u32 = 140;
const GOAL: u32 = 144;
const ARCS_AT: u32 = 152;
const ZBASE_AT: u32 = 152 + 4 * RMAX;
const OFFSETS_AT: u32 = 152 + 8 * RMAX;
const HELD_AT: u32 = 152 + 8 * RMAX + 8 * (RMAX + 1);
#[inline(always)]
fn r_arc(r: u32, k: i32) -> i32 {
    li(r + ARCS_AT + 4 * k as u32)
}
#[inline(always)]
fn r_zbase(r: u32, k: i32) -> i32 {
    li(r + ZBASE_AT + 4 * k as u32)
}
#[inline(always)]
fn r_off(r: u32, k: i32) -> f64 {
    lf(r + OFFSETS_AT + 8 * k as u32)
}
#[inline(always)]
fn held(r: u32, i: i32) -> u32 {
    r + HELD_AT + 24 * i as u32
}

// ---------------------------------------------------------------------------------------------
// Zones along a route: slot 0 is the start node's junction; then each arc's own zones in travel
// order and the node it ends at (a junction's zone, or at the goal of degree 2 the other path's
// zone its footprint reaches). Positions are along the route, from its start node.

/// Slot q (of arc k): its zone (−1 for an empty slot), where it starts and ends, and whether it is
/// a junction.
#[inline(always)]
fn slot(s: u32, r: u32, q: i32, k: i32) -> (i32, f64, f64, bool) {
    let rr = reach(s);
    if q == 0 {
        let z = jzone(s, a_from(s, r_arc(r, 0)));
        return (z, -rr, rr, z >= 0);
    }
    let a = r_arc(r, k);
    let e = a_edge(s, a);
    let back = a_back(s, a);
    let nz = e_zcount(s, e);
    let j = q - r_zbase(r, k);
    let off = r_off(r, k);
    let len = e_len(s, e);
    if j < nz {
        let z = e_zfirst(s, e) + if back { nz - 1 - j } else { j };
        let (za, zb) = (lf(zone(s, z) + 8), lf(zone(s, z) + 16));
        return if back { (z, off + len - zb, off + len - za, false) } else { (z, off + za, off + zb, false) };
    }
    let n = a_to(s, a);
    let end = off + len;
    let jz = jzone(s, n);
    if jz >= 0 {
        return (jz, end - rr, end + rr, true);
    }
    if k == li(r + NROUTE) - 1 && li(node(s, n) + 16) == 2 {
        let arrive = if back { 0 } else { 1 };
        let base = addr(s, INC);
        let nn = nodes(s);
        let mut i = li(base + 4 * n as u32);
        let stop = li(base + 4 * (n + 1) as u32);
        while i < stop {
            let ent = li(base + 4 * (nn + 1 + i) as u32);
            let (e2, end2) = (ent >> 1, ent & 1);
            if !(e2 == e && end2 == arrive) {
                if end2 == 0 {
                    let z = e_zfirst(s, e2);
                    return (z, end + lf(zone(s, z) + 8), end + lf(zone(s, z) + 16), false);
                }
                let z = e_zfirst(s, e2) + e_zcount(s, e2) - 1;
                let l2 = e_len(s, e2);
                return (z, end + l2 - lf(zone(s, z) + 16), end + l2 - lf(zone(s, z) + 8), false);
            }
            i += 1;
        }
    }
    (-1, 0.0, 0.0, false)
}

/// The slot after q (of arc k), and its arc.
#[inline(always)]
fn next(s: u32, r: u32, q: i32, k: i32) -> (i32, i32) {
    if q == 0 {
        return (1, 0);
    }
    let last = r_zbase(r, k) + e_zcount(s, a_edge(s, r_arc(r, k)));
    if q + 1 > last {
        (q + 1, k + 1)
    } else {
        (q + 1, k)
    }
}

/// Where the first zone at or after the cursor starts, or INF when none is left.
#[inline(always)]
fn cursor_from(s: u32, r: u32) -> f64 {
    let (mut q, mut k) = (li(r + Q), li(r + QK));
    let ns = li(r + NSLOTS);
    while q < ns {
        let (z, from, _, _) = slot(s, r, q, k);
        if z >= 0 {
            return from;
        }
        (q, k) = next(s, r, q, k);
    }
    INF
}

/// Vehicle v holds zone z, from `from` to `to` along its route.
#[inline(never)]
fn hold(s: u32, r: u32, v: i32, z: i32, from: f64, to: f64) {
    set_holder(s, z, v);
    let n = li(r + NHELD);
    let mut i = 0;
    while i < n {
        if li(held(r, i)) == z {
            sf(held(r, i) + 8, from);
            sf(held(r, i) + 16, to);
            return;
        }
        i += 1;
    }
    if n < HMAX {
        si(held(r, n), z);
        sf(held(r, n) + 8, from);
        sf(held(r, n) + 16, to);
        si(r + NHELD, n + 1);
    }
}

/// Drops held entry i, giving its zone back if v still holds it.
#[inline(always)]
fn drop_held(s: u32, r: u32, v: i32, i: i32) {
    let z = li(held(r, i));
    if holder(s, z) == v {
        set_holder(s, z, -1);
    }
    let n = li(r + NHELD) - 1;
    si(held(r, i), li(held(r, n)));
    sf(held(r, i) + 8, lf(held(r, n) + 8));
    sf(held(r, i) + 16, lf(held(r, n) + 16));
    si(r + NHELD, n);
}

#[inline(always)]
fn free_for(s: u32, z: i32, v: i32) -> bool {
    let h = holder(s, z);
    h < 0 || h == v
}

/// Vehicle v asks, in route order, for each next zone whose start lies within `h` of its front: a
/// junction only together with the zone after it, both or neither. True when an ask fails: it
/// then waits on the zone's holder.
#[inline(never)]
fn ask(s: u32, v: i32, h: f64) -> bool {
    let r = row(s, v);
    si(r + WAITS_ON, -1);
    si(r + WAIT_ZONE, -1);
    let front = lf(r + C) + half(s);
    let ns = li(r + NSLOTS);
    loop {
        let (q, k) = (li(r + Q), li(r + QK));
        if q >= ns {
            return false;
        }
        let (z, from, to, junction) = slot(s, r, q, k);
        if z < 0 {
            let (q2, k2) = next(s, r, q, k);
            si(r + Q, q2);
            si(r + QK, k2);
            continue;
        }
        if from > front + h {
            return false;
        }
        let (mut q2, mut k2) = next(s, r, q, k);
        let mut after = (-1, 0.0, 0.0);
        if junction {
            while q2 < ns {
                let (z2, f2, t2, _) = slot(s, r, q2, k2);
                if z2 >= 0 {
                    after = (z2, f2, t2);
                    break;
                }
                (q2, k2) = next(s, r, q2, k2);
            }
        }
        let ok1 = free_for(s, z, v);
        let ok2 = after.0 < 0 || free_for(s, after.0, v);
        #[cfg(planted)]
        let (ok1, ok2) = if junction { (true, true) } else { (ok1, ok2) };
        if !(ok1 && ok2) {
            let (zz, hh) = if ok1 { (after.0, holder(s, after.0)) } else { (z, holder(s, z)) };
            si(r + WAITS_ON, hh);
            si(r + WAIT_ZONE, zz);
            return true;
        }
        hold(s, r, v, z, from, to);
        if after.0 >= 0 {
            hold(s, r, v, after.0, after.1, after.2);
            (q2, k2) = next(s, r, q2, k2);
        }
        si(r + Q, q2);
        si(r + QK, k2);
    }
}

// ---------------------------------------------------------------------------------------------
// Motion within a step: speed up at accel, hold the limit, slow down at decel so the speed is
// within every limit ahead and zero at the stop point, each phase in closed form.

const EPS: f64 = 1e-12;

/// Advances (x, v) by dt over segments ahead of x: cap i holds up to end i, the last end the stop.
#[inline(never)]
fn advance(s: u32, n: u32, a: f64, b: f64, mut x: f64, mut v: f64, dt: f64) -> f64 {
    let (ends, caps) = (addr(s, ENDS), addr(s, CAPS));
    let end = |i: u32| lf(ends + 8 * i);
    let cap = |i: u32| lf(caps + 8 * i);
    let stop = end(n - 1);
    let mut tau = dt;
    let mut guard = 0;
    while tau > 0.0 && guard < 64 {
        guard += 1;
        if x >= stop - EPS && v <= EPS {
            x = stop;
            v = 0.0;
            break;
        }
        let mut i = 0;
        while i + 1 < n && end(i) <= x + EPS {
            i += 1;
        }
        let c = cap(i);
        // The binding limit: the earliest braking start among the limits ahead.
        let (mut brake_at, mut brake_to, mut brake_x) = (INF, 0.0, stop);
        let mut j = i;
        while j < n {
            let (cx, cv) = if j + 1 < n { (end(j), cap(j + 1)) } else { (stop, 0.0) };
            if !(j + 1 < n && cv >= v) {
                let start = cx - (v * v - cv * cv) / (2.0 * b);
                if start < brake_at {
                    brake_at = start;
                    brake_to = cv;
                    brake_x = cx;
                }
            }
            j += 1;
        }
        if brake_at <= x + 1e-9 && v > brake_to {
            let t = (v - brake_to) / b;
            if t >= tau {
                x += v * tau - 0.5 * b * tau * tau;
                v -= b * tau;
                tau = 0.0;
            } else {
                x = brake_x;
                v = brake_to;
                tau -= t;
            }
            continue;
        }
        if v < c - EPS {
            // Speed up: until the cap, the segment's end or a limit's braking curve.
            let mut t = mn((c - v) / a, tau);
            let mut hits = if (c - v) / a <= tau { 1 } else { 0 };
            let mut j = i;
            while j < n {
                let (cx, cv) = if j + 1 < n { (end(j), cap(j + 1)) } else { (stop, 0.0) };
                let xs = (cv * cv - v * v + 2.0 * a * x + 2.0 * b * cx) / (2.0 * (a + b));
                if xs > x {
                    let tc = (sqrt(v * v + 2.0 * a * (xs - x)) - v) / a;
                    if tc < t {
                        t = tc;
                        hits = 2;
                    }
                }
                j += 1;
            }
            if i + 1 < n {
                let te = (sqrt(v * v + 2.0 * a * (end(i) - x)) - v) / a;
                if te < t {
                    t = te;
                    hits = 3;
                }
            }
            x += v * t + 0.5 * a * t * t;
            v += a * t;
            if hits == 1 {
                v = c;
            }
            if hits == 3 {
                x = end(i);
            }
            tau -= t;
            continue;
        }
        // Hold the limit: until a braking start or the segment's end.
        v = mn(v, c);
        let mut t = tau;
        if v > EPS {
            if brake_at > x {
                t = mn(t, (brake_at - x) / v);
            }
            if i + 1 < n {
                t = mn(t, (end(i) - x) / v);
            }
        }
        x += v * t;
        if i + 1 < n && ab(end(i) - x) < EPS {
            x = end(i);
        }
        tau -= t;
        if v <= EPS {
            break;
        }
    }
    if x >= stop - 1e-9 && v < 1e-9 || x > stop {
        x = stop;
        v = 0.0;
    }
    sf(s + 104, v);
    x
}

/// The arc of vehicle row r whose stretch holds route position p.
#[inline(always)]
fn arc_at(r: u32, from: i32, p: f64) -> i32 {
    let n = li(r + NROUTE);
    let mut k = from;
    while k + 1 < n && p >= r_off(r, k + 1) {
        k += 1;
    }
    k
}

/// Puts vehicle row r at its route position: its centre and, when `turn`, its heading.
#[inline(never)]
fn place(s: u32, r: u32, turn: bool) {
    let c = lf(r + C);
    let k = arc_at(r, li(r + KARC), c);
    si(r + KARC, k);
    let a = r_arc(r, k);
    let e = a_edge(s, a);
    let back = a_back(s, a);
    let len = e_len(s, e);
    let d = c - r_off(r, k);
    let along = if back { len - d } else { d };
    let along = if along < 0.0 { 0.0 } else if along > len { len } else { along };
    let ea = edge(s, e);
    let (first, n) = (li(ea + 20), li(ea + 24));
    let pts = addr(s, POINTS);
    let pt = |i: i32| pts + 24 * i as u32;
    let mut i = first;
    while i + 2 < first + n && lf(pt(i + 1) + 16) < along {
        i += 1;
    }
    let (ax, ay, ac) = (lf(pt(i)), lf(pt(i) + 8), lf(pt(i) + 16));
    let (bx, by, bc) = (lf(pt(i + 1)), lf(pt(i + 1) + 8), lf(pt(i + 1) + 16));
    let seg = bc - ac;
    let f = if seg > 0.0 { (along - ac) / seg } else { 0.0 };
    sf(r + X, ax + (bx - ax) * f);
    sf(r + Y, ay + (by - ay) * f);
    if turn && seg > 0.0 {
        let sign = if back { -1.0 } else { 1.0 };
        let (hx, hy) = (sign * (bx - ax) / seg, sign * (by - ay) / seg);
        sf(r + HX, hx);
        sf(r + HY, hy);
        sf(r + HEADING, atan2(hy, hx));
    }
}

/// Vehicle v's move: toward its stop point, then its releases and, at rest at its goal, its arrival.
#[inline(never)]
fn drive(s: u32, v: i32, dt: f64) {
    let r = row(s, v);
    let c = lf(r + C);
    let sp = lf(r + V);
    let total = lf(r + L);
    let hf = half(s);
    let stop = mn(total, cursor_from(s, r) - hf);
    let n = li(r + NROUTE);
    let mut x = c;
    if stop - c > EPS || sp > EPS {
        if stop - c <= EPS {
            sf(r + V, 0.0);
        } else {
            let (ends, caps) = (addr(s, ENDS), addr(s, CAPS));
            let top = kind(s, SPEED);
            let mut k = li(r + KARC);
            let mut m: u32 = 0;
            loop {
                let lim = e_limit(s, a_edge(s, r_arc(r, k)));
                sf(caps + 8 * m, mn(top, lim));
                let e = r_off(r, k + 1) - c;
                if stop - c <= e + EPS || k + 1 >= n || m + 1 >= SEG {
                    sf(ends + 8 * m, stop - c);
                    m += 1;
                    break;
                }
                sf(ends + 8 * m, e);
                m += 1;
                k += 1;
            }
            let dx = advance(s, m, kind(s, ACCEL), kind(s, DECEL), 0.0, sp, dt);
            x = c + dx;
            sf(r + C, x);
            sf(r + V, lf(s + 104));
            place(s, r, dx > 0.0);
        }
    }
    // Release each zone its rear has passed the end of.
    let rear = x - hf;
    let mut i = 0;
    while i < li(r + NHELD) {
        if rear >= lf(held(r, i) + 16) - 1e-9 {
            drop_held(s, r, v, i);
        } else {
            i += 1;
        }
    }
    if x >= total - 1e-9 && lf(r + V) == 0.0 {
        let goal = li(r + GOAL);
        si(r + NROUTE, 0);
        si(r + AT_NODE, goal);
        si(r + WAITS_ON, -1);
        si(r + WAIT_ZONE, -1);
        sf(r + X, lf(node(s, goal)));
        sf(r + Y, lf(node(s, goal) + 8));
        let mut i = 0;
        while i < li(r + NHELD) {
            sf(held(r, i) + 8, -INF);
            sf(held(r, i) + 16, INF);
            i += 1;
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Routes: the quickest by length ÷ limit, ties broken by edge ID, over a binary heap.

#[inline(always)]
fn heap_less(h: u32, i: u32, j: u32) -> bool {
    let (ti, tj) = (lf(h + 16 * i), lf(h + 16 * j));
    ti < tj || (ti == tj && li(h + 16 * i + 8) < li(h + 16 * j + 8))
}
#[inline(always)]
fn heap_swap(h: u32, i: u32, j: u32) {
    let (ti, ni) = (lf(h + 16 * i), li(h + 16 * i + 8));
    sf(h + 16 * i, lf(h + 16 * j));
    si(h + 16 * i + 8, li(h + 16 * j + 8));
    sf(h + 16 * j, ti);
    si(h + 16 * j + 8, ni);
}

/// The quickest time from node `from` to node `to`, never through edge `avoid_edge` or into node
/// `avoid_node`, or −1; each node's arc in is left in the search's `via`.
#[inline(never)]
fn search(s: u32, from: i32, to: i32, avoid_edge: i32, avoid_node: i32) -> f64 {
    let nn = nodes(s);
    let (best, via, done, h) = (addr(s, BEST), addr(s, VIA), addr(s, DONE), addr(s, HEAP));
    let (out, cap) = (addr(s, OUT), li(s + 100) as u32);
    let mut i = 0;
    while i < nn {
        sf(best + 8 * i as u32, INF);
        si(via + 4 * i as u32, -1);
        si(done + 4 * i as u32, 0);
        i += 1;
    }
    sf(best + 8 * from as u32, 0.0);
    sf(h, 0.0);
    si(h + 8, from);
    let mut size: u32 = 1;
    while size > 0 {
        let (t, u) = (lf(h), li(h + 8));
        size -= 1;
        if size > 0 {
            sf(h, lf(h + 16 * size));
            si(h + 8, li(h + 16 * size + 8));
            let mut p = 0;
            loop {
                let (l, rt) = (2 * p + 1, 2 * p + 2);
                let mut m = p;
                if l < size && heap_less(h, l, m) {
                    m = l;
                }
                if rt < size && heap_less(h, rt, m) {
                    m = rt;
                }
                if m == p {
                    break;
                }
                heap_swap(h, p, m);
                p = m;
            }
        }
        if li(done + 4 * u as u32) != 0 {
            continue;
        }
        si(done + 4 * u as u32, 1);
        if u == to {
            return t;
        }
        let (mut j, stop) = (li(out + 4 * u as u32), li(out + 4 * (u + 1) as u32));
        while j < stop {
            let a = li(out + 4 * (nn + 1 + j) as u32);
            j += 1;
            let e = a_edge(s, a);
            let w = a_to(s, a);
            if e == avoid_edge || w == avoid_node || li(done + 4 * w as u32) != 0 {
                continue;
            }
            let nt = t + lf(arc(s, a) + 16);
            let b = lf(best + 8 * w as u32);
            let was = li(via + 4 * w as u32);
            if nt < b || (nt == b && was >= 0 && e < a_edge(s, was)) {
                sf(best + 8 * w as u32, nt);
                si(via + 4 * w as u32, a);
                if size < cap {
                    sf(h + 16 * size, nt);
                    si(h + 16 * size + 8, w);
                    let mut c = size;
                    size += 1;
                    while c > 0 {
                        let p = (c - 1) >> 1;
                        if !heap_less(h, c, p) {
                            break;
                        }
                        heap_swap(h, c, p);
                        c = p;
                    }
                }
            }
        }
    }
    -1.0
}

/// Vehicle row r's route: its first `keep` arcs, then the search's arcs to `goal`; false when it
/// would pass RMAX arcs.
#[inline(never)]
fn set_route(s: u32, r: u32, keep: i32, goal: i32) -> bool {
    let (via, tmp) = (addr(s, VIA), addr(s, TMP));
    let mut n = 0;
    let mut u = goal;
    loop {
        let a = li(via + 4 * u as u32);
        if a < 0 {
            break;
        }
        if keep + n + 1 >= RMAX as i32 {
            return false;
        }
        si(tmp + 4 * n as u32, a);
        n += 1;
        u = a_from(s, a);
    }
    let mut i = 0;
    while i < n {
        si(r + ARCS_AT + 4 * (keep + i) as u32, li(tmp + 4 * (n - 1 - i) as u32));
        i += 1;
    }
    let total = keep + n;
    si(r + NROUTE, total);
    sf(r + OFFSETS_AT, 0.0);
    si(r + ZBASE_AT, 1);
    let mut k = 0;
    while k < total {
        let e = a_edge(s, r_arc(r, k));
        sf(r + OFFSETS_AT + 8 * (k + 1) as u32, r_off(r, k) + e_len(s, e));
        si(r + ZBASE_AT + 4 * (k + 1) as u32, r_zbase(r, k) + e_zcount(s, e) + 1);
        k += 1;
    }
    si(r + NSLOTS, r_zbase(r, total));
    sf(r + L, r_off(r, total));
    si(r + GOAL, goal);
    true
}

/// The loop's lowest-ID vehicle m takes its next quickest route that avoids the zone it waits
/// for, from the end of the path its front is on, to its goal; false (nothing changes) when none.
#[inline(never)]
fn reroute(s: u32, m: i32) -> bool {
    let r = row(s, m);
    let avoid = li(r + WAIT_ZONE);
    let front = lf(r + C) + half(s);
    let k = arc_at(r, li(r + KARC), front - 1e-9);
    let a = r_arc(r, k);
    let from = a_to(s, a);
    let (mut avoid_edge, mut avoid_node) = (-1, -1);
    if avoid >= 0 {
        let za = zone(s, avoid);
        if li(za) == 0 {
            avoid_edge = li(za + 4);
        } else {
            avoid_node = li(za + 4);
        }
    }
    // A zone on the path it is on, or the junction at its end, can't be avoided from there.
    if avoid_edge == a_edge(s, a) || avoid_node == from {
        return false;
    }
    let goal = li(r + GOAL);
    if search(s, from, goal, avoid_edge, avoid_node) < 0.0 || !set_route(s, r, k + 1, goal) {
        return false;
    }
    resume(s, m);
    true
}

/// Vehicle m, its route changed ahead of its front: what it reserved ahead of its front is given
/// back, and it asks again from the zone its front is in.
#[inline(never)]
fn resume(s: u32, m: i32) {
    let r = row(s, m);
    let front = lf(r + C) + half(s);
    let mut i = 0;
    while i < li(r + NHELD) {
        if lf(held(r, i) + 8) >= front - 1e-9 {
            drop_held(s, r, m, i);
        } else {
            i += 1;
        }
    }
    let ns = li(r + NSLOTS);
    let (mut q, mut qk) = (0, 0);
    while q < ns {
        let (z, _, to, _) = slot(s, r, q, qk);
        if z >= 0 && to > front + 1e-9 {
            break;
        }
        (q, qk) = next(s, r, q, qk);
    }
    si(r + Q, q);
    si(r + QK, qk);
    si(r + WAITS_ON, -1);
    si(r + WAIT_ZONE, -1);
}

// ---------------------------------------------------------------------------------------------
// lanes@1's exports.

/// Starts the lane state at `s` from the built graph at `g`: zones cut, none held, no vehicles;
/// returns the state's size in bytes.
#[no_mangle]
pub unsafe extern "C" fn graph(s: i32, g: i32) -> i32 {
    let (s, g) = (s as u32, g as u32);
    si(s, g as i32);
    si(s + 4, 0);
    // The counts (N, E, A, Z, B), then each graph section's address.
    let mut k = 1;
    while k <= 5 {
        si(s + 4 + 4 * k, li(g + 4 * k));
        k += 1;
    }
    let mut k = 0;
    while k < 8 {
        si(s + 32 + 4 * k, (g + li(g + 32 + 4 * k) as u32) as i32);
        k += 1;
    }
    let mut k = 0;
    while k < 8 {
        sf(s + 112 + 8 * k, lf(g + 64 + 8 * k));
        k += 1;
    }
    sf(s + 176, (kind(s, LENGTH) + lf(g + 64 + 16)) / 2.0);
    sf(s + 184, kind(s, LENGTH) / 2.0);
    let (nn, na, nz) = (li(s + 8) as u32, li(s + 16) as u32, li(s + 20) as u32);
    let align = |x: u32| (x + 7) & !7;
    let hold = s + HEAD;
    let veh = align(hold + 4 * nz);
    let best = veh + ROW * VMAX as u32;
    let via = best + 8 * nn;
    let done = via + 4 * nn;
    let heap = align(done + 4 * nn);
    let cap = na + nn + 1;
    let ends = heap + 16 * cap;
    let caps = ends + 8 * SEG;
    let tmp = caps + 8 * SEG;
    let size = align(tmp + 4 * RMAX) - s;
    for (i, x) in [hold, veh, best, via, done, heap, ends, caps, tmp].iter().enumerate() {
        si(s + 32 + 4 * (8 + i as u32), *x as i32);
    }
    si(s + 100, cap as i32);
    si(s + 28, size as i32);
    let mut z = 0;
    while z < nz {
        si(hold + 4 * z, -1);
        z += 1;
    }
    size as i32
}

/// Places a vehicle of the item's kind at rest at bay `b`, its centre on the bay's node, holding
/// the zones its footprint covers; returns its ID, or −1.
#[no_mangle]
pub unsafe extern "C" fn vehicle(s: i32, b: i32) -> i32 {
    let s = s as u32;
    let v = li(s + 4);
    if v >= VMAX || b < 0 || b >= bays(s) {
        return -1;
    }
    let r = row(s, v);
    let ba = bay(s, b);
    let n = li(ba);
    let mut k = 0;
    while k < 19 {
        sf(r + 8 * k, 0.0);
        k += 1;
    }
    sf(r + X, lf(node(s, n)));
    sf(r + Y, lf(node(s, n) + 8));
    sf(r + HEADING, lf(ba + 8));
    sf(r + HX, lf(ba + 16));
    sf(r + HY, lf(ba + 24));
    si(r + AT_NODE, n);
    si(r + WAITS_ON, -1);
    si(r + WAIT_ZONE, -1);
    si(r + GOAL, n);
    si(r + NHELD, 0);
    let hf = half(s);
    let take = |z: i32| {
        if holder(s, z) < 0 {
            hold(s, r, v, z, -INF, INF);
        }
    };
    if jzone(s, n) >= 0 {
        take(jzone(s, n));
    }
    let base = addr(s, INC);
    let nn = nodes(s);
    let (mut i, stop) = (li(base + 4 * n as u32), li(base + 4 * (n + 1) as u32));
    while i < stop {
        let ent = li(base + 4 * (nn + 1 + i) as u32);
        i += 1;
        let (e, end) = (ent >> 1, ent & 1);
        let (first, nz, len) = (e_zfirst(s, e), e_zcount(s, e), e_len(s, e));
        let mut j = 0;
        while j < nz {
            let z = if end == 0 { first + j } else { first + nz - 1 - j };
            let covers = if end == 0 { lf(zone(s, z) + 8) < hf - 1e-6 } else { lf(zone(s, z) + 16) > len - hf + 1e-6 };
            if !covers {
                break;
            }
            take(z);
            j += 1;
        }
    }
    si(s + 4, v + 1);
    v
}

/// The quickest time from bay `from` to bay `to`, or −1 when none; changes nothing.
#[no_mangle]
pub unsafe extern "C" fn route(s: i32, from: i32, to: i32) -> f64 {
    let s = s as u32;
    let nb = bays(s);
    if from < 0 || from >= nb || to < 0 || to >= nb {
        return -1.0;
    }
    search(s, li(bay(s, from)), li(bay(s, to)), -1, -1)
}

/// Advances the world dt seconds: each vehicle in ID order asks, breaks a loop its ask closed,
/// moves and releases; then the forks move; then the arrays are written at `out`.
#[no_mangle]
pub unsafe extern "C" fn go(s: i32, dt: f64, out: i32) {
    let (s, out) = (s as u32, out as u32);
    let nv = li(s + 4);
    let top = kind(s, SPEED);
    let h = top * dt + top * top / (2.0 * kind(s, DECEL));
    let mut v = 0;
    while v < nv {
        let r = row(s, v);
        if li(r + NROUTE) > 0 {
            if ask(s, v, h) {
                // A loop of vehicles each waiting on the next, closed by this ask.
                let mut x = li(r + WAITS_ON);
                let (mut low, mut n, mut closed) = (v, 0, false);
                while x >= 0 && n <= nv {
                    if x == v {
                        closed = true;
                        break;
                    }
                    if x < low {
                        low = x;
                    }
                    x = li(row(s, x) + WAITS_ON);
                    n += 1;
                }
                if closed && reroute(s, low) && low == v {
                    ask(s, v, h);
                }
            }
            drive(s, v, dt);
        }
        v += 1;
    }
    let lift = kind(s, LIFT_SPEED) * dt;
    let hf = half(s);
    let un = nv as u32;
    let (heading, speed, state) = (out + 16 * un, out + 24 * un, out + 32 * un);
    let fork = state + ((4 * un + 7) & !7);
    let load = fork + 8 * un;
    let mut v = 0;
    while v < nv {
        let r = row(s, v);
        let (f, to) = (lf(r + FORK), lf(r + FORK_TO));
        let d = to - f;
        let f = if ab(d) <= lift + 1e-9 { to } else if d > 0.0 { f + lift } else { f - lift };
        sf(r + FORK, f);
        let sp = lf(r + V);
        let st = if sp > 0.0 {
            1
        } else if f != to {
            if to > f {
                3
            } else {
                4
            }
        } else if li(r + NROUTE) > 0 {
            2
        } else {
            0
        };
        let u = v as u32;
        sf(out + 16 * u, lf(r + X));
        sf(out + 16 * u + 8, lf(r + Y));
        sf(heading + 8 * u, lf(r + HEADING));
        sf(speed + 8 * u, sp);
        si(state + 4 * u, st);
        sf(fork + 8 * u, f);
        if li(r + CARRYING) != 0 {
            sf(r + LOAD, lf(r + X) + hf * lf(r + HX));
            sf(r + LOAD + 8, f);
            sf(r + LOAD + 16, lf(r + Y) + hf * lf(r + HY));
        }
        sf(load + 24 * u, lf(r + LOAD));
        sf(load + 24 * u + 8, lf(r + LOAD + 8));
        sf(load + 24 * u + 16, lf(r + LOAD + 16));
        v += 1;
    }
}

/// Sets vehicle v's forks moving toward height h, clamped to [0, max], from its next `go`.
#[no_mangle]
pub unsafe extern "C" fn lift(s: i32, v: i32, h: f64) {
    let s = s as u32;
    if v < 0 || v >= li(s + 4) {
        return;
    }
    let max = kind(s, LIFT_MAX);
    let h = if h > max { max } else if h > 0.0 { h } else { 0.0 };
    sf(row(s, v) + FORK_TO, h);
}

/// Vehicle v takes a load onto its forks.
#[no_mangle]
pub unsafe extern "C" fn carry(s: i32, v: i32) {
    let s = s as u32;
    if v >= 0 && v < li(s + 4) {
        si(row(s, v) + CARRYING, 1);
    }
}

/// Vehicle v sets its load down where its forks' point is; the load stays there.
#[no_mangle]
pub unsafe extern "C" fn set_down(s: i32, v: i32) {
    let s = s as u32;
    if v < 0 || v >= li(s + 4) {
        return;
    }
    let r = row(s, v);
    if li(r + CARRYING) != 0 {
        si(r + CARRYING, 0);
        let hf = half(s);
        sf(r + LOAD, lf(r + X) + hf * lf(r + HX));
        sf(r + LOAD + 8, lf(r + FORK));
        sf(r + LOAD + 16, lf(r + Y) + hf * lf(r + HY));
    }
}

/// Sends vehicle v along its quickest route from where it is to bay `b`, to park there; returns
/// the route's time, or −1 (no route; nothing changes).
#[no_mangle]
pub unsafe extern "C" fn park(s: i32, v: i32, b: i32) -> f64 {
    let s = s as u32;
    if v < 0 || v >= li(s + 4) || b < 0 || b >= bays(s) {
        return -1.0;
    }
    let r = row(s, v);
    let goal = li(bay(s, b));
    if li(r + NROUTE) > 0 {
        // On its way: from the end of the path its front is on.
        let front = lf(r + C) + half(s);
        let k = arc_at(r, li(r + KARC), front - 1e-9);
        let a = r_arc(r, k);
        let t = search(s, a_to(s, a), goal, -1, -1);
        if t < 0.0 || !set_route(s, r, k + 1, goal) {
            return -1.0;
        }
        resume(s, v);
        let left = r_off(r, k + 1) - lf(r + C);
        return t + left / e_limit(s, a_edge(s, a));
    }
    let start = li(r + AT_NODE);
    let t = search(s, start, goal, -1, -1);
    if t <= 0.0 {
        return t;
    }
    if !set_route(s, r, 0, goal) {
        return -1.0;
    }
    sf(r + C, 0.0);
    si(r + KARC, 0);
    si(r + Q, 0);
    si(r + QK, 0);
    // What its footprint holds at the start is behind its route until asked again on it.
    let mut i = 0;
    while i < li(r + NHELD) {
        sf(held(r, i) + 8, -INF);
        sf(held(r, i) + 16, 0.0);
        i += 1;
    }
    t
}
