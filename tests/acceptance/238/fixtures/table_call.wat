;; A program that calls through a table its active segment filled at instantiation: slot 0 holds
;; $forty_two and slot 1 $seven, so gen returns 42 * 100 + 7 = 4207.
(module
  (type $ret (func (result i32)))
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (table 2 2 funcref)
  (elem (i32.const 0) $forty_two $seven)
  (func $gen (export "gen") (param $seed i64) (result i32)
    (i32.add
      (i32.mul (call_indirect (type $ret) (i32.const 0)) (i32.const 100))
      (call_indirect (type $ret) (i32.const 1))))
  (func $forty_two (type $ret) (i32.const 42))
  (func $seven (type $ret) (i32.const 7)))
