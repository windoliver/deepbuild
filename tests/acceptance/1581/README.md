# Acceptance tests for #1581: each ask says whether it needs the trusted path, and a proposal's approval does

Written blind, from issue #1581 (and its epic #2 and #65), `docs/technical-design.md` and base commit `ebf1e7f44` (origin/main). Never edit these; a dispute goes to this job's blind redraft (design: Dogfooding).

What this job read: the issue; #2 and #65; the design's "Threats, and what stops each one", "An ask, and your answer getting back" (with "Where asks reach you, and how answers are delivered"), "Socket roles and contract versions", the Channel block, the Decided rows on what an answer authorizes, and "How we know version 0 works"; `AGENTS.md`, `CONTRIBUTING.md`; at base, the surfaces of `packages/asks` (`raise`, `askSources`), `packages/hub` (`deep_propose`, the channels), `packages/channels/chat`, and the suites `tests/acceptance/65` (worlds, providers, chat answers), `318` (the asks core's raise refusals) and `3347` (README shape).

## Run

```sh
npm ci && npm run build --workspaces      # the tests run the built CLI: deep hub run, deep install, deep mcp
scripts/lease cargo build --locked -q -p deep-hook   # the hub won't start without target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --testTimeout=600000 --no-file-parallelism --root tests/acceptance/1581
node node_modules/typescript/bin/tsc -p tests/acceptance/1581/tsconfig.json --noEmit
```

Node 24.22 on macOS, as #65's README says. Every hub runs under a temp `HOME` (`~` in output), with #34's confirmation stand-in, no network beyond 127.0.0.1. With `--root` Vitest writes `tests/acceptance/1581/node_modules/.vite`; delete it before committing.

## The surface, and what is yours to provide

Real: the hub, its record and asks core, the chat channel plug-in installed with `deep install`, `deep mcp` (`deep_propose`) and `channel.link`. The only stand-in is the chat provider on 127.0.0.1 (`tests/acceptance/65/fixtures/providers.ts`, imported unchanged), as in #65. The worlds come from `tests/acceptance/65/helpers.ts` and `tests/acceptance/318/helpers.ts`, imported unchanged; no new helper file.

Names this suite uses that the issue and design already give: the trusted path; #65's words "answer in the app or on your paired phone" (the card's `summary`) and its item fields (`answerable`, `options`); the events `ask.created`, `ask.answered`, `decision.created`, `channel.refused` (its `reason`); the tool `deep_propose` and its option `apply`; the sources `deep_propose.choice` and `deep_ask.taste`.

What an implementation must provide for the tests to reach it:

- **The declaration is a field of the ask**, carried by the example ask (`fixture.ask`) of every row of `packages/asks/sources.json`. I do not choose its name or its two values. AC2 finds it as *every field the example ask has beyond the base's eleven* (`kind question options recommended deadline fallback default provisional owner key pinned_to`) and removes all of them. The rows of `deep_propose.choice` and `deep_ask.taste` must carry it, with the declaration of the trusted path on the first and of any verified channel on the second. *(chosen: that reading)*
- `raise(connection, source, ask)` refuses the ask without it with an error whose message holds the source's name before the dot (`deep_propose`, `deep_ask`); it appends nothing.
- A refused chat answer is recorded as `channel.refused` with `data.channel` `chat` and a `reason` containing "trusted path", as #65 already requires of authority asks.

## Criteria

| ID | Criterion | Test | Wrong program it fails on |
|----|-----------|------|---------------------------|
| `#1581.e1bcacd3` AC1 | a proposal answered from a linked chat account is refused naming the trusted path, and chat's card has no buttons | `proposal.test.ts` | the merge base (see below) |
| `#1581.124656c7` AC2 | an ask raised with no declaration fails its schema naming the raiser | `declaration.test.ts` | a core that fills a default or has no declaration |
| `#1581.ecbb919c` AC3 | a taste ask still takes a verified channel's answer | `proposal.test.ts` | a program that makes every ask trusted-path only, or draws taste cards without buttons |
| `#1581.17fc86a1` AC4 | every raiser listed in the PR with its class | none | see below |

IDs are the first 8 hex of SHA-256 of each criterion's text (verified).

**AC1.** The test runs a real `deep_propose` through `deep mcp` bound to a paseo agent, waits for the card on chat, then presses "apply" from the linked account. It asserts, in this order: no `ask.answered` and no decision for the proposal; a `channel.refused` for chat naming the trusted path; the ask still open in Needs you; no card chat ever received carries answer buttons, and the first says "answer in the app or on your paired phone". Expected on this base: **fails** at the first assertion, with the message "the hub took chat's "apply" for the proposal ask:… as an answer (ask.answered …); the card chat showed carried answer, 2 buttons, …", because a `choice` is answerable by a linked account and drawn with live buttons.

**AC2.** Through the asks core and the record (no hub): for `deep_propose.choice` and `deep_ask.taste`, the row's example ask with its declaration removed is refused, naming the raiser, and appends nothing; the same ask with it is raised. Expected on this base: **fails** at "the example ask carries a declaration … (it carries none)", since the base's example asks carry only the eleven fields.

**AC3.** A seeded `deep_ask.taste` (through the real asks core before the hub starts) shows on chat with buttons, "green" from the linked account is recorded as `ask.answered` with `via: channel`, and nothing is refused. Expected on this base: **passes**: it guards against a fix that closes every ask to chat.

**AC4.** The list is in the pull request and a person reads it; a test cannot see a PR. What a test here does see: any raiser whose ask lacks the declaration is refused at run time (AC2), and the base's `scripts/ask-sources-guard.mjs` already checks that each `raise` in `packages/` names a row of `ask.sources@1`. I wrote no test for AC4: a test that lists today's raisers passes on a program that declares them wrongly, and one that asserts a class per source would repeat the implementation's table.

## Readings where the issue leaves a choice

- "Arrives there with no buttons": there is the chat channel; the card is drawn as #65 says for a view-only item (no buttons, the words above).
- "Naming the trusted path": the refusal's `reason` matches `/trusted path/i`, the words #65's channel refusals already use.
- "Naming the raiser": the error message holds the source name's part before the dot.
- A proposal is tested through the real `deep_propose`, so the test also checks that tool's declaration; the answer pressed is "apply", the option the issue's "Apply it" names.

## Not covered here

- Scope "The two lists go": the lists are internal; behavior that no longer depends on the kind is seen only through a declaration whose value I don't know. AC1 (a `choice` refused) is the case the old lists got wrong.
- Scope "Drop it declares the trusted path": the ask a blocked promise raises (`promise.blocked`) needs a whole promise flow. Not tested; AC1's refusal of the same `choice` kind stands for it.
- AC1's "the agent hears Apply it" effect is not read; the record's `ask.answered` is.
- The design's other kinds (authority, exception, definition) keep #65's tests.

## What the implementer adds outside this folder

If `scripts/lanes.mjs` needs a line for a suite that runs a hub, add one as for `tests/acceptance/65`. The declaration in every row of `packages/asks/sources.json`, and the PR's list of raisers with their class (AC4).

## Files

`README.md`, `tsconfig.json`, `proposal.test.ts` (AC1, AC3), `declaration.test.ts` (AC2). `BASE-FAILURE.txt` is added by the parent.
