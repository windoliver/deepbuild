;; Criterion 4's refused registry program entry: the validator of grid_validator.wat that also imports a
;; function, env.forbidden_fn, and calls it.
(module
  (import "env" "forbidden_fn" (func $forbidden))
  (memory (export "memory") 1 1)
  (global (export "in_at") i32 (i32.const 1024))
  (func $validate (export "validate") (param $len i64) (result i64)
    (call $forbidden)
    (i64.const -1)))
