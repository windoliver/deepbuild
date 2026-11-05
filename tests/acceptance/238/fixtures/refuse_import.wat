;; Refused at check: it imports a function, env.forbidden_fn (function 0; gen is function 1).
(module
  (import "env" "forbidden_fn" (func $forbidden))
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $forbidden)
    (i32.const 0)))
