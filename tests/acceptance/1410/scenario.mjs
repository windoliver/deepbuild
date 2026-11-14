// The #1410 scenario, run as its own Node process under the sync shim (README, The scenario). It drives only the public
// entries of @deepbuild/record and @deepbuild/evidence, as the hub's core composes them (one evidence store, passed to
// the record, the record on its own file storage, commitEach as the hub opens it), and marks each step by syncing an
// empty file in the markers folder, which the shim logs in order with everything else.
//
//   node scenario.mjs <evidence root> <ledger path> <markers folder>
//
// Its last stdout line is JSON: the hashes and event IDs the tests judge, read back from the record.
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { catalogue, fixtures } from '@deepbuild/contracts';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord, ulid } from '@deepbuild/record';

const [root, ledger, markers] = process.argv.slice(2);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const mark = (name) => {
  const fd = openSync(join(markers, name), 'w');
  try { fsyncSync(fd); } finally { closeSync(fd); }
};

// Four contents whose hashes fall in four different folders, so a sync of one's folder is never another's.
const used = new Set();
const distinct = (make) => {
  for (let n = 0; ; n++) {
    const text = make(n);
    const prefix = sha(text).slice(0, 2);
    if (!used.has(prefix)) { used.add(prefix); return text; }
  }
};
const named = distinct((n) => `the output a verdict cites, run ${n}\n`);
const unnamed = distinct((n) => `a file no event ever cites, run ${n}\n`);
// Longer than the record keeps of a field (8192), so the record stores the whole text as evidence itself.
const command = distinct((n) => `echo ${'lorem ipsum '.repeat(1000)}${n}`);
const prompt = distinct((n) => `please ${'carry on with the plan '.repeat(500)}${n}`);

let clock = Date.now();
const now = () => (clock += 5);
const YOU = { actor: 'you', scope: 'you' };
const session = ulid(now());
const hook = { writer: 'hook', ...YOU, session, agent: 'claude-code' };
const core = { writer: 'core', ...YOU };
const event = (kind, over = {}) => {
  const schema = catalogue().find((e) => e.kind === kind).schema;
  const fx = structuredClone(fixtures(schema)[0]);
  const ts = now();
  const input = { v: fx.v, id: ulid(ts), kind, ts, data: { ...fx.data, ...(over.data ?? {}) } };
  if (over.subject ?? fx.subject) input.subject = over.subject ?? fx.subject;
  if (typeof fx.seq === 'string') input.seq = (BigInt(ts) * 1_000_000n).toString();
  if (over.evidence) input.evidence = over.evidence;
  return input;
};
const label = { redaction: 'complete', license: { name: 'own', allows: [] } };

mark('start');
const store = await openEvidenceStore({ root, now });
const record = await openRecord({ path: ledger, now, evidence: store, commitEach: true });
const writer = store.connect({ role: 'deepbuild', via: 'job' });
const stored = async (text, source) => {
  const put = await writer.put({ bytes: new Uint8Array(Buffer.from(text)), kind: 'file', source, ...label });
  if (put.status !== 'stored') throw Error(`the evidence store refused ${source}: ${put.reason}`);
  const ev = put.evidence;
  // As the hub's core records each file it keeps: an evidence.stored event, which streams.
  await record.append(core, event('evidence.stored', { data: { sha256: ev.sha256, kind: ev.kind, type: ev.type, size: ev.size, origin: ev.origin, redaction: ev.redaction, license: ev.license.name, derived_from: [], step_times: [] } }));
  return ev.sha256;
};
mark('opened');

await record.append(hook, event('session.start', { data: { agent: 'claude-code', worktree: '/tmp/work', branch: 'main', thread: session } }));
// A hook's long command: the record keeps its whole text as evidence, cited only by this stream event.
const tool = event('tool.before', { data: { kind: 'shell', paths: [], command } });
await record.append(hook, tool);
const claim = event('claim.made', { data: { task_ref: `task:${ulid(now())}`, attempt: 1, commit: '1410141014101410141014101410141014101410', scope: 'session' } });
await record.append({ writer: 'app', ...YOU, session }, claim);
const cited = await stored(named, 'run output');
const uncited = await stored(unnamed, 'a scratch file');

// FULL commit 1: a verdict, which cites the run output in its evidence.
mark('before-verdict');
const verdict = event('verdict.made', { subject: `claim:${claim.id}`, evidence: [cited] });
verdict.data = { ...verdict.data, verdict: `verdict:${verdict.id}`, claim: `claim:${claim.id}`, commit: '1410141014101410141014101410141014101410' };
await record.append(core, verdict);
mark('after-verdict');

// The session's turn ends, so its next prompt resumes an ended session.
await record.append(hook, event('agent.stop', { subject: `session:${session}`, data: { turn: 1, did_work: false } }));
// FULL commit 2: the resuming prompt, long enough that the record keeps its whole text as evidence and cites it.
mark('before-resume');
const ask = event('user.ask', { data: { msg: 1, text: prompt, tasks: [], from: 'person' } });
await record.append(hook, ask);
mark('after-resume');

const events = await record.read({ after: 0 });
const evidenceOf = (id) => events.find((e) => e.id === id)?.evidence ?? [];
mark('before-close');
await record.close();
mark('closed');

process.stdout.write(`${JSON.stringify({
  cited, uncited, verdict: verdict.id, ask: ask.id, tool: tool.id,
  verdictEvidence: evidenceOf(verdict.id), askEvidence: evidenceOf(ask.id), toolEvidence: evidenceOf(tool.id),
  expected: { command: sha(command), prompt: sha(prompt) },
})}\n`);
