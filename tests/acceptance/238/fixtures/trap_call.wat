;; Trap kind call: call_indirect through slot 0, which holds $one of type (func (result i32)), with the
;; type (func (param i32) (result i32)), in function 1 (spec call_indirect.wast: "indirect call type
;; mismatch").
(module
  (type $ret (func (result i32)))
  (type $take (func (param i32) (result i32)))
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (table 1 1 funcref)
  (elem (i32.const 0) $one)
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (i32.store (i32.const 0) (call_indirect (type $take) (i32.const 5) (i32.const 0))))
  (func $one (type $ret) (i32.const 1)))
