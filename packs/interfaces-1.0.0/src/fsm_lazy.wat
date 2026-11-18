(module
  (import "env" "__linear_memory" (memory 0))
  ;; The machine at $m: its state at +0 and the step its timer started at +8, or -1 until a step reads it.
  (func (export "start") (param $m i32) (param $t i32) (param $s i32) (param $k i64)
    (i32.store (local.get $m) (local.get $s))
    (i64.store offset=8 (local.get $m) (i64.const -1)))
  (func (export "step") (param $m i32) (param $t i32) (param $k i64) (param $e i32) (result i32)
    (local $entry i32) (local $timer i32) (local $next i32)
    (block $settled
      (loop $due
        (local.set $entry (i32.add (i32.add (local.get $t) (i32.const 8))
          (i32.add (i32.shl (i32.mul (i32.load (local.get $t)) (i32.load offset=4 (local.get $t))) (i32.const 2))
                   (i32.shl (i32.load (local.get $m)) (i32.const 3)))))
        (local.set $timer (i32.load (local.get $entry)))
        (br_if $settled (i32.le_s (local.get $timer) (i32.const 0)))
        (if (i64.lt_s (i64.load offset=8 (local.get $m)) (i64.const 0))
          (then (i64.store offset=8 (local.get $m) (local.get $k))))
        (br_if $settled (i64.gt_s (i64.add (i64.load offset=8 (local.get $m)) (i64.extend_i32_s (local.get $timer))) (local.get $k)))
        (i32.store (local.get $m) (i32.load offset=4 (local.get $entry)))
        (i64.store offset=8 (local.get $m) (i64.const -1))
        (br $due)))
    (if (i32.ge_s (local.get $e) (i32.const 0))
      (then
        (local.set $next (i32.load (i32.add (i32.add (local.get $t) (i32.const 8))
          (i32.shl (i32.add (i32.mul (i32.load (local.get $m)) (i32.load offset=4 (local.get $t))) (local.get $e)) (i32.const 2)))))
        (if (i32.ge_s (local.get $next) (i32.const 0))
          (then
            (i32.store (local.get $m) (local.get $next))
            (i64.store offset=8 (local.get $m) (i64.const -1))))))
    (i32.load (local.get $m))))