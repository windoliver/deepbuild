// AC4: "`op: field` with `test.slab@3.widht` is refused with `unknown_field` naming `width` first; `test.slab@3.w` (the
// @1 name) names `width` with `renamed_in: test.slab@2`; each reply is one error in the shared shape"
//
// asserts: deep_kinds `{op: "field", path: "test.slab@3.widht"}` and `{op: "field", path: "test.slab@3.w"}`, each
// through `deep-show run` and through the deep_kinds tool of `deep mcp` (started by hand against `deep hub run` in a
// temporary home), is one error and nothing else: on `deep-show run` a reply `{"error": …}` holding no lines, over
// MCP a tool result with isError (never a JSON-RPC error). Each error validates against one of the contracts'
// published error@N schemas (the shared shape: its six fields and no other, its code from the closed set) with code
// unknown_field. Its remediation, what every route carries to the agent, singles width out among test.slab@3's fields
// (#1970's reading: it names width more often than some other field, so a list of every field names nothing):
// for widht, width is the first close name it names; for w, it also names test.slab@2, the version whose rename made
// w width. A `close` list the error may carry, if any, agrees: widht's starts with width, w's holds width with
// renamed_in test.slab@2 (helpers.ts, missFailures). test.slab@3's fields are read from the full build's dump.

import { afterAll, describe, expect, it } from 'vitest';
import {
  Mcp, SLAB, SLAB_RENAMED_IN, cleanup, dumpOf, entryIn, fieldCall, isObject, makeHome, missFailures, none, run, show, startHub, useFullBuild,
  type JsonObject, type Miss,
} from './helpers.ts';

const build = useFullBuild({ hook: true });
afterAll(cleanup, 60_000);

const MISSES: Miss[] = [
  { path: `${SLAB}.widht`, names: 'width', first: 'width' },
  { path: `${SLAB}.w`, names: 'width', renamedIn: SLAB_RENAMED_IN },
];

/** test.slab@3's fields in the full build, from its dump. */
const slabFields = (bin: string): string[] => entryIn(dumpOf(bin), SLAB).fields.map((f) => f.field);

describe('AC4 a miss on op: field is one unknown_field error in the shared shape, naming the close names, renames first', () => {
  it('AC4 deep-show run: test.slab@3.widht is refused with unknown_field naming width first, and test.slab@3.w names width with renamed_in test.slab@2, each one error in the shared shape', () => {
    const bin = build();
    const fields = slabFields(bin);
    expect(fields, `${SLAB}'s fields in the dump`).toEqual(expect.arrayContaining(['width', 'height']));
    const replies = run(bin, MISSES.map((m) => fieldCall(m.path)));
    const failures: string[] = [];
    MISSES.forEach((m, i) => {
      const reply = replies[i]!;
      const stray = Object.keys(reply).filter((k) => ['lines', 'text', 'errors', 'issues'].includes(k));
      if (stray.length) failures.push(`${m.path}: the reply holds ${stray.join(', ')} beside its error, not one error alone: ${show(reply, 800)}`);
      failures.push(...missFailures(reply['error'], m, fields));
    });
    none(failures, 'the two misses through deep-show run');
  }, 3_600_000);

  it('AC4 the deep_kinds tool over deep mcp: test.slab@3.widht is refused with unknown_field naming width first, and test.slab@3.w names width with renamed_in test.slab@2, each one tool error in the shared shape', async () => {
    const bin = build();
    const fields = slabFields(bin);
    const { tmp, home } = makeHome();
    await startHub(home);
    const mcp = Mcp.start(home, tmp);
    await mcp.initialize();
    const failures: string[] = [];
    for (const m of MISSES) {
      const o = await mcp.call('deep_kinds', { op: 'field', path: m.path });
      if (o.protocolError) { failures.push(`${m.path}: deep mcp answered a JSON-RPC error, not a tool error: ${show(o.reply, 800)}`); continue; }
      if (!o.isError) { failures.push(`${m.path}: the tool answered without isError: ${show(o.value ?? null, 800)}`); continue; }
      failures.push(...missFailures(isObject(o.value) ? (o.value as JsonObject) : o.value, m, fields));
    }
    none(failures, 'the two misses through the deep_kinds tool');
  }, 3_600_000);
});
