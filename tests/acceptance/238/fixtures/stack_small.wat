;; An endless recursion of the smallest frame: function 1 has no params and no locals and its value
;; stack is at most 3 deep, so each call charges 8 x 3 + 64 = 88 bytes of stack. Each call first adds one to
;; the count at 0, so after the stack trap the count is the depth reached.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (i32.store (i32.const 0) (i32.add (i32.load (i32.const 0)) (i32.const 1)))
    (call $t)))
