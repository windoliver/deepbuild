//! circuit@2's reference library (#3604; canvas primitives: Logic: library interfaces):
//! circuit@1's nodes and parts (#1181), solved each step by the same nodal analysis, plus a
//! breaker, an RCD, a changeover and a transformer, inputs the item's own arrays drive, and number
//! fields a control or one of the item's arrays sets within a range. Every closed part is linear,
//! so each source frequency (DC is frequency 0) is one solve of the same matrix with that
//! frequency's sources as phasors of their rms values; each instant is the closed form at the
//! step's time, f × k ÷ per turns. The matrix is solved again only when the closed set or a set
//! value changes. A switch, a connector, a closed fuse or breaker, a changeover's joined way, an
//! RCD's closed poles, a transformer's windings, a source with no internal resistance and a
//! resistor of 0 Ω are branches of their own (modified nodal analysis).
//!
//! - A fuse heats as circuit@1's does and opens at the first step θ ≥ 1.
//! - A breaker's thermal element heats as θ' = ((i_rms ÷ rating)² − θ) ÷ τ at every step, open
//!   included (its current is then 0), and opens it at the start of the first step θ has reached
//!   its opening heat (1.69); its magnetic element opens it at the start of the step after one
//!   whose rms current reached the curve's multiple of its rating. A rising `reset_by` closes it
//!   with the heat it has.
//! - An RCD's residual is the rms of its two poles' currents summed, each from the supply side to
//!   the load side. Its count rises by the step's length ÷ max(0.2 s × rating ÷ residual, 0.01 s)
//!   on a step whose residual is at or above its rating and returns to 0 on any other; both poles
//!   open at the start of the first step the count has reached 1. Its test path, `test_r` from the
//!   load-side live to the supply-side neutral, conducts while `test_by` says so.
//! - A changeover joins `common` to `a` while its input is 0 and to `b` while it is nonzero.
//! - A transformer is ideal: the secondary's volts are the primary's × n2 ÷ n1, the primary's
//!   current the secondary's × n2 ÷ n1 against it, and it takes no power.
//! - A set value outside its range is held to the nearest end of it; one that isn't finite keeps
//!   the last.
//!
//! Built with `--cfg no_magnetic` it is the planted library whose breakers have no magnetic
//! element; `--cfg cold_reset`, the one whose reset breaker closes cold; `--cfg one_pole`, the one
//! whose RCD reads its live pole alone; `--cfg both_ways`, the one whose changeover joins both ways
//! for the step its input changes; `--cfg primary_current`, the one whose transformer's primary
//! carries the secondary's current; `--cfg late_set`, the one that reads a set value a step late;
//! `--cfg late_fuse`, the one whose fuses open at ten times their curve's time.
//!
//! The state, `circuit.state@2`, and the built table's bytes are laid out as LAYOUT.md says. The
//! library keeps everything in the caller's memory and calls nothing: a relocatable object of
//! functions only, built by scripts/circuit2-pack.mjs.

#![cfg_attr(target_arch = "wasm32", no_std)]
#![allow(
    clippy::missing_safety_doc,
    clippy::too_many_arguments,
    clippy::needless_range_loop,
    unexpected_cfgs,
    clippy::manual_range_contains
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
#[inline(always)]
fn ll(a: u32) -> i64 {
    unsafe { (at(a) as *const i64).read_unaligned() }
}
#[inline(always)]
fn sl(a: u32, x: i64) {
    unsafe { (at(a) as *mut i64).write_unaligned(x) }
}

// ---------------------------------------------------------------------------------------------
// Numbers, by plain IEEE operations only, so every host gives the same bits.

#[inline(always)]
fn ab(x: f64) -> f64 {
    if x < 0.0 {
        -x
    } else {
        x
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
fn floor(x: f64) -> f64 {
    let t = x as i64 as f64;
    if t > x {
        t - 1.0
    } else {
        t
    }
}

const PI: f64 = core::f64::consts::PI;
const S1: f64 = -1.66666666666666324348e-01;
const S2: f64 = 8.33333333332248946124e-03;
const S3: f64 = -1.98412698298579493134e-04;
const S4: f64 = 2.75573137070700676789e-06;
const S5: f64 = -2.50507602534068634195e-08;
const S6: f64 = 1.58969099521155010221e-10;
const C1: f64 = 4.16666666666666019037e-02;
const C2: f64 = -1.38888888888741095749e-03;
const C3: f64 = 2.48015872894767294178e-05;
const C4: f64 = -2.75573143513906633035e-07;
const C5: f64 = 2.08757232129817482790e-09;
const C6: f64 = -1.13596475577881948265e-11;

/// sin and cos of `u` turns: reduced exactly to the nearest quarter turn, then the kernels on
/// ±π/4 (their coefficients are the classic minimax ones, good to an ulp or so).
#[inline(always)]
fn sincos_turns(u: f64) -> (f64, f64) {
    let q4 = (u - floor(u)) * 4.0;
    let q = floor(q4 + 0.5);
    let x = (q4 - q) * (PI / 2.0);
    let z = x * x;
    let s = x + z * x * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
    let w = z * z;
    let r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
    let hz = 0.5 * z;
    let one = 1.0 - hz;
    let c = one + (((1.0 - one) - hz) + z * r);
    match (q as i64) & 3 {
        0 => (s, c),
        1 => (c, -s),
        2 => (-s, -c),
        _ => (-c, s),
    }
}

/// e^x for x ≤ 0: x = k ln 2 + r, |r| ≤ ln 2 ÷ 2, and the classic rational kernel for e^r.
fn exp_neg(x: f64) -> f64 {
    if x < -745.0 {
        return 0.0;
    }
    const LN2_HI: f64 = 6.93147180369123816490e-01;
    const LN2_LO: f64 = 1.90821492927058770002e-10;
    const INV_LN2: f64 = 1.44269504088896338700e+00;
    const P1: f64 = 1.66666666666666019037e-01;
    const P2: f64 = -2.77777777770155933842e-03;
    const P3: f64 = 6.61375632143793436117e-05;
    const P4: f64 = -1.65339022054652515390e-06;
    const P5: f64 = 4.13813679705723846039e-08;
    let k = floor(x * INV_LN2 + 0.5);
    let hi = x - k * LN2_HI;
    let lo = k * LN2_LO;
    let r = hi - lo;
    let z = r * r;
    let c = r - z * (P1 + z * (P2 + z * (P3 + z * (P4 + z * P5))));
    let y = 1.0 - ((lo - (r * c) / (2.0 - c)) - hi);
    let k = k as i64;
    if k < -1021 {
        // Subnormal: scale in two steps.
        y * f64::from_bits(((k + 1000 + 1023) as u64) << 52) * f64::from_bits(((1023 - 1000) as u64) << 52)
    } else {
        y * f64::from_bits(((k + 1023) as u64) << 52)
    }
}


// ---------------------------------------------------------------------------------------------
// The built table (LAYOUT.md: The built table), from `g`.

const SOURCE_DC: i32 = 1;
const SOURCE_AC: i32 = 2;
const RESISTOR: i32 = 3;
const LOAD: i32 = 4;
const SWITCH: i32 = 5;
const CONNECTOR: i32 = 6;
const FUSE: i32 = 7;
const METER: i32 = 8;
const WIRE: i32 = 9;
const FAULT: i32 = 10;
const BREAKER: i32 = 11;
const RCD: i32 = 12;
const CHANGEOVER: i32 = 13;
const TRANSFORMER: i32 = 14;

const NODES: u32 = 64;
const PARTS: u32 = 128;
const GROUPS: u32 = 8;
/// The most unknowns: every node but the reference, and two branches for every part.
const DIM: u32 = NODES - 1 + 2 * PARTS;
/// The elementary charge, C.
const E: f64 = 1.602176634e-19;
/// A part's bytes in the table.
const PART: u32 = 160;

#[inline(always)]
fn t_nodes(g: u32) -> u32 {
    li(g + 4) as u32
}
#[inline(always)]
fn t_parts(g: u32) -> u32 {
    li(g + 8) as u32
}
#[inline(always)]
fn part(g: u32, i: u32) -> u32 {
    g + li(g + 12) as u32 + PART * i
}
#[inline(always)]
fn kind(g: u32, i: u32) -> i32 {
    li(part(g, i))
}
/// Node j (0 to 3) of part i: `from`, `to`; a changeover's `common`, `a`, `b`; an RCD's live and
/// neutral poles and a transformer's windings, each `[from, to]`.
#[inline(always)]
fn nd(g: u32, i: u32, j: u32) -> i32 {
    li(part(g, i) + 4 + 4 * j)
}
#[inline(always)]
fn target(g: u32, i: u32) -> i32 {
    li(part(g, i) + 20)
}
#[inline(always)]
fn x(g: u32, i: u32, j: u32) -> f64 {
    lf(part(g, i) + 48 + 8 * j)
}

// ---------------------------------------------------------------------------------------------
// The state from `s`: the head (circuit.state@2's arrays), then the library's own.

#[inline(always)]
fn a8(n: u32) -> u32 {
    (n + 7) & !7
}
/// Each head array's offset from `s`, for n nodes and p parts.
#[derive(Clone, Copy)]
struct Head {
    v: u32,
    i_rms: u32,
    i: u32,
    p: u32,
    r: u32,
    on: u32,
    energy: u32,
    kwh: u32,
    drift: u32,
    drift_x: u32,
    heat: u32,
    residual: u32,
    i2_rms: u32,
    i2: u32,
}
fn head(n: u32, p: u32) -> Head {
    let v = 0;
    let i_rms = a8(v + 8 * n);
    let i = i_rms + 8 * p;
    let pw = i + 8 * p;
    let r = pw + 8 * p;
    let on = r + 8 * p;
    let energy = a8(on + 4 * p);
    let kwh = energy + 8 * p;
    let drift = kwh + 8 * p;
    let drift_x = drift + 8 * p;
    let heat = drift_x + 8 * p;
    let residual = heat + 8 * p;
    let i2_rms = residual + 8 * p;
    let i2 = i2_rms + 8 * p;
    Head { v, i_rms, i, p: pw, r, on, energy, kwh, drift, drift_x, heat, residual, i2_rms, i2 }
}

// The library's own, from `o = s + OWN_AT`:
//   +0 i32 ready (1 once a builder ran), +4 i32 nodes, +8 i32 parts, +12 i32 table address
//   +16 i32 valid (the closed set's solve is current), +20 i32 groups, +24 i32 singular
//   +32 i64 the step the closed set last changed, +40 i64 the last per, +48 i64 the last step solved
//   +64 the per-part arrays below, each PARTS long, then the groups', then the solve's.
const READY: u32 = 0;
const NN: u32 = 4;
const PP: u32 = 8;
const TABLE: u32 = 12;
const VALID: u32 = 16;
const NG: u32 = 20;
const SINGULAR: u32 = 24;
const K0: u32 = 32;
const PER: u32 = 40;
const LAST: u32 = 48;
const ADDED: u32 = 64; // i32 × PARTS: 1 once added
const NODE_ADDED: u32 = ADDED + 4 * PARTS; // i32 × NODES
const LATEST: u32 = NODE_ADDED + 4 * NODES; // f64 × PARTS × 3: each input's latest value
const RAW: u32 = LATEST + 24 * PARTS; // f64 × PARTS × 2: each set field's latest value as given
const VAL: u32 = RAW + 16 * PARTS; // f64 × PARTS × 2: each set field's value held to its range
const THETA: u32 = VAL + 16 * PARTS; // f64 × PARTS: a fuse's or a breaker's heat
const OPEN: u32 = THETA + 8 * PARTS; // i32 × PARTS: a fuse melted, a breaker or an RCD open
const MAG: u32 = OPEN + 4 * PARTS; // i32 × PARTS: a breaker's magnetic element reached
const COUNT: u32 = MAG + 4 * PARTS; // f64 × PARTS: an RCD's count
const CODE: u32 = COUNT + 8 * PARTS; // i32 × PARTS: the closed set solved (below)
const COOL: u32 = CODE + 4 * PARTS; // f64 × PARTS: a fuse's or breaker's e^(−dt ÷ τ) at the last per
const X0: u32 = COOL + 8 * PARTS; // f64 × PARTS: a wire's displacement at the step K0
const BRANCH: u32 = X0 + 8 * PARTS; // i32 × PARTS × 2: its branch unknowns, or −1
const RMS: u32 = BRANCH + 8 * PARTS; // f64 × PARTS: its rms current under the closed set
const RMS2: u32 = RMS + 8 * PARTS; // f64 × PARTS: its second pole's or winding's
const RESID: u32 = RMS2 + 8 * PARTS; // f64 × PARTS: an RCD's residual
const MEAN: u32 = RESID + 8 * PARTS; // f64 × PARTS: its mean power
const FREQ: u32 = MEAN + 8 * PARTS; // f64 × GROUPS: each group's frequency, 0 for DC
const S0: u32 = FREQ + 8 * GROUPS; // f64 × GROUPS: sin at K0
const C0: u32 = S0 + 8 * GROUPS; // f64 × GROUPS: cos at K0
const IPH: u32 = C0 + 8 * GROUPS; // f64 × PARTS × GROUPS × 2: each part's current phasor (re, im)
const I2PH: u32 = IPH + 16 * PARTS * GROUPS; // the same for its second pole or winding
const VPH: u32 = I2PH + 16 * PARTS * GROUPS; // f64 × NODES × GROUPS × 2: each node's volts phasor
const MAT: u32 = VPH + 16 * NODES * GROUPS; // f64 × DIM × DIM
const RHS: u32 = MAT + 8 * DIM * DIM; // f64 × 2 GROUPS × DIM
const UP: u32 = RHS + 16 * GROUPS * DIM; // i32 × NODES: a union-find's parents
const SC: u32 = UP + 4 * NODES; // f64 × GROUPS × 2: each group's sin and cos at the step
/// Where the library's own bytes start: past the largest head (64 nodes, 128 parts), so `solve`,
/// which isn't given the table, finds the counts there. The state is OWN_AT + SC + 16 × GROUPS
/// bytes in all, under 1 MiB.
const OWN_AT: u32 = 8 * NODES + 12 * 8 * PARTS + 4 * PARTS;
const _FITS: () = assert!(OWN_AT + SC + 16 * GROUPS < 1 << 20);

// A part's code, the closed set: 0 out of the network; 1 closed (a changeover at `a`, an RCD's
// poles closed); 2 a changeover at `b`; 3 a changeover joining both (the planted both_ways). An
// RCD adds 2 while its test path conducts.

#[inline(always)]
fn own(s: u32) -> u32 {
    s + OWN_AT
}

/// Starts the state from the table at `g` at the first builder; false when another table started
/// it, or the table's counts are out of range.
fn start(s: u32, g: u32) -> bool {
    let o = own(s);
    if li(o + READY) == 1 {
        return li(o + TABLE) as u32 == g;
    }
    let (n, p) = (t_nodes(g), t_parts(g));
    if li(g) != 2 || n == 0 || n > NODES || p > PARTS {
        return false;
    }
    si(o + READY, 1);
    si(o + NN, n as i32);
    si(o + PP, p as i32);
    si(o + TABLE, g as i32);
    sl(o + LAST, -1);
    true
}

/// Set field j (0 or 1) of part i: 0 a number, 1 a control, 2 an f64 the item writes.
#[inline(always)]
fn set_mode(g: u32, i: u32, j: u32) -> i32 {
    li(part(g, i) + 96 + 24 * j)
}
/// A value held to set field j's range; a value that isn't finite keeps `last`.
fn held(g: u32, i: u32, j: u32, raw: f64, last: f64) -> f64 {
    let (lo, hi) = (lf(part(g, i) + 104 + 24 * j), lf(part(g, i) + 112 + 24 * j));
    if !raw.is_finite() {
        last
    } else if raw < lo {
        lo
    } else if raw > hi {
        hi
    } else {
        raw
    }
}
/// Number j of part i as it stands: its set value when set, else the table's.
#[inline(always)]
fn val(o: u32, g: u32, i: u32, j: u32) -> f64 {
    if j < 2 && set_mode(g, i, j) != 0 {
        lf(o + VAL + 16 * i + 8 * j)
    } else {
        x(g, i, j)
    }
}

// ---------------------------------------------------------------------------------------------
// The builders: each adds node or part i of the table, of its own kind.

#[no_mangle]
pub unsafe extern "C" fn node(s: i32, g: i32, i: i32) -> i32 {
    let (s, g) = (s as u32, g as u32);
    if !start(s, g) || i < 0 || i as u32 >= t_nodes(g) {
        return -1;
    }
    let a = own(s) + NODE_ADDED + 4 * i as u32;
    if li(a) != 0 {
        return -1;
    }
    si(a, 1);
    i
}

fn add(s: i32, g: i32, i: i32, k: i32) -> i32 {
    let (s, g) = (s as u32, g as u32);
    if !start(s, g) || i < 0 || i as u32 >= t_parts(g) || kind(g, i as u32) != k {
        return -1;
    }
    let o = own(s);
    let a = o + ADDED + 4 * i as u32;
    if li(a) != 0 {
        return -1;
    }
    si(a, 1);
    si(o + VALID, 0);
    // A set value before its first: 0 held to its range.
    let mut j = 0;
    while j < 2 {
        if set_mode(g, i as u32, j) != 0 {
            sf(o + VAL + 16 * i as u32 + 8 * j, held(g, i as u32, j, 0.0, 0.0));
        }
        j += 1;
    }
    i
}

#[no_mangle]
pub unsafe extern "C" fn source_dc(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, SOURCE_DC)
}
#[no_mangle]
pub unsafe extern "C" fn source_ac(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, SOURCE_AC)
}
#[no_mangle]
pub unsafe extern "C" fn resistor(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, RESISTOR)
}
#[no_mangle]
pub unsafe extern "C" fn load(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, LOAD)
}
#[no_mangle]
pub unsafe extern "C" fn switch(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, SWITCH)
}
#[no_mangle]
pub unsafe extern "C" fn connector(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, CONNECTOR)
}
#[no_mangle]
pub unsafe extern "C" fn fuse(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, FUSE)
}
#[no_mangle]
pub unsafe extern "C" fn meter(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, METER)
}
#[no_mangle]
pub unsafe extern "C" fn wire(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, WIRE)
}
#[no_mangle]
pub unsafe extern "C" fn fault(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, FAULT)
}
#[no_mangle]
pub unsafe extern "C" fn breaker(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, BREAKER)
}
#[no_mangle]
pub unsafe extern "C" fn rcd(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, RCD)
}
#[no_mangle]
pub unsafe extern "C" fn changeover(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, CHANGEOVER)
}
#[no_mangle]
pub unsafe extern "C" fn transformer(s: i32, g: i32, i: i32) -> i32 {
    add(s, g, i, TRANSFORMER)
}

// ---------------------------------------------------------------------------------------------
// What each part is.

/// A part's resistance as the library models it (a load's v_rated² ÷ p_rated, a resistor's or a
/// fault's r, a source's r_internal), 0 for the rest.
fn ohms(o: u32, g: u32, i: u32) -> f64 {
    match kind(g, i) {
        SOURCE_DC | SOURCE_AC => x(g, i, 2),
        RESISTOR | FAULT => val(o, g, i, 0),
        LOAD => {
            let v = val(o, g, i, 1);
            v * v / val(o, g, i, 0)
        }
        _ => 0.0,
    }
}
/// Whether part i is in the network at all (meters and wires measure; they aren't).
fn networked(g: u32, i: u32) -> bool {
    !matches!(kind(g, i), METER | WIRE)
}
/// Its group: the index of its frequency among the groups (DC is a frequency of 0).
fn group_of(o: u32, g: u32, i: u32) -> u32 {
    let f = if kind(g, i) == SOURCE_AC { val(o, g, i, 1) } else { 0.0 };
    let n = li(o + NG) as u32;
    let mut q = 0;
    while q < n {
        if lf(o + FREQ + 8 * q) == f {
            return q;
        }
        q += 1;
    }
    0
}
/// The latest value of the control whose slot is at `r + off`: its last entry this step, else
/// what it was (0 before its first).
fn latest(r: u32, off: i32, was: f64) -> f64 {
    if off < 0 {
        return was;
    }
    let slot = r + off as u32;
    let n = li(slot);
    if n <= 0 {
        return was;
    }
    let n = if n > 16 { 16 } else { n } as u32;
    lf(slot + 8 + 16 * (n - 1) + 8)
}
/// Input w of part i (0 what closes it, 1 `reset_by`, 2 `test_by`) at this solve: a control's
/// latest value, or the i32 or bool the item wrote this step (nonzero says so); `was` with none.
fn input_now(g: u32, i: u32, w: u32, r: u32, was: f64) -> f64 {
    let at = part(g, i) + 24 + 8 * w;
    match li(at) {
        1 => latest(r, li(at + 4), was),
        2 => li(li(at + 4) as u32) as f64,
        _ => was,
    }
}
/// Set field j of part i as given at this solve: a control's latest value or the f64 the item
/// wrote this step.
fn set_now(g: u32, i: u32, j: u32, r: u32, was: f64) -> f64 {
    let at = part(g, i) + 96 + 24 * j;
    match li(at) {
        1 => latest(r, li(at + 4), was),
        2 => lf(li(at + 4) as u32),
        _ => was,
    }
}
/// The nodes branch w (0 or 1) of part i joins at code c: a changeover's common and the way it
/// is at; an RCD's and a transformer's pole or winding w; any other's `from` and `to`.
#[inline(always)]
fn ends(g: u32, i: u32, w: u32, c: i32) -> (i32, i32) {
    match kind(g, i) {
        CHANGEOVER => (nd(g, i, 0), if w == 1 || c == 2 { nd(g, i, 2) } else { nd(g, i, 1) }),
        RCD | TRANSFORMER => (nd(g, i, 2 * w), nd(g, i, 2 * w + 1)),
        _ => (nd(g, i, 0), nd(g, i, 1)),
    }
}
/// How many branches of its own part i takes at code c.
fn branches(o: u32, g: u32, i: u32, c: i32) -> u32 {
    if c == 0 {
        return 0;
    }
    match kind(g, i) {
        SOURCE_DC | SOURCE_AC => (x(g, i, 2) == 0.0) as u32,
        SWITCH | CONNECTOR | FUSE | BREAKER => 1,
        RESISTOR | FAULT => (val(o, g, i, 0) == 0.0) as u32,
        CHANGEOVER => 1 + (c == 3) as u32,
        RCD => 2 * (c & 1) as u32,
        TRANSFORMER => 2,
        _ => 0,
    }
}

// ---------------------------------------------------------------------------------------------
// The solve of a closed set.

/// Gaussian elimination with partial pivoting on `d` unknowns and `m` right-hand sides in place;
/// a column with no pivot left sets its unknown to 0 and the result is flagged singular.
fn eliminate(o: u32, d: u32, m: u32) -> bool {
    let a = |i: u32, j: u32| o + MAT + 8 * (i * d + j);
    let b = |r: u32, i: u32| o + RHS + 8 * (r * d + i);
    let mut whole = true;
    let mut k = 0;
    while k < d {
        let mut p = k;
        let mut best = ab(lf(a(k, k)));
        let mut i = k + 1;
        while i < d {
            let v = ab(lf(a(i, k)));
            if v > best {
                best = v;
                p = i;
            }
            i += 1;
        }
        if best == 0.0 {
            whole = false;
            k += 1;
            continue;
        }
        if p != k {
            let mut j = 0;
            while j < d {
                let t = lf(a(k, j));
                sf(a(k, j), lf(a(p, j)));
                sf(a(p, j), t);
                j += 1;
            }
            let mut r = 0;
            while r < m {
                let t = lf(b(r, k));
                sf(b(r, k), lf(b(r, p)));
                sf(b(r, p), t);
                r += 1;
            }
        }
        let piv = lf(a(k, k));
        let mut i = k + 1;
        while i < d {
            let f = lf(a(i, k)) / piv;
            if f != 0.0 {
                sf(a(i, k), 0.0);
                let mut j = k + 1;
                while j < d {
                    sf(a(i, j), lf(a(i, j)) - f * lf(a(k, j)));
                    j += 1;
                }
                let mut r = 0;
                while r < m {
                    sf(b(r, i), lf(b(r, i)) - f * lf(b(r, k)));
                    r += 1;
                }
            }
            i += 1;
        }
        k += 1;
    }
    let mut r = 0;
    while r < m {
        let mut k = d;
        while k > 0 {
            k -= 1;
            let piv = lf(a(k, k));
            if piv == 0.0 {
                sf(b(r, k), 0.0);
                continue;
            }
            let mut v = lf(b(r, k));
            let mut j = k + 1;
            while j < d {
                v -= lf(a(k, j)) * lf(b(r, j));
                j += 1;
            }
            sf(b(r, k), v / piv);
        }
        r += 1;
    }
    whole
}

/// Adds v at row r, column c of the matrix (rows and columns past the reference node's).
#[inline(always)]
fn put(o: u32, d: u32, r: u32, c: u32, v: f64) {
    let at = o + MAT + 8 * (r * d + c);
    sf(at, lf(at) + v);
}
/// A node's row or column, None for the reference.
#[inline(always)]
fn row(n: i32) -> Option<u32> {
    if n > 0 {
        Some(n as u32 - 1)
    } else {
        None
    }
}
/// Conductance gg between nodes a and b.
fn conduct(o: u32, d: u32, a: i32, b: i32, gg: f64) {
    if let Some(ra) = row(a) {
        put(o, d, ra, ra, gg);
        if let Some(rb) = row(b) {
            put(o, d, ra, rb, -gg);
        }
    }
    if let Some(rb) = row(b) {
        put(o, d, rb, rb, gg);
        if let Some(ra) = row(a) {
            put(o, d, rb, ra, -gg);
        }
    }
}

/// The groups: DC first when any DC source is added, then each AC source's frequency as it stands
/// in part order.
fn regroup(o: u32, g: u32, p: u32) {
    let mut q = 0;
    let mut i = 0;
    while i < p {
        if li(o + ADDED + 4 * i) == 1 && kind(g, i) == SOURCE_DC && q == 0 {
            sf(o + FREQ, 0.0);
            q = 1;
        }
        i += 1;
    }
    let mut i = 0;
    while i < p {
        if li(o + ADDED + 4 * i) == 1 && kind(g, i) == SOURCE_AC {
            let f = val(o, g, i, 1);
            let mut seen = false;
            let mut j = 0;
            while j < q {
                seen |= lf(o + FREQ + 8 * j) == f;
                j += 1;
            }
            if !seen && q < GROUPS {
                sf(o + FREQ + 8 * q, f);
                q += 1;
            }
        }
        i += 1;
    }
    si(o + NG, if q == 0 { 1 } else { q as i32 });
}

/// Builds and solves the closed set's network: every frequency group's node volts and part
/// currents as phasors, each part's rms currents, an RCD's residual and each mean power. Returns
/// false when it has no single solution.
fn network(o: u32, g: u32) -> bool {
    let (n, p) = (li(o + NN) as u32, li(o + PP) as u32);
    regroup(o, g, p);
    let groups = li(o + NG) as u32;
    // The unknowns: nodes 1 … n − 1, then the branches of each closed part.
    let mut d = n - 1;
    let mut i = 0;
    while i < p {
        let c = li(o + CODE + 4 * i);
        let nb = branches(o, g, i, c);
        let mut w = 0;
        while w < 2 {
            si(o + BRANCH + 8 * i + 4 * w, if w < nb { (d + w) as i32 } else { -1 });
            w += 1;
        }
        d += nb;
        i += 1;
    }
    let m = 2 * groups;
    let mut z = 0;
    while z < d * d {
        sf(o + MAT + 8 * z, 0.0);
        z += 1;
    }
    let mut z = 0;
    while z < m * d {
        sf(o + RHS + 8 * z, 0.0);
        z += 1;
    }
    let rhs = move |col: u32, r: i32, v: f64| {
        if r > 0 {
            let at = o + RHS + 8 * (col * d + (r as u32 - 1));
            sf(at, lf(at) + v);
        }
    };
    // Each closed part's stamp.
    let mut i = 0;
    while i < p {
        let c = li(o + CODE + 4 * i);
        if c == 0 || !networked(g, i) {
            i += 1;
            continue;
        }
        let k = kind(g, i);
        let source = k == SOURCE_DC || k == SOURCE_AC;
        let (e_re, e_im, q) = if source { emf(o, g, i) } else { (0.0, 0.0, 0) };
        let mut w = 0;
        while w < 2 {
            let b = li(o + BRANCH + 8 * i + 4 * w);
            if b >= 0 {
                // j from `fr` to `t` through the branch: leaves `fr`, enters `t`; V(t) − V(fr) = e.
                let bu = b as u32;
                let (fr, t) = ends(g, i, w, c);
                if let Some(r) = row(fr) {
                    put(o, d, r, bu, 1.0);
                }
                if let Some(r) = row(t) {
                    put(o, d, r, bu, -1.0);
                }
                if k != TRANSFORMER {
                    if let Some(r) = row(fr) {
                        put(o, d, bu, r, -1.0);
                    }
                    if let Some(r) = row(t) {
                        put(o, d, bu, r, 1.0);
                    }
                }
                if source {
                    sf(o + RHS + 8 * (2 * q * d + bu), e_re);
                    sf(o + RHS + 8 * ((2 * q + 1) * d + bu), e_im);
                }
            }
            w += 1;
        }
        if k == TRANSFORMER {
            // Vs − a Vp = 0, each from its `from` to its `to`; and Ip + a Is = 0, a = n2 ÷ n1.
            let (bp, bs) = (li(o + BRANCH + 8 * i) as u32, li(o + BRANCH + 8 * i + 4) as u32);
            let a = x(g, i, 1) / x(g, i, 0);
            let mut j = 0;
            while j < 4 {
                if let Some(r) = row(nd(g, i, j)) {
                    let sign = if j % 2 == 0 { 1.0 } else { -1.0 };
                    put(o, d, bp, r, if j < 2 { -a * sign } else { sign });
                }
                j += 1;
            }
            put(o, d, bs, bp, 1.0);
            #[cfg(not(primary_current))]
            put(o, d, bs, bs, a);
            #[cfg(primary_current)]
            put(o, d, bs, bs, 1.0);
        } else if k == RCD {
            if c & 2 != 0 {
                conduct(o, d, nd(g, i, 1), nd(g, i, 2), 1.0 / x(g, i, 1));
            }
        } else if li(o + BRANCH + 8 * i) < 0 {
            let ohm = ohms(o, g, i);
            if ohm > 0.0 {
                let (fr, t) = (nd(g, i, 0), nd(g, i, 1));
                let gg = 1.0 / ohm;
                conduct(o, d, fr, t, gg);
                if source {
                    // A source behind its internal resistance: e ÷ r into `to`, out of `from`.
                    rhs(2 * q, t, e_re * gg);
                    rhs(2 * q, fr, -e_re * gg);
                    rhs(2 * q + 1, t, e_im * gg);
                    rhs(2 * q + 1, fr, -e_im * gg);
                }
            }
        }
        i += 1;
    }
    // A part of the network that nothing joins to node 0 is held at 0 V at its lowest node.
    grounds(o, g, n, p);
    let mut v = 1;
    while v < n {
        if find(o, v) == v {
            let r = v - 1;
            let mut j = 0;
            while j < d {
                sf(o + MAT + 8 * (r * d + j), 0.0);
                j += 1;
            }
            sf(o + MAT + 8 * (r * d + r), 1.0);
            let mut c = 0;
            while c < m {
                sf(o + RHS + 8 * (c * d + r), 0.0);
                c += 1;
            }
        }
        v += 1;
    }
    let whole = eliminate(o, d, m);
    // Node phasors, then each part's current phasors, rms and mean power.
    let mut q = 0;
    while q < groups {
        let mut v = 0;
        while v < NODES {
            let (re, im) = if v == 0 || v >= n {
                (0.0, 0.0)
            } else {
                (lf(o + RHS + 8 * (2 * q * d + v - 1)), lf(o + RHS + 8 * ((2 * q + 1) * d + v - 1)))
            };
            sf(o + VPH + 16 * (q * NODES + v), re);
            sf(o + VPH + 16 * (q * NODES + v) + 8, im);
            v += 1;
        }
        q += 1;
    }
    let mut i = 0;
    while i < p {
        currents(o, g, i, d, groups);
        i += 1;
    }
    whole
}

/// A node's volts phasor in group q.
#[inline(always)]
fn vph(o: u32, q: u32, v: i32) -> (f64, f64) {
    if v <= 0 {
        (0.0, 0.0)
    } else {
        let at = o + VPH + 16 * (q * NODES + v as u32);
        (lf(at), lf(at + 8))
    }
}

/// Part i's current phasors in each group, its rms currents, residual and mean power, from the
/// solve of `d` unknowns.
fn currents(o: u32, g: u32, i: u32, d: u32, groups: u32) {
    let c = li(o + CODE + 4 * i);
    let k = kind(g, i);
    let closed = c != 0 && networked(g, i);
    let (fr, t) = (nd(g, i, 0), nd(g, i, 1));
    let (b1, b2) = (li(o + BRANCH + 8 * i), li(o + BRANCH + 8 * i + 4));
    let (mut sq, mut sq2, mut sqr, mut given, mut test) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let mut q = 0;
    while q < groups {
        let (fa, fb) = vph(o, q, fr);
        let (ta, tb) = vph(o, q, t);
        let branch = move |b: i32| -> (f64, f64) {
            if b < 0 {
                (0.0, 0.0)
            } else {
                (lf(o + RHS + 8 * (2 * q * d + b as u32)), lf(o + RHS + 8 * ((2 * q + 1) * d + b as u32)))
            }
        };
        let (re, im) = if !closed {
            (0.0, 0.0)
        } else if b1 >= 0 {
            branch(b1)
        } else if k == SOURCE_DC || k == SOURCE_AC {
            let (e_re, e_im, own_q) = emf(o, g, i);
            let (e_re, e_im) = if own_q == q { (e_re, e_im) } else { (0.0, 0.0) };
            let r = x(g, i, 2);
            ((e_re - (ta - fa)) / r, (e_im - (tb - fb)) / r)
        } else {
            let ohm = ohms(o, g, i);
            if ohm > 0.0 && k != RCD {
                ((fa - ta) / ohm, (fb - tb) / ohm)
            } else {
                (0.0, 0.0)
            }
        };
        let (re2, im2) = if closed { branch(b2) } else { (0.0, 0.0) };
        sf(o + IPH + 16 * (i * GROUPS + q), re);
        sf(o + IPH + 16 * (i * GROUPS + q) + 8, im);
        sf(o + I2PH + 16 * (i * GROUPS + q), re2);
        sf(o + I2PH + 16 * (i * GROUPS + q) + 8, im2);
        sq += re * re + im * im;
        sq2 += re2 * re2 + im2 * im2;
        #[cfg(not(one_pole))]
        {
            sqr += (re + re2) * (re + re2) + (im + im2) * (im + im2);
        }
        #[cfg(one_pole)]
        {
            sqr += re * re + im * im;
        }
        if k == SOURCE_DC || k == SOURCE_AC {
            given += (ta - fa) * re + (tb - fb) * im;
        }
        if k == RCD && c & 2 != 0 {
            // The test path, from the load-side live to the supply-side neutral.
            let (la, lb) = vph(o, q, nd(g, i, 1));
            let (na, nb) = vph(o, q, nd(g, i, 2));
            let r = x(g, i, 1);
            test += ((la - na) * (la - na) + (lb - nb) * (lb - nb)) / r;
        }
        q += 1;
    }
    sf(o + RMS + 8 * i, sqrt(sq));
    sf(o + RMS2 + 8 * i, sqrt(sq2));
    sf(o + RESID + 8 * i, if k == RCD { sqrt(sqr) } else { 0.0 });
    let mean = if k == SOURCE_DC || k == SOURCE_AC {
        given
    } else if k == RCD {
        test
    } else if closed {
        ohms(o, g, i) * sq
    } else {
        0.0
    };
    sf(o + MEAN + 8 * i, mean);
}

/// A source's rms phasor (DC: its volts) and its group.
#[inline(always)]
fn emf(o: u32, g: u32, i: u32) -> (f64, f64, u32) {
    let q = group_of(o, g, i);
    if kind(g, i) == SOURCE_DC {
        (val(o, g, i, 0), 0.0, q)
    } else {
        let (s, c) = sincos_turns(x(g, i, 3) / 360.0);
        let v = val(o, g, i, 0);
        (v * c, v * s, q)
    }
}

/// Roots the closed network's parts with a union-find in the state (UP), the lower root winning
/// so node 0's part is rooted at 0; a node whose root is itself and not 0 is the lowest node of a
/// part nothing joins to node 0 (a node no closed part touches is such a part on its own).
fn find(o: u32, v: u32) -> u32 {
    let mut v = v;
    while li(o + UP + 4 * v) as u32 != v {
        v = li(o + UP + 4 * v) as u32;
    }
    v
}
fn join(o: u32, a: i32, b: i32) {
    if a >= 0 && b >= 0 {
        let (ra, rb) = (find(o, a as u32), find(o, b as u32));
        if ra < rb {
            si(o + UP + 4 * rb, ra as i32);
        } else if rb < ra {
            si(o + UP + 4 * ra, rb as i32);
        }
    }
}
fn grounds(o: u32, g: u32, n: u32, p: u32) {
    let mut v = 0;
    while v < n {
        si(o + UP + 4 * v, v as i32);
        v += 1;
    }
    let mut i = 0;
    while i < p {
        let c = li(o + CODE + 4 * i);
        if c != 0 && networked(g, i) {
            match kind(g, i) {
                CHANGEOVER => {
                    join(o, nd(g, i, 0), if c == 2 { nd(g, i, 2) } else { nd(g, i, 1) });
                    if c == 3 {
                        join(o, nd(g, i, 0), nd(g, i, 2));
                    }
                }
                RCD => {
                    if c & 1 != 0 {
                        join(o, nd(g, i, 0), nd(g, i, 1));
                        join(o, nd(g, i, 2), nd(g, i, 3));
                    }
                    if c & 2 != 0 {
                        join(o, nd(g, i, 1), nd(g, i, 2));
                    }
                }
                TRANSFORMER => {
                    join(o, nd(g, i, 0), nd(g, i, 1));
                    join(o, nd(g, i, 2), nd(g, i, 3));
                }
                _ => join(o, nd(g, i, 0), nd(g, i, 1)),
            }
        }
        i += 1;
    }
}

// ---------------------------------------------------------------------------------------------
// A step.

/// Each wire's displacement at step k under the closed set solved at K0, from X0 there.
fn displaced(o: u32, g: u32, w: u32, k: i64, per: f64) -> f64 {
    let groups = li(o + NG) as u32;
    let part = target(g, w);
    if part < 0 {
        return 0.0;
    }
    let part = part as u32;
    let nae = x(g, w, 2) * (x(g, w, 1) * 1e-6) * E;
    let k0 = ll(o + K0);
    let mut sum = 0.0;
    let mut q = 0;
    while q < groups {
        let at = o + IPH + 16 * (part * GROUPS + q);
        let (re, im) = (lf(at), lf(at + 8));
        let f = lf(o + FREQ + 8 * q);
        if f == 0.0 {
            sum += re * ((k - k0) as f64 / per);
        } else {
            let (s0, c0) = (lf(o + S0 + 8 * q), lf(o + C0 + 8 * q));
            let (s, c) = (lf(o + SC + 16 * q), lf(o + SC + 16 * q + 8));
            let w = 2.0 * PI * f;
            sum += core::f64::consts::SQRT_2 / w * (re * (c0 - c) + im * (s - s0));
        }
        q += 1;
    }
    lf(o + X0 + 8 * w) + sum / nae
}

/// Input w of part i at this solve, kept as its latest: (what it was, what it is).
#[inline(always)]
fn took(o: u32, g: u32, i: u32, w: u32, r: u32) -> (f64, f64) {
    let at = o + LATEST + 24 * i + 8 * w;
    let was = lf(at);
    let now = input_now(g, i, w, r, was);
    sf(at, now);
    (was, now)
}

/// Part i's inputs, protective state and set values at this solve; its code, and whether a set
/// value changed.
#[inline(always)]
fn update(o: u32, g: u32, i: u32, r: u32) -> (i32, bool) {
    if li(o + ADDED + 4 * i) != 1 {
        return (0, false);
    }
    let k_i = kind(g, i);
    let (was, now) = took(o, g, i, 0, r);
    let (reset_was, reset_now) = took(o, g, i, 1, r);
    let (_, test) = took(o, g, i, 2, r);
    let reset = reset_was == 0.0 && reset_now != 0.0;
    let mut moved = false;
    let mut j = 0;
    while j < 2 {
        if set_mode(g, i, j) != 0 {
            let at = o + RAW + 16 * i + 8 * j;
            let before = lf(at);
            let given = set_now(g, i, j, r, before);
            sf(at, given);
            #[cfg(late_set)]
            let given = before;
            let last = lf(o + VAL + 16 * i + 8 * j);
            let h = held(g, i, j, given, last);
            if h.to_bits() != last.to_bits() {
                moved = true;
                sf(o + VAL + 16 * i + 8 * j, h);
            }
        }
        j += 1;
    }
    let open = o + OPEN + 4 * i;
    match k_i {
        FUSE => {
            if reset {
                si(open, 0);
                sf(o + THETA + 8 * i, 0.0);
            }
            if lf(o + THETA + 8 * i) >= 1.0 {
                si(open, 1);
            }
        }
        BREAKER => {
            if reset {
                si(open, 0);
                #[cfg(cold_reset)]
                sf(o + THETA + 8 * i, 0.0);
            }
            if lf(o + THETA + 8 * i) >= x(g, i, 3) {
                si(open, 1);
            }
            #[cfg(not(no_magnetic))]
            if li(o + MAG + 4 * i) != 0 {
                si(open, 1);
            }
            si(o + MAG + 4 * i, 0);
        }
        RCD => {
            if reset {
                si(open, 0);
                sf(o + COUNT + 8 * i, 0.0);
            }
            if lf(o + COUNT + 8 * i) >= 1.0 {
                si(open, 1);
            }
        }
        _ => {}
    }
    let code = match k_i {
        SOURCE_DC | SOURCE_AC | RESISTOR | LOAD | TRANSFORMER => 1,
        SWITCH | CONNECTOR | FAULT => (now != 0.0) as i32,
        FUSE | BREAKER => (li(open) == 0) as i32,
        CHANGEOVER => {
            let at = 1 + (now != 0.0) as i32;
            // The planted both_ways joins both for the step its input changes.
            #[cfg(both_ways)]
            let at = if li(o + CODE + 4 * i) != 0 && (was != 0.0) != (now != 0.0) { 3 } else { at };
            at
        }
        RCD => (li(open) == 0) as i32 + 2 * (test != 0.0 && x(g, i, 1) > 0.0) as i32,
        _ => 0,
    };
    let _ = was;
    (code, moved)
}

/// solve(s, r, k, per): the circuit's step k, at t = k ÷ per s, each step 1 ÷ per s long, its
/// inputs read from the read region at `r` and from the item's arrays. Writes the state's head;
/// 1, or 0 for a circuit with no single solution (or a state no builder started).
#[no_mangle]
pub unsafe extern "C" fn solve(s: i32, r: i32, k: i64, per: i64) -> i32 {
    let (s, r) = (s as u32, r as u32);
    let o = own(s);
    if li(o + READY) != 1 || per <= 0 {
        return 0;
    }
    let g = li(o + TABLE) as u32;
    let (n, p) = (li(o + NN) as u32, li(o + PP) as u32);
    let h = head(n, p);
    let per_f = per as f64;
    let dt = 1.0 / per_f;
    // Each fuse's and breaker's cooling over a step, for this per.
    if ll(o + PER) != per {
        sl(o + PER, per);
        let mut i = 0;
        while i < p {
            let tau = match kind(g, i) {
                #[cfg(not(late_fuse))]
                FUSE => x(g, i, 1),
                #[cfg(late_fuse)]
                FUSE => 10.0 * x(g, i, 1),
                BREAKER => x(g, i, 2),
                _ => 0.0,
            };
            if tau > 0.0 {
                sf(o + COOL + 8 * i, exp_neg(-dt / tau));
            }
            i += 1;
        }
    }
    // Inputs, protective parts, set values and the closed set.
    let mut changed = li(o + VALID) != 1;
    let mut i = 0;
    while i < p {
        let (code, moved) = update(o, g, i, r);
        if li(o + CODE + 4 * i) != code || moved {
            changed = true;
            si(o + CODE + 4 * i, code);
        }
        i += 1;
    }
    let wave = move |o: u32, k: i64| {
        let mut q = 0;
        while q < li(o + NG) as u32 {
            let (s, c) = sincos_turns(lf(o + FREQ + 8 * q) * (k as f64) / per_f);
            sf(o + SC + 16 * q, s);
            sf(o + SC + 16 * q + 8, c);
            q += 1;
        }
    };
    wave(o, k);
    if changed {
        // Carry each wire's displacement to this step under the closed set before.
        let valid = li(o + VALID) == 1;
        let mut w = 0;
        while w < p {
            if kind(g, w) == WIRE {
                let x0 = if valid { displaced(o, g, w, k, per_f) } else { 0.0 };
                sf(o + X0 + 8 * w, x0);
            }
            w += 1;
        }
        let whole = network(o, g);
        si(o + SINGULAR, !whole as i32);
        si(o + VALID, 1);
        sl(o + K0, k);
        wave(o, k);
        let mut q = 0;
        while q < li(o + NG) as u32 {
            sf(o + S0 + 8 * q, lf(o + SC + 16 * q));
            sf(o + C0 + 8 * q, lf(o + SC + 16 * q + 8));
            q += 1;
        }
    }
    let groups = li(o + NG) as u32;
    // A step's instantaneous value of a phasor set: DC as it is, AC × √2 on the wave.
    let inst = move |base: u32, stride: u32| -> f64 {
        let mut v = 0.0;
        let mut q = 0;
        while q < groups {
            let at = base + stride * q;
            let (re, im) = (lf(at), lf(at + 8));
            if lf(o + FREQ + 8 * q) == 0.0 {
                v += re;
            } else {
                let (s, c) = (lf(o + SC + 16 * q), lf(o + SC + 16 * q + 8));
                v += core::f64::consts::SQRT_2 * (re * s + im * c);
            }
            q += 1;
        }
        v
    };
    let mut v = 0;
    while v < n {
        sf(s + h.v + 8 * v, inst(o + VPH + 16 * v, 16 * NODES));
        v += 1;
    }
    let mut i = 0;
    while i < p {
        let k_i = kind(g, i);
        let c = li(o + CODE + 4 * i);
        sf(s + h.i_rms + 8 * i, lf(o + RMS + 8 * i));
        sf(s + h.i + 8 * i, inst(o + IPH + 16 * GROUPS * i, 16));
        sf(s + h.p + 8 * i, lf(o + MEAN + 8 * i));
        sf(s + h.r + 8 * i, ohms(o, g, i));
        let on = if !networked(g, i) {
            0
        } else if k_i == CHANGEOVER {
            c
        } else if k_i == RCD {
            c & 1
        } else {
            (c != 0) as i32
        };
        si(s + h.on + 4 * i, on);
        sf(s + h.residual + 8 * i, lf(o + RESID + 8 * i));
        sf(s + h.i2_rms + 8 * i, lf(o + RMS2 + 8 * i));
        sf(s + h.i2 + 8 * i, inst(o + I2PH + 16 * GROUPS * i, 16));
        i += 1;
    }
    // Meters and wires read their parts as just written.
    let mut i = 0;
    while i < p {
        match kind(g, i) {
            METER => {
                let on = target(g, i);
                if on >= 0 {
                    let e = lf(s + h.energy + 8 * i) + lf(s + h.p + 8 * on as u32) * dt;
                    sf(s + h.energy + 8 * i, e);
                    sf(s + h.kwh + 8 * i, e / 3_600_000.0);
                }
            }
            WIRE => {
                let on = target(g, i);
                if on >= 0 {
                    let nae = x(g, i, 2) * (x(g, i, 1) * 1e-6) * E;
                    sf(s + h.drift + 8 * i, lf(s + h.i_rms + 8 * on as u32) / nae);
                    sf(s + h.drift_x + 8 * i, displaced(o, g, i, k, per_f));
                }
            }
            _ => {}
        }
        i += 1;
    }
    // Each closed fuse heats by its rms current over the step, and each breaker by its, open
    // included; a breaker's magnetic element and an RCD's count read the step's current.
    let mut i = 0;
    while i < p {
        let c = li(o + CODE + 4 * i);
        match kind(g, i) {
            FUSE | BREAKER if c == 1 || kind(g, i) == BREAKER => {
                let m = lf(o + RMS + 8 * i) / x(g, i, 0);
                let a = lf(o + COOL + 8 * i);
                let th = lf(o + THETA + 8 * i);
                sf(o + THETA + 8 * i, th * a + m * m * (1.0 - a));
                if kind(g, i) == BREAKER && lf(o + RMS + 8 * i) >= x(g, i, 1) * x(g, i, 0) {
                    si(o + MAG + 4 * i, 1);
                }
            }
            RCD => {
                let (res, rating) = (lf(o + RESID + 8 * i), x(g, i, 0));
                let count = if res >= rating && res > 0.0 {
                    let t = x(g, i, 2) * rating / res;
                    let t = if t < x(g, i, 3) { x(g, i, 3) } else { t };
                    lf(o + COUNT + 8 * i) + dt / t
                } else {
                    0.0
                };
                sf(o + COUNT + 8 * i, count);
            }
            _ => {}
        }
        let heat = if matches!(kind(g, i), FUSE | BREAKER) { lf(o + THETA + 8 * i) } else { 0.0 };
        sf(s + h.heat + 8 * i, heat);
        i += 1;
    }
    sl(o + LAST, k);
    (li(o + SINGULAR) == 0) as i32
}
