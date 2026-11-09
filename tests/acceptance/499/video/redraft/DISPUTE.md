# Dispute: AC3's push clause in its first draft (`video/frames.test.ts`, the ring through the 2× push)

Two readings in the first draft disagree with the design and the base:

- **The push's framing.** Shots: a push "comes in from (1 + `by`) times the framed view width" (canvas primitives,
  Shot; #493's code does the same). The first draft writes `by: 2` and expects a 2× ratio, where the design gives 3×
  (960 → 320 there).
- **The mark finder.** While the view is wider than the 640-wide document, the document's ground outside the
  recording (250, 250, 248) passes the first draft's white-mark filter (every channel ≥ 240), so the mark's centroid
  lands on the ground and every frame before about 1 s fails. From 1 s on, the ring sat within 0.006–0.016 px of the
  click.

The clause went to a fresh run of the blind job with the same inputs and the criterion, never the work, the diff or
this dispute (design: Dogfooding). Its draft is `push-redraft.test.ts` here (REDRAFT.md). AC3's other two clauses
(frames 90 and 120 played and seeked; the crop) stay with the first draft and pass. Swapping the redraft in for the
push clause is the owner's call.
