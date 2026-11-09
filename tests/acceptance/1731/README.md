# Acceptance tests for #1731: online model libraries

Written first, blind, by a job that never saw an implementation of #1731; none exists at the base. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1731 as the job's brief quoted it: Scope, the five criteria, Proof, Depends on (#979, #439 and #1066 open and
  unbuilt; #364 closed and built). Not read from GitHub; the IDs are computed from the quoted text.
- `docs/canvas-primitives.md`: Pack (its `assets` field), Pack: assets fetched on first use (the catalog `deep_kinds`
  searches "by words, a size range, a category and a limit of at most 50, ranked by words matched and then by size fit",
  "fetches nothing"; the first fetch "one authority ask with the plan (sizes, sources, licenses), or a standing rule";
  "Offline, it's BLOCKED with an unblock ask"), Document envelope (`format`, `profile`, `title`, `description`), and the
  `asset.game@1` recipe's paragraph.
- `docs/technical-design.md`: Building blocks, and Blocks for plug-ins that do real work (Source and reading, Secret,
  Send's standing rules, Work source's `ctx.fetch`, Replay and a clock). `AGENTS.md`.
- At the base, for surfaces and conventions only: `packages/extension-host` (`sources.ts`: `declareSource`, the hub
  making every call over `https://<host><path>`, `nodeHttp`; `host.ts`'s `ExtensionHost`, work sources' `ctx.fetch`;
  `runtime/deep.mjs`'s API list), `packages/contracts` (`hub-slots.json`, `hubSlots()`, `extension.manifest@1`),
  `packages/hub` (`core.ts`: `mcpCall` and `kinds`, `install`, `answer`, `evidence`; `tools.ts`'s `deep_kinds` schema
  and `checkArguments`; `server.ts`'s method table; `install.ts`, `inbox.ts`, `show.ts`, `client.ts`, `canvas.ts`),
  `packages/asks` (ask kinds and options), `packages/evidence` (`Evidence`, `License`); the suites `364`, `1338`
  (layout, README, criterion IDs), `363` and `66` (a real hub, `deep install`, the socket as the cli role), `412`
  and `806`/`393` (`deep_kinds`, `deep show`, document shape), and `scripts/proof-change.mjs` (`criterionId`).

## Criteria and files

Each `describe` title is the criterion's ID and its text. The ID is `#1731.` and the first 8 hex digits of SHA-256 of
the checkbox's text after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | ID | File | Tests |
|---|---|---|---|
| AC1 | `#1731.999d16ba` | `search.test.ts` | the search; the planted `measures-by-download` |
| AC2 | `#1731.e4d0ddba` | `fetch.test.ts` | the fetch, its ask, the store and the asset.game@1 item; the standing rule |
| AC3 | `#1731.0d3831dc` | `unknown.test.ts` | the unknown license BLOCKED and unnameable; the planted `reports-cc0` |
| AC4 | `#1731.826a5cb7` | `off.test.ts` | the library turned off |
| AC5 | `#1731.19849fe1` | `offline.test.ts` | offline search and fetch |

## Run them

macOS, the repo's Node (24.22.0) first on `PATH`, and the canvas core built (the hub's `deep_kinds` and `deep show`
reach it):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                           # once
npm run build --workspaces                       # the tests run packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook    # the hub won't start without it
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-show
NO_COLOR=1 npx vitest run tests/acceptance/1731 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1731/tsconfig.json
```

- **One at a time:** every test starts its own hub, which starts sandboxed plug-ins through the supervisor, so the
  implementer adds `tests/acceptance/1731/` to `alone` in `scripts/lanes.mjs` (not done here: this job writes tests
  only). The supervisor's sandbox needs a shell that may start it (in Claude Code, the Bash tool with its sandbox off).
- **Needs:** `openssl` on `PATH` (the test CA, made per world), `ps`.
- **Safety:** every folder is under `/tmp/dh1731-*`, removed after its file; every hub, `deep` command and `deep mcp`
  runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*`, `NODE_OPTIONS`;
  every process is stopped by its PID; nothing is stopped by name or port. Nothing leaves 127.0.0.1. No model is called.
- **The proof** (the issue's Proof line) is written to `$TMPDIR/deep-1731-proof/`, rewritten each run: the request
  logs, the ask, the fetched asset and its store entry, the refusals, the checked documents, and the planted fills'
  failures.

## The world (`helpers.ts`, `library.ts`)

One world per test: a temp home, **a real hub** (`deep hub run`) with `DEEP_HUB_TEST_CONFIRM` (the OS confirming you,
stubbed, as #363's and #1338's suites do) and `NODE_EXTRA_CA_CERTS` naming the world's test CA; **the fixture library**
over HTTPS on `127.0.0.1:<port>`, its certificate signed by that CA, so the hub reaches it through its ordinary Source
block calls (`https://<host><path>`, Node's fetch) with no test seam in the hub; **the test fill** installed with `deep
install <folder>`; a **`deep mcp`** started in a plain work folder, spoken to as an agent's MCP client does
(`initialize`, then `tools/call`); and **the hub's socket as the cli role** (the control token and this process as the
peer), your trusted path.

**The fixture library ("Shelf", `library.ts`):** 30 models, 5 HDRIs and 5 textures, built the same every run. Licenses:
CC0 1.0 (SPDX `CC0-1.0`), CC BY 4.0 (`CC-BY-4.0`, with a credit) and one unknown license, the "Shelf Standard License",
which has no SPDX ID and is on one model, `shelf-armchair`. A model is a glTF box (its `.gltf` and a `.bin` sidecar,
12 triangles, +Y up, metres, its height the stated size); an HDRI a Radiance `.hdr`; a texture a `.png`; each has a PNG
thumbnail. 12 models are chairs (each tagged `chair`): 9 with a stated size in [0.4, 1.2] m (`shelf-armchair` among
them), `doll-chair` (0.12) and `throne-chair` (1.6) outside it, and `camp-chair` with no stated size; 18 other models,
many in the same range. Its API, which only the fill reads:

| Request | Answer |
|---|---|
| `GET /api/search?q=<words>[&type=model\|hdri\|texture]` | `{total, results}`: every entry whose name's whole words and tags hold every word; no size filter, no files |
| `GET /api/assets/<id>` | the asset's own record: `{id, name, type, tags, size_m, triangles, license: {key, spdx, name, url, attribution}, url, version, modified, thumbnail, files: [{path, bytes, sha256}]}`, its main file first |
| `GET /files/<name>` | a file's bytes |
| `GET /thumbs/<id>.png` | the thumbnail |

It keeps **the request log**: every request that reached it, in order. "Offline" is the server closed with every
connection dropped, so the host refuses connections, as a machine with no network can't reach it.

**The test fill (`fixtures/shelf`, `test/shelf@1.0.0`):** the asset.library@1 fill for that library, `ext.shelf.library`,
copied per world with its `*.fixture` renamed, `probe.json` written (`host`, and a `plant` for the planted fills), its
manifest's library host set to the server's `127.0.0.1:<port>`, and its digest set by the extension host's
`packageDigest`. It makes every call through `ctx.fetch`. Its search keeps only rows whose stated size is in the asked
range, so a row with none stated (`camp-chair`) is left out; its fetch reads the asset's record and answers the file,
its sidecars, the license and the upstream, downloading nothing. A license maps to its SPDX ID, else to
`LicenseRef-shelf-<key>` (the unknown one: `LicenseRef-shelf-standard`). The planted fills, by `probe.json`'s `plant`:

- `measures-by-download` (AC1): its search downloads each model hit's record and `.gltf` to measure its height.
- `reports-cc0` (AC3): it reports a license with no SPDX ID as `CC0-1.0`, in search and fetch.

## The surface under test

The issue and the design name the slot (`asset.library@1` through `deep.registerSource`), the fill's `search` and
`fetch` and their fields, `deep_kinds` asset search, the authority ask, the standing rule for a library and license
list, the unblock ask, the content-addressed store with license and `upstream {url, version, modified}`, `asset.game@1`
`from: {asset}`, turning a fill on and off, and `stale` with the cache's age. Where they leave a name open, this job
picked the smallest surface the design and base code imply; each choice is listed here so the implementer builds to it.

1. **The slot row.** `hubSlots()` (`@deepbuild/contracts`, `hub-slots.json`) gains a row with `interface:
   "asset.library@1"`, `method: "deep.registerSource"`, `variant: "library"`, `fills: "many"` (its kit and planted
   names are the implementer's).
2. **The fill's side.** The manifest lists the source as `sources: [{name, variant: "library", host}]`; `deep install`
   shows that host, and the install you confirm grants it (today `deep install` grants no host at all). The code calls

   ```ts
   deep.registerSource('ext.shelf.library', {
     variant: 'library', host: '127.0.0.1:<port>', quota: { per_minute, per_day }, timeout: <ms>,   // + secret by handle, as #364
     search(ctx, q: { words: string; kind: 'model' | 'hdri' | 'texture' | null; size_m: [number, number] | null; license: string[] | null; limit: number })
       => { rows: { id, name, kind, license: { id, terms, shareable, credit }, size_m: number | null, triangles: number | null, thumbnail: <path on its host>, url }[] },
     fetch(ctx, q: { id: string }) => { file: { path, bytes, sha256 }, sidecars: { path, bytes, sha256 }[], license: { id, terms, shareable, credit }, upstream: { url, version, modified } } | { failed: string },
   });
   ```

   `ctx.fetch({method, path, headers?})` is the Source block's call on the source's host, answered `{status, headers,
   body}` as a work source's is (#66). The fill names files by path; the hub downloads them, so binary bytes never pass
   through the fill. `deep.registerSource` with variant `library` is listed under `requires.preview`.
3. **Turning a fill on and off, and a standing rule** are socket methods on the cli role, each counting once the OS
   confirms you: `library.on {library}`, `library.off {library}`, and `library.rule {library, licenses: [SPDX id]}`,
   your standing rule for that library and license list. Each answers a result without `error`; `library` is the
   source's registered name. Every unplanted world turns its fill on once after the install; whether an installed fill
   starts off isn't read.
4. **Search: `deep_kinds {op: "assets", query, kind, size_m, license, limit}`** through `deep mcp` (the existing
   `query` field carries the words; the other fields are the issue's; a field left out is null; no session needed,
   as for every deep_kinds call). It answers `{rows: [...]}`, one ranked list over installed packs' catalogs and enabled
   libraries. A library row is the fill's row with `thumbnail` the SHA-256 (lower-case hex) of the thumbnail the hub
   fetched through the Source block and keeps in the evidence store, plus `from: {library: "<source name>"}`; a pack
   row has `from: {pack: "<owner/name@version>"}`. A row answered from the cache because the library can't be reached
   has `stale: true` and `age_ms`, the milliseconds since the hub got the answer it came from; a fresh row's `stale` is
   absent or false. The suite calls `{op: "assets", query: "chair", size_m: [0.4, 1.2], limit: 50}`.
5. **Fetch: `deep_kinds {op: "fetch", library, id}`**, `id` the row's. It answers `{status: "held", ask: "ask:<id>"}`
   while it waits on your answer, and the same call again after the job is done `{status: "fetched", asset: {sha256,
   license: {id, ...}, upstream: {url, version, modified}, ...}}`, `sha256` the main file's; `{status: "refused",
   reason}` (or a tool error) for a refusal; `{status: "BLOCKED", cause, ask}` (any reply saying BLOCKED) for a fetch
   that can't run. Calling it again never raises a second ask for the same fetch.
6. **The asks** are the record's `ask.created` events, read with `events.read`; the authority ask's data (question,
   plan, options) names the library's source name, the bytes as a number of its own (the main file's, or the file's
   and its sidecars' together) and CC-BY 4.0 (`CC-BY-4.0` or `CC BY 4.0`); your yes is `deep inbox answer <ask>
   <the option whose decision is allow>`.
7. **The store:** `evidence.read {sha}` on the cli role finds the main file and each sidecar by its SHA-256; the main
   file's entry has `license.name` the license's SPDX ID (`CC-BY-4.0`) and `source` the upstream URL (the library's own
   URL for the asset, its record's `url`). A thumbnail a search fetched is found the same way.
8. **The item:** `deep show --doc 01JB1731D00000000000000001 --document <file> --check --json`, run as you, with a
   `scene` document whose one item is `{id, kind: "asset.game@1", name, from: {asset: "<sha256>"}, budget:
   "small_prop"}` (`helpers.ts`'s `gameDoc`). For a fetched asset the reply refuses nothing about the item (no
   `outcome: "refused"`, no error-severity issue whose `ids` hold the item) and carries `assets: [{item, asset:
   <sha256>, license: {id, ...}}]`, the license each item's asset was kept with (#1066's "names it with that
   license"). An item naming an asset the store doesn't hold with a license it may take is refused: the revision, or
   an error issue naming the item.

## How each criterion is read

- **AC1** (`search.test.ts`): the slot row (1); the search (4) must return, of the library's rows, exactly the 9 chairs
  with a stated size in [0.4, 1.2], in #979's order, which the design gives as words matched and then size fit; every
  chair matches the one word, and **size fit is read as nearness to the range's middle** (0.8 m), nearer first (the
  fixture's sizes leave no ties). Each row must equal what the library's own record says: name, kind, license (by the
  mapping above), size, 12 triangles, the thumbnail's SHA-256, the URL. The request log of the search must show the
  search API reached and no `/files/` request. The planted `measures-by-download` must fail the same judge with one
  failure naming the request log; a hub whose install refuses the plant passes this test only if the install's reason
  names the request log.
- **AC2** (`fetch.test.ts`): the CC-BY chair is `oak-chair` (0.82 m, CC-BY-4.0). The fetch must answer held, raise
  exactly one ask, an authority ask naming the library, its bytes and CC-BY 4.0 (6), with no file requested before
  your yes; after the yes, the fetch (called again until it isn't held) must answer fetched with the main file's
  SHA-256, `CC-BY-4.0` and the record's upstream; still one ask in all; the store (7) holds the file and its sidecar,
  the file's entry with the license and the upstream URL; and the item (8) names it with `CC-BY-4.0`. The standing-rule
  test is a new world: `library.rule` for the library and `CC0-1.0`; the CC0 `pine-chair` must fetch with no ask (so
  the rule is honoured, not everything refused), then the same `oak-chair` fetch must be refused naming CC-BY 4.0,
  with no ask, no file request and nothing stored.
- **AC3** (`unknown.test.ts`): the shared judge reads `shelf-armchair`'s search row (its license must be the record's,
  `LicenseRef-shelf-standard`), fetches it twice (each BLOCKED), and must find exactly one unblock ask and no authority
  ask, no file request, and none of its files in the store. Then the item (8) naming its main file's SHA-256 must be
  refused. The planted `reports-cc0` must fail the same judge with one failure naming the row (`row shelf-armchair`)
  and the library's own record; a hub whose install refuses the plant passes only if the reason names the license
  and the record.
- **AC4** (`off.test.ts`): with the fill on, the search has `oak-chair` (the control); after `library.off`, the same
  search must return only rows with `from.pack`, a fetch of `oak-chair` must be refused naming `ext.shelf.library`,
  no ask may be raised, and no request may reach the library.
- **AC5** (`offline.test.ts`): online, each library row isn't stale and its thumbnail is in the store; 1.5 s later the
  server is closed; the same search must return the same rows in the same order with the same thumbnail hashes, each
  `stale: true` with `age_ms` between the time since the online answer came and the time since it was asked; two
  fetches of `oak-chair` must each be BLOCKED and raise exactly one ask, an unblock ask, with nothing stored.

## Known limits

- **No installed pack in the world.** No route installs a data pack with a catalog into the hub at the base, and the
  catalog itself is #979's (open). So AC4's "installed packs' rows only" reads only that no row lacks `from.pack` (none
  from the library), and AC1 reads only the library's rows; the one ranked list across packs and libraries isn't read.
- The brief's allowed license list, secrets by handle, the quota and timeout, #439's convert and #435's import are in
  Scope but no criterion; the suite reads them only through AC2's fetch coming back fetched, which the issue says
  happens after convert and import. A `search` `license` filter and `kind` aren't read.
- "Offline" is the library's host refusing connections, not a machine without a network; the hub's own idea of being
  offline isn't read.
- The planted fills are the test fill with one wrong behaviour each; what they prove is that the judges fail a wrong
  fill, as the criteria ask. A hub can't tell a fill that lies about a license from the library's own record, so AC3's
  judge, not the hub, reads that record.
