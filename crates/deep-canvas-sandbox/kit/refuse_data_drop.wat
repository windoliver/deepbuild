;; sandbox@1 kit: a passive segment kept to use later: refused, naming memory.init, data.drop and data 0.
(module
  (data $d "hi")
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (memory.init $d (i32.const 0) (i32.const 0) (i32.const 2))
    (data.drop $d)))
