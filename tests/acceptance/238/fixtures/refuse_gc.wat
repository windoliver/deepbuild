;; Refused at check: the garbage-collection proposal, a struct type that function 1 allocates with struct.new
;; (wasm-tools lime1.wast: "gc proposal must be enabled to use subtypes").
(module
  (type $s (struct (field i32)))
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (drop (struct.new $s (i32.const 1)))))
