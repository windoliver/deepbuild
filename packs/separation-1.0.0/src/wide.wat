(module
  (import "env" "__linear_memory" (memory 32 32))
  (import "lib:separation@1" "minima" (func $minima (param i32 i32) (result i32)))
  (import "lib:separation@1" "mover" (func $mover (param i32 i32) (result i32)))
  (import "lib:separation@1" "conflicts" (func $conflicts (param i32 f64 f64) (result i32)))
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global (export "assets_at") i32 (i32.const 262144))
  (func (export "init") (param $seed i64) (local $i i32)
    (drop (call $minima (i32.const 1048576) (i32.const 262148)))
    (loop $add
      (drop (call $mover (i32.const 1048576) (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $add (i32.lt_u (local.get $i) (i32.const 2)))))
  (func (export "step") (param $k i64)
    (if (i64.eq (local.get $k) (i64.const 0)) (then
      (drop (call $conflicts (i32.const 1048576) (f64.const 0) (f64.const 300)))))
    (memory.copy (i32.const 4096) (i32.const 1048576) (i32.const 3336)))
  (data (i32.const 49152) "\00\00\00\00\00\00\00\00"))