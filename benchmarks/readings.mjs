// #45: the readings' budgets on a heavy month, as #26's budget has it (20 sessions a day for 30 days, 18,000 events).
// `recompute` reads them all; `update` adds one session to a month already read. Fails past the issue's 10 s and 1 s.
import { readingsOf, recompute, update } from '../packages/readings/dist/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);
let id = 0;
function session(name, start) {
  const out = [];
  for (let t = 0; t < 10; t++) {
    const at = start + t * 60_000;
    out.push({ id: `a${id++}`, kind: 'user.ask', ts: at, session: name, data: { msg: t, text: 'go on', tasks: [], from: 'person' } });
    out.push({ id: `h${id++}`, kind: 'stop.held', ts: at + 30_000, session: name, data: { session: `session:${name}`, stop: `s${id}`, claim: null, total: 3500, question: 0, slow: 0, fast: 3000, snapshot_start: 500, queue_wait: 0, code_changing: true, budget_cost: [] } });
    out.push({ id: `u${id++}`, kind: 'turn.usage', ts: at + 31_000, session: name, data: { turn: `m${id}`, model: 'claude-haiku-5-5', covers: 'turn', tokens: { input: 1000, cached: 0, output: 200, exact: true }, cost: { basis: 'estimated', usd: 0.01, rate_card: 'card' } } });
  }
  return out;
}
const month = Array.from({ length: 30 }, (_, d) => Array.from({ length: 20 }, (_, s) => session(`D${d}S${s}`, T0 + d * DAY + s * 1_800_000))).flat(2);
const mode = process.argv[2];
const t0 = performance.now();
if (mode === 'recompute') {
  const read = readingsOf(recompute(month));
  if (!read.length) throw Error('a month read to nothing');
  if (performance.now() - t0 > 10_000) throw Error(`recompute took ${performance.now() - t0} ms against 10 s`);
} else if (mode === 'update') {
  const state = recompute(month);
  const t1 = performance.now();
  const before = readingsOf(state).length;
  if (readingsOf(update(state, session('New', T0 + 40 * DAY))).length <= before) throw Error('the new session did not show');
  if (performance.now() - t1 > 1000) throw Error(`update took ${performance.now() - t1} ms against 1 s`);
} else throw Error('Usage: readings.mjs recompute | update');
