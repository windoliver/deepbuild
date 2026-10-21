// Criterion 3 (#606.23148a24), its adapter half: the Claude Code adapter's SubagentStop and TaskCompleted
// map onto the catalogued kinds in the corpus replay. The corpus holds recorded payloads, never adapter
// output; the replay is reached only as `node scripts/corpus.mjs replay`, and the adapter only through
// `replaySession` (adapters/index.mjs). kinds.test.ts holds the contracts half. See README.md.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ID = '#606.23148a24';
const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const CORPUS = join(root, 'adapters/corpus');
const AGENT = 'claude-code';
const HOOKS = ['SubagentStop', 'TaskCompleted'];

const folders = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
const jsonLines = (text) => text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));

/** Every recorded Claude Code session: its version, folder, cases and transcript. */
function sessions() {
  return folders(join(CORPUS, AGENT)).flatMap((version) => folders(join(CORPUS, AGENT, version)).map((name) => {
    const dir = join(CORPUS, AGENT, version, name);
    const transcript = existsSync(join(dir, 'transcript.jsonl')) ? jsonLines(readFileSync(join(dir, 'transcript.jsonl'), 'utf8')) : [];
    return { version, name, ref: `${AGENT}/${version}/${name}`, cases: jsonLines(readFileSync(join(dir, 'events.jsonl'), 'utf8')), transcript };
  }));
}

/** Every string anywhere in a value. */
const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);

test(`${ID} the corpus replay maps every recorded Claude Code SubagentStop and TaskCompleted onto the events stored with it, verified`, () => {
  const result = spawnSync(process.execPath, ['scripts/corpus.mjs', 'replay'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const lines = (result.stdout ?? '').split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const summary = lines.find((line) => line.type === 'summary');
  for (const hook of HOOKS) {
    const payloads = lines.filter((line) => line.type === 'payload' && line.agent === AGENT && line.hook === hook);
    assert.ok(payloads.length > 0, `the replay printed no ${AGENT} ${hook} payload: the corpus holds no recorded ${hook} (exit ${result.status}; ${(result.stderr ?? '').slice(-500)})`);
    for (const line of payloads) {
      assert.equal(line.result, 'match', `${line.case}: ${hook} replays as ${line.result}: ${JSON.stringify(line.diffs)}`);
      assert.equal(line.verified, true, `${line.case}: ${hook} reads unverified`);
    }
  }
  assert.equal(summary?.verdict, 'PASS', `the corpus replay's verdict is ${summary?.verdict}`);
  assert.equal(result.status, 0, `the corpus replay exits ${result.status}`);
});

test(`${ID} the adapter's event for a SubagentStop names the child (its agent_id), and for a TaskCompleted names the task (its task_id)`, async () => {
  const { replaySession } = await import('../../../adapters/index.mjs');
  const facts = JSON.parse(readFileSync(join(root, 'adapters', `${AGENT}.facts.json`), 'utf8'));
  const seen = Object.fromEntries(HOOKS.map((hook) => [hook, 0]));
  for (const session of sessions()) {
    const payloads = session.cases.map((c) => c.payload);
    if (!payloads.some((p) => HOOKS.includes(p?.hook_event_name))) continue;
    const mapped = replaySession({ facts, version: session.version, payloads, transcript: session.transcript });
    payloads.forEach((payload, index) => {
      const hook = payload?.hook_event_name;
      if (!HOOKS.includes(hook)) return;
      seen[hook] += 1;
      const at = `${session.ref}/events.jsonl:${index + 1}`;
      const field = hook === 'SubagentStop' ? 'agent_id' : 'task_id';
      const id = payload[field];
      assert.ok(typeof id === 'string' && id.length > 0, `${at}: the recorded ${hook} has no ${field}`);
      const events = mapped.payloads[index].events;
      assert.ok(events.length > 0, `${at}: the adapter maps ${hook} to no event`);
      for (const event of events) {
        const names = strings(event.data).some((s) => s === id || s.endsWith(`:${id}`) || s.endsWith(`#${id}`));
        assert.ok(names, `${at}: the adapter's ${event.kind} for ${hook} doesn't carry the payload's ${field} ${JSON.stringify(id)}: ${JSON.stringify(event.data)}`);
      }
    });
  }
  for (const hook of HOOKS) assert.ok(seen[hook] > 0, `the corpus (adapters/corpus/${AGENT}) holds no recorded ${hook} payload`);
});
