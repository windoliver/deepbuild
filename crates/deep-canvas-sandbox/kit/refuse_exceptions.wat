;; sandbox@1 kit: an exception handler: refused, naming exceptions and try_table in function 1.
(module
  (tag $e)
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (block $done
      (try_table (catch_all $done)
        (throw $e)))))
