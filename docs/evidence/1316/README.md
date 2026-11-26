# #1316 hand e2e

`e2e.command` draws Khronos SheenChair and DispersionTest in the blind suite's scene (`tests/acceptance/1316`:
environment-lit `sky@1` and a sun, 1280 × 800, frame 0) in 3 fresh `deep-gpu run` processes each, on the default path
and under `--planted environment_texture_race`. Run on Mac18,1 at code head 181583513 (`e2e.txt`):

- Default path: each sample gives 1 distinct final and 1 distinct linear target across the 3 processes.
  `SheenChair.png` and `DispersionTest.png` are those final frames.
- Planted race (the one-sample geometry pass): every process differs (SheenChair 37–40 final pixels,
  DispersionTest 9–49 final pixels), and the check names the sample.
