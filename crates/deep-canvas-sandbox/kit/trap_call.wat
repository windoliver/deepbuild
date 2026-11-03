;; sandbox@1 kit: call_indirect with the wrong signature: traps call.
(module
  (type $takes (func (param i32)))
  (table 1 1 funcref)
  (elem (i32.const 0) $f)
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t (call_indirect (type $takes) (i32.const 1) (i32.const 0)))
  (func $f))
