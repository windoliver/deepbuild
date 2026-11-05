// #1018 through a real hub (`deep hub run`, deep-hook and #29's Claude Code stand-in): a held-out variant's run keeps
// what it failed on out of the record even when its check's run read nothing but the check's own files, so no key
// holds it.
import { randomBytes } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { allEvents, cleanup } from '../../../tests/acceptance/29/h-d.ts';
import { draft, makeTrees, open, removeTemp, requirement, SAMPLE, settled, startHub, stop, stopHub, writes } from '../../../tests/acceptance/1018/helpers.ts';

afterEach(async () => {
  await cleanup();
  removeTemp();
}, 300_000);

const PROMPT = 'make the cart total right for the fixture cart';
const CHECK = '.deepbuild/checks/fixture.sh';
const FIXTURE = 'test/fixtures/cart.json';
/** A check that reads its fixture alone: the tracers see none of the code under test, so its run lands on no key. */
const FILES: Record<string, string> = {
  ...SAMPLE,
  [FIXTURE]: `${JSON.stringify({ name: 'visible-cart', ok: true })}\n`,
  'test/fixture.test.mjs': "import { readFileSync } from 'node:fs';\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('the fixture cart is right', () => {\n  const cart = JSON.parse(readFileSync(new URL('./fixtures/cart.json', import.meta.url), 'utf8'));\n  assert.equal(cart.ok, true, cart.name);\n});\n",
  [CHECK]: 'node --test test/fixture.test.mjs\n',
};

it('a held-out variant of a check whose run read only its own files keeps what it failed on out of the record', async () => {
  const marker = `held-out-${randomBytes(6).toString('hex')}`;
  const w = makeTrees(FILES, [draft(PROMPT, [requirement('R1', 'The fixture cart is right', CHECK, { held_out: [{ files: { [FIXTURE]: `${JSON.stringify({ name: marker, ok: false })}\n` } }] })])], 1);
  const hub = await startHub(w);
  try {
    const a = await open(hub, w, w.trees[0]!, PROMPT);
    await writes(a, { 'src/cart.ts': '// the fixture cart\nexport const total = (items: number[]): number => items.reduce((x, y) => x + y, 0);\n' });
    await stop(a);
    const r = await settled(hub, w, [a]);
    const failed = r.runs.filter((x) => x.check === CHECK && x.outcome === 'failed');
    expect(failed.length, `the variant must run and fail on its fixture: ${r.runs.map((x) => `${x.run} ${x.outcome}`).join('; ')}`).toBeGreaterThan(0);
    for (const e of await allEvents(hub)) expect(JSON.stringify(e), `${e.kind} must not hold the held-out variant's ${marker}`).not.toContain(marker);
  } finally {
    await stopHub(hub);
  }
}, 900_000);
