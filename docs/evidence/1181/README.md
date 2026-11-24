# Evidence for #1181: circuit@1

This folder shows circuit@1 driving a document, and its outputs checked against values worked by hand. Everything here
was taken at the branch's merge commit `4ea19282a`, on the reference library `circuit_ref@1.0.0`. None of it is a
test: the criteria are proven by `tests/acceptance/1181/`, and no test reads these files.

## The pictures: frames the canvas engine drew

The document has a 4.6 W lamp on 230 V, 50 Hz, behind a 3 A fast fuse, at 60 steps a second. Its logic item runs this
circuit, linking `circuit_ref@1.0.0`:

```text
mains   source_ac  neutral → live    230 V rms, 50 Hz
plug    connector  live → pin        closed by plug_in
fuse    fuse       pin → fused       3 A, fast
lamp    load       fused → neutral   4.6 W at 230 V
fault   fault      fused → case      1 Ω, on by fault
earth   resistor   case → neutral    0 Ω
meter   meter      on lamp
flex    wire       on lamp           2 m, 0.75 mm², copper
```

`deep-show run` presented it (`deep_show`), loaded the input track with the `track` call (`plug_in` true at 1 s,
`fault` true at 5 s), and took four screenshots with `eval` and 480 frames with `frames`. The frames are encoded at 60
frames a second as `lamp-plug-fuse.mp4`, scaled to 1280 px wide with nearest-neighbour. What moves on screen is set by
drivers reading the logic item's arrays:
- the lamp's opacity from its power `p`;
- the plug's position from its `on`;
- the fuse's label and shade from its `on`;
- the spark from the fault's `i_rms`;
- the electron dot from the flex's `drift_x`, × 3 × 10⁹;
- the bar from the lamp's instantaneous `i`;
- the five readouts, text counters, from `i_rms`, `p` and `energy`.

| File | Time | The readouts drawn (`texts.json`) | Worked by hand |
|---|---|---|---|
| `1-plug-out.png` | 0.5 s | lamp 0.00 A, 0.0 W, meter 0.00 J, fuse 0.00 A, earth 0.00 A | plug out: no current |
| `2-lit.png` | 3.0 s | lamp 0.02 A, 4.6 W, meter 9.28 J, fuse 0.02 A, earth 0.00 A | 230 ÷ 11,500 = 0.02 A; steps 60 to 180 are 121 × 4.6 W × 1/60 s = 9.277 J |
| `3-fault-step.png` | 5.0 s | lamp 0.02 A, 4.6 W, meter 18.48 J, fuse 230.02 A, earth 230.00 A | the fault's one step: 230 ÷ 1 Ω + 0.02 A; 241 steps of meter = 18.477 J |
| `4-blown.png` | 6.5 s | lamp 0.00 A, 0.0 W, meter 18.48 J, fuse 0.00 A, earth 0.00 A, "FUSE BLOWN" | the curve's 170 µs is under one 1/60 s step, so the fuse opens at the next step and the meter stops |

## The numbers: `data.json`

`deep-logic`'s `playback` and `judge` on the blind suite's own fixtures (`tests/acceptance/1181/circuits.ts`), each on
the reference library and on the planted library for its rule.

| Quantity | Worked by hand | The library gives |
|---|---|---|
| Lamp current at t = 5 ms (crest) | 0.02 × √2 = 0.0282843 A | 0.028284271247461905 A |
| Lamp current with the plug out, step 2,003 | 0 A | 0 A |
| Meter after 998 closed steps | 998 × 4.6 W × 1 ms = 4.5908 J | 4.590799999999956 J |
| Drift speed, 0.75 mm² copper | 0.02 ÷ (8.5 × 10²⁸ × 0.75 × 10⁻⁶ × e) = 1.958120 × 10⁻⁶ m/s | 1.958120493948475 × 10⁻⁶ m/s |
| Displacement at 5 ms | A = √2 v ÷ (2π × 50) = 8.81464 × 10⁻⁹ m | 8.814639148517121 × 10⁻⁹ m |
| Displacement after one cycle | 0 m | 0 m |
| Kettle meter after 135 s | 2,400 W × 135 s = 324,000 J = 0.09 kWh | 324,000 J, 0.09 kWh |
| Fuse current with the fault on | 230.02 A | 230.02 A |
| Step the fuse opens (10 µs steps) | 1,000 + ⌈170.117 µs ÷ 10 µs⌉ = 1,018 | 1,018 (late_fuse: 1,171) |
| Earth wire before the fault | 0 A | 0 A |

The kind rules, on the reference library and the planted library for each:

| Run | Reference | Planted | Its first fail |
|---|---|---|---|
| plug out, in at 1,005, out at 2,003 | kcl, power, fuse: PASS | `kept_current`: kcl FAIL, power and fuse PASS | `{"step": 2003, "node": "live", "sum": 0.01662507751109732}` |
| kettle, 150 s at 120 Hz | kcl, power, fuse: PASS | `rated_meter`: power FAIL, kcl and fuse PASS | `{"step": 0, "meter": "meter", "gap": 20}` |
| fault at 10 µs steps | kcl, power, fuse: PASS | `late_fuse`: fuse FAIL, kcl and power PASS | `{"fuse": "fuse", "step": 1171, "expected": 1018}` |

## SHA-256

```text
1-plug-out.png      e8ee6eaf4a5547171553f24d7e8634e991ebad6109e00d398519a24712ce0ac1
2-lit.png           54c6bceb8b4b86e816b9ea2045758394755b5e134add08f73ad76969b201bceb
3-fault-step.png    eb4c1e2a4632874c4f0b0f1a4c3b3c0a67e295a0464dd8ebbec5c029c39b001d
4-blown.png         24773c570544eb383e6ab2aa2b2485fbaaed8b496e6b08e0da280917eb8abcaa
lamp-plug-fuse.mp4  64558dd31cd3ce4da06608cd3e83af3f98c2f06319caf922c63711c25b84e295
data.json           8add13d6f256c0558235cffe2473b6b25196ae6e27cd3a286a18b0c60611c51f
texts.json          acde7d6f2b9d9ab59a06d6ad9846a9620f58bb136ecb9cf00bc789819e1320f1
```
