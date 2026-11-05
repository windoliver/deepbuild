;; Trap kind grow: memory.grow by one page in function 1. The spec answers -1 here (the memory's maximum is
;; its minimum); the rewrite makes growth trap. A rewrite that lets it return -1 runs on: it leaves -1 at 0
;; and 7 at 4.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (i32.store (i32.const 0) (memory.grow (i32.const 1)))
    (i32.store (i32.const 4) (i32.const 7))))
