;; sandbox@1 kit: 1 MiB memory.fill calls under 10,000,000 fuel: the tenth traps fuel before it fills, so the count reads 10 and region 9 stays zero.
(module
  (memory (export "memory") 177 177)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t (local $i i32)
    (loop $next
      (i32.store (i32.const 0) (i32.add (local.get $i) (i32.const 1)))
      (memory.fill (i32.add (i32.const 65536) (i32.mul (local.get $i) (i32.const 1048576))) (i32.const 0xab) (i32.const 1048576))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $next (i32.lt_u (local.get $i) (i32.const 11))))))
