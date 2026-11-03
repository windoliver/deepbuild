;; Trap kind bounds: a load at 65536 in a one-page memory, in function 1; the address itself is loaded
;; from memory (data at 256), so the trapping load is the function's second i32.load (spec traps.wast: "out
;; of bounds memory access").
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (data (i32.const 256) "\00\00\01\00")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (i32.store (i32.const 0) (i32.load (i32.load (i32.const 256))))))
