;; NaNs from 0 / 0, sqrt(-1) and inf - inf, in f32 at 0, 4, 8 and in f64 at 16, 24, 32. The operands are
;; loaded from memory (data at 256: f32 0, -1, +inf; at 272: f64 0, -1, +inf), so no engine folds them. After
;; the rewrite every one must reach memory as the canonical NaN, 0x7FC00000 and 0x7FF8000000000000 (the bits
;; wasmtime's canonicalize-nan-scalar.wast reads back at the pinned commit), on every host; on x86_64 an
;; uncanonicalized 0 / 0 is 0xFFF8000000000000.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (data (i32.const 256) "\00\00\00\00" "\00\00\80\bf" "\00\00\80\7f" "\00\00\00\00")
  (data (i32.const 272) "\00\00\00\00\00\00\00\00" "\00\00\00\00\00\00\f0\bf" "\00\00\00\00\00\00\f0\7f")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (f32.store (i32.const 0) (f32.div (f32.load (i32.const 256)) (f32.load (i32.const 256))))
    (f32.store (i32.const 4) (f32.sqrt (f32.load (i32.const 260))))
    (f32.store (i32.const 8) (f32.sub (f32.load (i32.const 264)) (f32.load (i32.const 264))))
    (f64.store (i32.const 16) (f64.div (f64.load (i32.const 272)) (f64.load (i32.const 272))))
    (f64.store (i32.const 24) (f64.sqrt (f64.load (i32.const 280))))
    (f64.store (i32.const 32) (f64.sub (f64.load (i32.const 288)) (f64.load (i32.const 288))))))
