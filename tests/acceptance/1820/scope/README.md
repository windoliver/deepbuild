# Supplemental acceptance tests for #1820 (scope/)

Added after the first draft in `tests/acceptance/1820/` (unchanged). Same world and same assumed surfaces (README one level up);
`world.ts` adds a pack server that serves license files, cuts a first download, and answers Range honestly or wrongly.

| Requirement | File | Proof |
|---|---|---|
| AC3, "license file read" (not the listing's id) | `license-file.test.ts` | assets listed CC0 whose license file reads CC BY-SA / NC / GPL are refused naming it and not stored; a CC0 file is fetched; a license-file request is required before use |
| Scope 4, `pack@version` and re-export; AC1 cached reuse | `reuse.test.ts` | two versions list one path with other bytes; a document is bound to the version it names; with the upstream changed and the network gone, re-export and refetch use the stored bytes with no request and no ask |
| Scope 1, resume; AC1 mismatch on the resumed path | `resume.test.ts` | a cut download continues by Range from the offset, one ask; a resumed rest that doesn't match is refused as a whole, naming the asset; a planted restart log fails the judge |

Locators the design leaves open (documented, not weakened): the license file is the listing's `license.terms` url, or `LICENSE`
or `<file>.license` beside the asset (all served; any counts); versions are separated by url, `/<pack>@<version>/<path>`;
`from: {asset: sha}` in a document is resolved within the pack version it names.

## Not covered

- Quota of the Source block: the design gives a source's quota as calls per minute and per day at registration and names no
  field a pack fetch exposes, so no refusal can be provoked without inventing a knob.
- Standing rule matching on license set, and the plan's content for several assets in one ask.
- Not run here: build outputs (`packages/cli/dist`, hub binaries) are missing in this base, so these tests were typechecked
  (`tsc -p tests/acceptance/1820/tsconfig.json`, clean) but not executed; they are expected to fail at base with BLOCKED from
  `installOrBlock` (no route installs a url-listed pack) until implemented.
