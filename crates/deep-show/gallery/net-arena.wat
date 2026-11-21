;; The eight-seat fixture beside the two-player rally (#280; Net `net@1`, Check input: net kinds):
;; eight movers driven by their players' entries, 100 projectiles each tested against 64 boxes, and
;; a 128 × 128 grid stamped 3 times a step. net.budget reports the window each host fits from it,
;; net.rollback plays it with players 8, and net.feel's own criteria play it on a seeded network.
;; The item `arena` reads the sliders move1 … move8 (−1 to 1): each entry sets its seat's mover
;; moving at 10 m/s that way (1/6 m a 60 Hz step), which keeps moving until the next.
;; Region map (check computes it, in declaration order): reads move1 … move8 at 0, 264, …, 1848
;; (264 B each: a u32 count, 4 zero bytes, then 16 entries of a u32 player, 4 zero bytes and an
;; f64), seed at 2112; writes movers 0 (8 f64, each mover's x in m), hits 64, stamped 72.
;; Carried state outside the regions: each mover's direction at 8192 (8 f64), the projectiles at
;; 12288 (100 × x, y, vx, vy in f64), the boxes at 16384 (64 × x0, y0, x1, y1 in f64) and the
;; grid, 128 × 128 i32 cells, filling page 1 (65536).
(module
  (memory (export "memory") 2 2)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func (export "init") (param $seed i64)
    (local $i i32) (local $a i32) (local $s f64)
    ;; 100 projectiles spread over the 128 × 128 field, each with its own velocity.
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (i32.const 100)))
      (local.set $a (i32.add (i32.const 12288) (i32.shl (local.get $i) (i32.const 5))))
      (local.set $s (select (f64.const 1) (f64.const -1) (i32.and (local.get $i) (i32.const 1))))
      (f64.store (local.get $a)
        (f64.add (f64.convert_i32_u (i32.rem_u (i32.mul (local.get $i) (i32.const 53)) (i32.const 128))) (f64.const 0.25)))
      (f64.store offset=8 (local.get $a)
        (f64.add (f64.convert_i32_u (i32.rem_u (i32.mul (local.get $i) (i32.const 17)) (i32.const 128))) (f64.const 0.75)))
      (f64.store offset=16 (local.get $a)
        (f64.mul (local.get $s)
          (f64.add (f64.const 0.5) (f64.mul (f64.convert_i32_u (i32.rem_u (local.get $i) (i32.const 5))) (f64.const 0.1)))))
      (f64.store offset=24 (local.get $a)
        (f64.mul (local.get $s)
          (f64.add (f64.const 0.3) (f64.mul (f64.convert_i32_u (i32.rem_u (local.get $i) (i32.const 7))) (f64.const 0.05)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    ;; 64 boxes, an 8 × 8 lattice of 8 m squares 16 m apart.
    (local.set $i (i32.const 0))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (i32.const 64)))
      (local.set $a (i32.add (i32.const 16384) (i32.shl (local.get $i) (i32.const 5))))
      (f64.store (local.get $a)
        (f64.convert_i32_u (i32.add (i32.shl (i32.and (local.get $i) (i32.const 7)) (i32.const 4)) (i32.const 4))))
      (f64.store offset=8 (local.get $a)
        (f64.convert_i32_u (i32.add (i32.shl (i32.shr_u (local.get $i) (i32.const 3)) (i32.const 4)) (i32.const 4))))
      (f64.store offset=16 (local.get $a) (f64.add (f64.load (local.get $a)) (f64.const 8)))
      (f64.store offset=24 (local.get $a) (f64.add (f64.load offset=8 (local.get $a)) (f64.const 8)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each))))
  ;; Each seat's entries set its mover's direction; every mover then moves 1/6 m that way.
  (func $movers
    (local $p i32) (local $slot i32) (local $n i32) (local $e i32) (local $d i32)
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $p) (i32.const 8)))
      (local.set $slot (i32.mul (local.get $p) (i32.const 264)))
      (local.set $d (i32.add (i32.const 8192) (i32.shl (local.get $p) (i32.const 3))))
      (local.set $n (i32.load (local.get $slot)))
      (local.set $e (i32.const 0))
      (block $read (loop $entry
        (br_if $read (i32.ge_u (local.get $e) (local.get $n)))
        (f64.store (local.get $d)
          (f64.load offset=16 (i32.add (local.get $slot) (i32.shl (local.get $e) (i32.const 4)))))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $entry)))
      (f64.store (i32.add (i32.const 4096) (i32.shl (local.get $p) (i32.const 3)))
        (f64.add (f64.load (i32.add (i32.const 4096) (i32.shl (local.get $p) (i32.const 3))))
                 (f64.div (f64.mul (f64.load (local.get $d)) (f64.const 10)) (f64.const 60))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br $each))))
  ;; Each projectile moves, turning back at the field's edges, and is tested against every box.
  (func $projectiles
    (local $i i32) (local $j i32) (local $a i32) (local $b i32) (local $hits i32)
    (local $x f64) (local $y f64) (local $vx f64) (local $vy f64)
    (local.set $hits (i32.load (i32.const 4160)))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (i32.const 100)))
      (local.set $a (i32.add (i32.const 12288) (i32.shl (local.get $i) (i32.const 5))))
      (local.set $vx (f64.load offset=16 (local.get $a)))
      (local.set $vy (f64.load offset=24 (local.get $a)))
      (local.set $x (f64.add (f64.load (local.get $a)) (local.get $vx)))
      (local.set $y (f64.add (f64.load offset=8 (local.get $a)) (local.get $vy)))
      (if (i32.or (f64.lt (local.get $x) (f64.const 0)) (f64.gt (local.get $x) (f64.const 128)))
        (then (local.set $vx (f64.neg (local.get $vx)))
              (local.set $x (f64.add (local.get $x) (f64.mul (local.get $vx) (f64.const 2))))))
      (if (i32.or (f64.lt (local.get $y) (f64.const 0)) (f64.gt (local.get $y) (f64.const 128)))
        (then (local.set $vy (f64.neg (local.get $vy)))
              (local.set $y (f64.add (local.get $y) (f64.mul (local.get $vy) (f64.const 2))))))
      (local.set $j (i32.const 0))
      (block $tested (loop $box
        (br_if $tested (i32.ge_u (local.get $j) (i32.const 64)))
        (local.set $b (i32.add (i32.const 16384) (i32.shl (local.get $j) (i32.const 5))))
        (if (i32.and
              (i32.and (f64.ge (local.get $x) (f64.load (local.get $b)))
                       (f64.le (local.get $x) (f64.load offset=16 (local.get $b))))
              (i32.and (f64.ge (local.get $y) (f64.load offset=8 (local.get $b)))
                       (f64.le (local.get $y) (f64.load offset=24 (local.get $b)))))
          (then (local.set $hits (i32.add (local.get $hits) (i32.const 1)))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $box)))
      (f64.store (local.get $a) (local.get $x))
      (f64.store offset=8 (local.get $a) (local.get $y))
      (f64.store offset=16 (local.get $a) (local.get $vx))
      (f64.store offset=24 (local.get $a) (local.get $vy))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.store (i32.const 4160) (local.get $hits)))
  ;; Three stamps a step, each a 9 × 9 square of the grid around a mover, its lane its row.
  (func $stamps (param $k i64)
    (local $s i32) (local $p i32) (local $cx i32) (local $cy i32) (local $dx i32) (local $dy i32)
    (local $at i32)
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $s) (i32.const 3)))
      (local.set $p (i32.and (i32.add (i32.mul (i32.wrap_i64 (local.get $k)) (i32.const 3)) (local.get $s)) (i32.const 7)))
      (local.set $cx (i32.and
        (i32.add (i32.trunc_f64_s (f64.load (i32.add (i32.const 4096) (i32.shl (local.get $p) (i32.const 3)))))
                 (i32.const 64))
        (i32.const 127)))
      (local.set $cy (i32.add (i32.shl (local.get $p) (i32.const 4)) (i32.const 8)))
      (local.set $dy (i32.const -4))
      (block $rows (loop $row
        (br_if $rows (i32.gt_s (local.get $dy) (i32.const 4)))
        (local.set $dx (i32.const -4))
        (block $cols (loop $col
          (br_if $cols (i32.gt_s (local.get $dx) (i32.const 4)))
          (local.set $at (i32.add (i32.const 65536)
            (i32.shl
              (i32.add (i32.shl (i32.and (i32.add (local.get $cy) (local.get $dy)) (i32.const 127)) (i32.const 7))
                       (i32.and (i32.add (local.get $cx) (local.get $dx)) (i32.const 127)))
              (i32.const 2))))
          (i32.store (local.get $at) (i32.add (i32.load (local.get $at)) (i32.const 1)))
          (local.set $dx (i32.add (local.get $dx) (i32.const 1)))
          (br $col)))
        (local.set $dy (i32.add (local.get $dy) (i32.const 1)))
        (br $row)))
      (i32.store (i32.const 4168) (i32.add (i32.load (i32.const 4168)) (i32.const 1)))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br $each))))
  (func (export "step") (param $k i64)
    (call $movers)
    (call $projectiles)
    (call $stamps (local.get $k))))
