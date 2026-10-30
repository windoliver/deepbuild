# Blind redraft: the AC10 tests (`prices.test.ts`, 4 tests)

Dispute: the AC10 packages call `deep.provide`, `deep.use` and `deep.read`, none lists `requires.preview`, so a host that
passes AC13 (a package that uses a preview method without listing it is refused with `preview_unrequested`) refuses the
starting world of every AC10 test. At the base `deep.provide` and `deep.use` are `stability: preview`, and `deep.read`
has no published entry (the design publishes an entry no shipped piece calls as preview).

Changed, in all four tests (they share `scene()`): each package's manifest now lists the preview methods it calls in
`requires.preview`, and none declares itself stable (criterion 3). The provider acme/acme 1.0.0 and 2.0.0 list
`deep.provide`; the stocks view acme/stocks lists `deep.use` and `deep.read`. Nothing else changed: the interfaces, the
`provides` row's `adapter: { from }`, `host.edges()`, the `rewires-to-newest` plant, the ask through the asks core, the
expected 12345 cents, and every assertion and failure pattern are as drafted.

Per test, from the criterion:

- **the update with its adapter installs; the view passes its contract tests**: the update installs and the view reads a
  prices@1 reading (`cents` 12345) through the adapter. The packages now pass criterion 13, so the scenario starts.
- **wrong program, an installer that rewires the view to prices@2**: fails naming
  `the edge acme/stocks uses ext.acme.prices@1 is wired to ext.acme.prices@2`, as before. With the starting world
  admitted, the only difference between this and the passing test is the plant.
- **without the adapter: one ask naming the stocks view, nothing installed until you answer; your yes installs**: as
  before; the update's 2.0.0 package lists `deep.provide`, so the only reason to ask is the lost `prices@1`.
- **your no leaves 1.0.0 and the edge as it was**: as before.

Base: all four fail in `scene()` on the missing surface: the manifest has no `requires` field
(`its manifest fails extension.manifest@1 at /requires: unlisted_field`); see BASE-FAILURE.txt.

Not changed: README.md (its `requires?: { preview?: string[] }` row already covers this), helpers.ts, other tests.

Open point: `deep.read` is listed in `requires.preview` on the reading that it is published as preview. If the real
contract publishes it stable, the listing is still accepted (only a stable *package* is refused for listing one).

Second change (same tests, via `scene()`): the host is now given an explicit published API (`api: previewApi()`) in which
`deep.provide`, `deep.use` and `deep.read` are `stability: preview` with a tracking issue, as preview.test.ts does for
`deep.provide`. This makes the scenario consistent with criteria 3 and 13 whatever the real contract marks, and covers
`deep.read`, which has no published entry at the base. No assertion changed.
