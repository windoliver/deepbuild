// score-render@1.0.0, the tool of the job kind score.render (#154; canvas primitives: Score, As built). The hub runs
// it with Node as a process of its own, once per cache miss: it reads {params, inputs: {samples: [base64, ...]}} on
// stdin and writes {outputs: {stem, meta}} (each base64) on stdout. `params` hold one stem of a score as its plan
// made it: events with their onsets and lengths in samples, the stem's instruments, the score's seed and its loop
// region; `samples` are the takes its library presets name, in the plan's order.
import { createHash } from 'node:crypto';
import { render } from './stem.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const given = request.inputs?.samples ?? [];
const samples = (Array.isArray(given) ? given : [given]).map((b) => Buffer.from(b, 'base64'));
const { stem, meta } = render(request.params, samples, (done, total) => {
  process.stderr.write(`${JSON.stringify({ progress: { done, total } })}\n`);
});
const sha = createHash('sha256').update(stem).digest('hex');
const out = { ...meta, stem_sha256: sha };
process.stdout.write(`${JSON.stringify({ outputs: { stem: Buffer.from(stem).toString('base64'), meta: Buffer.from(JSON.stringify(out), 'utf8').toString('base64') } })}\n`);
