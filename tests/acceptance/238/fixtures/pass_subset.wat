;; A program built to the subset: a provider (memory, gen, params_at, assets_at, out_at) with a loop,
;; a block, a call, float arithmetic that makes no NaN, and loads and stores. gen returns 5050 (1 + ... + 100)
;; and leaves it at 0; at 8 it leaves f32 sqrt(2) * sqrt(2), whatever bits that is, the same on every host.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (data (i32.const 256) "\00\00\00\40")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (local $i i32) (local $sum i32) (local $x f32)
    (block $done
      (loop $next
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (local.set $sum (i32.add (local.get $sum) (local.get $i)))
        (br_if $next (i32.lt_u (local.get $i) (i32.const 100)))))
    (local.set $x (f32.sqrt (f32.load (i32.const 256))))
    (f32.store (i32.const 8) (f32.mul (local.get $x) (local.get $x)))
    (i32.store (i32.const 0) (local.get $sum))
    (call $same (local.get $sum)))
  (func $same (param i32) (result i32)
    (i32.sub (i32.shl (local.get 0) (i32.const 1)) (local.get 0))))
