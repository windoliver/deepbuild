# The brief the blind acceptance-test job for #1041 was given

Given once, before any implementation existed, to a separate job with no view of the implementing session. It worked in
its own checkout, detached at the base commit `06e231702`, and wrote only `tests/acceptance/1041/`. Paths under the
home folder are shortened to `~`, and the issue's own text, which the brief carried word for word, is named here
rather than copied.

---

You are the blind acceptance-test job for GitHub issue windoliver/deepbuild#1041, "Web player: saves in the browser, kept per piece and persistent". You write this issue's acceptance tests FIRST, before any implementation exists, from the issue, the design and the base commit only. Another agent implements the issue afterwards and is not allowed to edit your files, so they must be right, runnable, and fair to every correct implementation. You make changes (you write files); you do not implement the feature.

## Where you work, and what you must not see

- Your checkout is `~/doneright-1041-blind`: a git worktree, detached at the base commit `06e231702` (current main). Work only there. Read repo files only as they are in that checkout.
- Do NOT read, list or search any other checkout, worktree, branch, pull request, stash, plan, agent memory or session history, on this machine or on GitHub. Other checkouts may hold work on this issue; seeing any of it voids your tests.
- Write only under `tests/acceptance/1041/` in your checkout. Scratch files go in a temp folder outside the repo, deleted when you finish. Do not commit, push, or run any git command that writes. On GitHub, only read the issue and its oracle page.
- Do not start subagents.

## What to read

- `AGENTS.md` (the repo's rules; they apply to you) and `CONTRIBUTING.md`.
- The issue, live: `gh issue view 1041 --repo windoliver/deepbuild`. Its oracle page, which says no upstream test covers any of the four criteria, so there is no `-oracle` folder to write.
- The design sections the issue links. `docs/technical-design.md`: Films and figures on the canvas; How it installs; How we know version 0 works (Dogfooding, "Tests written first"). `docs/canvas-primitives.md`: Export: web player; Seam and backend; Tour; Net: relay and Join; Logic: saves; Logic: saves across changes; Logic: checkpoints and bake; Check input: logic kinds; and whatever those lean on. Several paragraphs are one very long line each: read them whole.
- At the base, for existing surfaces only: the suites of the two closed issues this one depends on. `tests/acceptance/172/` is the web player core (README.md, helpers.ts, its tests, DISPUTE.md): the model for driving the web export, a server and headless Chrome with WebGPU, and for a taste-call criterion. `tests/acceptance/534/` is logic saves (README.md, helpers.ts, dungeon.ts, programs.ts, wat/): the dungeon piece and a save's fields. Read the code they exercise only as far as needed to learn the protocol: `crates/deep-show` (its `run` scenario and the web export), `crates/deep-player`, `crates/deep-logic`; `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`.

Code is read only to learn existing surfaces. Every expected value comes from the issue's text and the design.

## The issue (copied; re-read it live)

The issue's summary line, its Scope, its Fields and its four acceptance criteria, word for word as they stood on November 16, 2026, and its two dependencies (#172 and #534, both closed and on the base).

## What to write: `tests/acceptance/1041/`

Follow the shape of `tests/acceptance/172/` and `tests/acceptance/534/`:

- `README.md`: what was read; how to run; a criteria-to-tests table with each criterion's ID; the surface under test, with every name you chose marked *(chosen)*; the planted programs; the fixtures; the legs that read BLOCKED or INCONCLUSIVE; the taste call; your readings where the issue and the design leave a choice; and the `scripts/lanes.mjs` lines the implementer must add (you write only your folder).
- `helpers.ts`, the test files, `tsconfig.json`, and `BASE-FAILURE.txt`.

Rules for the tests:

1. Each test's name starts `AC<n> #1041.<h8>`, the ID computed as `criterionId` in `scripts/proof-change.mjs` computes it from the live issue text.
2. Keep the suite lean: one test per leg a criterion states, plus the planted twins the criteria name. No extra defensive tests, no duplicate coverage.
3. Every test must fail on a wrong program, as its criterion names it: the planted twins of criteria 2 and 3 (chosen through the `deep-show run` scenario's `planted` key, as #172's planted players are; never an environment variable), and the base for the rest. A test that would pass if the player did nothing is not a test.
4. Test behavior through the surfaces the issue and the design name: the web export, the bundle's `<deep-player>` element and its members, `probe()`, "Export save" and "Import save" on the player's own controls, the notices a page shows. Where they leave a choice you have to make, choose the smallest surface, shaped like its neighbours, mark it *(chosen)* in the README, and say exactly what the implementer must build. Do not pin anything a criterion doesn't need: not which of the browser's storage mechanisms holds the saves, and not the page's structure beyond the controls and notices you read.
5. Criterion 4 is a taste call. Do as #172's `taste.test.ts` and `TASTE.json` do: the test reads the record only, names the pictures the check run must take (names chosen), and is INCONCLUSIVE without them or without a recorded call on exactly them. You write no TASTE.json and make no picture, and no other criterion reads a picture.
6. Hosts: a leg that needs something this machine lacks (Google Chrome, a WebGPU adapter) fails as `BLOCKED: ...`, never passes and never skips, as #172's suite does.
7. Use node built-ins and vitest only. Drive Chrome over its DevTools protocol with suite code, as #172's helpers do (import them read-only or copy and cut them down); no browser-automation library.
8. Every `it` and every hook passes its own generous timeout (#172 uses 3,600,000 ms; a browser's cleanup in `afterAll` outlasts vitest's 10 s hook default on this machine). A server runs as a child process of its own, since the test process blocks in `spawnSync` while `deep-show` runs. Stop only processes you started, by PID; never by name or port.
9. These files are public. Name only this project's own design and what it runs. Never name another product, engine, library or company that was studied or that an oracle cites, and no browser-automation library. A lane (`node scripts/public-text.mjs`) fails on such names in added text. Use no emojis. Add no attribution lines.
10. No secrets or personal data in fixtures or logs; write paths relative to the checkout in README and BASE-FAILURE.txt.

## What to run (this Mac is shared and heavily loaded; keep it cheap)

The surface plainly does not exist at the base (the base player has no saves), so do not run the whole suite at the base. Do this instead, once each:

- `npm ci` in your checkout if `node_modules` is missing (and `npm run build --workspaces` only if vitest can't load without it).
- The type check exits 0, and `vitest list` collects your tests. Remove `tests/acceptance/1041/node_modules` (vitest's cache) afterwards.
- Try your browser mechanics once against a hand-written stand-in page in a scratch folder outside the repo (never committed): a profile kept across a closed and reopened page, a fresh profile, capturing a file a page exports and handing a file to an import control, the origin's storage quota set below a given size, and your storage shim's grant, refusal and clearing journey.
- Check your fixture against real components where the base can answer: the base's web export should admit your dungeon document, and the base player should play it on its track with the app's own hashes; the base ignores or refuses what it doesn't build, so say which. This needs `deep-show` built in your checkout, exactly as #172's README and helpers build it. If that build has not finished after about 45 minutes, stop it by its PID and write "not checked at the base" for that leg rather than waiting. If the base refuses something the issue needs in the fixture, do not bend the fixture: say so in the README as a base fact.
- `BASE-FAILURE.txt`: for each test, the assertion it meets first at the base and why (read from the base's code where you didn't run it), and which legs you ran.

Aim to finish within about two hours. Do not wait in sleep loops; do not rerun things to be sure.

## What to report back

- The list of files you wrote with each one's sha256.
- The criteria-to-tests table.
- Every surface and name you chose *(chosen)*, and every planted program name with what it does wrong and what a failure must name.
- What you ran, with the output's last lines, and what you did not run.
- Any base fact you found that would stop a correct implementation from passing a test, or that the implementer needs to know (stated as a fact of the base, with how you observed it).

---

One line of the brief as given was wrong: it said a compile cache is configured machine-wide. None is. The job's
`deep-show` build took 16 min 02 s without one and finished inside its limit.
