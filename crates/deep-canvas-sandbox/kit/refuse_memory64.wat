;; sandbox@1 kit: a 64-bit memory: refused, naming memory64 and i32.load in function 1.
(module
  (memory (export "memory") i64 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t (drop (i32.load (i64.const 0)))))
