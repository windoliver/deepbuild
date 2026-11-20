// #1415 AC5 and AC9 through a running hub and `deep mcp`: the walk over every published canvas tool's schema, its refusals and
// their error flag, each with the planted tool the criterion names (README: The walk through deep mcp, The planted tools).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup } from '../806/helpers.ts';
import { flagFailures, openWorld, schemaFailures, walkTools, type Walked } from './hub.ts';

const TEST_MS = 1_800_000;
/** The planted hub whose deep_kinds publishes `op` as optional while its handler needs it (AC5). */
const OP_OPTIONAL = 'kinds-op-optional';
/** The planted hub whose deep_kinds returns its refusals as ordinary text, isError unset (AC9). */
const REFUSAL_AS_TEXT = 'kinds-refusal-as-text';

/** One walk on its own hub, which is stopped after it. */
async function walkOn(plant?: string): Promise<Walked> {
  try {
    return await walkTools(await openWorld(plant));
  } finally {
    await cleanup();
  }
}

describe('#1415: the canvas tools through deep mcp', () => {
  let walked: Walked | undefined;
  let error = '';
  beforeAll(async () => {
    try { walked = await walkOn(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }, TEST_MS);
  afterAll(cleanup, 60_000);

  // AC5: "For every published canvas tool, a call with one required field removed is refused with `missing_field`, naming the
  // field and carrying that one tool's schema in under 4 KB; a call with any one optional field removed acts. A planted tool
  // whose schema marks a field optional while its handler needs it fails the walk, naming the tool and the field"
  it('AC5 every canvas tool refuses a call without one required field with missing_field, naming it and carrying that tool\'s schema in under 4 KB, and acts without any one optional field', () => {
    expect(error, 'the walk ran').toBe('');
    expect(schemaFailures(walked!), 'the walk over deep_show, deep_query, deep_kinds and deep_job (each failure names the tool and the field)').toEqual([]);
  }, TEST_MS);

  it(`AC5 (wrong program ${OP_OPTIONAL}) a deep_kinds whose schema marks op optional while its handler needs it fails the walk, naming deep_kinds and op`, async () => {
    const failures = schemaFailures(await walkOn(OP_OPTIONAL));
    expect(failures.some((f) => f.startsWith('deep_kinds') && /\bop\b/.test(f)), `the planted tool's walk fails naming deep_kinds and op: ${JSON.stringify(failures).slice(0, 3000)}`).toBe(true);
  }, TEST_MS);

  // AC9: "Every refusal in the walk sets the protocol's error flag. A planted tool that returns its refusal as ordinary text with
  // the flag unset fails, naming the tool"
  it('AC9 every refusal in the walk, the canvas core\'s own included, comes back with the protocol\'s error flag set', () => {
    expect(error, 'the walk ran').toBe('');
    expect(flagFailures(walked!), 'every refusal in the walk has isError set (each failure names the tool)').toEqual([]);
  }, TEST_MS);

  it(`AC9 (wrong program ${REFUSAL_AS_TEXT}) a deep_kinds that returns its refusal as ordinary text with the flag unset fails, naming deep_kinds`, async () => {
    const failures = flagFailures(await walkOn(REFUSAL_AS_TEXT));
    expect(failures.some((f) => f.startsWith('deep_kinds')), `the planted tool's walk fails naming deep_kinds: ${JSON.stringify(failures).slice(0, 3000)}`).toBe(true);
  }, TEST_MS);
});
