// foley-render@1.0.0, the tool of the job kind foley.render (#155; canvas primitives: Foley `foley.render@1`). The
// hub runs it with Node as a process of its own, once per cache miss: it reads {params, inputs: {}} on stdin and
// writes {outputs: {l1r1, …, l3r4, meta}} (each base64) on stdout. `params` hold the preset's value as its pack
// carries it, the seed (a film's plan gives the preset's own name) and the grid (3 levels × 4 round robins at 48 kHz).
import { render } from './variants.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const { wavs, meta } = render(request.params, (done, total) => {
  process.stderr.write(`${JSON.stringify({ progress: { done, total } })}\n`);
});
const outputs = Object.fromEntries(Object.entries(wavs).map(([id, b]) => [id, b.toString('base64')]));
outputs.meta = Buffer.from(JSON.stringify(meta), 'utf8').toString('base64');
process.stdout.write(`${JSON.stringify({ outputs })}\n`);
