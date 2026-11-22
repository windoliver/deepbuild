# Dispute: #806's AC1 test for #393 AC9 against #2896's unknown-client cap

Recorded 2026-11-21 on the MacBook Pro. Paths are redacted (`~`, `<scratch>`).

## What failed

`tests/acceptance/806/replay393.test.ts`, "AC1 #393 AC9: 5,000 unnamed marks refused give the stand-in's replies". It
plays #393's AC9 scenario through `deep mcp` on a real hub and compares each reply with the `deep-show` stand-in's,
field for field. The replay's `deep mcp` names itself `acceptance-26` in `initialize`. #2896 holds a client the facts
don't know to the smallest limit any facts file holds (its AC6). For an error, that included Codex 0.144.0's
10,000 bytes, held a fifth under, at 8,000 bytes. `deep_show`'s refusal of the 5,000 marks is 8,471 bytes as the stand-in
sends it. So the hub cut it to 34 issues, against the stand-in's 38 (`original-fails-first.txt`).

The test passes at load 4 on main `2f05ccb3e`, alone, and fails on #2896 merged with that main (b3870b835).

The rest of #806's replay files fail on main on this Mac too (`806-ab.txt`): `replay393`, `closed` and `replay384`
fail 12 of 15 tests on main and on b3870b835 alike. The tests that differ between the two sides are timeouts (no reply in
30 or 120 s), at load 26 to 80.

## The redraft

The test went to a fresh blind job (design: Dogfooding). Its inputs were issue #806, the sections #806 links, AGENTS.md
and a fresh GitHub clone of main at `2f05ccb3e`. It never saw #2896, its work, its diff or this dispute. Its files are
in `redraft/`: the test (kept as `.txt`, since it doesn't run from here), its README and `BASE-RESULT.txt`.
- On main it passes, on its one rerun after a load timeout. It fails a planted hub that changes `truncated`.
- On #2896 it fails the same way as the first draft, 34 against 38 (`redraft-fails-first.txt`).

Since the redraft also fails on the work, the test stands and no one is asked (design: Dogfooding). The redraft is
not added to `tests/`, and #806's test runs unchanged.

## The fix in #2896

`packages/hub/src/reply-fit.ts`, `0a5cab54f`: an error's cap keeps a fifth spare under its characters (the 9,000
drafted from the 11,000 an error keeps, AC5) and its tokens, whose count a cut can miss by a token or two. It holds bytes
at the facts' figure itself. A result's page keeps its fifth under every figure, as drafted.

- An unknown client's error cap is now 8,800 characters, 8,000 tokens and 10,000 bytes. So is Codex 0.144.0's, and that
  of any Codex version the facts don't list, which takes the smallest of Codex's entries.
- The 8,471-byte refusal reaches the unknown client uncut, so it equals the stand-in's.
- Claude Code's caps, and those of the Codex versions #2896 names, are unchanged: their entries give no byte figure.

Review round 6 found that `0a5cab54f` counted an error's bytes as `deep mcp` sends them, not as Codex receives them. An
error carries no `structuredContent`, so Codex's body is the content array JSON-encoded, with the refusal escaped once
more, after a "Wall time" header (codex-rs 0.144.0). A quote-dense, non-ASCII refusal held to 10,000 sent bytes reached
Codex 0.144.0 at 14,273, past its cut at 12,000. The next commit counts an error's bytes as Codex receives them, held
to the facts' 10,000, with Codex's own fifth more as the spare. `packages/hub/test/reply-fit.test.ts` holds that case;
its failing-first run is `../unit-fails-first-round6.txt`.

On the fix, the first draft and both of the redraft's tests pass, each file run alone (`passes-after-fix.txt`, load
100 to 127). An earlier run of the same files together, at load 13, got `unavailable` from the hub (it did not answer in time)
in both `deep_show` tests; the redraft's `--check` test passed in it.
