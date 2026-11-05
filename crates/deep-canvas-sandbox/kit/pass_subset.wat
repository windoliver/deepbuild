;; sandbox@1 kit: a program built to the subset: sums 1 to 100 into memory and returns 5050.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.load (i32.const 0)))
  (func $t (local $i i32)
    (loop $next
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (i32.store (i32.const 0) (i32.add (i32.load (i32.const 0)) (local.get $i)))
      (br_if $next (i32.lt_u (local.get $i) (i32.const 100))))))
