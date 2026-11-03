;; sandbox@1 kit: an extended constant: refused, naming extended_const and i32.add in global 3.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (global i32 (i32.add (i32.const 1) (i32.const 2)))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t))
