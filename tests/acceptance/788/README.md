# Acceptance tests for #788: an extension's tool.before handler is still asked about a call a warn-mode guard entry matches

Written first, blind, from issue #788's body, `AGENTS.md`, `docs/technical-design.md` (Extension API; guard modes
#304; hook replies) and the source at base `61aa8eb06`, by a job that read no git history, no pull request and no
existing test naming the issue. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

Every test runs on real components: a real hub (`deep hub run` from the built CLI) on a temp home, one real outside
extension (`test/warned`) installed and conformance-checked through the extension host's API and loaded by the hub,
guard entries in the hub's `rules.json`, and Claude Code `PreToolUse` hooks for a Bash call sent through the hub's socket
the way deep-hook sends them, naming the entries deep-hook matched. Each assertion is on what the agent receives: the
reply's exit code, its stderr (a deny's reason), and its hook output's `additionalContext` (text and order). No mock.

The extension's handler answers by what the command names (`helpers.ts`): `deny-me` denies ("this is a force-push
call"), `tell-me` adds context ("3 notes are open"), `quiet-me` answers nothing, `late-me` answers after 10 s,
`throw-me` throws, `probe-me` answers nothing and is counted, `report-me` adds the count so far ("<n> probes seen").

| ID | Criterion | Test (file) | What it proves |
|---|---|---|---|
| `#788.214d45c6` | With a warn-mode guard entry matching a call, an extension that denies it still denies it | `warn-entry.test.ts` (1) | A `deny-me` call the warn entry matched exits 2 with the extension's labelled reason on stderr, and no output allows it. |
| `#788.232478cf` | An extension's context for that call reaches the agent after the warn's words | `warn-entry.test.ts` (1) | A `tell-me` call the warn entry matched exits 0; its `additionalContext` holds the warn entry's reason, next step and name, and the extension's labelled block, and the warn's reason and next step come before the block. |
| `#788.7e7bdede` | A handler that adds nothing, runs late or fails leaves the warning as the reply | `warn-entry.test.ts` (3) | One test each for `quiet-me`, `late-me` and `throw-me` under the warn entry: exit 0, empty stderr, no deny, and `additionalContext` still holds the warn entry's reason, next step and name with nothing from the extension; the late one's reply also comes before the hold the hub acknowledged. |
| `#788.8c6af1bc` | A block-mode entry still decides first: the extension isn't asked | `block-entry.test.ts` (1) | Two calls a block-mode entry matched (`probe-me`, and `probe-me deny-me`) exit 2 with the entry's reason and name and no word of the extension (its deny reason absent); the handler's own count, read through a `report-me` call no entry matches, is 0; after one `probe-me` no entry matches, it is 1, so the count works. |

The IDs are the brief's, each at the start of its test's name.

## Readings where the issue leaves a choice

- **"the warn's words"**: the warn entry's `reason`, `next_step` and its name, as #304's warn reply carries them. The
  tests don't pin the exact sentence around them.
- **"after"**: the warn's reason and next step start earlier in `additionalContext` than the extension's block (its
  text or its label, whichever is first).
- **"leaves the warning as the reply"**: the call runs (exit 0, no deny, empty stderr) and the agent still reads the
  warning, with nothing of the extension's added.
- **"the extension isn't asked"**: read from the handler itself. It counts each call it is asked about; the count is
  read back as context on a later call no entry matches. A positive control shows the count moves.
- The commands under the block entry's control calls start with `true`, not `echo`, so the entry's `run:echo` match
  would not cover them; the tests name what deep-hook matched in each request.

## Wrong programs (`twins.json`, `twins/`)

Each twin is one file from the base, whole, with one change (one line per twin in `twins/README.md`):

- `asks-only-on-empty-reply` (`packages/hub/src/server.ts`): the hub asks the extensions only when the guard entries'
  reply is empty, the fault the issue reports. Tagged `#788.214d45c6` (the deny is dropped) and `#788.232478cf` (the
  context never comes).
- `context-before-warning` (`packages/hub/src/hook-replies.ts`): the extensions' blocks go before the warn's words.
  Tagged `#788.232478cf`.
- `quiet-handler-empty-reply` (`packages/hub/src/server.ts`): a reply with no deny and no context, a late or failed
  one included, is the empty reply, so the warning is lost. Tagged `#788.7e7bdede`.
- `block-asks-extension` (`packages/hub/src/server.ts`): a call a block-mode entry matched is still put to the
  extension. Tagged `#788.8c6af1bc`.

## Run them

From the checkout's root with Node 24 after `npm ci` and `npm run build --workspaces`:

```sh
npx vitest run tests/acceptance/788 --reporter=verbose
```

Each test starts its own hub (two starts: setup, then with the extension loaded); timeouts are 300 s for a loaded
machine. A hub that doesn't start, or an extension that fails its conformance check, throws `BLOCKED:`.
