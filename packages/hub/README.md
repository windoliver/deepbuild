# @deepbuild/hub

## What it is for

The hub daemon on its socket (#16), the one writer to the record and evidence store, and the commands that reach it: `deep hub`, `deep mcp`, `deep env`, `deep inbox`, `deep install`, `deep guard add`, `deep undo`, `deep setup`, `deep status`, `deep backup` and the rest its `src/index.ts` lists. The CLI calls it.

## Where new code goes

- `src/server.ts`: the socket and event loop; `src/core.ts`: hook stages, lifecycle and ordered wiring, run in a worker (`src/core-worker.ts`); `src/wire.ts`: what crosses the socket and threads. `src/log-reads.ts`: the log's pages, read-ahead and stream, a seam of the core's with its own state.
- `src/transcript-reader.ts` and `src/transcripts.ts`: transcript reading, cursors, missing-hook judgment and backfill. `src/session-types.ts` separates transcript-reading state from session identity; `src/session-state.ts` owns the live directory, process observations and rows. `src/session-flags.ts` owns what a row flags beside its word (#2019): unpushed commits, alike failures, watch-only causes, agent reach and retried model calls.
- `src/answer-delivery.ts`: answer routes, acknowledgements, waiters and resend state. `src/stop-judging.ts` and `src/stop-reply.ts`: claim lanes, verdicts and held-stop orchestration; the core supplies hook scheduling and record writes.
- `src/mcp-operations.ts`: bound MCP calls. `src/hub-canvas.ts`: canvas state and presentation. `src/session-memory.ts`: written rules and memory. `src/hub-control.ts` dispatches to human answers, trusted actions, evidence, readings and workspace actions; these own their state behind narrow capability ports, never a reference to Core.
- `src/hub-command.ts`: `deep hub run | start | status | stop | use`, the package's `./hub` entry, so the running hub loads the server's modules and none of the other commands'.
- `src/index.ts`: the package's entry; each command loads its own module when it runs, so `deep inbox` loads none of `deep status`'s or the gate's. A command whose modules are heavy stays behind its wrapper there.
- `src/claude-settings.ts`: Claude Code's hook entries and timing relations, plus the settings watch and session-start recheck under their own options; the core supplies running calls, queued work and recorded readings.
- `src/disk.ts`: the machine's disk floor and free space, apart from the product store, so `deep lease` reads them without the store's YAML.
- `src/packs.ts`: immutable canvas pack manifests and local license files (#1820). `deep install` runs the canvas pack check before admitting a version; `src/libraries.ts` shares its networked asset job with library fetches. `deep_kinds {op: "fetch", pack: "owner/name@version", asset: "path"}` and a document's first use wait for the same authority ask. `pack.rule {pack: "owner/name", licenses: [...]}` is CLI-role, OS-confirmed authority. Downloads use Source quotas and resumable ranges, require 2.2× disk room and verify bytes and license terms before use; quota pauses return `pending` with `until`, offline returns `BLOCKED` with one ask per pack. Cached bytes are verified even offline; a pack version cannot be republished with different bytes. `deep export` documents naming packs use the same first-use gate through `canvas.export`; the hub returns checked PNG bytes, never accepts output paths, and documents without packs keep the headless/no-hub export path. Document assets and hashes in kind inputs are resolved against their pinned packs.
- `src/stacks.ts`: worktree and check-run stack policy (`deep env`, `deep_env`, #331, #332), through a supplied lifecycle provider. The composition root currently supplies env-local. Runtime selection of an installed `environment@1` remains unimplemented; the empty release list is a separate limitation, not proof that replacement works.
- `src/teardowns.ts`: the teardown task each outside resource gets, from the `resources` of a repo's done.yaml and its sessions' own calls (#342); only its check closes it.
- `src/agents.ts`: the Agents page's syncs (#148): an MCP server or a skill written into each chosen agent's own file at user level, planned in memory, journaled, replaced and flushed, recovered at start, undone by `deep undo sync:<id>`; each agent's rules come from its facts' `entries`. `src/mcp-exec.ts` is `deep mcp-exec <name>`, a synced server's command with its secrets by handle.
- `src/runs.ts`: the supervisor's runs (`run.start`, deep_run, a claim's checks) and their journal; a claim's check goes through the command check kind, or the kind a loaded package installed with `replaces`.
- `src/hosts.ts`: the hosts your SSH config names (#1942): their facts as readings, runs on them as user services named by run token, started once and followed one connection each, the ask for changes as you there, `deep host list | facts` and `deep run follow`.
- `src/confirmed-command.ts`: `deep library on | off | rule`, `deep pack rule`, `deep job rule` and `deep person invite | revoke`: each one call the hub takes only from your own terminal, once the OS confirms you. A new command of that shape is one more form in its table.
- `src/acceptance.ts`: the blind acceptance job (#1328): its start on the runner, the base rule, the attempt's first commit, disputes and their slots.
- `src/drive.ts`: deep_drive's replicas, each under the replica lease; `src/retention.ts`: the evidence retention pass and snapshot pruning.
- `src/answers.ts`: eligible answers from the record, answer text and delivery outcomes, used by `src/answer-delivery.ts`. Core retains hook scheduling; the delivery seam owns permission delivery and transcript acknowledgement.
- A new command gets its own `src/<command>.ts`, exported from `src/index.ts`; MCP tool schemas go in `src/tools.ts`.
- `tools.json` is generated by `scripts/skill.mjs` from the design's Building blocks table; never hand-edit it.
- Regression tests go in `test/` (helper: `test/hub.ts`) and run the built CLI; acceptance tests live in `tests/acceptance/<issue>` and are never edited.
- Logic of the record, gate, verdicts, leases or an extension belongs in that package, not here.

## What it may import

The top of the TypeScript stack under the CLI: the core packages and the first-party extensions, each through its package name, never a path into its `src`. Only the CLI imports it; no core package or extension ever imports the hub.

## Deviations

- `licenses/`: CC0 1.0 and CC BY 4.0 legal texts from Creative Commons' canonical `legalcode.txt` URLs, unchanged except one redundant EOF blank line removed from CC BY. These two canonical terms URLs read their shipped files without network access; any other terms URL is read through the Source block after authorization. All legal text and notices are retained.
- `native/dev.deepbuild.confirm.policy`: the polkit action the hub asks on Linux (#70): your own password each time, never kept. Root installs it; `deep doctor` says so while it's missing.
- `native/deep-confirm.swift`: a Swift helper, built into `dist/` on macOS only by `native/build.mjs`, through which the hub asks the OS to confirm you (#24).
- `src/plant.ts`: every planted wrong program the tests select with `DEEP_HUB_PLANT`, in one module so a proof lane's twin can lay a wrong program over this file alone.
- `src/vfs.ts`: the design's test VFS (`DEEP_HUB_TEST_VFS`), which numbers durable writes so a test can cut the process after any one, as a power cut would.
- `src/settle.ts`: forces one collection once each thread is warm, so an idle hub holds only what it uses.
