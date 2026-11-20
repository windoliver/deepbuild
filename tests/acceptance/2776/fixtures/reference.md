# Canvas primitives, field by field: a scratch reference for the #2776 acceptance tests

Five sections in the reference's template. Four put shape, light or shading into a 3D frame, and the sealed listing beside
this file gives each of them a 3D entry or field, so each carries a Paths row; the fifth draws in 2D, and the listing
names it for nothing, so it carries none.

### Test primitives

#### Test glow

For: a glow the acceptance tests draw in 3D

**Fields**

- `size: [m, m, m] = [1, 1, 1]`

**Semantics:** A box of light in the 3D frame, drawn after lighting.

**Cost:** One box.

**It can never:** Carry a status color.

**Paths**

| Entry | rays | final | web |
|---|---|---|---|
| `test.paths.glow@1` | `same`, held by `test.paths/glow` | `not_applicable`: drawn after lighting, as in the real-time export | `refused` `test.paths.no_web` |

**Lands:** R6

#### Test halo

For: a halo the acceptance tests draw in 3D

**Fields**

- `size: [m, m, m] = [1, 1, 1]`

**Semantics:** A soft ring of light around a box in the 3D frame.

**Cost:** One box.

**It can never:** Carry a status color.

**Paths**

| Entry | rays | final | web |
|---|---|---|---|
| `test.paths.halo@1` | `refused` `path_undefined` (#2759) | `refused` `path_undefined` (#2759) | `stand_in`: nothing, the web player leaves the halo out (receipt: halo left out) |

**Lands:** R6

#### Test mist

For: a mist the acceptance tests draw in 3D

**Fields**

- `size: [m, m, m] = [1, 1, 1]`
- `depth: m = 0` (Test mist: depth)

**Semantics:** A box of mist in the 3D frame.

**Cost:** One box.

**It can never:** Carry a status color.

**Paths**

| Entry | rays | final | web |
|---|---|---|---|
| `test.paths.mist@1` | `refused` `path_undefined` (#2759) | `refused` `path_undefined` (#2759) | `refused` `path_undefined` (#2759) |

**Lands:** R6

#### Test mist: depth

For: mist that thickens with distance

**Fields**

- `depth: m = 0` (on `test.paths.mist@1`; 0 is off)

**Semantics:** With a depth, the mist's density grows over that distance from the camera.

**Cost:** One more fetch per pixel.

**It can never:** Read an earlier frame.

**Paths**

| Entry | rays | final | web |
|---|---|---|---|
| `test.paths.mist@1.depth` | `same`, held by `geometry.audit` | `refused` `path_undefined` (#2761) | `not_applicable`: the web player draws no depth fog |

**Lands:** R6

#### Test plate

For: a flat plate the acceptance tests draw in 2D

**Fields**

- `box: [x, y, w, h]`

**Semantics:** A filled box in logical pixels.

**Cost:** One quad.

**It can never:** Carry a status color.

**Lands:** R2
