;; Refused at check: the memory64 proposal, a 64-bit memory that function 1 loads from (wasm-tools
;; lime1.wast: "memory64 must be enabled for 64-bit memories").
(module
  (memory (export "memory") i64 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (drop (i32.load (i64.const 0)))))
