// #1725.9bb6c26d: "`deep_query` on a document another session wrote answers only that session's layer as the binding allows,
// as #411's suite reads it through `deep-show run`."
//
// The Claude Code session draws a gate board as its own document: the gate's fill is bound to that session's open ask (#411's
// AC5, here on an agent's own board), which the record holds from before the hub started. The Codex session, bound by its
// hooks (a Codex call binds by the PreToolUse stamped for it), asks deep_query for the board's rows and the gate's fill. Its
// answer is `deep-show run`'s for the same call by the same session, apart from `core` and `set_digest`: rows only in the Claude
// Code session's layer, and the gate's fill `ref_unresolved` with no value, since the Codex session may not read another
// session's ask. The Claude Code session's own query, the twin, reads the value.
import { afterEach, expect, test } from 'vitest';
import {
  AC, CLAUDE, CODEX, DOC, GATE, GATE_FILL, TEST_MS, brief, call, cleanup, draw, events, expectListed, gateBoard, isObject, onCore, openAsk, openWorld, queryCall,
  showCall, taken, unstamped, type JsonObject,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const ROWS: JsonObject = { what: 'rows', paths: [GATE_FILL], at: ['0s'] };

test(`${AC.binding} deep_query from another session answers only the writer's layer as its binding allows, as deep-show run answers it`, async () => {
  const w = await openWorld({ askFor: CLAUDE });
  const ask = w.ask!;
  await expectListed(w, CODEX, 'deep_query');
  const board = gateBoard(ask);
  await draw(w, CLAUDE, DOC.a, board);
  const other = taken(await call(w, CODEX, 'deep_query', { doc: DOC.a, ...ROWS }), `deep_query from the Codex session on the Claude Code session's ${DOC.a}`);
  const own = taken(await call(w, CLAUDE, 'deep_query', { doc: DOC.a, ...ROWS }), `deep_query from the Claude Code session on its own ${DOC.a}`);

  const [, runOther, runOwn] = onCore([showCall(CLAUDE, DOC.a, board), queryCall(CODEX, DOC.a, ROWS), queryCall(CLAUDE, DOC.a, ROWS)], openAsk(ask, CLAUDE));
  expect(unstamped(other), `the Codex session's deep_query answers what deep-show run answers for the same call, apart from core and set_digest (deep-show run: ${brief(runOther)})`).toEqual(unstamped(runOther!));
  expect(unstamped(own), `the Claude Code session's deep_query answers what deep-show run answers for the same call, apart from core and set_digest (deep-show run: ${brief(runOwn)})`).toEqual(unstamped(runOwn!));

  // Only the writer's layer: the one the record holds the Claude Code session's revision in.
  const patched = (await events(w.hub)).filter((e) => e.kind === 'doc.patched' && String(e.data?.doc ?? '').endsWith(DOC.a));
  const layer = patched.at(-1)?.data?.layer;
  expect(typeof layer, `the record holds the Claude Code session's revision of ${DOC.a} with its layer: ${brief(patched.map((e) => e.data))}`).toBe('string');
  const rows = Array.isArray(other['rows']) ? other['rows'].filter(isObject) : [];
  expect(rows.map((r) => r['id']).sort(), `the Codex session's rows are the board's items: ${brief(other)}`).toEqual(['caption', GATE]);
  expect(rows.filter((r) => r['layer'] !== layer).map((r) => `${String(r['id'])} in ${String(r['layer'])}`), `every row is in the writer's layer ${String(layer)}`).toEqual([]);

  // As the binding allows: the gate's fill, read through the Claude Code session's ask, is unresolved for the Codex session.
  const values = isObject(other['values']) ? other['values'][GATE_FILL] : undefined;
  expect(values, `the Codex session gets no value for ${GATE_FILL}: ${brief(other)}`).toEqual([null]);
  const unresolved = Array.isArray(other['unresolved']) ? other['unresolved'].filter(isObject) : [];
  expect(unresolved.some((u) => u['path'] === GATE_FILL && u['code'] === 'ref_unresolved'), `ref_unresolved for ${GATE_FILL}: ${brief(other['unresolved'])}`).toBe(true);
  expect(rows.find((r) => r['id'] === GATE)?.['code'], `the gate's row answers ref_unresolved: ${brief(rows)}`).toBe('ref_unresolved');
  expect(JSON.stringify(other), 'nothing of the ask\'s state reaches the Codex session').not.toContain('needs_you');
  const mine = isObject(own['values']) ? own['values'][GATE_FILL] : undefined;
  expect(Array.isArray(mine) && mine.length === 1 && mine[0] !== null, `the Claude Code session, whose ask it is, reads the gate's fill: ${brief(own)}`).toBe(true);
}, TEST_MS);
