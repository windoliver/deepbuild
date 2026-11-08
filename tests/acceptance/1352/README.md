# Acceptance tests for #1352: starting with no computer, a hub of your own in the cloud

These tests were drafted blind from issue #1352 (its body as of November 8), `docs/technical-design.md`, AGENTS.md,
CONTRIBUTING.md and the base commit `6aa228ce` (main, no implementation). At the base I also read `scripts/lanes.mjs`
(the doc lanes' entries), `scripts/proof-change.mjs` (for `criterionId`) and `tests/acceptance/1336/` with
`docs/evidence/1336/taste-call.json` for conventions. What `helpers.mjs` needs from those (GitHub's slug and
heading-text rules, the section finder) is copied, never imported; `ac2-doc-lanes.live.test.mjs` is 1336's doc-lanes
test with this issue's section rule. Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes to a
blind redraft by this job.

The issue is design-only: its deliverable is a change to `docs/technical-design.md`, and its Proof is "the design
change and its doc lanes".

## How to run them

```sh
node --test 'tests/acceptance/1352/*.test.mjs'          # all, the live ones included
node --test tests/acceptance/1352/ac1-section.test.mjs tests/acceptance/1352/ac2-privacy-threats.test.mjs \
  tests/acceptance/1352/ac3-agent-routes.test.mjs tests/acceptance/1352/ac5-taste-call.test.mjs   # offline only
```

They're plain `node --test` files and need no build, except the doc lanes test: the catalogue drift lane imports
`packages/contracts/dist`, so build that first (`npm ci && npm run build -w @deepbuild/contracts`); without it the test
skips as `INCONCLUSIVE:`. The two `*.live.test.mjs` files read GitHub through `gh`, so they need network and `gh`
signed in with read access to `windoliver/deepbuild`. Offline or signed out they skip with a message starting
`INCONCLUSIVE:`; a skip is never a pass. The checkout must hold the base commit `6aa228ce`, which several tests read
with `git show` and `git grep`.

## The surface (my choice where the issue leaves it open)

- **The new section** is the one heading in `docs/technical-design.md` (outside fenced code, any level) whose text
  holds the whole word `hub` and the whole word `cloud` or `hosted`, ignoring case, as in the issue's subject "a hub of
  your own in the cloud". The base has none. More than one such heading fails. Its body runs to the next heading of its
  level or higher, so its own subheadings belong to it; blank and `<a id>` lines just before that next heading belong
  to the next heading.
- **Its anchors** are its GitHub slug and each `<a id>` on the lines just above the heading, with only blank lines and
  other anchor lines between. An issue links into the section with `docs/technical-design.md#<one of those anchors>`.
- **What "answers" a decision means.** The section holds the words any answer to that Scope decision has to use (ignoring
  case unless shown capitalised; `…` means any ending):

  | Decision | Words the section must hold |
  |---|---|
  | A hub of your own, not a shared service | `isolated`, `writer`, `shared` |
  | The same hub | `Linux`, `sandbox`, `seam` (or `host@1`), `connection` |
  | Who runs it | `hosted`, `sign-up` (or `sign up`, `signup`), `image`, `locked in` (or `lock-in`) |
  | Whose agents and plan | `unmodified`, `account`, `subscription`, `API key`, `secret` |
  | What leaves your machine | `privacy`, `first screen`, `encrypt…`, `at rest`, `who can read` |
  | The browser | `web client`, `own hub`, `authenticated connection`, `passkey`, `plug-in`, `ask` |
  | Who pays for hosting | `pay` (or `pays`, `paying`), `idle`, `asleep`, `bring-your-own` (or `bring your own`), `free`, `flat` |
  | Moving | `deep backup`, `deep restore`, `generation`, `stale` |

  That is a floor for a text a person also judges (criterion 5), not a reading of the text.
- **"With what was not taken"** is the phrase the design already uses for it: the section says `Not taken` (any case)
  at least eight times, once per decision.
- **The Decided table** is the table under the heading slugged `decided` (`### Decided`). Its rows are its `|` lines
  without the header and the rule line. It must have more rows than at `6aa228ce` (112), and at least one row not at
  the base must link to one of the section's anchors (`](#anchor)`) or hold the words `hub` and `cloud` or `hosted`.
- **The old wording.** The issue's search phrase is "refuses any request carrying a browser Origin". At the base it sits
  in two sentences of the design: Socket roles' "deep-hook's fast rules stay local, the hub still refuses any request
  carrying a browser Origin, reads and the stream over the connection are bounded, and the threats table holds the
  connection's rows." and the threats table's Injected answers row, "There is no HTTP server for a UI, and the hub
  refuses any request carrying a browser Origin, so no web page can reach it." The test finds those sentences at the
  base itself (every text file under `docs/` and `README.md` that holds "browser", split into sentences and table
  cells) and requires that none of them is still in any of those files now, ignoring case, curly apostrophes and line
  breaks. So a hit of the phrase today is only new wording.
- **The threats table** is the table under `## Threats, and what stops each one`. It must have a row that holds all of
  `web client`, `own hub`, `authenticated connection` and `passkey`, and that row must not be a base row unchanged. No
  row may mention `browser Origin`, `every browser` or `any browser` without also naming the `web client`.
- **The privacy section** is the section under `### Privacy`. Its text must differ from the base's and hold `cloud`,
  `sign-up` (or `sign up`, `signup`), `first screen`, `encrypt…`, `at rest` and `who can read`. The base's privacy
  section holds none of them.
- **The doc lanes** are the three CONTRIBUTING.md names: catalogue drift, design links and names, and public text, run
  as 1336's test runs them (each lane's own `commands` from `scripts/lanes.mjs`, with cwd at this checkout, against one
  fetch of the open issues in `DEEP_OPEN_ISSUES`). A lane passes, or every finding it prints (line numbers dropped) is
  also printed when the same commands read the base commit's `docs/**/*.md` and `scripts/planned-names.txt`; public text
  scans the change, so it must pass. Why a baseline, and why not `runLanes`, is in `tests/acceptance/1336/README.md`
  (the machine-wide throttle, and catalogue drift failing on main for open issues no design change touches).
- **The agents** are those the design's "What each agent gives us" table names at the base: Claude Code, Codex, pi and
  Cursor by their rows, and Copilot and OpenCode, which its paseo row names as agents it runs ("any ACP agent" names
  no one, so it isn't counted). Each must have a line in the new section (a table row, list item or paragraph line)
  that names it (`pi` as a whole lowercase word), holds a route word (`allowed`, `API key only` or `not allowed`, any
  case) and holds an `http(s)://` link that isn't into `github.com/windoliver/`, read as the provider's terms.
- **The taste call** is recorded in `docs/evidence/1352/taste-call.json`, in the shape the project used for #1336's:

  ```json
  {"criterion": "#1352.28fd1eed", "who": "the person, and how they came to make the call", "when": "ISO 8601 time",
   "text": {"file": "docs/technical-design.md", "anchor": "<one of the section's anchors>", "sha256": "<see below>"},
   "call": "reads_right", "note": "… the others on the project are told on #1352 and can overrule this call."}
  ```

  `sha256` is the SHA-256 of the section's text as the finder above returns it: its lines from the heading up to and
  without the closing blank and `<a id>` lines, joined with `\n`, no final newline. So a call can't outlive an edit to
  the section; the test prints the mismatch when it does. Other fields (such as `by`) are free. The note must say the
  others are `told` and can `overrul…` it.

## Criteria and tests

Each tag is `criterionId` from `scripts/proof-change.mjs`: `#1352.` and the first 8 hex of the SHA-256 of the `- [ ]`
text, trimmed, whitespace collapsed. Every test name starts with its tag.

| Criterion | Tag | Tests |
|---|---|---|
| 1. The design holds a section answering each decision above, with what was not taken, and the Decided table gains its rows | `#1352.4c4e63a7` | `ac1-section.test.mjs`: the section and its eight decisions with eight `Not taken`; the Decided table's new rows |
| 2. The privacy section and the threats table are changed to match, and the doc lanes pass. A search for the old "refuses any request carrying a browser Origin" row finds only its new wording | `#1352.7a887cd4` | `ac2-privacy-threats.test.mjs` (offline: old wording, threats row, privacy); `ac2-doc-lanes.live.test.mjs` (live) |
| 3. Each agent's route on a hosted machine is written down from its provider's own terms, as allowed, API key only, or not allowed | `#1352.fbaaa304` | `ac3-agent-routes.test.mjs` |
| 4. #1353 and #1354 each link into the new section | `#1352.aaf4b26e` | `ac4-issue-links.live.test.mjs`: reads each body with `gh issue view <n> --repo windoliver/deepbuild --json body` |
| 5. One taste call on the text, by any one person on the project. The others are told, and can overrule it | `#1352.28fd1eed` | `ac5-taste-call.test.mjs`: the record of the call, bound to the section's text. The call itself is a person's, which code can't judge; telling the others is done on #1352 and isn't read by the test. |

Not tested: whether a line elsewhere in the design contradicts the new section in meaning (such as the App API row's
"any request carrying a browser Origin is refused", which the issue's search phrase doesn't hit); whether each agent's
route is what its provider's terms say; and whether a keyword sits in the decision rather than in what was not taken.
Code can't read those; criterion 5's reader covers them.

## On the base

All seven offline tests fail on `6aa228ce` for the expected reasons, and both live tests fail at the missing section
before they read GitHub. See `BASE-FAILURE.txt`, which also describes the planted fix and its mutants, run in a scratch
clone and never in this checkout.
