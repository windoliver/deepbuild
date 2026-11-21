# Acceptance tests for #1904: one GitHub REST client; five copies fold into one that bounds redirects

Written first, blind, from issue #1904 as the brief quoted it, the design (Threats, and what stops each one;
Dogfooding), AGENTS.md and base commit `dcb63a0a0` (= origin/main), by a job that never saw an implementation; none
existed, and no other branch, worktree, pull request or stash was read, nor the live issue. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#1904.b57b5ae4` | `redirects.test.ts` (12): per caller, an off-origin redirect, and a redirect loop |
| AC2 | `#1904.9f3f4bff` | `one-header.test.ts` (1): exactly one place in `packages/*/src` sets GitHub's authorization header |
| AC3 | `#1904.6f3b1f79` | no new test (below) |

The IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text as the brief gave it, after `- [ ] `;
the live issue body wasn't read, so they aren't checked against it.

## The callers, confirmed at the base

Grepping `packages/*/src` (tests left out) for `authorization`, `Bearer`, `api.github.com` and `vnd.github` finds
eleven places that send a bearer token to GitHub's API, more than the five files the issue names:

| File | Site | Reached here through |
|---|---|---|
| `github/src/pushes.ts:28` | `restOf` (also used by `delivery.ts`) | `githubPushes` (package entry) |
| `github/src/apps.ts:40` | `call` | `revoke` (package entry) |
| `hub/src/forge.ts:112` | `Forge.page` | `new Forge(api, token).pullFor` (module export) |
| `hub/src/github-source.ts:53` | `liveFetch` (REST) | `liveFetch` (module export) |
| `hub/src/github-source.ts:78` | `liveGraphql` (GraphQL, same file) | `liveGraphql` (module export) |
| `archive/src/index.ts:292` | `forgeRuns`'s `get` | `openArchive(...).pass()` (package entry), via `../20/helpers.ts` |
| `hub/src/workspaces.ts:246`, `work.ts:330`, `landing.ts:120` and `:303`, `intake.ts:368` | private methods of hub classes | not reached by AC1 (below); counted by AC2 |

The hub's package entry exports only commands, so `Forge`, `liveFetch` and `liveGraphql` come from the modules that
export them, imported from source as other suites do. Not counted: `landing.ts:95` and `intake.ts:293` hand git an
`http.extraHeader` for `git push`/`fetch`, which isn't a REST call and isn't a header our code sets on a request;
`hub/src/channels.ts:235` (generic channels), `hub/src/reach.ts:122` (Slack) and `extension-host/src/sources.ts:907`
(generic sources) aren't GitHub.

## AC1: the stand-in forge

Two `node:http` servers on 127.0.0.1, on different ports, so different origins: the forge, and elsewhere. The forge
answers every request with a redirect to the same path on elsewhere: 302 for a GET, 307 for `revoke`'s DELETE and
GraphQL's POST (so the method survives). Elsewhere answers as GitHub would, so a caller that follows gets a usable
answer. Each caller has its own token (`tok-1904-pushes`, `-apps`, `-forge`, `-issues`, `-graphql`, `-archive`). One
assertion per test, on a summary, so the base's whole answer shows in the diff:

- `forgeAskedWithToken`: the forge saw the caller's token (a caller that did nothing can't pass);
- `refused`, each caller's own way: `githubPushes`, `revoke` and the archive's pass reject (and the archive records no
  `ci.archived`); `pullFor` answers `undefined` (its "the forge doesn't answer"); `liveFetch`/`liveGraphql` give an
  `Answer` that isn't elsewhere's 200 (a 599, the 3xx itself, or a throw);
- `tokenSentElsewhere: 0` and `requestsElsewhere: 0`: archive's rule, refused before the other origin is asked.

The loop case: the forge redirects to itself forever. The caller must refuse, with the forge asked at most six times.
That bound is a reading of the Scope ("one client, with archive's redirect and deadline rules"): archive gives up after
five redirects. Each test's timeout is 30 s, so a hang fails.

Not reached by AC1: the five private hub sites in the last table row. Their classes (`Workspaces`, `Work`, `Landing`,
`Intake`) need a hub's record, git checkouts and more to reach a call, and the issue names five clients. AC2 forces
them through the one function, which AC1's callers exercise.

## AC2: the pattern

A site is a line matching `/\bauthorization['"]?\s*[:=,]\s*[`'"]Bearer /i`: an object key (`authorization: \`Bearer …\``,
quoted or not), a property set (`headers.authorization = …`) or a `Headers` call (`.set('authorization', 'Bearer …')`),
in a non-test `.ts` file under `packages/*/src` that names `github` anywhere. git's `\`Authorization: Bearer …\``
value doesn't match: the quote opens before `Authorization`, not before `Bearer`. The non-GitHub sites' files don't
name GitHub. At the base it finds the eleven sites above; a planted copy of any of them is a second.

## AC3

"The suites that cover the touched files pass unchanged against the merge base, and each package's type-check passes" is
proven by running those suites and `tsc` for each touched package, not by a test here; a test restating it would
prove nothing.

## Run them

```sh
npm ci && npm run build --workspaces   # vitest.config.ts needs the packages' dist
node node_modules/vitest/vitest.mjs run tests/acceptance/1904
node node_modules/typescript/bin/tsc -p tests/acceptance/1904/tsconfig.json
```

A few seconds. Binds ephemeral ports on 127.0.0.1 only; no network beyond it.

## Base results

`BASE-FAILURE.txt` is the run at the base, whole, with the checkout's path replaced by `<repo>`, on macOS arm64 at load
~80: 11 failed, 2 passed. Every failure is at the summary assertion.

| Caller | Off origin: base answer | Loop: base answer |
|---|---|---|
| `restOf` (`githubPushes`) | followed; returned elsewhere's push (commit `eee…`, pusher `elsewhere`); 4 requests elsewhere | threw `fetch failed` after 21 requests |
| apps `call` (`revoke`) | followed the 307; elsewhere's 204 read as revoked; 1 request elsewhere | threw `fetch failed` after 21 |
| `Forge.pullFor` | followed; returned elsewhere's pull URL; 1 request elsewhere | `undefined` after 21 |
| `liveFetch` | followed; returned `{ status: 200, body: elsewhere's }`; 1 request elsewhere | 599 after 21 |
| `liveGraphql` | followed the 307; returned elsewhere's 200; 1 request elsewhere | 599 after 21 |
| archive (`pass`) | refused, nothing asked of elsewhere (passes: #1775's rule) | refused after 6 (passes) |
| AC2 | 11 sites (fails) | |

The token reached elsewhere from no caller: Node's fetch (undici) drops `authorization` on a cross-origin redirect.
So at the base the leak is the answer, not the token: five callers take another origin's answer as GitHub's. The archive's two tests pass on the
base; the lanes need a wrong program for them (a planted twin, written later by the implementer).

No fix was tried against the suite.
