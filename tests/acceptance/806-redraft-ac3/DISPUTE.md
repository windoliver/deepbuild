# Dispute: the first draft reads a refused deep_show as a result with the error flag unset

This redraft exists because of this dispute. The first draft is the first test of `tests/acceptance/806/unbound.test.ts`
("AC3 the call is refused with no_session and no snapshot, and the record and the evidence store gain nothing").

## What fails

#806's AC3: "A `deep_show` call from a `deep mcp` process bound to no session is refused and draws nothing, and the record
gains no revision". #1415 adds "Every refusal sets the protocol's error flag as well as its code", and its AC9 holds
`deep_show` and `deep_query` bound to no session to a refusal with `isError` set. The first draft asserts the opposite, on
its line 18, before it reads anything the criterion states:

```ts
const { reply, isError } = await deepShow(f.hand, CALL, 'deep_show from a deep mcp bound to no session');
expect(isError, 'a refused deep_show is #393\'s reply, not a protocol error').toBe(false);
```

The run, on #1415's work:

```
FAIL  unbound.test.ts > AC3 a deep_show call from a deep mcp process bound to no session is refused and draws nothing,
      and the record gains no revision > AC3 the call is refused with no_session and no snapshot, and the record and the
      evidence store gain nothing
AssertionError: a refused deep_show is #393's reply, not a protocol error: expected true to be false // Object.is equality
```

The reply itself is unchanged: `outcome: "refused"`, `code: "no_session"`, no snapshot and no revision, now with the tool
result's `isError` set. It still comes back as a tool result, never a JSON-RPC error, which is what the line's message
names; it is `isError` that the line reads.

## How the redraft was made

AC3 went to a fresh run of a blind job with the same inputs: issue #806 (its scope and AC3, quoted), the design and a base
with #806's work and none of #1415's. It never saw #1415, its work, the diff or this dispute, and was told only to write
AC3's test. It reads "refused" as #393's reply with `outcome: "refused"` or a tool error (`isError`), not a JSON-RPC error
or `unavailable`, and checks that nothing is drawn (no snapshot, no revision the app draws, no picture of the figure in the
evidence store) and that the record gains no revision, with a bound session's same call as its control. It passes on its
base, and on #1415's work (one test, 20 s).

## What is decided, and what is yours

The first draft is kept by hand in `scripts/lanes.mjs`; the redraft runs in its place. This is the one dispute that comes
to you (design: Dogfooding): keep #1415's rule, as the work and the redraft do, that every refusal sets the error flag, a
canvas tool's own refusal included; or keep refusals of the canvas core's own as ordinary results, which drops that part of
#1415 (its AC9) and lets the first draft run again.
