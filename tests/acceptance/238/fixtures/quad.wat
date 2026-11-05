;; The test provider (gen@1) of criterion 3: it writes a one-quad mesh at out_at (4096) by copying 160 bytes
;; from a template at 1024, in this suite's mesh layout (README: The mesh a provider writes): u32 vertex
;; count 4, u32 index count 6, then f32 positions (0,0,0) (1,0,0) (1,1,0) (0,1,0), f32 normals (0,0,1) x 4,
;; f32 uv0 (0,0) (1,0) (1,1) (0,1), and u32 indices 0 1 2 0 2 3: two triangles, one quad. gen returns 0.
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 4096))
  (data (i32.const 1024) "\04\00\00\00\06\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\00\00\00\00\80\3f\00\00\00\00\00\00\80\3f\00\00\80\3f\00\00\00\00\00\00\80\3f\00\00\00\00\01\00\00\00\02\00\00\00\00\00\00\00\02\00\00\00\03\00\00\00")
  (func $gen (export "gen") (param $seed i64) (result i32)
    (memory.copy (i32.const 4096) (i32.const 1024) (i32.const 160))
    (i32.const 0)))
