# lanes@1's layouts

Two layouts a lanes@1 library and the logic module agree on (#981): the **built graph**, which the check makes from a
logic item's `lanes` and the piece's floor paths and copies to the item's asset 0, and **`lanes.state@1`**, the state a
library keeps from the address `s` its caller gives `graph`. Every number is little-endian; every address is an i32
into the caller's memory; f64 fields sit at offsets that are multiples of 8 from their section's start.

## The built graph

The bytes from `g` (asset 0's bytes: `assets_at + 4`). A header of 128 bytes, then eight sections, each at the offset
its header field gives, from `g`.

| Offset | Field |
|---|---|
| 0 | i32 version, 1 |
| 4, 8, 12, 16, 20, 24 | i32 N nodes, E edges, A arcs, Z zones, B bays, P points |
| 28 | i32 0 |
| 32 … 60 | i32 offsets of nodes, edges, arcs, zones, bays, points, out, inc |
| 64 … 120 | f64 the vehicle kind: length, width, gap, speed, accel, decel, lift max, lift speed (0, 0 without a lift) |

- **Nodes** (32 B each): f64 x, f64 y, i32 degree (path ends there), i32 its junction's zone or −1, 8 B zero. A node of
  degree 3 or more is a junction.
- **Edges** (48 B each), one per path in `lanes.graph.paths`, **in path ID order**, so a lower edge is a lower ID:
  i32 from node, i32 to node (its first point's and its last's), i32 two-way, i32 first zone, i32 zone count, i32 first
  point, i32 point count, 4 B zero, f64 length, f64 speed limit.
- **Arcs** (24 B each): edge e's forward arc, then its backward one if it is two-way, edge by edge: i32 edge, i32
  backward (0 or 1), i32 from node, i32 to node, f64 time (length ÷ limit).
- **Zones** (24 B each): i32 kind (0 an edge's own zone, 1 a junction's), i32 its edge or its node, f64 a, f64 b: an
  edge's zone covers [a, b] along its edge from its first point; a junction's zone (a = b = 0) covers r = (length +
  gap) ÷ 2 along each path that ends at its node. Each edge's own zones are its stretch between its junctions' reach,
  cut into max(1, ⌊stretch ÷ (length + gap)⌋) equal zones, named `<path ID>.<i>` from its first point; a junction's is
  named `junction:` and the sorted IDs of the paths ending there, joined by `,`. Edges' zones come first, edge by
  edge, then junctions' by node.
- **Bays** (32 B each), in the order `lanes.graph.bays` lists them: i32 node, 4 B zero, f64 heading at placement (the
  direction from the bay into the first path, in `paths` order, that ends there), f64 its unit x, f64 its unit y.
- **Points** (24 B each), each edge's polyline in turn: f64 x, f64 y, f64 distance along the edge.
- **Out**: N + 1 i32 starts, then A i32 arc IDs: node n's arcs out are entries start[n] to start[n + 1] − 1.
- **Inc**: N + 1 i32 starts, then 2E i32 entries 2 × edge + end (0 its first point, 1 its last): the path ends at each
  node.

## lanes.state@1

From `s`, at most 1 MiB for up to 64 vehicles, 512 paths and 128 bays. The library touches nothing else of its
caller's but what `go` writes at `out`. Addresses the header holds are absolute: the state stays where `graph` put it.

| Offset | Field |
|---|---|
| 0 | i32 g, the built graph |
| 4 | i32 vehicles placed |
| 8 … 24 | i32 N, E, A, Z, B, copied from the graph |
| 28 | i32 the state's size in bytes |
| 32 … 60 | i32 the graph's sections, as addresses |
| 64 … 96 | i32 addresses of the holders, the vehicle rows, the search's best times, arcs in, done marks, heap, and a step's speed segments' ends, caps and a route's scratch |
| 100 | i32 the heap's capacity, A + N + 1 |
| 104 | f64 scratch |
| 112 … 168 | f64 the vehicle kind, as the graph gives it |
| 176, 184 | f64 the junction reach r, half a length |
| 192 | i32 × Z each zone's holder, or −1 |

**Vehicle rows**, 5,024 B each, 64 of them, 8-aligned after the holders:

| Offset | Field |
|---|---|
| 0 … 96 | f64 its centre along its route, speed, x, y, heading, heading's unit x and y, fork height, fork target, load x, load height, load y, route length |
| 104 … 144 | i32 the node it is at, arcs in its route (0: none), the arc its centre is on, carrying (0 or 1), the vehicle it waits on (−1), the zone it waits for (−1), the next zone slot to ask and its arc, slots in its route, zones it holds, its goal node |
| 152 | i32 × 256 its route's arcs |
| 1,176 | i32 × 256 each arc's first zone slot |
| 2,200 | f64 × 257 each arc's start along the route, then the route's end |
| 4,256 | 32 × {i32 zone, 4 B, f64 from, f64 to}: the zones it holds, where each starts and ends along its route |

A route's zone slots: slot 0, the start node's junction; then for each arc its edge's own zones in travel order and
the node it ends at (a junction's zone, or, at the goal, the other path's zone the vehicle's footprint reaches there
when the goal has two path ends).

## What go writes

At `out`, for the V vehicles placed, each array 8-aligned in this order: `pos` vec2 ×V (the centre), `heading` f64 ×V,
`speed` f64 ×V, `state` i32 ×V (0 parked, 1 driving, 2 waiting, 3 lifting, 4 lowering), `fork` f64 ×V, `load` vec3 ×V
(`[x, height, y]`: on the forks while carried, where `set_down` left it after, `[0, 0, 0]` before any `carry`).
