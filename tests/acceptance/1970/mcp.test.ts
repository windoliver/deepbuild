// AC2: "`deep_show` called with `docs` in place of `doc` is refused at `/params/arguments/docs` with a remediation
// naming `doc`; an `include` value `pixel` is refused naming `pixels`; `zzzzzz` names none and lists the fields as
// today; on the merge base the first two name nothing and fail"
//
// asserts: through `deep mcp` (started by hand, against a real hub in a temporary home), with deep_show's fields and
// include's values read from the input schema `deep mcp` lists:
// - deep_show with `docs` in place of `doc` is a tool error at /params/arguments/docs whose remediation singles out
//   `doc` among deep_show's fields (`singlesOut`: names it more often than some other field, so a remediation that
//   only lists every field once, as the merge base's does, names nothing);
// - deep_show with `include: ["pixel"]` is a tool error at a path under /params/arguments/include whose remediation
//   singles out `pixels` among include's values;
// - deep_show with `zzzzzz` in place of `doc` is a tool error at /params/arguments/zzzzzz whose remediation names every
//   field deep_show lists (the list, as today) and singles out none.
// Each part is checked on its own, so a run reports every part that fails.

import { describe, expect, it } from 'vitest';
import { Mcp, isObject, makeHome, show, singlesOut, startHub, timesNamed, useBinary, useCleanup, type JsonObject, type Outcome } from './helpers.ts';

useCleanup();
const hook = useBinary('deep-hook');

const DOC = `01JD1970D${'0'.repeat(16)}1`;

/** The tool error's error@2 value: a tool result with isError, never a JSON-RPC error. */
function refusal(o: Outcome, what: string): JsonObject {
  expect.soft(o.protocolError, `${what}: refused as a tool result with isError, not a JSON-RPC error: ${show(o.reply)}`).toBe(false);
  expect.soft(o.isError, `${what}: refused: ${show(o.reply)}`).toBe(true);
  return isObject(o.value) ? o.value : {};
}

describe('AC2 a misspelt deep mcp name names the nearest listed one; a far one names none and lists the choices', () => {
  it('AC2 deep_show with docs names doc at /params/arguments/docs, include pixel names pixels, and zzzzzz names none and lists the fields', async () => {
    hook();
    const { tmp, home } = makeHome();
    await startHub(home);
    const mcp = Mcp.start(home, tmp);
    await mcp.initialize();
    const schema = await mcp.schemaOf('deep_show');
    const props = isObject(schema['properties']) ? schema['properties'] : {};
    const fields = Object.keys(props);
    const include = props['include'];
    const items = isObject(include) && isObject(include['items']) ? include['items'] : {};
    const values = Array.isArray(items['enum']) ? items['enum'].filter((v): v is string => typeof v === 'string') : [];
    expect(fields, `deep_show lists doc and include: ${show(schema)}`).toEqual(expect.arrayContaining(['doc', 'include']));
    expect(values, `deep_show's include takes pixels: ${show(include)}`).toContain('pixels');

    const docs = refusal(await mcp.call('deep_show', { docs: DOC, include: ['issues'] }), 'deep_show with docs');
    expect.soft(docs['path'], `deep_show with docs is refused at /params/arguments/docs: ${show(docs)}`).toBe('/params/arguments/docs');
    const fixDocs = String(docs['remediation'] ?? '');
    expect.soft(singlesOut(fixDocs, 'doc', fields), `deep_show with docs: the remediation names doc, the nearest listed field, not only the list of fields: ${show(fixDocs)}`).toBe(true);

    const pixel = refusal(await mcp.call('deep_show', { doc: DOC, include: ['pixel'] }), 'deep_show with include pixel');
    expect.soft(String(pixel['path']), `deep_show with include pixel is refused at include's value: ${show(pixel)}`).toMatch(/^\/params\/arguments\/include(\/|$)/);
    const fixPixel = String(pixel['remediation'] ?? '');
    expect.soft(singlesOut(fixPixel, 'pixels', values), `deep_show with include pixel: the remediation names pixels, the nearest listed value, not only the list of values: ${show(fixPixel)}`).toBe(true);

    const far = refusal(await mcp.call('deep_show', { zzzzzz: DOC, include: ['issues'] }), 'deep_show with zzzzzz');
    expect.soft(far['path'], `deep_show with zzzzzz is refused at /params/arguments/zzzzzz: ${show(far)}`).toBe('/params/arguments/zzzzzz');
    const fixFar = String(far['remediation'] ?? '');
    expect.soft(fields.filter((f) => timesNamed(fixFar, f) === 0), `deep_show with zzzzzz: the remediation lists every field deep_show lists, as today: ${show(fixFar)}`).toEqual([]);
    expect.soft(fields.filter((f) => singlesOut(fixFar, f, fields)), `deep_show with zzzzzz: the remediation names no field as nearest: ${show(fixFar)}`).toEqual([]);
  }, 600_000);
});
