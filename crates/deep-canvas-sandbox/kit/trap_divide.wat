;; sandbox@1 kit: i32.div_s of 1 by 0: traps divide.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (data (i32.const 64) "\01\00\00\00\00\00\00\00")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t (drop (i32.div_s (i32.load (i32.const 64)) (i32.load (i32.const 68))))))
