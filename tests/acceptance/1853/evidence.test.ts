// AC3: deep.evidence.put from a sandboxed test extension (test/caller, whose manifest asks for `files`) stores a file
// in its granted folder (the package's own folder; the path is relative to it) through the evidence store and returns
// its sha256; the store, read through `get` and `read`, holds those bytes with the extension as origin. A file outside
// the grant is refused, naming the path, and doesn't reach the store.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC3, callAs, FIXTURES, NOT_WIRED, openHost, sha256, tempDir } from './helpers.ts';

describe(`AC3 ${AC3} deep.evidence.put of a file in its granted folder returns its sha256 and the store holds it with the extension as origin; a file outside its grant is refused, naming the path`, () => {
  it('AC3 a file in the package\'s folder: its sha256 comes back, and the store holds its bytes with test/caller as origin', async () => {
    const { w, h } = await openHost();
    const bytes = readFileSync(join(FIXTURES, 'caller', 'evidence.txt'));
    const [call] = await callAs(h, [{ method: 'deep.evidence.put', args: ['evidence.txt'] }]);
    expect({ outcome: call?.outcome, error: call?.error }, 'deep.evidence.put stores the file').toEqual({ outcome: 'ok', error: null });
    expect(call?.value, 'it returns the file\'s sha256').toBe(sha256(bytes));
    const held = await w.evidence.get(sha256(bytes));
    expect(held, 'the evidence store holds it').toBeDefined();
    expect(Buffer.from(await w.evidence.read(sha256(bytes))).equals(bytes), 'the stored bytes are the file\'s').toBe(true);
    expect([held!.origin, held!.source].some((v) => String(v).includes('test/caller')), `the extension is its origin: ${JSON.stringify({ origin: held!.origin, source: held!.source })}`).toBe(true);
    expect(['you', 'deepbuild'], 'an extension\'s file is never marked as yours or DeepBuild\'s').not.toContain(held!.origin);
  }, 120_000);

  it('AC3 a file outside the grant is refused, naming its path, and isn\'t stored', async () => {
    const { w, h } = await openHost();
    const outside = join(tempDir('outside'), 'outside.txt');
    writeFileSync(outside, 'a file outside the caller package\'s grant\n');
    const [call] = await callAs(h, [{ method: 'deep.evidence.put', args: [outside] }]);
    expect(call?.outcome, 'the put is refused').toBe('error');
    expect(call?.error ?? '', 'the refusal is the grant\'s, not the host\'s not-wired error').not.toContain(NOT_WIRED);
    expect(call?.error ?? '', 'the refusal names the path').toContain(outside);
    expect(await w.evidence.get(sha256(readFileSync(outside))), 'the outside file never reaches the store').toBeUndefined();
  }, 120_000);
});
