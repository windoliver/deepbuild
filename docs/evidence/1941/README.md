# #1941 evidence: each planted-fault scene before and after its named fix

`tests/acceptance/1941/taste.test.ts` writes these pictures. For each planted-fault scene of #1938 (nine), #1936 (three)
and #1937 (one), it asks the scene's check for its fix with `verdict`. Then, in one `deep-show run`, it has render-back
draw the judged revision, sends the fix as the working agent's patch, and has render-back draw the revision the patch
made. Each picture is render-back's own snapshot, read from the evidence store by the hash its reply names. No verdict
reads them.

`sheet.png` lays out all 28 with each name and hash outside the frame. Make it again with
`node docs/evidence/1941/sheet.mjs <out.png>` after a run of the test.

Two pairs can't show their fault:

- **texture-missing**: before and after are the same bytes. render-back draws a missing map as the material's base
  colour, which is what unsetting the map leaves. document.validate reads the evidence store, not these pixels.
- **coincident-walls**: before and after are the same bytes. Two copies of one wall in one place draw as one wall.

`grid-off-after.png` and `seam-moved-after.png` are the same bytes: both fixes put the kit room's right wall back on its
grid line.

The taste call on these pictures is recorded in `tests/acceptance/1941/TASTE.json`. Without it, `taste.test.ts` reads
INCONCLUSIVE.
