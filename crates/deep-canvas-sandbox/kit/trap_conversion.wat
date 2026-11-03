;; sandbox@1 kit: i32.trunc_f32_s of NaN: traps conversion.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (data (i32.const 64) "\00\00\c0\7f")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t (drop (i32.trunc_f32_s (f32.load (i32.const 64))))))
