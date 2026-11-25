# circuit@1's layouts

Two layouts a circuit@1 library, a piece and the logic module agree on (#1181): the **built table**, which the check
makes from a logic item's `circuit` and copies to the item's asset 0; and **`circuit.state@1`**, the state a library
keeps from the address `s` its caller gives the builders and `solve`. Every number is little-endian; every address is
an i32 into the caller's memory. Volts, amperes, watts, ohms, joules and seconds are SI; an area is in mm².

## The built table

The bytes from `g` (asset 0's bytes: `assets_at + 4`). A header of 64 bytes, then 64 bytes a part, in the order
`circuit.parts` lists them, so part i is `parts[i]` everywhere.

| Offset | Field |
|---|---|
| 0 | i32 version, 1 |
| 4, 8 | i32 N nodes (1 to 64), P parts (at most 128) |
| 12 | i32 the parts' offset from `g`, 64 |

A part:

| Offset | Field |
|---|---|
| +0 | i32 kind: 1 `source_dc`, 2 `source_ac`, 3 `resistor`, 4 `load`, 5 `switch`, 6 `connector`, 7 `fuse`, 8 `meter`, 9 `wire`, 10 `fault` |
| +4, +8 | i32 `from` and `to`, each a node's index in `circuit.nodes`; −1 for a meter and a wire |
| +12 | i32 the offset in the item's read region of the control that closes it (`closed_by`, a fault's `on_by`), −1 with none |
| +16 | i32 the part a meter is `on` or a wire's `part`, by index; −1 for the rest |
| +20 | i32 the offset of the control that resets a fuse (`reset_by`), −1 with none |
| +24, +28 | zero |
| +32 … +56 | four f64, by kind (below) |

| Kind | f64 0 | f64 1 | f64 2 | f64 3 |
|---|---|---|---|---|
| `source_dc` | `v` | | `r_internal` | |
| `source_ac` | `v_rms` | `f` | `r_internal` | `phase`, degrees |
| `resistor`, `fault` | `r` | | | |
| `load` | `p_rated` | `v_rated` | | |
| `fuse` | `rating` | τ, its curve's time constant | | |
| `wire` | `length` | `area` | n, its material's carrier density | |

τ and n are the pack's constants (pack.json: `interfaces["circuit@1"].constants`, each with its source), copied by
the check: `curves.fast.tau` 1 s and `curves.slow.tau` 10 s; `carriers.copper` 8.5 × 10²⁸ m⁻³ and
`carriers.aluminium` 1.8 × 10²⁹ m⁻³. The check refuses a part of a kind circuit@1 can't model (a diode, say), a field
a kind doesn't take, a number out of range, a node or part it names that isn't there, a meter or wire on a meter or
wire, and an input the item doesn't read as a number control, each naming the part (`"part"`).

A control's slot in the read region holds that step's entries only (a u32 count, 4 zero bytes, then 16 bytes an
entry: a u32 player, 4 zero bytes, the f64 value), so the library keeps each input's latest value: 0 before its first
entry, and the last entry's value from then. A switch, a connector or a fault conducts while that value is nonzero.

## circuit.state@1

From `s`. **The head is the layout's arrays**, for the table's N nodes and P parts, each 8-aligned in this order,
which is the order and placement the logic module gives an item's writes declared so. A piece declares them first and
publishes them by copying the head over its write region after its calls; a bound value then reads each as
`<logic ID>.<name>[<index>]`.

| Array | Type × count | Unit | Holds, at the step solved |
|---|---|---|---|
| `v` | f64 × N | V | each node's instantaneous volts above node 0, the reference |
| `i_rms` | f64 × P | A | each part's rms current; 0 for a meter, a wire, an open part |
| `i` | f64 × P | A | its instantaneous current from `from` to `to` (a source's positive while it gives power) |
| `p` | f64 × P | W | its mean power: a source's given at its terminals, any other part's taken |
| `r` | f64 × P | Ω | its resistance as modelled: a load's `v_rated² ÷ p_rated`, a resistor's or fault's `r`, a source's `r_internal`; 0 for the rest |
| `on` | i32 × P | | 1 while it conducts; a fuse's state; 0 for meters and wires |
| `energy` | f64 × P | J | a meter's energy: its part's `p` × 1 ÷ per summed over the steps solved, this step's included |
| `kwh` | f64 × P | kWh | the same ÷ 3,600,000 |
| `drift` | f64 × P | m/s | a wire's electrons' rms drift speed, its part's `i_rms` ÷ (n × area × 10⁻⁶ × e) |
| `drift_x` | f64 × P | m | their displacement from rest: the closed-form integral of its part's `i` ÷ (n A e) from the run's start |

For N = 3 and P = 5 the head is 368 bytes; for 64 nodes and 128 parts, 9,216. The library's own bytes start at
`s + 9,216` (past the largest head, so `solve`, which isn't given the table, finds the counts there) and run to about
`s + 360,200`: the inputs' latest values, each fuse's heat, the closed set solved, each wire's displacement where the
closed set last changed, each part's and node's phasors by frequency, and the matrix the nodal solve eliminates.

## The exports

| Export | Signature | Does |
|---|---|---|
| `node` | (s, g, i) → i32 | adds node i; i, or −1 out of range or added before |
| `source_dc` … `fault` | (s, g, i) → i32 | adds part i, which must be of the export's kind; i, or −1. A part not added is out of the circuit |
| `solve` | (s, r, k i64, per i64) → i32 | solves step k at t = k ÷ per s, each step 1 ÷ per s long, reading inputs from the read region at r; 1, or 0 with no single solution |

## The solve

- **Nodal analysis.** The unknowns are the volts of nodes 1 … N − 1 and the current of each closed part with no
  resistance (a switch, a connector, a closed fuse, a resistor or fault of 0 Ω, a source with no internal resistance),
  modified nodal analysis; a source behind its internal resistance is its Norton equivalent. A part of the network that
  nothing joins to node 0 is held at 0 V at its lowest node. Gaussian elimination with partial pivoting.
- **Frequencies.** Every part is resistive, so the network is solved once for DC (when a DC source is added) and once
  for each AC frequency, each with that frequency's sources as phasors of their rms values, `v_rms (cos φ, sin φ)`, the
  others shorted. A part's rms current is √(Σ |I|²); a resistive part's mean power R × rms²; a source's Σ Re(V I*) at
  its terminals; its instantaneous current Σ √2 (Re I sin ωt + Im I cos ωt), DC as it is, with ωt = 2π × frac(f × k ÷
  per) and the sine and cosine by quarter-turn reduction and fixed kernels, so a step of any length lands on the wave
  and every host gives the same bits.
- **When it solves again.** Only when the closed set changes (an input, a fuse); between, a step is closed forms.
- **A fuse** heats as θ ← θ e^(−dt/τ) + (rms ÷ rating)² (1 − e^(−dt/τ)) after each step it conducts, exact for a
  current held over the step, and opens at the start of the first step θ ≥ 1: at a steady I past its rating, τ ln(I² ÷
  (I² − rating²)) after it began. It stays open until its `reset_by` input turns nonzero, when it closes cold.
- **A wire's displacement** is carried across each change of the closed set: at the step it changes, the integral to
  then under the old currents is kept, and the new currents' closed form runs from there.

## The planted libraries

`src/circuit.rs` built with `--cfg kept_current` keeps every part's `i_rms`, `i` and `p` from the step before while a
connector is open (the open connector writes 0), so its two nodes don't balance: it fails the `plug` fixture at step
3 and `circuit.kcl`. With `--cfg rated_meter` a meter on a load adds the load's `p_rated` × 1 ÷ per each step, so it
counts with the switch open: it fails `kettle` at step 1 and `circuit.power`. With `--cfg late_fuse` a fuse's time
constant is ten times its curve's, so it opens at ten times its curve's time: it fails `fault` at step 28 and
`circuit.fuse`.
