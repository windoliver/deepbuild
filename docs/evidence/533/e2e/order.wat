;; #533 evidence: writes order (f64 x 8) = the player and value of the first four entries of press in its read region, in region order.
(module (memory (export "memory") 1 1) (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 4096)) (func (export "init") (param $seed i64)) (func (export "step") (param $k i64)
(f64.store (i32.const 4096) (f64.convert_i32_u (i32.load (i32.const 8))))(f64.store (i32.const 4104) (f64.load (i32.const 16)))
(f64.store (i32.const 4112) (f64.convert_i32_u (i32.load (i32.const 24))))(f64.store (i32.const 4120) (f64.load (i32.const 32)))
(f64.store (i32.const 4128) (f64.convert_i32_u (i32.load (i32.const 40))))(f64.store (i32.const 4136) (f64.load (i32.const 48)))
(f64.store (i32.const 4144) (f64.convert_i32_u (i32.load (i32.const 56))))(f64.store (i32.const 4152) (f64.load (i32.const 64)))
))
