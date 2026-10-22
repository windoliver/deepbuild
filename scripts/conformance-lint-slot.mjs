// One slot kit's preflight check, run by conformance-lint in a worker of its own so the kits that spawn
// processes (check.kind@1's suites, environment@1's servers) run beside each other instead of one after the
// other. Posts the kit's problems back; the lint prints them.
import { parentPort, workerData } from 'node:worker_threads';

const { kitProblems, slotKits } = await import('../packages/conformance/dist/index.js');
const kit = slotKits().find((k) => k.slot === workerData);
if (!kit) throw Error(`no slot kit ${workerData}`);
parentPort.postMessage(kitProblems(kit));
