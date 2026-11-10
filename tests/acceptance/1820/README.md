# Acceptance tests for #1820: pack assets fetched on first use

Written first and blind: from issue #1820, `docs/canvas-primitives.md#pack-assets-fetched-on-first-use`, the technical
design (Source block, Dogfooding), `AGENTS.md` and the base commit 903a1c07, with no implementation seen. The implementer
doesn't edit these files; a dispute goes to this job's blind redraft.

## Criteria and files

Each `describe` title starts with the criterion's ID (`#1820.` + first 8 hex of SHA-256 of its text, as `scripts/proof-change.mjs`).

| AC | ID | File | What it proves |
|---|---|---|---|
| AC1 | `#1820.34edde87` | `fetch.test.ts` | one authority ask with the plan (size, source host, license, pack), no request before the yes, the file lands in the store by its listed sha256 with its license, one request in all; a second use makes no request and no ask; a file whose bytes differ from the listed sha256 is refused naming its path, is in no file under the hub's folder and not in the store |
| AC1 planted | | `judges.test.ts` | the "kept" judge fails a fetch that keeps the mismatched file, naming the asset (no hub needed) |
| AC2 | `#1820.bd8f8f74` | `disk.test.ts` | an asset listed at 0.6 of the free space (over free/2.2, under free) is refused with no request for it, naming its size and the free space |
| AC3 | `#1820.a489b5cd` | `license.test.ts` | CC BY-SA, CC BY-NC and GPL assets are refused naming the license, not stored, not usable by a document; a CC0 control is fetched |
| AC4 | `#1820.09114f60` | `offline.test.ts` | unanswered ask: no request; offline: BLOCKED twice with exactly one unblock ask, no authority ask, nothing stored, a document naming it is refused or BLOCKED, never accepted; a standing rule for pack A fetches A's asset with no ask, and B's asset still holds on its own ask naming B with no request |
| AC4 planted | | `judges.test.ts` | the other-pack judge fails a hub that fetches under another pack's rule, naming that pack |

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm run build --workspaces
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-show
NO_COLOR=1 npx vitest run tests/acceptance/1820 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1820/tsconfig.json
node scripts/affected.mjs tests/acceptance/1820/
```

Every hub test starts its own hub (as #1731's), so the implementer adds `tests/acceptance/1820/` to `alone` in
`scripts/lanes.mjs` (not done here). Needs `openssl`. Everything is under `/tmp/dh1731-*` (the reused world), nothing leaves
127.0.0.1, no model is called, processes are stopped by PID.

## The world and the surface (the gaps)

The world is #1731's `openWorld()` (imported read-only from `../1731/helpers.ts`: a real hub, test CA, `deep mcp`, the cli
socket, `events.read`, `evidence.read`, `deep inbox answer`, `deep show`), plus a local HTTPS pack server with a request log
(`pack.ts`; offline = server closed) on the same CA. Two packs, `acme/sounds@1.0.0` (A) and `acme/voices@2.0.0` (B), list
assets by url, sha256, size, license, upstream. The base has no route that installs a url-listed data pack into the hub, and
no pack fetch. The issue says it shares #1731's networked job, so the tests use the surfaces #1731 already has and name
the smallest additions; each is one line in `helpers.ts`/`pack.ts` to change if the implementer's names differ:

1. Install: `deep install <pack folder>` (`pack.json` with `id`, `name`, `version`, `assets`). A failed install reads BLOCKED naming its output.
2. Fetch: `deep_kinds {op: "fetch", pack: "owner/name@version", asset: "<listed path>"}`, replying as the library fetch does: `{status: "held", ask}`, `{status: "fetched", asset: {sha256, license, upstream, ...}}`, `{status: "refused", reason}` (or a tool error), `{status: "BLOCKED", cause, ask}`.
3. Standing rule: cli-role socket method `pack.rule {pack: "owner/name", licenses: [SPDX]}`, as `library.rule`.
4. The asks are `ask.created` events: one `authority` ask holding the plan, one `unblock` ask offline.
5. The document: an `asset.game@1` item `from: {asset: <sha256>}` in a document listing `packs: ["owner/name@version"]`, checked with `deep show --check`; the reply is `refused` or says BLOCKED until the asset is fetched, and lists the asset with its license after.
6. The store: `evidence.read {sha}` finds the file by its listed sha256, `license.name` the SPDX ID.

## Reading of each criterion

- **Disk (AC2):** a listed size of 0.6 × the free bytes under the hub's home is over free/2.2 but under free, so a plain "fits" check passes it and only the 2.2× rule refuses. The server never serves it, and any request for it fails the test. The refusal must contain the listed size in bytes and the free space (bytes within 2 GiB + 2%, or GB/GiB within the same).
- **License (AC3):** read from the pack's listed `license.id`; the issue's "license file" has no named location at the base, so a listing whose file contradicts its id isn't tested (follow-up once the design names where the file lives).
- **Mismatch (AC1):** the server answers the listed size with other bytes starting `PLANTED-MISMATCH-MARKER-1820`; the whole hub folder is searched for them.
- Not tested: a document's `pack@version` giving the same bytes on re-export (the scope's fourth bullet is not an acceptance criterion); resume and quota; the shared job with #1731 beyond the shared ask kinds.
