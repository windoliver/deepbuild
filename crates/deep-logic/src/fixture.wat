;; The logic module's kit fixture (#533): one item writing `steps` (the steps it has run) and
;; `presses` (the sum of the u32s at the start of its read region). Read with the control `press`,
;; as the kit's stepper reads it, its layout is: reads `press` at 0 (264 bytes, its count first),
;; the seed at 264; writes `steps` at 0, `presses` at 8.
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 1024))
  (global (export "writes_at") i32 (i32.const 2048))
  (global $steps (mut i32) (i32.const 0))
  (global $presses (mut i32) (i32.const 0))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (global.set $steps (i32.add (global.get $steps) (i32.const 1)))
    (global.set $presses (i32.add (global.get $presses) (i32.load (i32.const 1024))))
    (i32.store (i32.const 2048) (global.get $steps))
    (i32.store (i32.const 2056) (global.get $presses))))
