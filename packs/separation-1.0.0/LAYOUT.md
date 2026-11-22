# separation@1's layouts

Three layouts a separation@1 library, a piece and the logic module agree on (#1255): the **built table**, which the
check makes from a logic item's `separation` and copies to the item's asset 0; **`separation.state@1`**, the state a
library keeps from the address `s` its caller gives `minima`; and the **control record** `delay` writes and `apply`
reads. Every number is little-endian; every address is an i32 into the caller's memory. Positions are `[x, y, z]` in
metres with y up, so (x, z) is the lateral plane and y the altitude; speeds are in m/s and times in seconds on the
piece's clock.

## The built table

The bytes from `g` (asset 0's bytes: `assets_at + 4`). A header of 64 bytes, then the movers, then the by-pair rows.

| Offset | Field |
|---|---|
| 0 | i32 version, 1 |
| 4, 8 | i32 M movers (1 to 64), R rows (at most 64) |
| 16, 24 | f64 the table's lateral minimum, its vertical minimum, in metres |
| 32, 36 | i32 offsets of the movers and of the rows, from `g` |

- **Movers** (464 B each), in the order `separation.movers` lists them, so mover i is `movers[i]` everywhere: i32 its
  class, i32 its route's fixes (2 to 8), f64 its start, then 8 fixes of 56 B: f64 x, y, z, f64 the speed given from
  the fix (the last one given at or before it; 0 at the route's last fix), f64 the band's min and max there (0 and
  the largest f64 where the mover gives no band), i32 the fix's name, 4 B zero.
- **Rows** (24 B each), in `minima.by_pair`'s order: i32 the leader's class, i32 the follower's, i32 the name of the
  fix it is measured at or −1 for `always`, i32 its basis (1 cited, 2 invented), f64 its minimum in metres.

A class key and a fix name are each a number: its place among those the movers, then the rows, first name. The check
refuses a row that carries no basis, naming it by its index (`"row"`), so no row reaches a library without one; a
cited row's source and section stay in the piece, where a readout finds them by the row's index.

## separation.state@1

From `s`. **The head is the layout's arrays**, for the table's M movers, each 8-aligned in this order, which is the
order and placement the logic module gives an item's writes declared so. A piece declares them first and publishes them
by copying the head over its write region after its calls; a bound value then reads each as `<logic ID>.<name>`.

| Array | Type × count | Unit | Holds |
|---|---|---|---|
| `fix_count` | i32 × M | | the slots mover i flies: its route's fixes and the off-route point a stretch adds; 0 until `mover` adds it |
| `fix_ref` | i32 × 8M | | slot q of mover i is entry 8i + q, in the order flown: the fix's index in the mover's route, or −1 for a stretch's point and for a slot not flown |
| `fix_pos` | vec3 × 8M | m | the mover's position at the slot |
| `fix_speed` | f64 × 8M | m/s | its speed on the leg leaving the slot |
| `fix_time` | f64 × 8M | s | its time at the slot |
| `delay_s` | f64 × M | s | the delay asked of mover i by its last `delay` that gave a control, once a control is applied to it; 0 with none |
| `delay_fix` | i32 × M | | the fix that delay was wanted at, by its index in the mover's route; −1 with none |
| `win_count` | i32 | | how many windows the last `conflicts` or `next_conflict` found |
| `win_a`, `win_b` | i32 × 64 each | | window k's pair, by mover index, a < b |
| `win_from`, `win_to` | f64 × 64 each | s | its start and its end |
| `win_min` | f64 × 64 | m | the minimum that applied: the table's lateral one, or a row's |
| `win_row` | i32 × 64 | | that row's index in `by_pair`, or −1 for the table's |
| `win_basis` | i32 × 64 | | that row's basis: 0 no row, 1 cited, 2 invented |
| `closest_a`, `closest_b` | i32 each | | the pair the last `closest` answered for, a < b; −1 before any |
| `closest_dist` | f64 | m | their smallest distance |
| `closest_time` | f64 | s | when |

The first 64 windows by start, then pair, are written; `win_count` may be more, and the slots past those written are
zero. The head is 368 M + 3,144 bytes, rounded up to each array's 8: 3,712 for 3 movers, 17,320 for 40.

**The library's own part** starts 32,768 bytes from `s`, past the head of 64 movers: i32 `g`, i32 M, the 19 arrays'
addresses as i32, 4 B zero, then for each mover 16 B: f64 the seconds its last `delay` that gave a control asked, i32
the fix they were wanted at (−1 before any), 4 B zero. `minima` returns the state's size, 32,856 + 16 M bytes. The
library touches nothing else of its caller's but the control record `delay` writes.

## The control record

48 bytes at `c`, six fields of 8 bytes each. Fixes are indexes in the mover's route.

| At | Field | `speed` | `stretch` | `hold` | a refusal |
|---|---|---|---|---|---|
| +0 i32 | kind | 1 | 2 | 3 | 0 |
| +8 i32 | mover | its index | | | |
| +16 i32 | from | `from_fix` | `leave_fix` | −1 | the fix whose band forbids the speed, or −1 |
| +24 i32 | to | `to_fix` | `rejoin_fix` | −1 | −1 |
| +32 f64 | value | m/s | `offset`, m | s | the speed the delay needs, m/s, or 0 |
| +40 i32 | why | 0 | 0 | 0 | 1 the band, 2 no leg left |

## What the exports do

- `minima(s, g) → i32` starts the state from the table: no mover flown, no window, no closest pair. −1 for a table it
  can't read.
- `mover(s, i) → i32` adds mover i as the table gives it: its time at its first fix is its start, and each leg takes
  its straight-line length, altitude included, ÷ the speed given from its first fix. Returns i, or −1 for an index out
  of range or added before. A mover not added is in no pair.
- `closest(s, a, b, t0, t1) → f64`: over the times in [t0, t1] at which both are on their routes (from a mover's first
  slot's time to its last's), cut wherever either passes a slot, the squared straight-line distance on each stretch is
  a quadratic in time, least at its vertex held to the stretch. The smallest is returned and written with its time,
  the earliest on a tie; −1, writing nothing, when the two share no time in the span.
- `conflicts(s, t0, t1) → i32`: every window, written, and their count. For each pair a < b, the times both are on
  their routes at which their lateral distance is below the pair's lateral minimum and their vertical distance below
  the table's, both strictly: on each stretch, between the lateral quadratic's two roots and the vertical line's two
  crossings. Each maximal such stretch of time is one window; pieces that meet at a slot's time are one. **The pair's
  lateral minimum** is the table's, or the largest `always` row's above it whose two classes are the pair's,
  whichever of the two leads; the window then names that row and its basis. **A row measured at a fix** gives a
  window of one instant, of its own: for a mover of its leader's class and one of its follower's whose routes both
  hold the fix, the leader passing it first, the time the leader passes it, when that is in [t0, t1], the follower is
  on its route, and the pair is laterally below the row's minimum and vertically below the table's.
- `next_conflict(s, t) → i32`: the first window `conflicts(s, t, ∞)` lists, written as the state's one window; 1, or 0
  with none.
- `delay(s, m, seconds, t, c) → i32` writes the control that delays mover m by `seconds` over its next leg, asked at
  t, and returns its kind. The next leg runs from the first slot whose time is at or after t to the slot after it,
  where the delay is wanted. With no such leg it refuses, why 2. Else, in order: the **speed** that takes the leg
  `seconds` longer, its length ÷ (its time + seconds), when the band at the leg's first fix holds it (an off-route
  point takes the band of the fix before it); a **stretch**, unless the leg is the mover's last, the leg's midpoint
  moved `offset` = ½√((length + speed × seconds)² − length²) to the left of travel in the lateral plane, both halves
  flown at the leg's speed; a **hold** of `seconds`, for a mover whose first slot's time is after t; else it
  **refuses**, why 1, naming the fix whose band forbids the speed and the speed.
- `apply(s, c) → i32` flies the record's mover again under it, as given: a speed holds from its `from` slot to its
  `to` slot and the speeds after stay; a stretch adds its point as a slot (`fix_ref` −1) after its `from` slot; a hold
  moves every time by its seconds. It reads no band: `separation.exact` judges what was flown. 1, or 0, changing
  nothing, for a refusal's record, a mover not flown, a fix the mover doesn't hold, or a ninth slot.

## The kind rules

`judge` reads them on a run's last step, from the movers as the state says they fly and the item's `separation`,
never from the `win_*` arrays, so they hold any library (`crates/deep-logic/src/separation.rs`).

- `separation.clear {span}`: no window over the span, worked by the judge in closed form. A fail is `{pair, window,
  min, row}`.
- `separation.exact {tolerance: 0.5}`: for a mover with `delay_fix` f ≥ 0, its time at the slot whose `fix_ref` is f,
  less the time its document data put it there, less `delay_s`, is within the tolerance, else a fail `{mover, fix,
  time}`; and each leg's `fix_speed` is inside the band at the leg's first fix, else a fail `{mover, fix, speed}`.

The pack's planted libraries are the kit's twins, each the reference library built with one change: `once_a_second`
(`--cfg sampler`) looks at each pair only at the whole seconds of the span, a window running from the first second in
a row it is under the table's minima to the last, and reads no row; `leaves_band` (`--cfg solver`) gives the speed
for the delay asked whenever a leg is left, the band unread.

## The fixtures' rule sheet

The basis the fixtures cite, of this pack's own making, so that a cited row has a source and a section to name: on
the fixtures' approach, a light mover behind a heavy one keeps 10,000 m, measured when the heavy one passes the
threshold. The `wide` fixture's row, a light mover and a heavy one keeping 7,408 m always, is marked invented.
