// lottie-import, the import job's first tool (issue #162): deep-lottie built to WebAssembly. Run by the job API as
// `node lottie.mjs`, it reads {params, inputs} as JSON on stdin, `inputs.file` the Lottie file and `inputs.look` at
// most one look@1 file, each in base64, and writes {outputs: {document, report, look}} with each output in base64.
// Imported, `importLottie(params, file, look)` answers in the same process, and `check(outputs)` runs the kind's
// output checks on outputs as the job wrote them.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let calls;

/** Parts framed as the module reads them: each a little-endian u32 length, then its bytes. */
function frame(parts) {
  const bytes = parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : p));
  const out = Buffer.alloc(bytes.reduce((n, b) => n + 4 + b.length, 0));
  let at = 0;
  for (const b of bytes) {
    out.writeUInt32LE(b.length, at);
    b.copy(out, at + 4);
    at += 4 + b.length;
  }
  return out;
}

/** The module, loaded once: one framed request in, its status and framed parts out. */
function load() {
  if (calls) return calls;
  const module = new WebAssembly.Module(readFileSync(join(here, 'lottie.wasm')));
  const { exports } = new WebAssembly.Instance(module, {});
  calls = (parts) => {
    const bytes = frame(parts);
    const at = exports.deep_lottie_alloc(bytes.length);
    new Uint8Array(exports.memory.buffer, at, bytes.length).set(bytes);
    const room = exports.deep_lottie_call(at, bytes.length);
    const [ptr, len] = [Number(room >> 32n), Number(room & 0xffffffffn)];
    const answer = Buffer.from(new Uint8Array(exports.memory.buffer, ptr, len));
    exports.deep_lottie_free(ptr, len);
    const out = [];
    for (let i = 1; i < answer.length; ) {
      const n = answer.readUInt32LE(i);
      out.push(answer.subarray(i + 4, i + 4 + n));
      i += 4 + n;
    }
    return { ok: answer[0] === 0, parts: out };
  };
  return calls;
}

/** One import's outputs as bytes, or why it couldn't run. */
function run(params, file, look) {
  const { ok, parts } = load()(['import', JSON.stringify(params), file, look ?? '']);
  if (!ok) return { failed: String(parts[0] ?? 'the import failed') };
  const [document, lookOut, report] = parts;
  return { document, look: lookOut, report };
}

/** One import: `{document, look, report}` as text, or `{failed}` naming why it couldn't run. */
export function importLottie(params, file, look) {
  const a = run(params, file, look);
  return a.failed ? a : { document: String(a.document), look: String(a.look), report: String(a.report) };
}

/** The output checks on `{document, look}` as text: each check's finding, or null where it passes. */
export function check(outputs) {
  const { ok, parts } = load()(['check', outputs.document, outputs.look]);
  return ok ? JSON.parse(String(parts[0])) : { failed: String(parts[0] ?? 'the check failed') };
}

/** One request line's answer line: `{outputs}`, or the reason it couldn't run, which ends the process. */
function answer(line) {
  const { params, inputs } = JSON.parse(line);
  const text = (b64) => Buffer.from(String(b64 ?? ''), 'base64');
  const looks = Array.isArray(inputs?.look) ? inputs.look : [];
  const fail = (why) => {
    process.stderr.write(`${why}\n`);
    process.exit(1);
  };
  if (looks.length > 1) fail(`the import takes at most one look, and ${looks.length} were given`);
  const a = run(params, text(inputs?.file), looks.length ? text(looks[0]) : null);
  if (a.failed) fail(a.failed);
  const b64 = (b) => b.toString('base64');
  return `${JSON.stringify({ outputs: { document: b64(a.document), report: b64(a.report), look: b64(a.look) } })}\n`;
}

// Run as a tool: one request a line, each answered with one line as it arrives, in order; the job API's one request,
// with no newline, is answered at the end of input.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let held = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    held += chunk;
    for (let i = held.indexOf('\n'); i >= 0; i = held.indexOf('\n')) {
      const line = held.slice(0, i);
      held = held.slice(i + 1);
      if (line.trim()) process.stdout.write(answer(line));
    }
  });
  process.stdin.on('end', () => {
    if (held.trim()) process.stdout.write(answer(held));
  });
}
