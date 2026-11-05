;; Passes the check: a fixed table of exactly 65,536 entries, the subset's limit.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (table 65536 65536 funcref)
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t))
