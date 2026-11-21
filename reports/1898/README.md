# #1898: what `deep lease` and the hub's start load (Nov 20, 2026)

Read on a MacBook Pro (Mac18,1, Apple M6, 12 cores, 32 GB, macOS 27.2, Node 24.22.0) at main `7ba31d777` with this
branch's tests, by `tests/acceptance/1898` (the blind suite). The load averages (1/5/15 min) were 20/61/100 when the
reading was written, on a Mac shared with other sessions that is not a reference machine; the module counts don't
depend on load. The blind job's run at `ee05e7257` (`tests/acceptance/1898/BASE-FAILURE.txt`), at a 1-minute load of 128 (113-189
across its run), gave the same module counts and medians of 4,289 ms without the kits and 5,279 ms with them.

## The lease path

The static import closure of `packages/cli/dist/main.js` plus its lease branch's module (`@deepbuild/hub/lease` →
`packages/hub/dist/heavy.js`) holds no `yaml`, no `better-sqlite3` and no `.node` addon. Commit 35bb7eaba (#1951, merged as a2841e985) did
this by another route than the issue's first Scope line: `DISK_FLOOR` and `freeBytes` live in
`packages/hub/src/disk.ts`, which `heavy.ts` and `products.ts` both import, rather than in `heavy.ts` itself.

## The hub's start, with and without the kits

`deep hub run` on a fresh home, three starts each, alternating; ms from spawn to the ready line, modules loaded by all
threads by ready + 5 s ([hub-start.json](hub-start.json)). "With the kits" is the suite's stand-in for an eager hub: a
preload imports the four `@deepbuild/checks-*` entries and conformance's index in every thread, not only the core's.

| | median start | starts (ms) | modules, all threads | by thread (0 / 1 / 2) |
|---|---|---|---|---|
| as built (no kit) | 708 ms | 495 / 708 / 835 | 665 | 147 / 388 / 130 |
| with the kits | 512 ms | 512 / 469 / 1,754 | 858 | 215 / 446 / 197 |

Each thread pays 58-68 more modules for the kits. A hub that loaded them eagerly would do so in its core thread only,
so about 60 modules. The start times don't separate the two: in this run the medians even favour the kits, and the
spread of three starts (up to 1.3 s) is larger than any gap, so the kits' cost at start is below what this machine can
read under shared load.

The hub as built loads no conformance or `checks-*` module in any thread by ready + 5 s. Since c332f7fb0 (#2332) the
hub reaches the kits only through dynamic imports (`openKinds` behind the core's `checkKinds` provider, and the
`checks.command` and `reviewOutcomes` providers, the rules page's review read and the speed check), so a kit loads the
first time something uses it: a judged claim, a `checks.kinds` call, a command run, a review round or the rules page.
None of those runs by ready + 5 s on a fresh home. The start already doesn't pay for the kits, so no light `./check`
subpath is needed: no check package's entry is on the start path to narrow.
