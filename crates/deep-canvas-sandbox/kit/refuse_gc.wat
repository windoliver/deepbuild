;; sandbox@1 kit: a garbage-collected type: refused, naming gc and struct.new in function 1.
(module
  (type $pair (struct (field i32) (field i32)))
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 0))
  (global (export "out_at") i32 (i32.const 0))
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t (drop (struct.new $pair (i32.const 1) (i32.const 2)))))
