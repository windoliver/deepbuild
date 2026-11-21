;; The deep_kinds gallery's two-player piece (Net `net@1`, Logic `logic@1`): two players, a paddle
;; each and a ball. The item `rally` reads three controls, paddle1, paddle2 and serve, and keeps its
;; whole state in its write region, so every copy of a match carries the same state and hashes it.
;; Its rules validate every entry's player on every copy (Net: desync and replay): only player 1
;; moves paddle1 and only player 2 paddle2 (rule own_paddle), only the player whose turn it is
;; serves, and only while the ball is out of play (rule serve_turn), and no move takes a paddle past
;; a wall (rule wall). A refused entry changes nothing, and the step's first refusal is written to
;; `refused` as its player and its rule: 1 own_paddle, 2 serve_turn, 3 wall (0 and 0 for none).
;; Region map (check computes it, in declaration order): reads paddle1 at 0, paddle2 at 264, serve
;; at 528 (264 B each: a u32 count, 4 zero bytes, then 16 entries of a u32 player, 4 zero bytes and
;; an f64), seed at 792; writes ball_x 0, ball_y 8, ball_vx 16, ball_vy 24, pad1 32, pad2 40,
;; serving 48, points1 56, points2 64, refused 72 (two i32s).
;; The court is 100 by 60; a paddle is 12 tall, its top from 0 to 48, player 1's at x 4 and player
;; 2's at x 96. `serving` is the player due to serve, 0 while the ball is in play.
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  ;; The step's first refusal, by rule (1 own_paddle, 2 serve_turn, 3 wall), naming the player.
  (func $refuse (param $rule i32) (param $player i32)
    (if (i32.eqz (i32.load (i32.const 1096)))
      (then
        (i32.store (i32.const 1096) (local.get $player))
        (i32.store (i32.const 1100) (local.get $rule)))))
  ;; The ball back at the centre, out of play, `serving` due to serve.
  (func $reset (param $serving i32)
    (f64.store (i32.const 1024) (f64.const 50))
    (f64.store (i32.const 1032) (f64.const 30))
    (f64.store (i32.const 1040) (f64.const 0))
    (f64.store (i32.const 1048) (f64.const 0))
    (i32.store (i32.const 1072) (local.get $serving)))
  (func (export "init") (param $seed i64)
    (f64.store (i32.const 1056) (f64.const 24))
    (f64.store (i32.const 1064) (f64.const 24))
    (call $reset (i32.const 1)))
  ;; One paddle control's entries: only its own player moves it, and never past a wall.
  (func $paddle (param $read i32) (param $own i32) (param $pad i32)
    (local $i i32) (local $n i32) (local $e i32) (local $p i32) (local $y f64)
    (local.set $n (i32.load (local.get $read)))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $e (i32.add (i32.add (local.get $read) (i32.const 8)) (i32.mul (local.get $i) (i32.const 16))))
        (local.set $p (i32.load (local.get $e)))
        (local.set $y (f64.add (f64.load (local.get $pad)) (f64.load (i32.add (local.get $e) (i32.const 8)))))
        (if (i32.ne (local.get $p) (local.get $own))
          (then (call $refuse (i32.const 1) (local.get $p)))
          (else
            (if (i32.or (f64.lt (local.get $y) (f64.const 0)) (f64.gt (local.get $y) (f64.const 48)))
              (then (call $refuse (i32.const 3) (local.get $p)))
              (else (f64.store (local.get $pad) (local.get $y))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each))))
  ;; The serve's entries: only the player due to serve puts the ball in play.
  (func $serve
    (local $i i32) (local $n i32) (local $e i32) (local $p i32)
    (local.set $n (i32.load (i32.const 528)))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $e (i32.add (i32.const 536) (i32.mul (local.get $i) (i32.const 16))))
        (local.set $p (i32.load (local.get $e)))
        (if (i32.ne (local.get $p) (i32.load (i32.const 1072)))
          (then (call $refuse (i32.const 2) (local.get $p)))
          (else
            (f64.store (i32.const 1040)
              (select (f64.const 1.5) (f64.const -1.5) (i32.eq (local.get $p) (i32.const 1))))
            (f64.store (i32.const 1048) (f64.const 0.75))
            (i32.store (i32.const 1072) (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each))))
  ;; The ball in play moves by its velocity, off the top and bottom and the paddles; past a
  ;; paddle it's the other player's point, and the player who missed serves.
  (func $ball
    (local $x f64) (local $y f64) (local $vx f64) (local $vy f64)
    (if (i32.ne (i32.load (i32.const 1072)) (i32.const 0)) (then (return)))
    (local.set $vx (f64.load (i32.const 1040)))
    (local.set $vy (f64.load (i32.const 1048)))
    (local.set $x (f64.add (f64.load (i32.const 1024)) (local.get $vx)))
    (local.set $y (f64.add (f64.load (i32.const 1032)) (local.get $vy)))
    (if (f64.lt (local.get $y) (f64.const 0))
      (then (local.set $y (f64.neg (local.get $y))) (local.set $vy (f64.neg (local.get $vy)))))
    (if (f64.gt (local.get $y) (f64.const 60))
      (then (local.set $y (f64.sub (f64.const 120) (local.get $y))) (local.set $vy (f64.neg (local.get $vy)))))
    (if (i32.and (f64.lt (local.get $x) (f64.const 4)) (f64.lt (local.get $vx) (f64.const 0)))
      (then
        (if (i32.and (f64.ge (local.get $y) (f64.load (i32.const 1056)))
                     (f64.le (local.get $y) (f64.add (f64.load (i32.const 1056)) (f64.const 12))))
          (then (local.set $x (f64.sub (f64.const 8) (local.get $x))) (local.set $vx (f64.neg (local.get $vx))))
          (else
            (i32.store (i32.const 1088) (i32.add (i32.load (i32.const 1088)) (i32.const 1)))
            (call $reset (i32.const 1))
            (return)))))
    (if (i32.and (f64.gt (local.get $x) (f64.const 96)) (f64.gt (local.get $vx) (f64.const 0)))
      (then
        (if (i32.and (f64.ge (local.get $y) (f64.load (i32.const 1064)))
                     (f64.le (local.get $y) (f64.add (f64.load (i32.const 1064)) (f64.const 12))))
          (then (local.set $x (f64.sub (f64.const 192) (local.get $x))) (local.set $vx (f64.neg (local.get $vx))))
          (else
            (i32.store (i32.const 1080) (i32.add (i32.load (i32.const 1080)) (i32.const 1)))
            (call $reset (i32.const 2))
            (return)))))
    (f64.store (i32.const 1024) (local.get $x))
    (f64.store (i32.const 1032) (local.get $y))
    (f64.store (i32.const 1040) (local.get $vx))
    (f64.store (i32.const 1048) (local.get $vy)))
  (func (export "step") (param $k i64)
    (i64.store (i32.const 1096) (i64.const 0))
    (call $paddle (i32.const 0) (i32.const 1) (i32.const 1056))
    (call $paddle (i32.const 264) (i32.const 2) (i32.const 1064))
    (call $serve)
    (call $ball)))
