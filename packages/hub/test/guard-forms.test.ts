// The install check over each spelling an entry reads (#1523): every pair of a proof that lists them goes through
// deep-hook's check mode as a lone planted call and twin do.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { addGuards } from '../src/guards.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const deepHook = join(REPO, 'target/debug/deep-hook');
const shipped = JSON.parse(readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8')) as { entries: Record<string, unknown>; proofs: Record<string, unknown> };
const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
const install = (name: string, proof: unknown) => addGuards(dir, { v: 1, entries: { [name]: shipped.entries[name] }, proofs: { [name]: proof } }, { deepHook, classes: {} });

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the install check reads each form an entry ships', () => {
  it.each(['push-needs-ask', 'pr-needs-ask', 'merge-needs-ask', 'merge-names-head'])('%s installs with every form its proof ships', async (name) => {
    dir = mkdtempSync(join(tmpdir(), 'guards-'));
    expect((shipped.proofs[name] as unknown[]).length).toBeGreaterThan(1);
    expect(await install(name, shipped.proofs[name])).toEqual({ status: 'installed', names: [name] });
  });
  it('refuses an entry one of whose forms goes through, or whose twin is matched, naming the call', async () => {
    dir = mkdtempSync(join(tmpdir(), 'guards-'));
    const proof = shipped.proofs['merge-needs-ask'] as unknown[];
    const through = await install('merge-needs-ask', [...proof, { planted: bash('gh api repos/acme/shop/pulls/3/merge'), twin: bash('gh pr view 3') }]);
    expect(through).toMatchObject({ status: 'refused', reason: expect.stringContaining('`gh api repos/acme/shop/pulls/3/merge` goes through') });
    const matched = await install('merge-needs-ask', [...proof, { planted: bash('gt merge'), twin: bash('git town ship') }]);
    expect(matched).toMatchObject({ status: 'refused', reason: expect.stringContaining('twin `git town ship` is matched') });
    expect(await install('merge-needs-ask', [...proof, { planted: bash('gt merge') }])).toMatchObject({ status: 'refused' });
    expect(await install('merge-needs-ask', [])).toMatchObject({ status: 'refused' });
  });
});
