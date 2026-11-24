# #3347: the drawn clip, and a first reading of it

`tests/fixtures/hands@1/open-fist-pinch.mov` is the clip for #1186's test camera. Nobody was recorded: its script draws it.

| | |
|---|---|
| Clip | SHA-256 `7996273c36652e43f63c3a62f57fd157052a327fd1150d6e6cde79c7cb79ddca`, 2,721,515 B, 600 frames of 1280 × 720 at 30 a second, Motion JPEG in a QuickTime movie |
| Script | `tests/fixtures/hands@1/open-fist-pinch.mjs`, SHA-256 `706190d142c887e81067103fb2dc1b088cef33f706d7e8cbc467f188874e68f3` |
| Shown | a right hand, its palm to the camera: open to 6 s, a fist from 7 s to 13 s, a pinch from 14 s |
| Corner block | 64 × 64 px at the top left: 4 × 4 cells of 16 px in four colors |

## The reading

`reading.swift` runs the request #1186 names for its macOS backend, Vision's hand pose with at most two hands a frame, on each frame. On a reference Mac (Mac17,10, macOS 27.2), November 24, 2026:

```text
$ swift docs/evidence/3347/reading.swift tests/fixtures/hands@1/open-fist-pinch.mov
one hand with 21 points in 1.0 of 600 frames, a right hand in 600
$ swift tests/acceptance/3347/plants/no-hand.swift no-hand.mov && swift docs/evidence/3347/reading.swift no-hand.mov
one hand with 21 points in 0.0 of 60 frames, a right hand in 0
```

This is not #1186's backend, which doesn't exist yet. It says that a drawn hand can be read, so no recording of a person is needed; it proves nothing about the backend. The criterion's own reading is BLOCKED until #1186 is built (`tests/acceptance/3347/ac2-reading.test.mjs`).

`frames.png` shows frames 60, 196, 300, 405 and 500.
