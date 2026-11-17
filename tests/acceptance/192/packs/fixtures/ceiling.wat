;; Criterion 12's provider at the ceilings (README: Fixtures): its one memory is 4,096 pages, 256 MiB, minimum equal to
;; maximum as the subset requires, so it is admitted only under a memory budget of 256 MiB, and it writes quad.wat's
;; one-quad mesh in the last 4 KiB of that memory (out_at = 268,431,360 = 256 MiB - 4,096), so the run reads memory
;; at its top. It reads no param, no asset and no seed; gen returns 0.
(module
  (memory (export "memory") 4096 4096)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 268431360))
  (data (i32.const 1024) "\04\00\00\00\06\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\80\3f\00\00\80\3f\00\00\00\00\00\00\80\3f\00\00\00\00\01\00\00\00\02\00\00\00\00\00\00\00\02\00\00\00\03\00\00\00")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (memory.copy (i32.const 268431360) (i32.const 1024) (i32.const 160))
    (i32.const 0)))
