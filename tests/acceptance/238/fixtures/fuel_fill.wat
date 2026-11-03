;; A loop of 1 MiB memory.fill calls in function 1. Iteration i (from 0) first writes i + 1 at 0, then fills
;; [65536 + i MiB, 65536 + (i + 1) MiB) with 0xAB; it would stop after 11. Under a fuel budget of 10,000,000
;; nine fills cost 9,437,184 and the tenth's 1,048,576 more can't be paid, so it traps with kind fuel at the
;; tenth memory.fill, before that fill runs: 10 at 0, region 8 filled, region 9 still zero.
(module
  (memory (export "memory") 177 177)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t (local $i i32)
    (loop $next
      (i32.store (i32.const 0) (i32.add (local.get $i) (i32.const 1)))
      (memory.fill
        (i32.add (i32.const 65536) (i32.mul (local.get $i) (i32.const 1048576)))
        (i32.const 0xAB)
        (i32.const 1048576))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $next (i32.lt_u (local.get $i) (i32.const 11))))))
