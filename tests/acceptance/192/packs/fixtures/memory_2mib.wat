;; Criterion 13's provider that grows its memory to 2 MiB (README: Fixtures and Readings): its one memory is 32 pages,
;; 2 MiB, minimum equal to maximum as the subset requires (a memory that can grow is refused at check, and
;; memory.grow traps `grow` on every build), and it writes its last byte (2,097,151) before it writes quad.wat's
;; one-quad mesh at out_at. Under a budget of 1 MiB it can't have its memory; under the 64 MiB default it runs with no
;; trap. It reads no param, no asset and no seed; gen returns 0.
(module
  (memory (export "memory") 32 32)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 4096))
  (data (i32.const 1024) "\04\00\00\00\06\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\80\3f\00\00\80\3f\00\00\00\00\00\00\80\3f\00\00\00\00\01\00\00\00\02\00\00\00\00\00\00\00\02\00\00\00\03\00\00\00")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (i32.store8 (i32.const 2097151) (i32.const 1))
    (memory.copy (i32.const 4096) (i32.const 1024) (i32.const 160))
    (i32.const 0)))
