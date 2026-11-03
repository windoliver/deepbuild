;; The test layout's validator (Logic: data layouts): an asset is valid when every byte is a cell type
;; 0..3. validate(len) reads the asset at in_at (1024) and returns -1 when valid, else the offset of the
;; first bad byte, so the malformed twin 00 01 02 03 03 09 00 is refused at offset 5. Criterion 4's
;; registry program entry is this same program, in the validator role.
(module
  (memory (export "memory") 1 1)
  (global (export "in_at") i32 (i32.const 1024))
  (func $validate (export "validate") (param $len i64) (result i64)
    (local $i i64)
    (block $valid
      (loop $next
        (br_if $valid (i64.ge_u (local.get $i) (local.get $len)))
        (if (i32.gt_u (i32.load8_u (i32.add (i32.const 1024) (i32.wrap_i64 (local.get $i)))) (i32.const 3))
          (then (return (local.get $i))))
        (local.set $i (i64.add (local.get $i) (i64.const 1)))
        (br $next)))
    (i64.const -1)))
