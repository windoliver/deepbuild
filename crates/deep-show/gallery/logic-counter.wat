;; The deep_kinds gallery's logic@1 example (Logic `logic@1`, Logic: preview): the item `counter`
;; reads the control `press` and writes `count`, the presses so far; its preview writes `next`,
;; what `count` would be after one more press, on a throwaway copy, never stored.
;; Region map (check computes it, in declaration order): reads press at 0 (264 B: a u32 count,
;; 4 zero bytes, then 16 entries of a u32 player, 4 zero bytes and an f64), seed at 264;
;; writes count at 0. The preview's read region is empty, so its write region starts at preview_at.
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (global (export "preview_at") i32 (i32.const 2048))
  (global $count (mut i32) (i32.const 0))
  (func (export "init") (param $seed i64))
  ;; Each step adds the press entries it read to the count and writes it.
  (func (export "step") (param $k i64)
    (global.set $count (i32.add (global.get $count) (i32.load (i32.const 0))))
    (i32.store (i32.const 1024) (global.get $count)))
  ;; The preview: the count after one more press.
  (func (export "preview") (param $k i64)
    (i32.store (i32.const 2048) (i32.add (global.get $count) (i32.const 1)))))
