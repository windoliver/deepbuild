;; Criterion 11's planted provider (README: Fixtures): it traps only at its param's maximum. It reads its one param
;; `n` (an integer type, so 8 bytes little-endian as an i64 at params_at: README, The surface) and executes
;; `unreachable` when n is 16, the maximum its pack's schema declares ([1, 16], default 4); for any other n it writes
;; quad.wat's one-quad mesh at out_at and returns 0. The seed is never read, so every seed gives the same run.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 4096))
  (data (i32.const 1024) "\04\00\00\00\06\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\80\3f\00\00\80\3f\00\00\00\00\00\00\80\3f\00\00\00\00\01\00\00\00\02\00\00\00\00\00\00\00\02\00\00\00\03\00\00\00")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (if (i64.eq (i64.load (i32.const 61440)) (i64.const 16))
      (then (unreachable)))
    (memory.copy (i32.const 4096) (i32.const 1024) (i32.const 160))
    (i32.const 0)))
