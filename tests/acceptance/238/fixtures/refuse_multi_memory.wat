;; Refused at check: the multi-memory proposal, a second memory that function 1 loads from (wasm-tools
;; lime1.wast: "multiple memories").
(module
  (memory $m0 (export "memory") 1 1)
  (memory $m1 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (drop (i32.load $m1 (i32.const 0)))))
