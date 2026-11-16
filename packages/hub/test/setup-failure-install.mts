// Subprocess probe: an unhandled rejection must crash this process, not be swallowed by the test runner.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world } from './setup-failure-world.ts';
const w = await world();
try {
  const installed = join(w.cwd, 'node_modules/broken'); mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, 'package.json'), '{malformed fixture');
  const snapshot = w.ports.checkouts.snapshot.bind(w.ports.checkouts);
  w.ports.checkouts.snapshot = async (...args) => { await new Promise((done) => setTimeout(done, 150)); return snapshot(...args); };
  const { claim, lane } = await w.claim();
  const rows = await w.ports.record.raw('SELECT outcome, reasons FROM verdicts WHERE claim_id = ?', [claim.slice(6)]);
  const items = await w.ports.record.raw('SELECT text FROM open_items WHERE task_ref = ? AND closed IS NULL', [w.task]);
  process.stdout.write(JSON.stringify({ rows, items, lane: lane.status }));
} finally { await w.close(); }
