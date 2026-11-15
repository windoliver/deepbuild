// The merge base's transcript archive, run once in a child process from the merge base's exported sources (base.ts):
//   node --experimental-transform-types --conditions=development base-copy.mjs <job.json>
// job.json: { base, root, out, env, held, now }. It opens the merge base's own record, evidence store and asks core in
// `root`, its adapters (shipped, plus #20's `tiny` adapter, as tests/acceptance/20/helpers.ts registers it), runs one
// pass of its archive over the homes in `env`, and writes each copy every transcript.archived event links, read back
// from its store, to `out`, with out/manifest.json naming them in log order. It never writes to the test's world.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const load = (path) => import(pathToFileURL(join(job.base, path)).href);
const { openArchive } = await load('packages/archive/src/index.ts');
const { factsAdapter, shipped } = await load('packages/adapters/src/index.ts');
const { openAsks } = await load('packages/asks/src/index.ts');
const { openEvidenceStore } = await load('packages/evidence/src/index.ts');
const { openRecord } = await load('packages/record/src/index.ts');

mkdirSync(job.root, { recursive: true });
mkdirSync(job.out, { recursive: true });
const now = () => job.now;
const store = await openEvidenceStore({ root: join(job.root, 'evidence'), now });
const record = await openRecord({ path: join(job.root, 'ledger.db'), now, evidence: store });
const asks = await openAsks({ record, now, deliver: () => undefined });
const adapters = shipped();
const facts = structuredClone(shipped().get('claude').facts);
facts.agent = 'tiny';
facts.transcripts = { readBy: "a run keeps its session's own transcript", conformance: 'tiny/transcripts/folder', home: ['TINY_HOME', '~/.tiny'], path: 'sessions/{session}.jsonl' };
const caps = { holdStop: false, wakeIdle: false, steer: false, followUp: false, answerPermission: false, nativeTools: false, mcp: false, rewrite: false, editInput: false, errorTurnHook: false, startTurn: false };
adapters.register('tiny', factsAdapter(facts, { caps, unsupported: {}, doctor: () => [] }));
const archive = await openArchive({
  record, evidence: store, asks, adapters, env: job.env, now, held: () => job.held,
  connection: { writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' },
});
let error = null;
try {
  await archive.pass();
} catch (e) {
  error = [e?.message, ...(Array.isArray(e?.errors) ? e.errors.map((x) => x?.message ?? String(x)) : [])].join(': ');
}
const copies = [];
for (let after = 0; ;) {
  const page = await record.read({ after, limit: 1000, kinds: ['transcript.archived'] });
  if (!page.length) break;
  for (const e of page) {
    const file = join(job.out, `${copies.length}.copy`);
    writeFileSync(file, await store.read(String(e.data.evidence)));
    copies.push({ session: String(e.data.session), file });
  }
  after = page[page.length - 1].log_pos;
}
await record.close();
writeFileSync(join(job.out, 'manifest.json'), JSON.stringify({ error, copies }));
