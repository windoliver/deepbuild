import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { deflateSync } from 'node:zlib';
import { CHECKOUT, judgedRow, manifest, marked, measured, names, percent, ranOnce, recordOf, reportOf, sidesOf, staged, within } from './helpers.mjs';

const RETAIN = 'evidence-retain-30d';
const PUT = 'evidence-put-5mb';
const BENCHMARK = 'benchmarks/evidence.mjs';
const DIST = 'packages/evidence/dist';
const DAYS_OLDER_THAN_30 = 36 - 30;
const RECORDS_A_DAY = 500;
const CITED_AND_KEPT_ONE_IN = 10;
const RECORDS_REMOVED = DAYS_OLDER_THAN_30 * RECORDS_A_DAY * (1 - 1 / CITED_AND_KEPT_ONE_IN);
const PNG_ROWS = (1200 * 3 + 1) * 1400;
const PNG_SIGNATURE = 8, PNG_CHUNK_FRAME = 12, PNG_HEADER = 13;
const BYTES_STORED = PNG_SIGNATURE + PNG_CHUNK_FRAME + PNG_HEADER + PNG_CHUNK_FRAME + deflateSync(Buffer.alloc(PNG_ROWS), { level: 0 }).length + PNG_CHUNK_FRAME;
const PLANTED_STORE = `import { join } from 'node:path';
import { openEvidenceStore as openKept } from './kept.js';
export * from './kept.js';
export const openEvidenceStore = (options = {}) => openKept(options.root === undefined ? options : { ...options, root: join(options.root, 'unseen') });
`;

function evidenceTasks() {
  assert.ok(existsSync(join(CHECKOUT, DIST, 'index.js')), `BLOCKED (build): <checkout>/${DIST}/index.js isn't built, and ${BENCHMARK} imports it: run npm run build -w @deepbuild/evidence there first`);
  const { tasks } = JSON.parse(readFileSync(join(CHECKOUT, 'benchmarks/budgets.json'), 'utf8'));
  return Object.fromEntries([PUT, RETAIN].map((id) => {
    const found = tasks.find((one) => one.id === id);
    assert.ok(found, `benchmarks/budgets.json holds no task ${id}`);
    return [id, found];
  }));
}

function storeAsBuilt() {
  const built = readdirSync(join(CHECKOUT, DIST), { recursive: true }).map((name) => name.split('\\').join('/')).filter((name) => /\.(?:js|json)$/.test(name));
  return Object.fromEntries([BENCHMARK, 'packages/evidence/package.json', ...built.map((name) => `${DIST}/${name}`)].map((path) => [path, readFileSync(join(CHECKOUT, path))]));
}

const onItsOwn = staged(after, async (box) => box);

test('AC7 #3537.e8bf6db2 evidence-put-5mb reports the bytes it stored and evidence-retain-30d the records its pass removed, each the same on two runs of an unchanged store', within(15), async () => {
  const box = await onItsOwn();
  const tasks = evidenceTasks();
  const counts = [
    [PUT, 'bytes', BYTES_STORED, 'the bytes of the 1200 by 1400 PNG it puts, as the store keeps them'],
    [RETAIN, 'records', RECORDS_REMOVED, `the records its pass removes: the ${DAYS_OLDER_THAN_30} oldest days at ${RECORDS_A_DAY} a day, less the one in ${CITED_AND_KEPT_ONE_IN} that is cited`],
  ];
  for (const [id, count, expected, what] of counts) {
    const [first, second] = ['first', 'second'].map((turn) => {
      const ran = ranOnce(box, tasks[id].command, CHECKOUT);
      assert.equal(ran.status, 0, `BLOCKED (benchmark): ${id}'s command, ${tasks[id].command.join(' ')}, exited ${ran.status} on its ${turn} run: ${ran.said}`);
      const read = reportOf(ran.stdout);
      assert.ok(read, `${id}'s run prints no report, a last stdout line that is a JSON object, so nothing says what it did: its stdout ends ${JSON.stringify(ran.stdout.slice(-300))}`);
      return read;
    });
    assert.equal(first.work?.[count], expected, `${id}'s report doesn't hold work.${count} as ${expected}, ${what}: its work is ${JSON.stringify(first.work ?? null)}`);
    assert.deepEqual(second.work, first.work, `${id} reports unlike work on two runs of an unchanged store, ${JSON.stringify(first.work)} then ${JSON.stringify(second.work ?? null)}, so its two sides would never compare`);
  }
});

async function play(box) {
  const tasks = evidenceTasks();
  const repo = await marked(box, { 'benchmarks/budgets.json': manifest(Object.values(tasks)), ...storeAsBuilt() });
  const commit = repo.commit({ [`${DIST}/kept.js`]: readFileSync(join(CHECKOUT, DIST, 'index.js')), [`${DIST}/index.js`]: PLANTED_STORE }, 'Plant a store that opens its records one folder down, so its retention pass removes nothing');
  const run = await measured(box, repo, 40);
  return { commit, record: recordOf(box, run, commit, 'the commit that plants the store') };
}
const scene = staged(after, play);

const said = (row) => JSON.stringify({ state: row.state, note: row.note ?? null }).slice(0, 1500);

test('AC7 #3537.e8bf6db2 a planted store whose retention pass removes nothing reads INCONCLUSIVE on evidence-retain-30d, naming records and both values, and evidence-put-5mb, whose store is unchanged, is not held for unlike work', within(45), async () => {
  const { commit, record } = await scene();
  const retain = judgedRow(record, RETAIN);
  const sides = sidesOf(retain);
  assert.ok(sides && sides.instructionsKept < 0.5, `INCONCLUSIVE (scene): the window's own readings don't show the planted store doing less than the merge base's on ${RETAIN}: ${JSON.stringify(retain).slice(0, 1500)}`);
  const planted = `${commit} plants a store whose retention pass removes nothing, where the merge base's pass removes ${RECORDS_REMOVED} records, and its instructions retired fell by ${percent(1 - sides.instructionsKept)}`;
  assert.notEqual(retain.state, 'PASS', `${RETAIN} read PASS, judged as on the merge base: ${planted}`);
  assert.equal(retain.state, 'INCONCLUSIVE', `${RETAIN} read ${retain.state}, not INCONCLUSIVE: ${planted}: ${said(retain)}`);
  for (const named of ['records', RECORDS_REMOVED, 0]) assert.ok(names(retain.note, named), `${RETAIN}'s INCONCLUSIVE on ${commit} doesn't name ${named}, of the count records and its values ${RECORDS_REMOVED} on the merge base and 0 on the change: ${said(retain)}`);

  const put = judgedRow(record, PUT);
  assert.ok(!(put.state === 'INCONCLUSIVE' && names(put.note, 'bytes')), `${PUT} is held for unlike work on ${commit}, which leaves what a put stores as it was, ${BYTES_STORED} bytes on both sides: ${said(put)}`);
  const none = record.noWork?.tasks;
  assert.ok(Array.isArray(none) && !none.includes(PUT) && !none.includes(RETAIN), `the record of ${commit} lists ${PUT} or ${RETAIN} among the tasks that report no work, or lists none: its noWork is ${JSON.stringify(record.noWork ?? null)}`);
});
