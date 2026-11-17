;; Criterion 6's voxel mesher (README: Fixtures): one quad per exposed voxel face. Its grid is the provider's asset 0,
;; read at assets_at as a logic item's data assets are (README, The surface: a u32 little-endian length, then the
;; bytes): 32 x 32 x 32 bytes, x fastest, then y, then z, a voxel solid when its byte isn't 0. It traps `unreachable`
;; when asset 0 isn't exactly 32,768 bytes. A face is exposed when the voxel beside it is empty or past the grid's
;; edge. Each quad has 4 vertices of its own, in metres at 0.25 m a voxel, wound counter-clockwise seen from outside
;; with the face's outward normal at each vertex, uv0 (0,0) (1,0) (1,1) (0,1), and indices 4k+0 1 2 0 2 3. It counts the
;; quads first, then writes the gen@1 mesh layout at out_at: u32 vertex_count, u32 index_count, f32 positions[3n],
;; f32 normals[3n], f32 uv0[2n], u32 indices. It reads no param and no seed; gen returns 0.
;;
;; The face table at 256: 16 bytes a face, signed: the outward direction (dx, dy, dz, 0), then the four corners'
;; offsets from the voxel's low corner, in winding order. Faces: +x, -x, +y, -y, +z, -z.
(module
  (memory (export "memory") 4 4)
  (global (export "params_at") i32 (i32.const 512))
  (global (export "assets_at") i32 (i32.const 1024))
  (global (export "out_at") i32 (i32.const 65536))
  (data (i32.const 256)
    "\01\00\00\00" "\01\00\00" "\01\01\00" "\01\01\01" "\01\00\01"
    "\ff\00\00\00" "\00\00\00" "\00\00\01" "\00\01\01" "\00\01\00"
    "\00\01\00\00" "\00\01\00" "\00\01\01" "\01\01\01" "\01\01\00"
    "\00\ff\00\00" "\00\00\00" "\01\00\00" "\01\00\01" "\00\00\01"
    "\00\00\01\00" "\00\00\01" "\01\00\01" "\01\01\01" "\00\01\01"
    "\00\00\ff\00" "\00\00\00" "\00\01\00" "\01\01\00" "\01\00\00")

  ;; 1 when (x, y, z) is in the grid and its byte isn't 0; a coordinate of -1 reads as past the edge (unsigned).
  (func $solid (param $x i32) (param $y i32) (param $z i32) (result i32)
    (if (i32.or (i32.or (i32.ge_u (local.get $x) (i32.const 32)) (i32.ge_u (local.get $y) (i32.const 32)))
                (i32.ge_u (local.get $z) (i32.const 32)))
      (then (return (i32.const 0))))
    (i32.ne
      (i32.load8_u offset=1028
        (i32.add (local.get $x) (i32.add (i32.shl (local.get $y) (i32.const 5)) (i32.shl (local.get $z) (i32.const 10)))))
      (i32.const 0)))

  ;; Writes quad k: face table entry $t of voxel (x, y, z).
  (func $quad (param $x i32) (param $y i32) (param $z i32) (param $t i32) (param $k i32)
              (param $pos i32) (param $nrm i32) (param $uv i32) (param $idx i32)
    (local $c i32) (local $v i32) (local $a i32) (local $p i32) (local $n i32)
    (local.set $c (i32.const 0))
    (loop $corners
      (local.set $v (i32.add (i32.shl (local.get $k) (i32.const 2)) (local.get $c)))
      (local.set $a (i32.add (i32.add (local.get $t) (i32.const 4)) (i32.mul (local.get $c) (i32.const 3))))
      (local.set $p (i32.add (local.get $pos) (i32.mul (local.get $v) (i32.const 12))))
      (local.set $n (i32.add (local.get $nrm) (i32.mul (local.get $v) (i32.const 12))))
      (f32.store (local.get $p)
        (f32.mul (f32.convert_i32_s (i32.add (local.get $x) (i32.load8_s (local.get $a)))) (f32.const 0.25)))
      (f32.store offset=4 (local.get $p)
        (f32.mul (f32.convert_i32_s (i32.add (local.get $y) (i32.load8_s offset=1 (local.get $a)))) (f32.const 0.25)))
      (f32.store offset=8 (local.get $p)
        (f32.mul (f32.convert_i32_s (i32.add (local.get $z) (i32.load8_s offset=2 (local.get $a)))) (f32.const 0.25)))
      (f32.store (local.get $n) (f32.convert_i32_s (i32.load8_s (local.get $t))))
      (f32.store offset=4 (local.get $n) (f32.convert_i32_s (i32.load8_s offset=1 (local.get $t))))
      (f32.store offset=8 (local.get $n) (f32.convert_i32_s (i32.load8_s offset=2 (local.get $t))))
      (f32.store (i32.add (local.get $uv) (i32.shl (local.get $v) (i32.const 3)))
        (f32.convert_i32_u (i32.or (i32.eq (local.get $c) (i32.const 1)) (i32.eq (local.get $c) (i32.const 2)))))
      (f32.store offset=4 (i32.add (local.get $uv) (i32.shl (local.get $v) (i32.const 3)))
        (f32.convert_i32_u (i32.ge_u (local.get $c) (i32.const 2))))
      (br_if $corners (i32.lt_u (local.tee $c (i32.add (local.get $c) (i32.const 1))) (i32.const 4))))
    (local.set $a (i32.add (local.get $idx) (i32.mul (local.get $k) (i32.const 24))))
    (local.set $v (i32.shl (local.get $k) (i32.const 2)))
    (i32.store (local.get $a) (local.get $v))
    (i32.store offset=4 (local.get $a) (i32.add (local.get $v) (i32.const 1)))
    (i32.store offset=8 (local.get $a) (i32.add (local.get $v) (i32.const 2)))
    (i32.store offset=12 (local.get $a) (local.get $v))
    (i32.store offset=16 (local.get $a) (i32.add (local.get $v) (i32.const 2)))
    (i32.store offset=20 (local.get $a) (i32.add (local.get $v) (i32.const 3))))

  ;; Visits every exposed face in z, y, x, face order; writes each as a quad when $emit; returns the count.
  (func $walk (param $emit i32) (param $pos i32) (param $nrm i32) (param $uv i32) (param $idx i32) (result i32)
    (local $x i32) (local $y i32) (local $z i32) (local $f i32) (local $t i32) (local $q i32)
    (loop $zs
      (local.set $y (i32.const 0))
      (loop $ys
        (local.set $x (i32.const 0))
        (loop $xs
          (if (call $solid (local.get $x) (local.get $y) (local.get $z))
            (then
              (local.set $f (i32.const 0))
              (loop $faces
                (local.set $t (i32.add (i32.const 256) (i32.shl (local.get $f) (i32.const 4))))
                (if (i32.eqz (call $solid
                      (i32.add (local.get $x) (i32.load8_s (local.get $t)))
                      (i32.add (local.get $y) (i32.load8_s offset=1 (local.get $t)))
                      (i32.add (local.get $z) (i32.load8_s offset=2 (local.get $t)))))
                  (then
                    (if (local.get $emit)
                      (then (call $quad (local.get $x) (local.get $y) (local.get $z) (local.get $t) (local.get $q)
                                        (local.get $pos) (local.get $nrm) (local.get $uv) (local.get $idx))))
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))))
                (br_if $faces (i32.lt_u (local.tee $f (i32.add (local.get $f) (i32.const 1))) (i32.const 6))))))
          (br_if $xs (i32.lt_u (local.tee $x (i32.add (local.get $x) (i32.const 1))) (i32.const 32))))
        (br_if $ys (i32.lt_u (local.tee $y (i32.add (local.get $y) (i32.const 1))) (i32.const 32))))
      (br_if $zs (i32.lt_u (local.tee $z (i32.add (local.get $z) (i32.const 1))) (i32.const 32))))
    (local.get $q))

  (func $gen (export "gen") (param $seed i64) (result i32)
    (local $n i32) (local $pos i32) (local $nrm i32) (local $uv i32) (local $idx i32)
    (if (i32.ne (i32.load (i32.const 1024)) (i32.const 32768))
      (then (unreachable)))
    (local.set $n (i32.shl (call $walk (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)) (i32.const 2)))
    (i32.store (i32.const 65536) (local.get $n))
    (i32.store (i32.const 65540) (i32.add (local.get $n) (i32.shr_u (local.get $n) (i32.const 1))))
    (local.set $pos (i32.const 65544))
    (local.set $nrm (i32.add (local.get $pos) (i32.mul (local.get $n) (i32.const 12))))
    (local.set $uv (i32.add (local.get $nrm) (i32.mul (local.get $n) (i32.const 12))))
    (local.set $idx (i32.add (local.get $uv) (i32.shl (local.get $n) (i32.const 3))))
    (drop (call $walk (i32.const 1) (local.get $pos) (local.get $nrm) (local.get $uv) (local.get $idx)))
    (i32.const 0)))
