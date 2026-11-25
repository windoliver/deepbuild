(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param i64)
    (i32.store (i32.add (i32.const 1044) (i32.shl (i32.and (i32.wrap_i64 (local.get 0)) (i32.const 1)) (i32.const 2))) (i32.const 1))
    (i32.store (i32.const 1084) (i32.const 5)))
  (func (export "step") (param i64)))
