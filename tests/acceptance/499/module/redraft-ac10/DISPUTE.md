# Dispute: AC10's test, both drafts

Both drafts fail on their own fixtures, not on the program; each test is redrafted at most once, so this comes to the
owner with both drafts (design: Dogfooding).

- **First draft** (`module/av-link.test.ts`): it presents its board with `deep_show` and then patches it, but at the
  base a patch applies only to a shared document seeded through the scenario's `docs[…].document` (#96;
  `crates/deep-show/src/shared.rs`, `check_patch`), and its patches use `base: 0` where the presented revision is 1.
  Every patch is refused before any check runs:

  ```text
  the rate-only patch fails the document check with av_unlinked: [{"code":"ref_unresolved","path":"doc",
    "what":"no shared document has this ID"}]
  the patch changing both rates together applies, got refused: [{"code":"ref_unresolved", … }]
  ```

- **Redraft** (`redraft-ac10/av-link-redraft.test.ts`): it seeds the film correctly, but the film's `requires.modules`
  doesn't name `media` while it holds a `media.strip@1` item. The base check refuses every module kind its document
  doesn't declare (as in #378's dispute and AC5's first draft), so the strip is refused at its kind and no rule runs
  on it:

  ```text
  {"code":"out_of_range","ids":["rec.sound"],"path":"items/rec.sound/kind","actual":"media.strip@1",
   "what":"kind `media.strip@1` is the `media` module's, and `requires.modules` does not name it"}
  ```

- **Evidence that the program meets the criterion:** the redraft run once with only
  `requires: { modules: { media: '^1' } }` added to `filmDoc` (a scratch copy, deleted after, never committed) passed
  both its tests: the rate-only and start-only patches refused with `av_unlinked` naming `rec.picture` and
  `rec.sound`, revision 0 still current; the patch of both applied as revision 1; the planted `av_link_start_only`
  lets the rate-only patch through and the judgment fails naming `av_unlinked` and `frames.rate`.

The owner's call: swap in the redraft with that one line added, or another resolution.
