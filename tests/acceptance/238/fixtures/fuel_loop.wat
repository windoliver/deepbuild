;; An endless loop in function 1: it must trap with kind fuel, at the same function and offset on
;; every host (wasmtime's fuel.rs iloop, ported to our own metering).
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (loop $spin (br $spin))))
