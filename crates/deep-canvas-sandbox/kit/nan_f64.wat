;; sandbox@1 kit: f64 0 / 0, sqrt(-1) and inf - inf from operands in memory: each stored as 0x7FF8000000000000.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (data (i32.const 64) "\00\00\00\00\00\00\00\00\00\00\00\00\00\00\f0\bf\00\00\00\00\00\00\f0\7f")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (f64.store (i32.const 0) (f64.div (f64.load (i32.const 64)) (f64.load (i32.const 64))))
    (f64.store (i32.const 8) (f64.sqrt (f64.load (i32.const 72))))
    (f64.store (i32.const 16) (f64.sub (f64.load (i32.const 80)) (f64.load (i32.const 80))))))
