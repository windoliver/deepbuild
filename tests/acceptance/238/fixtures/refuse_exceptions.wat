;; Refused at check: the exception-handling proposal, a tag and a handler (try_table catching all) around a
;; throw in function 1 (wasm-tools lime1.wast and missing-exceptions.wast: "exceptions proposal not
;; enabled").
(module
  (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440))
  (global (export "assets_at") i32 (i32.const 62464))
  (global (export "out_at") i32 (i32.const 63488))
  (tag $e)
  (func $gen (export "gen") (param $seed i64) (result i32)
    (call $t)
    (i32.const 0))
  (func $t
    (block $caught
      (try_table (catch_all $caught)
        (throw $e)))))
