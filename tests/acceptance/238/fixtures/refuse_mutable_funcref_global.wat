;; Refused at check: a mutable global of a reference type, global 3 (mut funcref), after the provider's
;; three immutable i32 globals 0, 1 and 2.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (global $g (mut funcref) (ref.null func))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t))
