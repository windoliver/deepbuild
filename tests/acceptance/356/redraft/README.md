# Blind redraft of #356 criterion `482272ce` (merge on exact keys, unclear merge asks)

## What it read

Issue #356 (and #357's text for scope only), AGENTS.md, the design's `wiki` row, The learned layer and Reading by
reference, the suites tests/acceptance/355 and 63 (READMEs first), `packages/wiki/src/index.ts`,
`packages/hub/src/search.ts`, the first draft's shared files (`README.md` surface section, `helpers.ts`, `history.ts`,
`setup19.ts`, `fixtures/`; reused, not edited), base `c733840f`. It did not read the first draft's `merge.test.ts`.

## How it reads the criterion

- **Which pages hold claims.** `repos/<name>.md`, `you.md`, `setup.md`, `rules.md`. The base wiki rewrites
  `questions/<repo>/start.md` from the repo page's claims (`STANDING`), so those pages are derived copies: they are
  never counted, and a claim counts once, where it is held. The `index.md` and `log.md` hold none.
- **Exact keys.** A repo path (the session's cwd), a command (`npm run dev`), a variable name (`GITHUB_TOKEN`). A claim
  *states* a key when it is a whole word in the claim line or a quote it cites, so `npm run dev` is not `npm run dev:api`.
  Claims are tied to repos by the session in each source's `at` handle, so no page or claim name is pinned.
- **Merged** = one claim whose sources cover both agents' sessions, `proof` 2. **Separate** = no claim states both
  keys or rests on both repos, and no repo page is shared.
- **Unclear** = the deleted `shop` folder and the live one: nothing merges (two pages, two claims), and `inbox.read`
  holds exactly one ask, not closed, whose question names both paths. A rerun leaves that ask the only one and the
  same one, and every merge result unchanged (proof stays 2, not 4).
- **Invariant 4 reading** (a person sees only what needs a person): two live `api` repos at different paths are not
  unclear, so no ask names both of them. This is the one assertion not stated outright by the criterion.
- An implementation may hold a fact on two pages (repo page and `setup.md`): that passes if every claim stating
  the key is the merged one.

## What it drives and asserts

`merge.test.ts`: `deep setup` on `world()` through `setupWithWindows`, twice. `mergeProblems` (a pure check, exported)
returns problems for: same path and command from Claude Code and Codex (one claim, proof 2, one api repo page);
`make serve` (api at the other path) on another page and claim; `npm run dev:api` its own claim, Codex source only;
`GITHUB_TOKEN` and `GH_TOKEN` each their own claim and session; the shop pages and the one ask. Three tests:
the check on hand-built wikis (right passes, each wrong one named; no hub), the real scenario, and the
`(wrong program)` case under `DEEP_HUB_PLANT=merge-by-name` and `never-merge` (each must exit 0 and be caught).

## Wrong programs

- `merge-by-name`: the two `api` repos (and the two `shop` folders) share a page or a claim; fails the separation checks.
- `never-merge`: the Claude Code and Codex `npm run dev` stay two claims (proof 1); fails the one-claim and proof checks.
- Similar-key merges (dev into dev:api, GH_TOKEN into GITHUB_TOKEN) and a repeated ask on rerun are caught by the
  hand-built case; no plant is named for them.

## Not done

No sample implementation ran, so any of: the ask text naming real paths, `inbox.read` rows (`status`, `question`),
sources citing `session:<id>` handles, may need a redraft request if an implementation can't meet them.
