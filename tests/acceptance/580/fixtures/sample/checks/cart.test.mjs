// The compose sample's journey: `web`, built from the repo, serves this checkout's src/cart.ts. It waits for /release,
// which a test writes into the container once it has looked at the stack.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const base = `http://127.0.0.1:${process.env.web}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
test('web serves the claim\'s src/cart.ts', async () => {
  for (const end = Date.now() + 240_000; (await fetch(`${base}/release`)).status !== 200 && Date.now() < end;) await sleep(100);
  const served = await (await fetch(`${base}/src/cart.ts`)).text();
  assert.equal(served, readFileSync('src/cart.ts', 'utf8'), 'the image serves another snapshot\'s cart');
});
