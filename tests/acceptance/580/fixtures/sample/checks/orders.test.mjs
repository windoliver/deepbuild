// The journey: places one order and expects the orders page to show exactly 1, on a run that starts with no orders and
// a visit counter at 0. Each reading goes to the app's /report, the one way out of the check's sandbox. /go holds it
// where a test needs to look at the stack while the run lasts; /target names a port another stack holds (AC10), which
// it tries to write to.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pg, VERSION } from 'dh-wire';

const base = `http://127.0.0.1:${process.env.web}`;
const get = async (path) => (await fetch(`${base}${path}`)).json();
const report = (body) => fetch(`${base}/report`, { method: 'POST', body: JSON.stringify(body) });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

test('one order shows exactly 1 order', async () => {
  const start = await get('/state');
  await report({ step: 'start', ...start, journey_version: VERSION });
  for (const end = Date.now() + 240_000; !(await get('/go')).go && Date.now() < end;) await sleep(100);
  const target = await get('/target');
  if (target.port) {
    let reached = null;
    try {
      const other = await pg(`postgres://postgres@127.0.0.1:${target.port}/${target.database}`);
      await other.query("INSERT INTO orders (item) VALUES ('from another stack')");
      other.close();
      reached = 'inserted';
    } catch (e) {
      reached = `refused: ${e.code ?? e.message}`;
    }
    await report({ step: 'target', port: target.port, reached });
    assert.notEqual(reached, 'inserted', `port ${target.port} of another stack took the insert`);
  }
  await fetch(`${base}/orders`, { method: 'POST' });
  const shown = await get('/orders');
  await report({ step: 'end', count: shown.count });
  assert.equal(start.orders, 0, `the run started with ${start.orders} orders`);
  assert.equal(start.visits, 0, `the run started with the visit counter at ${start.visits}`);
  assert.equal(start.seeded, '1', 'the seed\'s Redis data is there');
  assert.equal(shown.count, 1, `the orders page shows ${shown.count} orders`);
});
