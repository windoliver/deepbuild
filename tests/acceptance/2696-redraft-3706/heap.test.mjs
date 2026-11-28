import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { buildCopyWithoutEscapeStep, cleanup, copyOfCheckoutAsBuilt, coreHeap, MB, mb, MIN, needBuiltCheckout, REPO, scratch, seedHistory, shortTemp } from './helpers.mjs';

after(cleanup);

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const ROUNDS = 5;

test('#2696.be4d3304 #3706.c1a4b78e after a start on the 30-day record the core thread\'s heap after two full collections is at least 1.2 MB under that of this checkout built without its escape step', { timeout: 19 * MIN }, async () => {
  needBuiltCheckout();
  if (!['release', 'debug'].some((profile) => existsSync(join(REPO, 'target', profile, 'deep-hook')))) throw Error('BLOCKED: this checkout has no deep-hook under target/release or target/debug (cargo build -p deep-hook), and a hub of a checkout starts with nothing else');
  const folder = scratch('deep-2696r-heap-');
  const head = copyOfCheckoutAsBuilt(folder, 'head');
  const { tree: bare } = await buildCopyWithoutEscapeStep(folder, 'bare');
  const seeded = join(shortTemp(), 'root');
  const events = await seedHistory(seeded, 30);
  if (events !== 90_600) throw Error(`BLOCKED: the 30-day record holds ${events} events, not #16 AC12's 90,600`);
  const readings = { bare: [], head: [] };
  for (let round = 0; round < ROUNDS; round++) {
    readings.bare.push(await coreHeap(bare, seeded));
    readings.head.push(await coreHeap(head, seeded));
  }
  const was = median(readings.bare), is = median(readings.head), under = was - is;
  const list = (values) => values.map(mb).join(', ');
  console.log(`#2696 core thread heap after two full collections, MB: without the escape step ${list(readings.bare)} (median ${mb(was)}); this build ${list(readings.head)} (median ${mb(is)}); ${mb(under)} under`);
  assert.ok(under >= 1.2 * MB, `the core thread's heap after two full collections is ${mb(is)} MB in this build (readings ${list(readings.head)}) and ${mb(was)} MB in this checkout built without its escape step (readings ${list(readings.bare)}): ${mb(under)} MB under it, where the criterion asks for at least 1.2 MB`);
});
