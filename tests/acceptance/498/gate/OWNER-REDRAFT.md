# C9 blind redraft: `owner-redraft.test.ts` replaces `owner.test.ts`

Criterion 9: "A panel playing strips stops every voice within one audio block when it closes or opens another document,
and pressing Play again is needed before any sound; a planted gate that keeps the previous document's voices after the
switch fails, naming the panel".

## What was disputed

`owner.test.ts` (commit 34101ab1) checks that doc-a was playing before the cut by reading each voice's amplitude with a
Hann-windowed single-bin DFT over 9,600 samples from 1.7 s, and needs at least 0.05. One voice is a 0.25 s asset of
330 Hz played as a loop. A 0.25 s loop of 330 Hz holds 82.5 cycles, so the tone's phase flips by 180° at every loop
point. With the transport started by Play at 1.06 s, the window covers transport time 0.64–0.84 s and a loop point
falls at 0.75 s, 10 ms from its centre. The two halves cancel: a faithful loop reads
0.2 × (0.599 − 0.401) ≈ 0.0397 there. The implementation read exactly 0.0397, and both C9 tests failed on that one line:

```text
before the cut the panel player's 330 Hz voice reads amplitude 0.0397: it wasn't playing
```

With only that floor eased (a scratch copy, deleted after), every other check of both tests passed, the planted
`keeps_voices_on_switch` and `fades_on_close` included.

## The redraft

A fresh run of this job (commit a1c8850c) wrote `owner-redraft.test.ts` from the issue, the design, the base commit and
this folder's README and `helpers.ts`, without the implementation or `owner.test.ts`. Its brief also asked it to choose
signals a faithful player measures unambiguously (loop points, phase, windows), which points at the dispute; that departs
from the Dogfooding rule and is disclosed here. Its looping voice is 300 Hz over 0.4 s (exactly 120 periods, so the loop
is seamless), its cut is at sample 120,141 (77 samples into a block), and its readings sit clear of loop points.
`OWNER-REDRAFT-BASE-FAILURE.txt` is its run at the base.

On the implementation the redraft passes 2/2, each case also running its planted program and failing it naming the
panel. Per Dogfooding the dispute went to the owner with both drafts; on November 1, 2026 the owner asked to close the
gaps and the issue, and the redraft replaced `owner.test.ts`, which is removed.
