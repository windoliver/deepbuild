;; Trap kind divide: i32.div_s of 7 by 0 in function 1, both loaded from memory (spec traps.wast:
;; "integer divide by zero").
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (data (i32.const 256) "\07\00\00\00" "\00\00\00\00")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (i32.store (i32.const 0) (i32.div_s (i32.load (i32.const 256)) (i32.load (i32.const 260))))))
