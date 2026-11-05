;; Refused at check: a passive data segment (data 0) that function 1 copies in with memory.init and then
;; drops with data.drop, keeping a segment to use later.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (data $p "abc")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (memory.init $p (i32.const 0) (i32.const 0) (i32.const 3))
    (data.drop $p)))
