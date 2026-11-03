;; sandbox@1 kit: changes a table: refused, naming table.set in function 1.
(module
  (table 1 1 funcref)
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t (table.set (i32.const 0) (ref.null func))))
