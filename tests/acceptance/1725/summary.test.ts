// #1725.6bd3c6a3: "Through a running hub and `deep mcp`, with a session bound by its hooks, `deep_query` with `what: summary`
// on a document the session drew answers, apart from `core` and `set_digest`, what `deep-show run` answers for the same call.
// On the merge base `deep_query` is not in the tool list and the test fails, naming it."
//
// The Claude Code session (bound by its hooks, #806's stand-in) draws the red-box fixture on its document through its own
// deep_show, then asks deep_query for its summary through its own deep mcp. `deep-show run`, the canvas core the hub runs, plays
// the same two calls for the same session in the world the hub gives it. The two summaries' replies match but for `core` and
// `set_digest`.
import { afterEach, expect, test } from 'vitest';
import { AC, CLAUDE, DOC, TEST_MS, brief, call, cleanup, draw, expectListed, onCore, openWorld, queryCall, redBox, showCall, taken, unstamped } from './helpers.ts';

afterEach(cleanup, 60_000);

test(`${AC.summary} deep_query what: summary on the document the session drew answers what deep-show run answers, apart from core and set_digest`, async () => {
  const w = await openWorld();
  await expectListed(w, CLAUDE, 'deep_query');
  await draw(w, CLAUDE, DOC.a, redBox());
  const hub = taken(await call(w, CLAUDE, 'deep_query', { doc: DOC.a, what: 'summary' }), `deep_query what: summary on ${DOC.a} through the Claude Code session's deep mcp`);
  const [, run] = onCore([showCall(CLAUDE, DOC.a, redBox()), queryCall(CLAUDE, DOC.a, { what: 'summary' })]);
  expect(run!['summary'], `deep-show run answers the summary for the same call: ${brief(run)}`).toBeDefined();
  expect(unstamped(hub), `deep_query through the hub answers what deep-show run answers, apart from core and set_digest (deep-show run: ${brief(run)})`).toEqual(unstamped(run!));
}, TEST_MS);
