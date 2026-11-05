;; Refused at check: the extended-constant proposal, global 3 initialized by i32.add, after the provider's
;; three globals (lime1 admits it; the subset doesn't).
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (global $x i32 (i32.add (i32.const 1) (i32.const 2)))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t))
