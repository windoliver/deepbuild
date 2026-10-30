// One asks workload per run, for the perf lane's budgets (issue #319): node benchmarks/asks.mjs <task>.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askSources, draftAskSettings, openAsks } from '../packages/asks/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';

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
const as = (writer, session) => ({ writer, actor: 'you', scope: 'you', session });
const card = { writer: 'app', actor: 'you', scope: 'you' };
const taste = askSources().find((row) => row.kind === 'taste');
/** The taste row's fixture ask, made distinct by `n`, with its deadline and default left to your settings. */
function ask(n) {
  const { deadline: _deadline, default: _default, ...data } = structuredClone(taste.fixture.ask);
  return { ...data, question: `Which header for screen ${n}?`, key: sha256(`taste:${n}`), pinned_to: { kind: 'evidence', ref: sha256(`screen ${n}`) } };
}
async function start(record, session) {
  await record.append(as('hook', session), { v: 1, id: ulidAt(T0), kind: 'session.start', ts: T0, data: { agent: 'claude-code', worktree: '/nowhere', branch: 'main', thread: session } });
}

const workloads = {
  // 200 asks raised and answered on the card, one after another, in one session.
  async 'raise-answer'(record, asks) {
    await start(record, 'S1');
    for (let n = 0; n < 200; n++) {
      const handle = await asks.raise(as('core', 'S1'), taste.source, ask(n));
      await asks.answer(card, handle, { option: taste.fixture.ask.recommended });
    }
  },
  // The inbox over 10,000 open asks: 2,000 sessions with five each, so none folds.
  async 'inbox-10k'(record, asks) {
    for (let s = 0; s < 2000; s++) {
      await start(record, `S${s}`);
      const appends = [];
      for (let i = 0; i < 5; i++) {
        const data = { ...ask(s * 5 + i), deadline: T0 + 30 * 86_400_000, default: taste.fixture.ask.recommended };
        appends.push(record.append(as('core', `S${s}`), { v: 1, id: ulidAt(T0), kind: 'ask.created', ts: T0, data }));
      }
      await Promise.all(appends);
    }
    if ((await asks.inbox()).length !== 10_000) throw Error('the inbox lists every ask');
  },
  // One plan's preview drafted (#69): an authority ask raised with a 500-step plan whose last step can't be undone,
  // until its card shows the whole plan.
  async 'plan-preview'(record, asks) {
    await start(record, 'S1');
    const del = askSources().find((row) => row.source === 'effect.delete');
    const steps = Array.from({ length: 499 }, (_, i) => ({ does: `Delete build/cache/part-${i}.bin`, changes: [`build/cache/part-${i}.bin`], undo: `Restore build/cache/part-${i}.bin from the staged copy`, public: false, cost: 0 }));
    steps.push({ does: 'Empty the staged copies of build/cache', changes: ['the staged copies'], undo: null, public: false, cost: 0 });
    const handle = await asks.raise(as('core', 'S1'), del.source, { ...structuredClone(del.fixture.ask), deadline: T0 + 86_400_000, key: sha256('plan-preview') }, { steps, diff: sha256('build/cache') });
    const shown = (await asks.card(handle)).plan;
    if (shown?.steps.length !== 500 || shown.steps[499].undo !== "can't undo") throw Error('the preview shows every step, the last marked can\'t undo');
  },
};

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
const root = mkdtempSync(join(tmpdir(), 'deep-asks-bench-'));
try {
  const home = join(root, 'home');
  await draftAskSettings(home);
  const record = await openRecord({ path: join(root, 'record.db'), now: () => T0 });
  const asks = await openAsks({ record, now: () => T0, deliver: () => {}, home });
  await workloads[task](record, asks);
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}
