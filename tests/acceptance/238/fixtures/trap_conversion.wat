;; Trap kind conversion: i32.trunc_f32_s of a NaN loaded from memory, in function 1 (spec traps.wast:
;; "invalid conversion to integer").
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (data (i32.const 256) "\00\00\c0\7f")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (i32.store (i32.const 0) (i32.trunc_f32_s (f32.load (i32.const 256))))))
