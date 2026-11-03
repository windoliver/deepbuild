;; Refused at check: the tail-call proposal, return_call in function 1 (wasm-tools lime1.wast: "tail calls
;; support is not enabled").
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (drop (call $t))
    (i32.const 0))
  (func $t (result i32)
    (return_call $k))
  (func $k (result i32)
    (i32.const 1)))
