;; sandbox@1 kit: f32 0 / 0, sqrt(-1) and inf - inf from operands in memory: each stored as 0x7FC00000.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (data (i32.const 64) "\00\00\00\00\00\00\80\bf\00\00\80\7f")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (f32.store (i32.const 0) (f32.div (f32.load (i32.const 64)) (f32.load (i32.const 64))))
    (f32.store (i32.const 4) (f32.sqrt (f32.load (i32.const 68))))
    (f32.store (i32.const 8) (f32.sub (f32.load (i32.const 72)) (f32.load (i32.const 72))))))
