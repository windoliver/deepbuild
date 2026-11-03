;; sandbox@1 kit: calls through a table its active segment filled: returns 4000 + 207.
(module
  (type $value (func (result i32)))
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (table 2 2 funcref)
  (elem (i32.const 0) $a $b)
  (func $gen (export "gen") (param $seed i64) (result i32)
    (i32.add (call_indirect (type $value) (i32.const 0)) (call_indirect (type $value) (i32.const 1))))
  (func $a (result i32) (i32.const 4000))
  (func $b (result i32) (i32.const 207)))
