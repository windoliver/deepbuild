;; The net module's planted fixtures (#550): a match whose logic traps with kind unreachable at its
;; first step, so every net check kind run on it fails. Assembled to trap.wasm.
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param i64))
  (func (export "step") (param i64) unreachable))
