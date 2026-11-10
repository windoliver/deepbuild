# Logic: work across steps, and rolls keyed by the action

A logic item's step has two limits. Its fuel budget caps one step at 10,000,000 fuel. Its step ceiling is the fuel one step may use in a live frame: the budget class's frame CPU × 3/4 ÷ ⌈step rate ÷ 60⌉ ÷ the host's ns per fuel unit. The ns per fuel unit was measured on the reference Mac, in the app and in headless Chrome. deep_kinds answers op step_ceilings with every class, host and rate. logic.budget fails each step past its piece's ceiling on each host it names, from the bake's fuel alone, so every machine fails the same step. A step run in a check or an export is held to the same ceiling.

An item stepping at 30 Hz or slower runs pipelined: step k + 1 runs on the logic thread across the frames that draw k − 1 to k, so its ceiling is twice the 60 Hz one.

## Split work that doesn't fit across steps

Work past the ceiling, such as an AI's turn, a search over a large grid or a level generator, goes in shares. Keep the progress in memory or in mutable globals, do a share each step under the ceiling, and show the work as pending in the arrays until it ends. Checkpoints, saves and seeks hold memory and globals, so seeking into the middle of the work equals playing.

The two searches below find the same shortest route on the same grid. They search breadth first over the four neighbours, from the start to the goal. Each reads one data asset, the grid: a u32 width, height, start cell and goal cell, then one byte a cell, row by row, 0 open and 1 wall. Each writes `done` (1 once the search has ended), `route_len` (the route's cells, start and goal included, or 0 when there is none) and `route` (the cells, start first). `grid_search` does the whole search in one step, which on a large grid passes the ceiling. `grid_search_split` does at most 20,000 cells a step, about 2,000,000 fuel, under every live class's ceiling on both hosts at 60 Hz, and keeps its queue in memory between steps.

```wat grid_search
(module
  (memory (export "memory") 128 128)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 64))
  (global (export "assets_at") i32 (i32.const 5308416))
  ;; Progress: the queue's head and tail, and 0 not started, 1 searching, 2 ended.
  (global $head (mut i32) (i32.const 0))
  (global $tail (mut i32) (i32.const 0))
  (global $state (mut i32) (i32.const 0))
  ;; Memory: done at 64, route_len at 72, route at 80; at 65,536 one byte a cell (0 unseen, 1 to 4 the
  ;; move that reached it, 5 the start); at 1,114,112 the queue, an i32 a cell; the grid at 5,308,420.
  (func (export "init") (param i64))
  (func $try (param $n i32) (param $d i32)
    (if (i32.eqz (i32.or (i32.load8_u (i32.add (i32.const 5308436) (local.get $n)))
                         (i32.load8_u (i32.add (i32.const 65536) (local.get $n)))))
      (then
        (i32.store8 (i32.add (i32.const 65536) (local.get $n)) (local.get $d))
        (i32.store (i32.add (i32.const 1114112) (i32.shl (global.get $tail) (i32.const 2))) (local.get $n))
        (global.set $tail (i32.add (global.get $tail) (i32.const 1))))))
  (func $back (param $c i32) (param $w i32) (result i32) (local $d i32)
    (local.set $d (i32.load8_u (i32.add (i32.const 65536) (local.get $c))))
    (if (result i32) (i32.eq (local.get $d) (i32.const 1)) (then (i32.sub (local.get $c) (i32.const 1)))
      (else (if (result i32) (i32.eq (local.get $d) (i32.const 2)) (then (i32.add (local.get $c) (i32.const 1)))
        (else (if (result i32) (i32.eq (local.get $d) (i32.const 3)) (then (i32.sub (local.get $c) (local.get $w)))
          (else (i32.add (local.get $c) (local.get $w)))))))))
  (func $route (param $goal i32) (param $w i32) (local $c i32) (local $n i32)
    (local.set $c (local.get $goal))
    (local.set $n (i32.const 1))
    (block $b (loop $l
      (br_if $b (i32.eq (i32.load8_u (i32.add (i32.const 65536) (local.get $c))) (i32.const 5)))
      (local.set $c (call $back (local.get $c) (local.get $w)))
      (local.set $n (i32.add (local.get $n) (i32.const 1)))
      (br $l)))
    (i32.store (i32.const 72) (local.get $n))
    (local.set $c (local.get $goal))
    (block $b (loop $l
      (local.set $n (i32.sub (local.get $n) (i32.const 1)))
      (i32.store (i32.add (i32.const 80) (i32.shl (local.get $n) (i32.const 2))) (local.get $c))
      (br_if $b (i32.eqz (local.get $n)))
      (local.set $c (call $back (local.get $c) (local.get $w)))
      (br $l))))
  (func (export "step") (param $k i64) (local $left i32) (local $c i32) (local $x i32) (local $y i32) (local $w i32) (local $h i32)
    (if (i32.eq (global.get $state) (i32.const 2)) (then (return)))
    (local.set $w (i32.load (i32.const 5308420)))
    (local.set $h (i32.load (i32.const 5308424)))
    (if (i32.eqz (global.get $state))
      (then (call $try (i32.load (i32.const 5308428)) (i32.const 5)) (global.set $state (i32.const 1))))
    ;; The share a step does: every cell here.
    (local.set $left (i32.const -1))
    (block $out (loop $each
      (if (i32.ge_u (global.get $head) (global.get $tail))
        (then (global.set $state (i32.const 2)) (i32.store (i32.const 64) (i32.const 1)) (return)))
      (br_if $out (i32.eqz (local.get $left)))
      (local.set $left (i32.sub (local.get $left) (i32.const 1)))
      (local.set $c (i32.load (i32.add (i32.const 1114112) (i32.shl (global.get $head) (i32.const 2)))))
      (global.set $head (i32.add (global.get $head) (i32.const 1)))
      (if (i32.eq (local.get $c) (i32.load (i32.const 5308432)))
        (then (call $route (local.get $c) (local.get $w)) (global.set $state (i32.const 2))
          (i32.store (i32.const 64) (i32.const 1)) (return)))
      (local.set $x (i32.rem_u (local.get $c) (local.get $w)))
      (local.set $y (i32.div_u (local.get $c) (local.get $w)))
      (if (i32.lt_u (i32.add (local.get $x) (i32.const 1)) (local.get $w)) (then (call $try (i32.add (local.get $c) (i32.const 1)) (i32.const 1))))
      (if (local.get $x) (then (call $try (i32.sub (local.get $c) (i32.const 1)) (i32.const 2))))
      (if (i32.lt_u (i32.add (local.get $y) (i32.const 1)) (local.get $h)) (then (call $try (i32.add (local.get $c) (local.get $w)) (i32.const 3))))
      (if (local.get $y) (then (call $try (i32.sub (local.get $c) (local.get $w)) (i32.const 4))))
      (br $each)))))
```

```json grid_search
{"writes": {"done": {"type": "i32"}, "route_len": {"type": "i32"}, "route": {"type": "i32", "count": 4096}}, "budget": {"fuel": 10000000, "memory": 8}}
```

`grid_search_split` is the same program but for the share a step does: 20,000 cells, not every cell.

```wat grid_search_split
(module
  (memory (export "memory") 128 128)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 64))
  (global (export "assets_at") i32 (i32.const 5308416))
  ;; Progress: the queue's head and tail, and 0 not started, 1 searching, 2 ended.
  (global $head (mut i32) (i32.const 0))
  (global $tail (mut i32) (i32.const 0))
  (global $state (mut i32) (i32.const 0))
  ;; Memory: done at 64, route_len at 72, route at 80; at 65,536 one byte a cell (0 unseen, 1 to 4 the
  ;; move that reached it, 5 the start); at 1,114,112 the queue, an i32 a cell; the grid at 5,308,420.
  (func (export "init") (param i64))
  (func $try (param $n i32) (param $d i32)
    (if (i32.eqz (i32.or (i32.load8_u (i32.add (i32.const 5308436) (local.get $n)))
                         (i32.load8_u (i32.add (i32.const 65536) (local.get $n)))))
      (then
        (i32.store8 (i32.add (i32.const 65536) (local.get $n)) (local.get $d))
        (i32.store (i32.add (i32.const 1114112) (i32.shl (global.get $tail) (i32.const 2))) (local.get $n))
        (global.set $tail (i32.add (global.get $tail) (i32.const 1))))))
  (func $back (param $c i32) (param $w i32) (result i32) (local $d i32)
    (local.set $d (i32.load8_u (i32.add (i32.const 65536) (local.get $c))))
    (if (result i32) (i32.eq (local.get $d) (i32.const 1)) (then (i32.sub (local.get $c) (i32.const 1)))
      (else (if (result i32) (i32.eq (local.get $d) (i32.const 2)) (then (i32.add (local.get $c) (i32.const 1)))
        (else (if (result i32) (i32.eq (local.get $d) (i32.const 3)) (then (i32.sub (local.get $c) (local.get $w)))
          (else (i32.add (local.get $c) (local.get $w)))))))))
  (func $route (param $goal i32) (param $w i32) (local $c i32) (local $n i32)
    (local.set $c (local.get $goal))
    (local.set $n (i32.const 1))
    (block $b (loop $l
      (br_if $b (i32.eq (i32.load8_u (i32.add (i32.const 65536) (local.get $c))) (i32.const 5)))
      (local.set $c (call $back (local.get $c) (local.get $w)))
      (local.set $n (i32.add (local.get $n) (i32.const 1)))
      (br $l)))
    (i32.store (i32.const 72) (local.get $n))
    (local.set $c (local.get $goal))
    (block $b (loop $l
      (local.set $n (i32.sub (local.get $n) (i32.const 1)))
      (i32.store (i32.add (i32.const 80) (i32.shl (local.get $n) (i32.const 2))) (local.get $c))
      (br_if $b (i32.eqz (local.get $n)))
      (local.set $c (call $back (local.get $c) (local.get $w)))
      (br $l))))
  (func (export "step") (param $k i64) (local $left i32) (local $c i32) (local $x i32) (local $y i32) (local $w i32) (local $h i32)
    (if (i32.eq (global.get $state) (i32.const 2)) (then (return)))
    (local.set $w (i32.load (i32.const 5308420)))
    (local.set $h (i32.load (i32.const 5308424)))
    (if (i32.eqz (global.get $state))
      (then (call $try (i32.load (i32.const 5308428)) (i32.const 5)) (global.set $state (i32.const 1))))
    ;; The share a step does: 20,000 cells.
    (local.set $left (i32.const 20000))
    (block $out (loop $each
      (if (i32.ge_u (global.get $head) (global.get $tail))
        (then (global.set $state (i32.const 2)) (i32.store (i32.const 64) (i32.const 1)) (return)))
      (br_if $out (i32.eqz (local.get $left)))
      (local.set $left (i32.sub (local.get $left) (i32.const 1)))
      (local.set $c (i32.load (i32.add (i32.const 1114112) (i32.shl (global.get $head) (i32.const 2)))))
      (global.set $head (i32.add (global.get $head) (i32.const 1)))
      (if (i32.eq (local.get $c) (i32.load (i32.const 5308432)))
        (then (call $route (local.get $c) (local.get $w)) (global.set $state (i32.const 2))
          (i32.store (i32.const 64) (i32.const 1)) (return)))
      (local.set $x (i32.rem_u (local.get $c) (local.get $w)))
      (local.set $y (i32.div_u (local.get $c) (local.get $w)))
      (if (i32.lt_u (i32.add (local.get $x) (i32.const 1)) (local.get $w)) (then (call $try (i32.add (local.get $c) (i32.const 1)) (i32.const 1))))
      (if (local.get $x) (then (call $try (i32.sub (local.get $c) (i32.const 1)) (i32.const 2))))
      (if (i32.lt_u (i32.add (local.get $y) (i32.const 1)) (local.get $h)) (then (call $try (i32.add (local.get $c) (local.get $w)) (i32.const 3))))
      (if (local.get $y) (then (call $try (i32.sub (local.get $c) (local.get $w)) (i32.const 4))))
      (br $each)))))
```

```json grid_search_split
{"writes": {"done": {"type": "i32"}, "route_len": {"type": "i32"}, "route": {"type": "i32", "count": 4096}}, "budget": {"fuel": 10000000, "memory": 8}}
```

## Key a game's rolls by the action

A game draws its rolls, such as a hit, a drop or a die, from streams keyed by the seed `init` gets and the action's number, never from the step's seed. So the step a click lands on can't change a roll, and a throw stamped one step later rolls the same face. The grid core kit's check rng.timing holds a game to this: it replays each run with an action stamped one step later and requires the same outcome.

`dice` reads the control `roll`. Each entry of it a step reads is one throw, numbered 1, 2, 3 and on in the order the track gives them. Each throw's face, 1 to 6, comes from hash(the seed `init` got, the throw's number), and `die` holds the latest throw's face, 0 before the first.

```wat dice
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 512))
  ;; Reads: roll's entry count at 0, the step's seed at 264. Writes: die at 512. The seed init got at
  ;; 1,024 and the throws so far at 1,032.
  (func (export "init") (param $seed i64) (i64.store (i32.const 1024) (local.get $seed)))
  (func (export "step") (param $k i64) (local $n i32) (local $key i64) (local $x i64)
    (local.set $n (i32.load (i32.const 0)))
    (block $done (loop $each
      (br_if $done (i32.eqz (local.get $n)))
      (local.set $n (i32.sub (local.get $n) (i32.const 1)))
      (i32.store (i32.const 1032) (i32.add (i32.load (i32.const 1032)) (i32.const 1)))
      (local.set $key (i64.load (i32.const 1024)))
      ;; splitmix64 of the key and the throw's number
      (local.set $x (i64.add (local.get $key) (i64.mul (i64.extend_i32_u (i32.load (i32.const 1032))) (i64.const -7046029254386353131))))
      (local.set $x (i64.mul (i64.xor (local.get $x) (i64.shr_u (local.get $x) (i64.const 30))) (i64.const -4658895280553007687)))
      (local.set $x (i64.mul (i64.xor (local.get $x) (i64.shr_u (local.get $x) (i64.const 27))) (i64.const -7723592293110705685)))
      (local.set $x (i64.xor (local.get $x) (i64.shr_u (local.get $x) (i64.const 31))))
      (i32.store (i32.const 512) (i32.add (i32.wrap_i64 (i64.rem_u (local.get $x) (i64.const 6))) (i32.const 1)))
      (br $each))))
)
```

```json dice
{"reads": ["roll"], "writes": {"die": {"type": "i32"}}}
```
