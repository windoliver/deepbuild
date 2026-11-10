# #1296: a repo status line that shadows the forwarder, and the cap on injected hook output

All proof is the blind suite in `tests/acceptance/1296/` (13 tests, each file run once on this branch, all pass), run
with Node 24.22.0 and the 1.99.1 toolchain on PATH. Paths below are redacted to `<tmp>`.

## Fixture repos and the doctor's output (AC1, `doctor.test.ts`)

`deep doctor` in a git repo whose `.claude/settings.json` sets `statusLine.command`:

```
Claude Code claude.statusline_shadowed: WARN (statusline_shadowed)
  <tmp>/repo/.claude/settings.json sets statusLine.command, which Claude Code runs instead of the forwarder in <tmp>/repo, so no plan window is read there
  Fix: Take statusLine.command out of <tmp>/repo/.claude/settings.json, or run your status line from statusline.yours in ~/.deepbuild/config.json, which the forwarder runs after it reads the windows.
```

`.claude/settings.local.json` reads the same. A repo with neither shows no such item. With nothing else failing the
doctor exits 3 (not decided): `exit.code@1` keeps 1 for a failed item. `DEEP_HUB_PLANT=statusline-user-settings-only`
reads your user settings only and shows nothing, which fails the test.

## The session's window readings (AC2, `windows.test.ts`)

`deep status` for a session in the shadowed repo, then the line for one in another repo whose forwarder sent 31% used
(the lines' form, as the code writes them; the test asserts "unknown", the file and no percentage on the first):

```
      5 h · unknown: <tmp>/work/.claude/settings.json sets statusLine.command, which runs instead of DeepBuild's status line forwarder, so this session's plan windows aren't read
      5 h · 69% left · resets <time>
```

The forwarder now sends the session ID its input carries, and a reading shows only on that session's row, for a
session the hub met through its hooks. `window-unknown-as-zero` and `window-carried-from-other-repo` show a
percentage on the shadowed row and fail. The repo's settings file is byte-identical after setup and the doctor.

## The facts entry with its source version (AC3, `facts.test.ts`)

`adapters/claude-code.facts.json` `contextOutput`: `capChars` 10000, `previewChars` 2000, the facts' versions
(2.1.299, 2.1.304, 2.1.308), its source (code.claude.com/docs/en/hooks, read Nov 9 2026 against 2.1.308), and per hook
event where `additionalContext`, `systemMessage`, `stdout`, `stderr` (exit 0) and `stderrOnBlock` go. The docs state
no version for the cap. `node scripts/corpus.mjs check --facts <dir>` with the entry taken out prints
`FAIL corpus: the Claude Code facts (claude-code.facts.json) have no contextOutput entry, the context-output entry, …`.

## The delivered resume block beside its handle (AC4, `resume.test.ts`)

A resume whose block is 14,018 characters (R1 to R12, five typed rules and 54 AGENTS.md rule lines) gets a SessionStart
context inside 10,000 characters: the rules head, every typed rule, every requirement ID, then the rule-file lines
while they fit, and a last line such as
``DeepBuild: rules didn't fit in this hook's 10000-character limit; the rest is at ev:<sha256>. Continue with `deep read ev:<sha256>`.``
`deep read` returns every remaining line. The record holds `session.context_fit@1` with what went inline (by part and
by handle, `rule:typed…`, `req:<task>#R<n>`), what went by handle, the cap, the size and the handle.
`sends-block-whole` sends the block whole, past the cap; cut to a 2,000-character preview, the test names the first
missing ID.

## The conformance kit's planted adapter (AC5, `kit.test.ts`)

`adapter@1` gains the case `context/reaches-model` and two fakes, one per new rule of `adapter.facts@1`'s `x-rules`:
`block-as-postcompact-stdout` fails with "needed block sent where it reaches no model: the reply to PostCompact sent
it as stdout, which the facts mark as reaching debug", and `block-as-stderr-exit-0` fails with "needed block sent as
stderr on exit 0: the reply to SessionStart …". The shipped Claude Code adapter passes the case.
`node scripts/conformance-lint.mjs`: `PASS kit adapter@1: 28 fakes killed, 67 planted codes raised alone`.
