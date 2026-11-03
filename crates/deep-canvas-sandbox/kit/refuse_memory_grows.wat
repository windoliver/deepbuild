;; sandbox@1 kit: a memory that can grow (maximum past minimum): refused, naming the memory limit.
(module
  (memory (export "memory") 1 4)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (func $gen (export "gen") (param $seed i64) (result i32) (i32.const 0)))
