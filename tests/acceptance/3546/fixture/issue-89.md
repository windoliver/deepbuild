Only the canvas pieces the core needs in version 0: the line per ask, receipts and taste cards.

**Epic:** #4 · **Design:** [The canvas core](https://github.com/windoliver/deepbuild/blob/main/docs/technical-design.md#the-canvas-core) · [Conventions every primitive uses](https://github.com/windoliver/deepbuild/blob/main/docs/canvas-primitives.md#conventions-every-primitive-uses) · [Marks, data and diagrams](https://github.com/windoliver/deepbuild/blob/main/docs/canvas-primitives.md#marks-data-and-diagrams) · [What holds a document to its rules](https://github.com/windoliver/deepbuild/blob/main/docs/canvas-primitives.md#what-holds-a-document-to-its-rules)

### Parts
This issue is split into the parts below. Each part is one pull request with its own criteria, and this issue closes when every part has closed.
- #389 Canvas document contract: kinds with versions, stable IDs, the envelope, one path grammar, and the math checks read in f64
- #390 Canvas text: one shaper with bundled fonts, the canvas's glyph atlas, and glyphs through the GPUI patch
- #391 The line's motion and 2D marks: keys and springs, placements and counters, R1's marks and content keys for 2D
- #392 Status and bound values: numbers with their source, status colors only through verdicts, and the clean pipeline look
- #393 deep_show for agents: their own writer layers, whole revisions, render-back and settled snapshots
- #394 Salience and sheets: about nine items a level, the basic layered layout with its memory, and taste-call sheets
- #395 The evidence player and the decode worker: a journey's video at the checked step, and call recordings under caps
- #396 The ask line and a claim's film: stations from the record, a chip per requirement, and record replay
- #1485 image@1 keeps its design line: refused by header before decoding, off the UI thread, and decoded once

### Proof
Recordings of the line, a taste call with its sheet and the evidence player, with GPU use while still.

### References

### Depends on
- #389 Canvas document contract: kinds with versions, stable IDs, the envelope, one path grammar, and the math checks read in f64
- #390 Canvas text: one shaper with bundled fonts, the canvas's glyph atlas, and glyphs through the GPUI patch
- #391 The line's motion and 2D marks: keys and springs, placements and counters, R1's marks and content keys for 2D
- #392 Status and bound values: numbers with their source, status colors only through verdicts, and the clean pipeline look
- #393 deep_show for agents: their own writer layers, whole revisions, render-back and settled snapshots
- #394 Salience and sheets: about nine items a level, the basic layered layout with its memory, and taste-call sheets
- #395 The evidence player and the decode worker: a journey's video at the checked step, and call recordings under caps
- #396 The ask line and a claim's film: stations from the record, a chip per requirement, and record replay
