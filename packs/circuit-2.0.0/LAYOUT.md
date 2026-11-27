# circuit@2's layouts

Two layouts a circuit@2 library, a piece and the logic module agree on (#3604): the **built table**, which the check
makes from a logic item's `circuit` and copies to the item's asset 0; and **`circuit.state@2`**, the state a library
keeps from the address `s` its caller gives the builders and `solve`. Every number is little-endian; every address is
an i32 into the caller's memory. Volts, amperes, watts, ohms, joules and seconds are SI; an area is in mm². An item's
`circuit` is circuit@2's when its program imports `lib:circuit@2` or links a library that implements it; otherwise it
is circuit@1's, laid out as `packs/circuit-1.0.0/LAYOUT.md` says.

## The built table

The bytes from `g` (asset 0's bytes: `assets_at + 4`). A header of 64 bytes, then 160 bytes a part, in the order
`circuit.parts` lists them, so part i is `parts[i]` everywhere.

| Offset | Field |
|---|---|
| 0 | i32 version, 2 |
| 4, 8 | i32 N nodes (1 to 64), P parts (at most 128) |
| 12 | i32 the parts' offset from `g`, 64 |

A part:

| Offset | Field |
|---|---|
| +0 | i32 kind: circuit@1's 1 to 10 (`source_dc`, `source_ac`, `resistor`, `load`, `switch`, `connector`, `fuse`, `meter`, `wire`, `fault`), then 11 `breaker`, 12 `rcd`, 13 `changeover`, 14 `transformer` |
| +4 … +16 | i32 four nodes, each an index in `circuit.nodes` or −1: `from`, `to`, −1, −1; a changeover's `common`, `a`, `b`, −1; an RCD's `live` then `neutral`, a transformer's `primary` then `secondary`, each `[from, to]` |
| +20 | i32 the part a meter is `on` or a wire's `part`, by index; −1 for the rest |
| +24, +28 | the input that closes it (`closed_by`, a fault's `on_by`, a changeover's `at_b_by`): i32 mode, i32 where |
| +32, +36 | its `reset_by` (a fuse's, a breaker's, an RCD's): mode, where |
| +40, +44 | an RCD's `test_by`: mode, where |
| +48 … +88 | six f64, by kind (below) |
| +96 … +119 | set field 0: i32 mode, i32 where, f64 min, f64 max |
| +120 … +143 | set field 1: the same |
| +144 … +159 | zero |

An input's mode is 0 with none, 1 for a control (where: its slot's offset in the read region) and 2 for an element of
one of the item's own writes, a bool or an i32 (where: its address), nonzero while it says so. A set field's mode is 0
for a number (the f64 below holds it), 1 for a number control (its slot) and 2 for an f64 of the item's own writes (its
address); it sets f64 0 or f64 1 of its part, the field the table below names first or second.

| Kind | f64 0 | f64 1 | f64 2 | f64 3 |
|---|---|---|---|---|
| `source_dc` | `v` (set 0) | | `r_internal` | |
| `source_ac` | `v_rms` (set 0) | `f` (set 1) | `r_internal` | `phase`, degrees |
| `resistor`, `fault` | `r` (set 0) | | | |
| `load` | `p_rated` (set 0) | `v_rated` (set 1) | | |
| `fuse` | `rating` | τ, its curve's time constant | | |
| `wire` | `length` | `area` | n, its material's carrier density | |
| `breaker` | `rating` | its curve's magnetic multiple | τ, 60 s | its opening heat, 1.69 |
| `rcd` | `rating` | `test_r`, 0 with none | its time at its rating, 0.2 s | its floor, 0.01 s |
| `transformer` | n1 | n2 | | |

τ, n, the multiples and the RCD's times are the pack's constants (pack.json: `interfaces["circuit@2"].constants`,
each with its source), copied by the check: `curves.fast.tau` 1 s and `curves.slow.tau` 10 s; `carriers.copper`
8.5 × 10²⁸ m⁻³ and `carriers.aluminium` 1.8 × 10²⁹ m⁻³; `breaker.tau` 60 s, `breaker.heat_open` 1.69 and
`breaker.curves` B 4, C 7.5 and D 15; `rcd.time` 0.2 s and `rcd.floor` 0.01 s. The check refuses, each naming the
part (`"part"`): a part of a kind circuit@2 can't model (a diode, say), a field a kind doesn't take, a number or a
range out of its field's range, a node or part it names that isn't there, a meter or wire on a meter or wire, an input
the item doesn't read as a number control, an array of another item (`<item>.<name>[<index>]`) or one the item doesn't
write, of the wrong type or past its end, and a DC source in a network a transformer's winding joins (`"parts"`, the
source and the transformer).

A control's slot in the read region holds that step's entries only (a u32 count, 4 zero bytes, then 16 bytes an
entry: a u32 player, 4 zero bytes, the f64 value), so the library keeps each input's and set field's latest value: 0
before its first entry, and the last of the step's first 16 entries from then. An array element is read at the solve
of the step, after the item's program wrote it.

## circuit.state@2

From `s`. **The head is the layout's arrays**, for the table's N nodes and P parts, each 8-aligned in this order,
which is the order and placement the logic module gives an item's writes declared so. A piece declares them first and
publishes them by copying the head over its write region after its calls; a bound value then reads each as
`<logic ID>.<name>[<index>]`. The item's own arrays a circuit reads come after the head.

| Array | Type × count | Unit | Holds, at the step solved |
|---|---|---|---|
| `v` | f64 × N | V | each node's instantaneous volts above node 0, the reference |
| `i_rms` | f64 × P | A | each part's rms current: an RCD's live pole's, a transformer's primary's; 0 for a meter, a wire, an open part |
| `i` | f64 × P | A | its instantaneous current from `from` to `to` (a changeover's from `common` to the way it is at; a source's positive while it gives power) |
| `p` | f64 × P | W | its mean power: a source's given at its terminals, any other part's taken (an RCD's test path's; a breaker, a changeover and a transformer none) |
| `r` | f64 × P | Ω | its resistance as modelled, from its set values as held: a load's `v_rated² ÷ p_rated`, a resistor's or fault's `r`, a source's `r_internal`; 0 for the rest |
| `on` | i32 × P | | 1 while it conducts; a fuse's, a breaker's and an RCD's state; a changeover's way, 1 at `a` and 2 at `b`; 0 for meters and wires |
| `energy` | f64 × P | J | a meter's energy: its part's `p` × 1 ÷ per summed over the steps solved, this step's included |
| `kwh` | f64 × P | kWh | the same ÷ 3,600,000 |
| `drift` | f64 × P | m/s | a wire's electrons' rms drift speed, its part's `i_rms` ÷ (n × area × 10⁻⁶ × e) |
| `drift_x` | f64 × P | m | their displacement from rest: the closed-form integral of its part's `i` ÷ (n A e) from the run's start |
| `heat` | f64 × P | | a fuse's or a breaker's θ after the step |
| `residual` | f64 × P | A | an RCD's residual: the rms of its two poles' currents summed, each from the supply side to the load side |
| `i2_rms` | f64 × P | A | an RCD's neutral pole's rms current, a transformer's secondary's |
| `i2` | f64 × P | A | its instantaneous current, from its `from` to its `to` |

For 64 nodes and 128 parts the head is 13,312 bytes. The library's own bytes start at `s + 13,312` (past the largest
head, so `solve`, which isn't given the table, finds the counts there) and run to under `s + 1 MiB`: the inputs' and
set fields' latest values, the values held, each fuse's and breaker's heat, each RCD's count, the closed set solved,
each wire's displacement where the closed set last changed, each part's and node's phasors by frequency, and the matrix
the nodal solve eliminates, with room for two branches a part.

## The exports

| Export | Signature | Does |
|---|---|---|
| `node` | (s, g, i) → i32 | adds node i; i, or −1 out of range or added before |
| `source_dc` … `fault`, `breaker`, `rcd`, `changeover`, `transformer` | (s, g, i) → i32 | adds part i, which must be of the export's kind; i, or −1. A part not added is out of the circuit |
| `solve` | (s, r, k i64, per i64) → i32 | solves step k at t = k ÷ per s, each step 1 ÷ per s long, reading inputs from the read region at r and the item's arrays; 1, or 0 with no single solution |

## The solve

- **Nodal analysis**, as circuit@1's: the unknowns are the volts of nodes 1 … N − 1 and a current for each branch of
  its own: a switch, a connector, a closed fuse or breaker, a resistor or fault of 0 Ω, a source with no internal
  resistance, a changeover's joined way, an RCD's two closed poles and a transformer's two windings. An RCD's test path
  is a conductance of 1 ÷ `test_r` from its load-side live to its supply-side neutral while `test_by` says so. A
  transformer's rows are Vs − (n2 ÷ n1) Vp = 0 and Ip + (n2 ÷ n1) Is = 0, each winding's volts and current from its
  `from` to its `to`. A part of the network that nothing joins to node 0 (a transformer's secondary, say) is held at
  0 V at its lowest node.
- **Frequencies**, as circuit@1's, each AC source at its frequency as it stands.
- **When it solves again.** When the closed set changes (an input, a fuse, a breaker, an RCD) or a set value does.
- **A set value** is the latest its control or array gives, held to its range: one below it is its min, one above it
  its max, and one that isn't finite keeps the last held. Before its first, 0 held to its range.
- **A fuse**, as circuit@1's.
- **A breaker** heats as θ ← θ e^(−dt/τ) + (rms ÷ rating)² (1 − e^(−dt/τ)) after each step, open included (its rms is
  then 0). It opens at the start of the first step θ ≥ its opening heat, or at the start of the step after one whose
  rms reached its multiple × its rating. A rising `reset_by` closes it with the heat it has.
- **An RCD** keeps a count: after a step whose residual is at or above its rating it rises by dt ÷ max(0.2 s × rating ÷
  residual, 0.01 s), after any other it is 0. Both poles open at the start of the first step the count ≥ 1. A rising
  `reset_by` closes them, the count at 0.

## The planted libraries

`src/circuit.rs` built with `--cfg no_magnetic` has breakers with no magnetic element: it holds `short`'s fault past
step 4 and fails `circuit.breaker`. `--cfg cold_reset` closes a reset breaker with no heat: it holds `overload` past
step 1,220 and fails `circuit.breaker`. `--cfg one_pole` takes an RCD's residual from its live pole alone: it reads
the lamp's 0.26087 A in `leak` and opens after 23 ms, failing `circuit.rcd`. `--cfg both_ways` joins a changeover's
common to both ways for the step its input changes: it lights `stair`'s lamp at step 1 and fails `circuit.kcl`.
`--cfg primary_current` has a transformer's primary carry the secondary's current: it fails `doorbell` at step 0
and `circuit.power`, a gap of 109 W. `--cfg late_set` reads each set value a step late: it fails `dimmer` at step 2
and `circuit.range`. `--cfg late_fuse` opens a fuse at ten times its curve's time: it holds `fuse` past step 28 and
fails `circuit.fuse`.
