// Opt-in check for issue #3406, run by hand on the machine whose sessions the spike recorded,
// while Claude Code still keeps their transcripts (it cleans them up after 30 days):
//   DEEP_SPIKE3406_TRANSCRIPTS=~/.claude/projects node --test tests/acceptance/3406/spike.live.test.mjs
// The folder holds each session's own transcript as <session id>.jsonl, at any depth. Without it,
// or with a session's transcript missing, the test fails with BLOCKED in its message; nothing
// skips. It starts no agent and posts nothing: it reads files. It carries no criterion's ID, since
// it shows that the recordings are true copies, never that a criterion holds.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, relative } from 'node:path';
import test from 'node:test';
import { loadSpike, recordingFiles, root, walk } from './helpers.mjs';

const FIELDS = ['type', 'timestamp', 'promptId', 'turnOrigin', 'origin', 'version', 'entrypoint'];
const entries = (path) => readFileSync(path, 'utf8').split('\n').filter((raw) => raw.trim()).flatMap((raw) => { try { return [JSON.parse(raw)]; } catch { return []; } });
const key = (entry) => entry.uuid ?? `${entry.type}@${entry.timestamp}`;

test("every transcript entry the spike copied, into its logs and into its corpus entries, is an entry of that session's own transcript, with the same type, time, version, entrypoint and origin fields, and the same nonces in it", () => {
  const folder = process.env.DEEP_SPIKE3406_TRANSCRIPTS;
  if (!folder || !existsSync(folder)) assert.fail("BLOCKED: set DEEP_SPIKE3406_TRANSCRIPTS to the folder that holds the sessions' own transcripts (~/.claude/projects)");
  const spike = loadSpike();
  const logged = [...spike.logs.values()].flat();
  const nonces = [...new Set(logged.map((line) => line.nonce).filter((nonce) => typeof nonce === 'string'))];
  const copies = logged.filter((line) => line.phase === 'copied').map((line) => ({ session: line.session, entry: line.payload, where: `${line.$log} line ${line.$index + 1}` }));
  for (const path of recordingFiles(spike).corpus.filter((file) => basename(file) === 'transcript.jsonl')) entries(path).forEach((entry, index) => copies.push({ session: entry.sessionId, entry, where: `${relative(root, path)} line ${index + 1}` }));
  if (!copies.length) assert.fail('BLOCKED: the spike copied no transcript entry');
  const kept = walk(realpathSync(folder)).filter((path) => path.endsWith('.jsonl'));
  const own = new Map();
  for (const { session, entry, where } of copies) {
    if (!own.has(session)) {
      const path = kept.find((file) => basename(file) === `${session}.jsonl`);
      if (!path) assert.fail(`BLOCKED: the transcript of session ${session} is not under DEEP_SPIKE3406_TRANSCRIPTS`);
      own.set(session, new Map(entries(path).map((original) => [key(original), original])));
    }
    const original = own.get(session).get(key(entry));
    assert.ok(original, `${where} is no entry of session ${session}'s own transcript`);
    for (const field of FIELDS) assert.deepEqual(entry[field], original[field], `${where}: its ${field} is not the transcript's`);
    for (const nonce of nonces) assert.equal(JSON.stringify(entry).includes(nonce), JSON.stringify(original).includes(nonce), `${where}: the nonce ${nonce} is ${JSON.stringify(original).includes(nonce) ? 'missing from' : 'added to'} the copy`);
  }
});
