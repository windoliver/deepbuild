# The dispute on AC3 #177.ab6f72b4

**The criterion:** "An export, a render-back snapshot and a golden of the same revision are byte-identical with HDR
output on or off."

**What the first draft assumed** (`tests/acceptance/177/ac3-sdr-outputs.test.ts`): that #380's `golden` with
`oracle: "hash"` always compares once a golden is blessed, so each run's reply carries `numbers.pixels`, its
snapshot's pixel hash. It blessed a two-grey checker (30 and 230, 16 px squares) and drew the lamps (a black sky and
three flat squares) as the snapshot.

**Why it can't pass, on any program:** at the base (`0e5572731`), `golden` runs the blank guard before any oracle
(`crates/deep-gpu-layer/src/golden.rs`, `fn blank`, #1399): a frame is blank when 98% of its pixels are at Rec. 709
luma 0.06 or under, or when it holds under `COLORS` = 32 distinct RGBA colors, or when under `OFF_MODAL` = 5% of its
pixels differ from its modal color. If the stored golden or the snapshot is blank, `golden` answers `{"verdict":
"BLOCKED", "reason": "blank", …}` with no `numbers`, before the hash path (`oracle == "hash"`) is reached. The checker
holds 2 colors, so it is blank; the lamps hold under 32 colors (black, three flat squares and their edges), so the
snapshot is blank too. Every run therefore answered BLOCKED: blank with no `numbers`, and the first test failed at
"the golden's numbers" on a right program as on a wrong one. The first draft was wrong; the criterion and its other
two legs (export, render-back) are unchanged.

**What the redraft changes:** only the fixtures. The blessed golden is a gradient the view's size (red across, green
down, blue 96): 61,440 distinct colors, 0.4% dark, all but one pixel off its modal color. The document is the shaded
ball: a front-lit sphere (base color 0.8, roughness 1) covering a quarter of the frame, whose shading gives a smooth
ramp of codes, beside a lamp at 8 times paper white and a highlight at 2, so an HDR frame still differs from the SDR one
for the planted program. A model of its SDR frame (the sphere's Lambert shading, 0.8 × cos θ, through the look's agx
with white 8, then the sRGB encode; `README.md`: The blank guard) holds 138 distinct colors, 32% of its pixels off the
modal black and 68% dark: it passes all three conditions with room. The test checks both on the run itself: the
gradient and the export's and render-back's frames through a port of `blank` before anything is compared, and the
golden's reply not `blank`. Everything else is the first draft's: two processes, the live view with hdr auto on the
stub display must present HDR, the three outputs byte-identical across on and off, and `export_reads_hdr_surface`
failing, naming an output.
