;; The 8,000-agent steering fixture of spike #245 (Logic: step blocks), which #212 reuses: a logic
;; item at 60 Hz in a 2048 x 2048 world whose step bins the agents into 16-unit cells of a
;; 128 x 128 grid and whose 8 blocks steer 1,000 agents each (separation, alignment and cohesion
;; over at most 12 agents within 8, and a weak seek toward a goal of its own that moves every 2 s),
;; writing slice b of each of the two out regions, NPOS and NVEL, and each agent's near
;; count in scratch. `join` copies NPOS and NVEL back over POS and VEL.
;;
;; Fields as #212 declares them: parallel {blocks: 8, out: [{at: npos_at, stride: 16000},
;; {at: nvel_at, stride: 16000}], scratch: [{at: scratch_at, bytes: 8192}]}.
;;
;; Memory (12 pages, bytes):
;;   POS      0       8000 x (x, y) f64
;;   VEL      128000  8000 x (vx, vy) f64
;;   NPOS     256000  out 0: block b writes agents 1000b .. 1000b + 999
;;   NVEL     384000  out 1
;;   CSTART   512000  16385 i32: the first sorted index of each cell, and the end
;;   CURSOR   577540  16384 i32: counting sort's cursors
;;   CIDX     643076  8000 i32: each agent's cell
;;   SORTED   675076  8000 i32: agents by cell
;;   SCRATCH  778240  8192 bytes: one block's near counts (1,000 i32)
(module
  (memory (export "memory") 12 12)
  (global (export "reads_at") i32 (i32.const 707076))
  (global (export "writes_at") i32 (i32.const 256000))
  (global (export "npos_at") i32 (i32.const 256000))
  (global (export "nvel_at") i32 (i32.const 384000))
  (global (export "scratch_at") i32 (i32.const 778240))
  (global (export "agents") i32 (i32.const 8000))
  (global (export "blocks") i32 (i32.const 8))
  (global $rng (mut i64) (i64.const 0x245245245))

  (func $rand (result f64)
    (global.set $rng
      (i64.add (i64.mul (global.get $rng) (i64.const 6364136223846793005))
               (i64.const 1442695040888963407)))
    (f64.mul (f64.convert_i64_u (i64.shr_u (global.get $rng) (i64.const 11)))
             (f64.const 0x1p-53)))

  ;; A coordinate's grid column or row, 0 to 127.
  (func $cell (param $v f64) (result i32)
    (local $c i32)
    (local.set $c (i32.trunc_sat_f64_s (f64.mul (local.get $v) (f64.const 0.0625))))
    (if (i32.lt_s (local.get $c) (i32.const 0)) (then (local.set $c (i32.const 0))))
    (if (i32.gt_s (local.get $c) (i32.const 127)) (then (local.set $c (i32.const 127))))
    (local.get $c))

  (func (export "init")
    (local $i i32) (local $a i32)
    (loop $l
      (local.set $a (i32.shl (local.get $i) (i32.const 4)))
      (f64.store (local.get $a) (f64.mul (call $rand) (f64.const 2048)))
      (f64.store offset=8 (local.get $a) (f64.mul (call $rand) (f64.const 2048)))
      (f64.store offset=128000 (local.get $a) (f64.mul (f64.sub (call $rand) (f64.const 0.5)) (f64.const 40)))
      (f64.store offset=128008 (local.get $a) (f64.mul (f64.sub (call $rand) (f64.const 0.5)) (f64.const 40)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_u (local.get $i) (i32.const 8000)))))

  ;; Bins every agent by cell: CIDX, CSTART and SORTED.
  (func (export "step") (param $k i64)
    (local $i i32) (local $a i32) (local $c i32) (local $p i32)
    (memory.fill (i32.const 512000) (i32.const 0) (i32.const 65540))
    (loop $count
      (local.set $a (i32.shl (local.get $i) (i32.const 4)))
      (local.set $c
        (i32.add (i32.shl (call $cell (f64.load offset=8 (local.get $a))) (i32.const 7))
                 (call $cell (f64.load (local.get $a)))))
      (i32.store offset=643076 (i32.shl (local.get $i) (i32.const 2)) (local.get $c))
      (local.set $p (i32.add (i32.shl (local.get $c) (i32.const 2)) (i32.const 512004)))
      (i32.store (local.get $p) (i32.add (i32.load (local.get $p)) (i32.const 1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $count (i32.lt_u (local.get $i) (i32.const 8000))))
    (local.set $c (i32.const 1))
    (loop $sum
      (local.set $p (i32.add (i32.shl (local.get $c) (i32.const 2)) (i32.const 512000)))
      (i32.store (local.get $p)
        (i32.add (i32.load (local.get $p)) (i32.load offset=0 (i32.sub (local.get $p) (i32.const 4)))))
      (local.set $c (i32.add (local.get $c) (i32.const 1)))
      (br_if $sum (i32.le_u (local.get $c) (i32.const 16384))))
    (memory.copy (i32.const 577540) (i32.const 512000) (i32.const 65536))
    (local.set $i (i32.const 0))
    (loop $place
      (local.set $c (i32.load offset=643076 (i32.shl (local.get $i) (i32.const 2))))
      (local.set $a (i32.add (i32.shl (local.get $c) (i32.const 2)) (i32.const 577540)))
      (local.set $p (i32.load (local.get $a)))
      (i32.store offset=675076 (i32.shl (local.get $p) (i32.const 2)) (local.get $i))
      (i32.store (local.get $a) (i32.add (local.get $p) (i32.const 1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $place (i32.lt_u (local.get $i) (i32.const 8000)))))

  ;; Steers agents 1000b .. 1000b + 999 from the state the step left, into slice b of NPOS and
  ;; NVEL, counting each agent's near neighbours into scratch.
  (func (export "block") (param $k i64) (param $b i32)
    (local $i i32) (local $hi i32) (local $a i32) (local $c i32) (local $cx i32) (local $cy i32)
    (local $gx i32) (local $gy i32) (local $p i32) (local $e i32) (local $q i32) (local $h i32)
    (local $n i32) (local $t i32) (local $sxi i32) (local $syi i32)
    (local $x f64) (local $y f64) (local $vx f64) (local $vy f64) (local $tx f64) (local $ty f64)
    (local $dx f64) (local $dy f64) (local $d2 f64) (local $m f64)
    (local $sx f64) (local $sy f64) (local $lx f64) (local $ly f64) (local $ox f64) (local $oy f64)
    (local $ax f64) (local $ay f64) (local $s f64)
    (local.set $i (i32.mul (local.get $b) (i32.const 1000)))
    (local.set $hi (i32.add (local.get $i) (i32.const 1000)))
    (loop $agent
      ;; The agent's goal: a point hashed from its index and the 2 s period, so it wanders.
      (local.set $h
        (i32.xor (i32.mul (local.get $i) (i32.const 0x9E3779B1))
                 (i32.mul (i32.wrap_i64 (i64.div_u (local.get $k) (i64.const 120))) (i32.const 0x85EBCA77))))
      (local.set $h (i32.mul (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 15))) (i32.const 0x2C1B3C6D)))
      (local.set $tx (f64.convert_i32_u (i32.and (local.get $h) (i32.const 2047))))
      (local.set $ty (f64.convert_i32_u (i32.and (i32.shr_u (local.get $h) (i32.const 11)) (i32.const 2047))))
      (local.set $a (i32.shl (local.get $i) (i32.const 4)))
      (local.set $x (f64.load (local.get $a)))
      (local.set $y (f64.load offset=8 (local.get $a)))
      (local.set $vx (f64.load offset=128000 (local.get $a)))
      (local.set $vy (f64.load offset=128008 (local.get $a)))
      (local.set $c (i32.load offset=643076 (i32.shl (local.get $i) (i32.const 2))))
      (local.set $cx (i32.and (local.get $c) (i32.const 127)))
      (local.set $cy (i32.shr_u (local.get $c) (i32.const 7)))
      (local.set $sx (f64.const 0)) (local.set $sy (f64.const 0))
      (local.set $lx (f64.const 0)) (local.set $ly (f64.const 0))
      (local.set $ox (f64.const 0)) (local.set $oy (f64.const 0))
      (local.set $m (f64.const 0))
      ;; Separation, alignment and cohesion over the agents within 8, half a cell, so they are in its
      ;; own cell and the three toward the agent's quarter of it; at most 12 candidates count.
      (local.set $dx (f64.sub (local.get $x) (f64.mul (f64.convert_i32_u (local.get $cx)) (f64.const 16))))
      (local.set $dy (f64.sub (local.get $y) (f64.mul (f64.convert_i32_u (local.get $cy)) (f64.const 16))))
      (local.set $sxi (select (i32.const 1) (i32.const -1) (f64.ge (local.get $dx) (f64.const 8))))
      (local.set $syi (select (i32.const 1) (i32.const -1) (f64.ge (local.get $dy) (f64.const 8))))
      (local.set $n (i32.const 0))
      (local.set $t (i32.const 0))
      (block $full
        (loop $cells
          (local.set $gx (i32.add (local.get $cx) (i32.mul (i32.and (local.get $t) (i32.const 1)) (local.get $sxi))))
          (local.set $gy (i32.add (local.get $cy) (i32.mul (i32.shr_u (local.get $t) (i32.const 1)) (local.get $syi))))
          (if (i32.and (i32.lt_u (local.get $gx) (i32.const 128)) (i32.lt_u (local.get $gy) (i32.const 128)))
            (then
              (local.set $q
                (i32.shl (i32.add (i32.shl (local.get $gy) (i32.const 7)) (local.get $gx)) (i32.const 2)))
              (local.set $p (i32.load offset=512000 (local.get $q)))
              (local.set $e (i32.load offset=512004 (local.get $q)))
              (block $done
                (loop $members
                  (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
                  (br_if $full (i32.ge_u (local.get $n) (i32.const 12)))
                  (local.set $n (i32.add (local.get $n) (i32.const 1)))
                  (local.set $q
                    (i32.shl (i32.load offset=675076 (i32.shl (local.get $p) (i32.const 2))) (i32.const 4)))
                  (local.set $dx (f64.sub (f64.load (local.get $q)) (local.get $x)))
                  (local.set $dy (f64.sub (f64.load offset=8 (local.get $q)) (local.get $y)))
                  (local.set $d2
                    (f64.add (f64.mul (local.get $dx) (local.get $dx)) (f64.mul (local.get $dy) (local.get $dy))))
                  (if (i32.and (f64.lt (local.get $d2) (f64.const 64)) (f64.gt (local.get $d2) (f64.const 0)))
                    (then
                      (local.set $sx (f64.sub (local.get $sx) (f64.div (local.get $dx) (local.get $d2))))
                      (local.set $sy (f64.sub (local.get $sy) (f64.div (local.get $dy) (local.get $d2))))
                      (local.set $lx (f64.add (local.get $lx) (f64.load offset=128000 (local.get $q))))
                      (local.set $ly (f64.add (local.get $ly) (f64.load offset=128008 (local.get $q))))
                      (local.set $ox (f64.add (local.get $ox) (local.get $dx)))
                      (local.set $oy (f64.add (local.get $oy) (local.get $dy)))
                      (local.set $m (f64.add (local.get $m) (f64.const 1)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $members)))))
          (local.set $t (i32.add (local.get $t) (i32.const 1)))
          (br_if $cells (i32.lt_u (local.get $t) (i32.const 4)))))
      (i32.store offset=778240
        (i32.shl (i32.sub (local.get $i) (i32.mul (local.get $b) (i32.const 1000))) (i32.const 2))
        (i32.trunc_sat_f64_u (local.get $m)))
      ;; Seek, then the flock's three rules when any neighbour is near.
      (local.set $ax (f64.mul (f64.sub (local.get $tx) (local.get $x)) (f64.const 0.002)))
      (local.set $ay (f64.mul (f64.sub (local.get $ty) (local.get $y)) (f64.const 0.002)))
      (if (f64.gt (local.get $m) (f64.const 0))
        (then
          (local.set $s (f64.div (f64.const 1) (local.get $m)))
          (local.set $ax (f64.add (local.get $ax)
            (f64.add (f64.mul (local.get $sx) (f64.const 400))
              (f64.add (f64.mul (f64.sub (f64.mul (local.get $lx) (local.get $s)) (local.get $vx)) (f64.const 0.5))
                       (f64.mul (f64.mul (local.get $ox) (local.get $s)) (f64.const 0.05))))))
          (local.set $ay (f64.add (local.get $ay)
            (f64.add (f64.mul (local.get $sy) (f64.const 400))
              (f64.add (f64.mul (f64.sub (f64.mul (local.get $ly) (local.get $s)) (local.get $vy)) (f64.const 0.5))
                       (f64.mul (f64.mul (local.get $oy) (local.get $s)) (f64.const 0.05))))))))
      (local.set $vx (f64.add (local.get $vx) (f64.mul (local.get $ax) (f64.const 0x1.1111111111111p-6))))
      (local.set $vy (f64.add (local.get $vy) (f64.mul (local.get $ay) (f64.const 0x1.1111111111111p-6))))
      ;; Speed at most 40.
      (local.set $s (f64.add (f64.mul (local.get $vx) (local.get $vx)) (f64.mul (local.get $vy) (local.get $vy))))
      (if (f64.gt (local.get $s) (f64.const 1600))
        (then
          (local.set $s (f64.div (f64.const 40) (f64.sqrt (local.get $s))))
          (local.set $vx (f64.mul (local.get $vx) (local.get $s)))
          (local.set $vy (f64.mul (local.get $vy) (local.get $s)))))
      (local.set $x (f64.add (local.get $x) (f64.mul (local.get $vx) (f64.const 0x1.1111111111111p-6))))
      (local.set $y (f64.add (local.get $y) (f64.mul (local.get $vy) (f64.const 0x1.1111111111111p-6))))
      ;; The walls at 0 and 2048 turn an agent back.
      (if (f64.lt (local.get $x) (f64.const 0))
        (then (local.set $x (f64.const 0)) (local.set $vx (f64.abs (local.get $vx)))))
      (if (f64.ge (local.get $x) (f64.const 2048))
        (then (local.set $x (f64.const 2047.5)) (local.set $vx (f64.neg (f64.abs (local.get $vx))))))
      (if (f64.lt (local.get $y) (f64.const 0))
        (then (local.set $y (f64.const 0)) (local.set $vy (f64.abs (local.get $vy)))))
      (if (f64.ge (local.get $y) (f64.const 2048))
        (then (local.set $y (f64.const 2047.5)) (local.set $vy (f64.neg (f64.abs (local.get $vy))))))
      (f64.store offset=256000 (local.get $a) (local.get $x))
      (f64.store offset=256008 (local.get $a) (local.get $y))
      (f64.store offset=384000 (local.get $a) (local.get $vx))
      (f64.store offset=384008 (local.get $a) (local.get $vy))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $agent (i32.lt_u (local.get $i) (local.get $hi)))))

  (func (export "join") (param $k i64)
    (memory.copy (i32.const 0) (i32.const 256000) (i32.const 128000))
    (memory.copy (i32.const 128000) (i32.const 384000) (i32.const 128000))))
