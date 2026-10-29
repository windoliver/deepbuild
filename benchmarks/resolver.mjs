// resolver-decisions matching an ask against 10,000 saved decisions, for the perf lane's budgets (issue #23):
// node benchmarks/resolver.mjs. One process records 10,000 choices, each answered and saved for one of ten repos,
// then hands the resolver 200 asks: 100 a decision covers, 50 in a repo none covers and 50 new. It fails unless each
// is answered exactly when a decision covers it.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecord } from '../packages/record/dist/index.js';
import { resolverDecisions } from '../packages/resolver-decisions/dist/index.js';

const T0 = 1_760_013_451_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID at `ms`, with a counter for its random part: unique, ordered, and the same on every run. */
function ulidAt(ms) {
  let s = '';
  let value = (BigInt(ms) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const as = (writer, session) => ({ writer, actor: 'you', scope: 'you', ...(session ? { session } : {}) });
const options = [{ id: 'one', label: 'one', decision: 'none' }, { id: 'two', label: 'two', decision: 'none' }];
const point = (i) => `req:01JSEED${String(i).padStart(18, '0')}`;
const key = (i) => sha256(`choice ${point(i)}`);

const root = mkdtempSync(join(tmpdir(), 'deep-resolver-bench-'));
try {
  const record = await openRecord({ path: join(root, 'record.db'), now: () => T0 });
  for (let i = 0; i < 10_000; i++) {
    const id = ulidAt(T0);
    const data = {
      kind: 'choice', question: `Which way for requirement ${i}?`, options, recommended: 'one', deadline: T0 + 172_800_000, fallback: 'you', default: 'one',
      provisional: false, owner: 'you', key: key(i), subject: { point: point(i) }, pinned_to: { kind: 'evidence', ref: sha256(point(i)) },
    };
    await record.append(as(`mcp:seed${i % 10}`, `seed${i % 10}`), { v: 4, id, kind: 'ask.created', ts: T0, data });
    await record.append(as('core'), { v: 1, id: ulidAt(T0), kind: 'decision.created', subject: `ask:${id}`, ts: T0, data: { key: key(i), scope: `repo:repo${i % 10}`, answer: i % 3 ? 'one' : 'two', ask: `ask:${id}` } });
  }
  const resolve = resolverDecisions({ record });
  for (let j = 0; j < 200; j++) {
    const i = (j * 37) % 10_000;
    const [repo, k] = j < 100 ? [`repo${i % 10}`, i] : j < 150 ? ['repoElsewhere', i] : [`repo${j % 10}`, 10_000 + j];
    const ask = {
      ask: `ask:${ulidAt(T0)}`, kind: 'choice', options, plan: null, words: [], changed: null, folded: [], undo: false, cost_usd: null,
      suggested: null, conflict: [], needs_person: [], session: `probe${j}`, key: key(k), repo, subject: { point: point(k) },
    };
    const answer = await resolve(ask);
    if (Boolean(answer) !== j < 100) throw Error(`ask ${j} was ${answer ? 'answered' : 'left'}, but a decision ${j < 100 ? 'covers' : "doesn't cover"} it`);
  }
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}
