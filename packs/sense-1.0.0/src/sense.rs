//! sense.lib@1's reference library, sense.sight (#959; canvas primitives: Logic: library interfaces:
//! sense.lib@1): each side's sight over a terrain plate's heights on a coarse grid. An eye sees a
//! sight cell in its range when the line from its eye to the cell's ground point stays above the
//! coarse heights it crosses; a radar holds the fog cells in its range whatever the terrain; a
//! jammer clears the other sides' radar from the fog cells in its range; a cloaked unit shows only
//! to a side with a detect sensor within its decloak radius; a structure a side saw and lost stays
//! a ghost row until the fog cell of its last place reads seen again. Each call rebuilds one share
//! of the grids' rows, `spread` calls a whole rebuild, then writes every unit's bits and every
//! ghost row from the grids as they stand. Built with `--cfg planted`, it is sense.lib@1's planted
//! library: every height reads 0, so it sees behind a ridge.
//!
//! Everything lives in the 2 MiB state at `s` in the caller's memory, past the program's 256-byte
//! header, laid out as the constants below say; the zeroed state is the one nothing has seen. The
//! library calls nothing: a relocatable object of functions only, built by scripts/sense-pack.mjs:
//!
//! ```text
//! rustc --target wasm32-unknown-unknown --crate-type=lib --crate-name sense --edition 2021
//!   --emit=obj -C opt-level=3 -C panic=abort -C target-cpu=mvp -C debuginfo=0
//!   -C target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint [--cfg planted] sense.rs
//! ```

#![no_std]
#![allow(clippy::missing_safety_doc)]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[inline(always)]
fn l8(a: u32) -> u32 {
    unsafe { *(a as usize as *const u8) as u32 }
}
#[inline(always)]
fn s8(a: u32, v: u32) {
    unsafe { *(a as usize as *mut u8) = v as u8 }
}
#[inline(always)]
fn l16(a: u32) -> u32 {
    unsafe { (a as usize as *const u16).read_unaligned() as u32 }
}
#[inline(always)]
fn s16(a: u32, v: u32) {
    unsafe { (a as usize as *mut u16).write_unaligned(v as u16) }
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
fn l64(a: u32) -> u64 {
    unsafe { (a as usize as *const u64).read_unaligned() }
}
#[inline(always)]
fn lf(a: u32) -> f64 {
    unsafe { (a as usize as *const f64).read_unaligned() }
}
#[inline(always)]
fn sf(a: u32, v: f64) {
    unsafe { (a as usize as *mut f64).write_unaligned(v) }
}
#[inline(always)]
fn zero(a: u32, n: u32) {
    unsafe { core::ptr::write_bytes(a as usize as *mut u8, 0, n as usize) }
}

// The header the program writes.
const H_HEIGHTS: u32 = 0;
const H_COLS: u32 = 4;
const H_ROWS: u32 = 8;
const H_CELL: u32 = 12;
const H_RADAR_CELL: u32 = 16;
const H_SPREAD: u32 = 20;
const H_SIDES: u32 = 24;
const H_SENSORS: u32 = 28;
const H_SENSOR_COUNT: u32 = 32;
const H_UNITS: u32 = 36;
const H_UNIT_COUNT: u32 = 40;
const H_FOG: u32 = 44;
const H_SEEN: u32 = 48;
const H_BLIP: u32 = 52;
const H_BLIP_POS: u32 = 56;
const H_GHOST: u32 = 60;
const H_GHOST_POS: u32 = 64;
const H_GHOST_KIND: u32 = 68;
const H_X0: u32 = 72;
const H_Z0: u32 = 80;
const H_SPACING: u32 = 88;
const H_SEED: u32 = 96;
const H_PLAYERS: u32 = 104;

/// A sensor or unit row's bytes.
const ROW: u32 = 40;
// A sensor row: x, z, height and range (f64), then its kind and side.
const SN_HEIGHT: u32 = 16;
const SN_RANGE: u32 = 24;
const SN_KIND: u32 = 32;
const SN_SIDE: u32 = 36;
// A unit row: x, z and its decloak radius in sight cells (f64), then its side, kind and flags.
const U_DECLOAK: u32 = 16;
const U_SIDE: u32 = 24;
const U_KIND: u32 = 28;
const U_FLAGS: u32 = 32;

const EYE: u32 = 1;
const RADAR: u32 = 2;
const JAM: u32 = 4;
const DETECT: u32 = 5;
const CLOAKED: u32 = 1;
const STRUCTURE: u32 = 2;
/// A cell's state for a side, two bits: unseen 0, radar 1, seen 2.
const ST_RADAR: u32 = 1;
const ST_SEEN: u32 = 2;

const SIDES: u32 = 8;
/// The state's bytes.
const STATE: u32 = 2 << 20;
// The library's own, from +256. Each side's multiplier (a state times it is the state in each of
// the side's players' two bits); for each set of sides that see a cell, the fog value and the
// state word of a cell those sides see; then a byte a sight cell (bit s: side s sees it), a word
// a fog cell (two bits a side: its state; while a call marks its rows, bit s a radar of side s
// and bit 8 + j a jammer of side j) and 24 bytes a ghost row (x, z, kind, known).
const MULT: u32 = 256;
const VALUE: u32 = 512;
const WORD: u32 = 1536;
const SIGHT: u32 = 2048;
const GHOST: u32 = 24;
const G_KIND: u32 = 16;
const G_KNOWN: u32 = 20;

/// ⌊x⌋ of an x at or above 0 and under 2³¹.
#[inline(always)]
fn floor(x: f64) -> i32 {
    x as i32
}
/// ⌈|x|⌉ of an x whose size is under 2³¹.
#[inline(always)]
fn ceil_abs(x: f64) -> i32 {
    let a = if x < 0.0 { -x } else { x };
    let c = a as i32;
    if (c as f64) < a {
        c + 1
    } else {
        c
    }
}
/// The first and last cells of lo..=hi whose centres a disc of radius r about c can hold, a cell
/// wider each way (first > last when it holds none).
#[inline(always)]
fn span(c: f64, r: f64, lo: i32, hi: i32) -> (i32, i32) {
    let r = if r < 0.0 { -r } else { r };
    let (a, b) = (c - r - 2.0, c + r + 2.0);
    // A range or a place that is no number holds no cell.
    if a.is_nan() || b.is_nan() {
        return (lo, lo - 1);
    }
    let first = if a > lo as f64 {
        if a > hi as f64 {
            hi + 1
        } else {
            a as i32
        }
    } else {
        lo
    };
    let last = if b < hi as f64 {
        if b < lo as f64 {
            lo - 1
        } else {
            b as i32
        }
    } else {
        hi
    };
    (first, last)
}

/// What a call reads of the header and works out from it once.
struct Grid {
    s: u32,
    sides: u32,
    /// Sight cells across and down, fog cells across and down.
    gc: u32,
    gr: u32,
    fc: u32,
    fr: u32,
    x0: f64,
    z0: f64,
    /// A sight cell's and a fog cell's side in metres.
    m: f64,
    mr: f64,
    /// The coarse height of sight cell (cx, cz) is the binary32 at `h + cz × hz + cx × hx`.
    h: u32,
    hz: u32,
    hx: u32,
    sight: u32,
    state: u32,
    ghosts: u32,
}

impl Grid {
    #[inline(always)]
    fn height(&self, cx: u32, cz: u32) -> f64 {
        let at = self.h + cz * self.hz + cx * self.hx;
        if cfg!(planted) {
            return 0.0;
        }
        unsafe { (at as usize as *const f32).read_unaligned() as f64 }
    }
    /// A side's state at fog cell `c`, unseen off the grid.
    #[inline(always)]
    fn state_at(&self, side: u32, c: i32) -> u32 {
        if c < 0 {
            0
        } else {
            (l16(self.state + 2 * c as u32) >> (2 * side)) & 3
        }
    }
    /// The fog cell holding the point (x, z), row by row, or −1 off the grid.
    #[inline(always)]
    fn fog_cell(&self, x: f64, z: f64) -> i32 {
        let rx = (x - self.x0) / self.mr;
        let rz = (z - self.z0) / self.mr;
        if rx >= 0.0 && rx < self.fc as f64 && rz >= 0.0 && rz < self.fr as f64 {
            (floor(rz) as u32 * self.fc + floor(rx) as u32) as i32
        } else {
            -1
        }
    }
}

/// Marks, in this call's rows `from..to`, each sight cell the eye sensor row at `sn` sees.
#[inline(always)]
fn look(g: &Grid, sn: u32, side: u32, from: u32, to: u32) {
    let ex = (lf(sn) - g.x0) / g.m;
    let ez = (lf(sn + 8) - g.z0) / g.m;
    if !(ex >= 0.0 && ex < g.gc as f64 && ez >= 0.0 && ez < g.gr as f64) {
        return;
    }
    let rc = lf(sn + SN_RANGE) / g.m;
    let rc2 = rc * rc;
    let he = g.height(floor(ex) as u32, floor(ez) as u32) + lf(sn + SN_HEIGHT);
    let (x0, x1) = span(ex, rc, 0, g.gc as i32 - 1);
    let (z0, z1) = span(ez, rc, from as i32, to as i32 - 1);
    let bit = 1 << side;
    let mut tz = z0;
    while tz <= z1 {
        let dz = tz as f64 + 0.5 - ez;
        let dz2 = dz * dz;
        let nz = ceil_abs(dz);
        let row = g.sight + tz as u32 * g.gc;
        let mut tx = x0;
        while tx <= x1 {
            let p = row + tx as u32;
            let seen = l8(p);
            let dx = tx as f64 + 0.5 - ex;
            if seen & bit == 0 && dx * dx + dz2 <= rc2 {
                let dh = g.height(tx as u32, tz as u32) - he;
                let nx = ceil_abs(dx);
                let n = if nx > nz { nx } else { nz };
                let nf = n as f64;
                let mut clear = true;
                let mut i = 1;
                while i < n {
                    let t = i as f64 / nf;
                    let y = he + dh * t;
                    if !(y > g.height(floor(ex + dx * t) as u32, floor(ez + dz * t) as u32)) {
                        clear = false;
                        break;
                    }
                    i += 1;
                }
                if clear {
                    s8(p, seen | bit);
                }
            }
            tx += 1;
        }
        tz += 1;
    }
}

/// Marks, in this call's fog rows `from..to`, each fog cell the radar or jam sensor row at `sn`
/// holds, with `mark`.
#[inline(always)]
fn sweep(g: &Grid, sn: u32, mark: u32, from: u32, to: u32) {
    let c = (lf(sn) - g.x0) / g.mr;
    let d = (lf(sn + 8) - g.z0) / g.mr;
    let rr = lf(sn + SN_RANGE) / g.mr;
    let rr2 = rr * rr;
    let (x0, x1) = span(c, rr, 0, g.fc as i32 - 1);
    let (z0, z1) = span(d, rr, from as i32, to as i32 - 1);
    let mut fz = z0;
    while fz <= z1 {
        let dz = fz as f64 + 0.5 - d;
        let dz2 = dz * dz;
        let row = g.state + 2 * fz as u32 * g.fc;
        let mut fx = x0;
        while fx <= x1 {
            let dx = fx as f64 + 0.5 - c;
            if dx * dx + dz2 <= rr2 {
                let p = row + 2 * fx as u32;
                s16(p, l16(p) | mark);
            }
            fx += 1;
        }
        fz += 1;
    }
}

/// Whether `side` has a detect sensor within the unit row's decloak radius, in sight cells.
fn detected(g: &Grid, u: u32, side: u32) -> bool {
    let d = lf(u + U_DECLOAK);
    let d2 = d * d;
    let ux = (lf(u) - g.x0) / g.m;
    let uz = (lf(u + 8) - g.z0) / g.m;
    let mut sn = l32(g.s + H_SENSORS);
    let end = sn + ROW * l32(g.s + H_SENSOR_COUNT);
    while sn < end {
        if l32(sn + SN_KIND) == DETECT && l32(sn + SN_SIDE) == side {
            let dx = (lf(sn) - g.x0) / g.m - ux;
            let dz = (lf(sn + 8) - g.z0) / g.m - uz;
            if dx * dx + dz * dz <= d2 {
                return true;
            }
        }
        sn += ROW;
    }
    false
}

/// One call: the share of the grids' rows step `k` rebuilds, then every unit's seen and blip bits
/// and blip place, and every ghost row, from the grids as they stand.
#[no_mangle]
pub unsafe extern "C" fn sight(s: i32, k: i64) {
    let s = s as u32;
    let (cols, rows) = (l32(s + H_COLS), l32(s + H_ROWS));
    let (cell, radar_cell, spread) = (l32(s + H_CELL), l32(s + H_RADAR_CELL), l32(s + H_SPREAD));
    let sides = l32(s + H_SIDES);
    // A header with no plate, cell, share or side, or whose grids and ghost rows the state can't
    // hold, is the program's mistake: the call stops here, before anything of the caller's is
    // written.
    if cols == 0
        || rows == 0
        || cell == 0
        || radar_cell == 0
        || spread == 0
        || sides == 0
        || sides > SIDES
    {
        core::arch::wasm32::unreachable();
    }
    let (gc, gr, q) = ((cols - 1) / cell, (rows - 1) / cell, cell / radar_cell);
    let cells = gc as u64 * gr as u64;
    let own = cells * (1 + 2 * q as u64 * q as u64)
        + GHOST as u64 * l32(s + H_UNIT_COUNT) as u64 * sides as u64;
    if SIGHT as u64 + own + 16 > STATE as u64 {
        core::arch::wasm32::unreachable();
    }
    let (fc, fr) = (gc * q, gr * q);
    let spacing = lf(s + H_SPACING);
    let half = cell / 2;
    let sight_at = s + SIGHT;
    let state = (sight_at + gc * gr + 7) & !7;
    let g = Grid {
        s,
        sides,
        gc,
        gr,
        fc,
        fr,
        x0: lf(s + H_X0),
        z0: lf(s + H_Z0),
        m: spacing * cell as f64,
        mr: spacing * radar_cell as f64,
        h: l32(s + H_HEIGHTS) + 4 * (half * cols + half),
        hz: 4 * cell * cols,
        hx: 4 * cell,
        sight: sight_at,
        state,
        ghosts: (state + 2 * fc * fr + 7) & !7,
    };
    let phase = (k as u64 % spread as u64) as u32;
    let from = gr * phase / spread;
    let to = gr * (phase + 1) / spread;

    // Each side's multiplier, and each set of seeing sides' fog value and state word.
    let mut side = 0;
    while side < sides {
        let players = l32(s + H_PLAYERS + 4 * side);
        let mut v: u32 = 0;
        let mut p = 0;
        while p < 16 {
            if (players >> p) & 1 != 0 {
                v |= 1 << (2 * p);
            }
            p += 1;
        }
        s32(s + MULT + 4 * side, v);
        side += 1;
    }
    s32(s + VALUE, 0);
    s16(s + WORD, 0);
    let mut set: u32 = 1;
    while set < 1 << sides {
        let rest = set & (set - 1);
        let low = (set ^ rest).trailing_zeros();
        s32(
            s + VALUE + 4 * set,
            l32(s + VALUE + 4 * rest) | (ST_SEEN * l32(s + MULT + 4 * low)),
        );
        s16(
            s + WORD + 2 * set,
            l16(s + WORD + 2 * rest) | (ST_SEEN << (2 * low)),
        );
        set += 1;
    }

    // This call's rows start clear; each eye marks the cells it sees, each radar and jammer the
    // fog cells it holds.
    zero(g.sight + from * gc, (to - from) * gc);
    let sensors = l32(s + H_SENSORS);
    let end = sensors + ROW * l32(s + H_SENSOR_COUNT);
    let mut marks = false;
    let mut sn = sensors;
    while sn < end {
        let kind = l32(sn + SN_KIND);
        let side = l32(sn + SN_SIDE);
        if side < sides {
            if kind == EYE {
                look(&g, sn, side, from, to);
            } else if kind == RADAR || kind == JAM {
                if !marks {
                    marks = true;
                    zero(g.state + 2 * from * q * fc, 2 * (to - from) * q * fc);
                }
                sweep(
                    &g,
                    sn,
                    if kind == RADAR {
                        1 << side
                    } else {
                        0x100 << side
                    },
                    from * q,
                    to * q,
                );
            }
        }
        sn += ROW;
    }

    // Each fog cell of this call's rows: every side's state, and the grid's value.
    let fog = l32(s + H_FOG);
    let all: u32 = (1 << sides) - 1;
    let mut cz = from;
    while cz < to {
        let mut sub = 0;
        while sub < q {
            let row = (cz * q + sub) * fc;
            let mut cx = 0;
            while cx < gc {
                let sees = l8(g.sight + cz * gc + cx);
                let v = l32(s + VALUE + 4 * sees);
                let w = l32(s + WORD + 2 * sees) & 0xffff;
                let mut f = row + cx * q;
                let stop = f + q;
                while f < stop {
                    let marked = if marks { l16(g.state + 2 * f) } else { 0 };
                    if marked == 0 {
                        s32(fog + 4 * f, v);
                        s16(g.state + 2 * f, w);
                    } else {
                        // A side's radar holds the cell unless another side's jammer does.
                        let jam = marked >> 8;
                        let jammed = if jam == 0 {
                            0
                        } else if jam & (jam - 1) != 0 {
                            all
                        } else {
                            all & !jam
                        };
                        let mut radar = marked & 0xff & !jammed & !sees;
                        let (mut v, mut w) = (v, w);
                        while radar != 0 {
                            let side = radar.trailing_zeros();
                            v |= ST_RADAR * l32(s + MULT + 4 * side);
                            w |= ST_RADAR << (2 * side);
                            radar &= radar - 1;
                        }
                        s32(fog + 4 * f, v);
                        s16(g.state + 2 * f, w);
                    }
                    f += 1;
                }
                cx += 1;
            }
            sub += 1;
        }
        cz += 1;
    }

    rows_of(&g, k);
}

/// Every unit's seen and blip bits and blip place, and every ghost row.
#[inline(always)]
fn rows_of(g: &Grid, k: i64) {
    let s = g.s;
    let sides = g.sides;
    let units = l32(s + H_UNITS);
    let count = l32(s + H_UNIT_COUNT);
    let (seen_at, blip_at, blip_pos) = (l32(s + H_SEEN), l32(s + H_BLIP), l32(s + H_BLIP_POS));
    let (ghost_at, ghost_pos, ghost_kind) = (
        l32(s + H_GHOST),
        l32(s + H_GHOST_POS),
        l32(s + H_GHOST_KIND),
    );
    let seed = l64(s + H_SEED);
    let mut i = 0;
    while i < count {
        let u = units + ROW * i;
        let uside = l32(u + U_SIDE);
        let flags = l32(u + U_FLAGS);
        let there = uside < sides;
        let (x, z) = (lf(u), lf(u + 8));
        let c = if there { g.fog_cell(x, z) } else { -1 };
        let (mut seen, mut blip) = (0, 0);
        let mut side = 0;
        while side < sides {
            let players = l32(s + H_PLAYERS + 4 * side);
            let mut sees = false;
            if there {
                if side == uside {
                    sees = true;
                } else {
                    let st = g.state_at(side, c);
                    if st != 0 && !(flags & CLOAKED != 0 && !detected(g, u, side)) {
                        if st == ST_SEEN {
                            sees = true;
                        } else {
                            blip |= players;
                        }
                    }
                }
            }
            if sees {
                seen |= players;
            }
            // The ghost row of this unit for this side: a structure the side sees is known to it
            // with its place and kind; lost, it stays until the fog cell of that place reads seen.
            let at = i * sides + side;
            let row = g.ghosts + GHOST * at;
            let mut ghost = 0;
            if there && side != uside && sees && flags & STRUCTURE != 0 {
                sf(row, x);
                sf(row + 8, z);
                s32(row + G_KIND, l32(u + U_KIND));
                s32(row + G_KNOWN, 1);
            } else if l32(row + G_KNOWN) != 0 {
                let st = g.state_at(side, g.fog_cell(lf(row), lf(row + 8)));
                if st == ST_SEEN {
                    s32(row + G_KNOWN, 0);
                } else {
                    ghost = players;
                }
            }
            s32(ghost_at + 4 * at, ghost);
            if ghost != 0 {
                sf(ghost_pos + 16 * at, lf(row));
                sf(ghost_pos + 16 * at + 8, lf(row + 8));
                s32(ghost_kind + 4 * at, l32(row + G_KIND));
            } else {
                sf(ghost_pos + 16 * at, 0.0);
                sf(ghost_pos + 16 * at + 8, 0.0);
                s32(ghost_kind + 4 * at, 0);
            }
            side += 1;
        }
        s32(seen_at + 4 * i, seen);
        s32(blip_at + 4 * i, blip);
        // The blip's place: somewhere in the unit's fog cell, by a hash of the seed, the unit's
        // row and the step, so every copy draws it at the same place.
        if there {
            let mut h = seed
                ^ (i as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15)
                ^ (k as u64).wrapping_mul(0xc2b2_ae3d_27d4_eb4f);
            h = (h ^ (h >> 29)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            h ^= h >> 32;
            let fx = floor_any((x - g.x0) / g.mr);
            let fz = floor_any((z - g.z0) / g.mr);
            sf(
                blip_pos + 16 * i,
                g.x0 + g.mr * (fx + (h >> 40) as f64 / 16_777_216.0),
            );
            sf(
                blip_pos + 16 * i + 8,
                g.z0 + g.mr * (fz + ((h >> 16) & 0xff_ffff) as f64 / 16_777_216.0),
            );
        } else {
            sf(blip_pos + 16 * i, 0.0);
            sf(blip_pos + 16 * i + 8, 0.0);
        }
        i += 1;
    }
}

/// ⌊x⌋ as a float, for any x.
#[inline(always)]
fn floor_any(x: f64) -> f64 {
    // Past 2⁵² every float is whole.
    if !(x > -4_503_599_627_370_496.0 && x < 4_503_599_627_370_496.0) {
        return x;
    }
    let t = x as i64 as f64;
    if t > x {
        t - 1.0
    } else {
        t
    }
}
