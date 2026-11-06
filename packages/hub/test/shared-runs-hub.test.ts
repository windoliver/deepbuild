// #1018 through a real hub (`deep hub run`, deep-hook and #29's Claude Code stand-in): a held-out variant's run keeps
// what it failed on out of the record even when its check's run read nothing but the check's own files, so no key
// holds it; and a journey run on a warm stack (#580) lands on no key, so another session runs its own.
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

const SHOP = '.deepbuild/checks/shop.sh';
/** A journey on a warm stack: done.yaml's environment starts the app (no compose), and the check reads the cart it serves. */
const STACKED: Record<string, string> = {
  ...SAMPLE,
  '.deepbuild/done.yaml': `environment:\n  up: ${JSON.stringify(`'${process.execPath}' app.mjs`)}\n  ports: [web]\n  ready: { http: "http://127.0.0.1:\${web}/health", within: 30 }\n`,
  'app.mjs': "import http from 'node:http';\nhttp.createServer((_, res) => res.end('ok')).listen(Number(process.env.web), '127.0.0.1');\n",
  'test/shop.test.mjs': "import { readFileSync } from 'node:fs';\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\n\ntest('the cart takes the discount off', () => {\n  assert.match(readFileSync(new URL('../src/cart.ts', import.meta.url), 'utf8'), /discount/);\n});\n",
  [SHOP]: 'node --test test/shop.test.mjs\n',
};
const SHOP_PROMPT = 'make the shop take the discount off';
const CART = '// the shop\nexport interface Cart { items: number[]; discount: number }\nexport const total = (cart: Cart): number => cart.items.reduce((a, b) => a + b, 0) - cart.discount;\n';

it("a journey run on a warm stack lands on no key: another session's claim on the same files runs its own", async () => {
  const w = makeTrees(STACKED, [draft(SHOP_PROMPT, [requirement('R1', 'The shop takes the discount off', SHOP, { depth: 'journey' })])], 2);
  const hub = await startHub(w);
  try {
    const a = await open(hub, w, w.trees[0]!, SHOP_PROMPT);
    const b = await open(hub, w, w.trees[1]!, SHOP_PROMPT);
    await writes(a, { 'src/cart.ts': CART });
    await stop(a);
    await settled(hub, w, [a]);
    await writes(b, { 'src/cart.ts': CART });
    await stop(b);
    const r = await settled(hub, w, [a, b]);
    const ran = r.runs.filter((x) => x.check === SHOP && x.outcome === 'passed');
    const served = (await allEvents(hub)).filter((e) => e.kind === 'stack.served').map((e) => (e.data as { run?: string }).run);
    expect(ran.filter((x) => served.includes(x.run)).length, `each run must be served by its tree's stack: runs ${ran.map((x) => x.run).join(', ')}; served ${served.join(', ')}`).toBe(ran.length);
    expect(new Set(ran.map((x) => x.claim)), `both claims run the journey, neither carries the other's: ${r.runs.map((x) => `${x.run} ${x.check} ${x.claim} ${x.outcome}`).join('; ')}`).toEqual(new Set(r.claims.map((c) => c.claim)));
  } finally {
    await stopHub(hub);
  }
}, 900_000);
