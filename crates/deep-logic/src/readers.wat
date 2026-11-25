;; The logic module's readers fixture (#2363, #3360): the kit fixture's layout, `steps` at 0 and
;; `presses` at 8 of its write region, but a step only counts itself. The fixture's item reads no
;; control, since the core declares no reference to one, so the start of its read region is the
;; step's seed, a hash, never a press count: `presses` stays zero for the readers to show.
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 1024))
  (global (export "writes_at") i32 (i32.const 2048))
  (global $steps (mut i32) (i32.const 0))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (global.set $steps (i32.add (global.get $steps) (i32.const 1)))
    (i32.store (i32.const 2048) (global.get $steps))
    (i32.store (i32.const 2056) (i32.const 0))))
