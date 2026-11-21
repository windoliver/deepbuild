# Acceptance tests for #2790: deep.registerPort's guide entry

These tests were drafted blind from issue #2790 (its body's acceptance criteria and text, not its comments), `docs/technical-design.md` and the base commit `8bfb6a633`, which is `origin/main`. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them with:

```
npm run build --workspaces        # scripts/guide.mjs stamps the examples' digests with packages/extension-host/dist
node node_modules/vitest/vitest.mjs run tests/acceptance/2790
```

They take a few seconds, need no network and write nothing in the repo. Temp folders go under `/tmp/dh351-*` (made and removed by #351's helpers) and `HOME` is a temp folder.

## What the base does

At the base, `scripts/guide.mjs` already has a description of `deep.registerPort`, `docs/extension-guide.md` already has its entry, and `node scripts/guide.mjs --check` prints `PASS guide`. So criteria 2 and 3 hold on the base, and their tests pass there; they are proven by planted wrong programs (below). Criterion 1 doesn't hold: the description says three of the criterion's elements differently or not at all, and three of its eight tests fail on the base. `BASE-FAILURE.txt` has the base run (local paths redacted) and each twin's run.

## The surfaces

- `node scripts/guide.mjs`, the checkout's own script, run in a temp copy of what it reads: `packages/contracts/extension-api.json`, `packages/contracts/hub-slots.json`, `crates/deep-app/panel-catalog.json` and `docs/extension-guide/`, with the checkout's built `packages/extension-host/dist` linked in. The guide it writes there is "what `node scripts/guide.mjs` writes". Without a built dist the tests fail on a `BLOCKED:` message.
- `node scripts/guide.mjs --check` in the checkout, through #351's `runGuideCheck`.
- `docs/extension-guide.md` and `packages/contracts/extension-api.json`, read as files.
- The drift case of `tests/acceptance/351/guide.test.ts` (the case whose name has "its drift test passes on the contract"), run as it is by Vitest in a child process with `-t` and judged from its JSON report.

An entry is a guide's text from its `` ### `<method>` `` heading to the next entry or `## ` section, as the script's own drift test reads it. What an entry says a method is for is its text after the heading and the release line, without the parameter table.

## The contract each test holds

**`purpose.test.ts`, criterion 1 (`#2790.56435eb8`).** `node scripts/guide.mjs` exits 0 and writes an entry for `deep.registerPort`, and that entry says, one test each, with the issue's own wording as the standard (case aside, curly quotes read as straight):

1. it is a plug-in's side of a piece's port: `plug-in's side of a piece's port` (or `the piece's`);
2. the entries and the occurrence rows it takes: it names `` `entries` `` and `` `rows` `` (each a field of `port` the contract publishes) and says "occurrence";
3. the sources it gives for readings in: it names `` `sources` `` (a field the contract publishes) and says "reading";
4. whether its gear makes sound: it names `` `sound` `` (a field the contract publishes) and says "whether its gear makes sound";
5. which makes the plug-in a device gate owner whatever the document says: "device gate owner" and "whatever the document says" (or "the piece says");
6. registering opens nothing: "registering opens nothing" ("registering it" or "registering a port" also);
7. a port opens only after a person clicks Connect: "only after" or "until", then "a person" or "you", then "click(s) Connect";
8. it sends only while the piece plays live: "only while" (or "when", "as"), then "the piece" or "it", then "plays live".

The base's description, "A port a piece can declare to the plug-in … which puts it under the device gate … what the piece lists is sent as it plays live …", meets 2, 3, 4, 6 and 7 and fails 1, 5 and 8: it doesn't call the method the plug-in's side of the piece's port, it says "under the device gate" with nothing on the plug-in owning it whatever the document says, and it says what is sent "as it plays live" without "only". The design's Extension API line says each of these (`deep.registerPort(name, port)`: "only while it plays live", "makes the plug-in a device gate owner whatever the document says").

**`regenerated.test.ts`, criterion 2 (`#2790.92d7996b`).**

1. `docs/extension-guide.md` has a `` ### `deep.registerPort` `` entry whose release line carries the digest `extension-api.json` publishes for it.
2. `docs/extension-guide.md` is byte for byte what `node scripts/guide.mjs` writes.
3. `node scripts/guide.mjs --check` prints no line, on stdout or stderr, that contains `deep.registerPort`.

**`drift.test.ts`, criterion 3 (`#2790.d87e08da`).** The #351 drift case runs once and passes or fails; no line of its failure messages names `deep.registerPort`; and when it fails, the methods its `FAIL guide: <name>:` lines name are exactly `deep.source.ask`.

## Planted wrong programs (`twins.json`, `twins/`)

- `port-undescribed` (criterion 1): `scripts/guide.mjs` with no description of `deep.registerPort`, as the issue found it on main. The script exits 1 and all eight tests fail at the exit-status assertion.
- `port-opens-on-register` (criterion 1): `scripts/guide.mjs` whose description says elements 1 to 5 in the issue's words but says registering opens the port at once and sends on every step, a seek, a replay and an export included. Tests 6, 7 and 8 fail; 1 to 5 pass.
- `guide-without-port` (criteria 2 and 3): `docs/extension-guide.md` without the `deep.registerPort` entry. All three criterion 2 tests fail, and the #351 drift case fails on `FAIL guide: deep.registerPort: …`, so the criterion 3 test fails.
- `guide-stale-port` (criterion 2): `docs/extension-guide.md` whose `deep.registerPort` entry carries a zero digest. All three criterion 2 tests fail.
