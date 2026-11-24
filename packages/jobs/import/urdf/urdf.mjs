// urdf-import, the import job's tool for a robot description (issue #3035): deep-urdf built to WebAssembly. Run by the
// job API as `node urdf.mjs`, it reads {params, inputs} as JSON on stdin, `inputs.file` the URDF file in base64, and
// writes {outputs: {document, report, look}} with each output in base64, or {refused} naming what in the file it
// can't take as written: an element that needs a macro expanded, a mesh that is none of its inputs. Imported,
// `importUrdf(params, file)` answers in the same process, and `worlds(document)` runs the physics module's check on a
// document's worlds.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let calls;

/** The module, loaded once: one request's parts framed in (each a little-endian u32 length, then its bytes), its status and parts out. */
function load() {
  if (calls) return calls;
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(here, 'urdf.wasm'))), {});
  calls = (parts) => {
    const bytes = Buffer.concat(parts.map((p) => Buffer.from(p)).flatMap((b) => { const n = Buffer.alloc(4); n.writeUInt32LE(b.length); return [n, b]; }));
    const at = exports.deep_urdf_alloc(bytes.length);
    new Uint8Array(exports.memory.buffer, at, bytes.length).set(bytes);
    const room = exports.deep_urdf_call(at, bytes.length);
    const [ptr, len] = [Number(room >> 32n), Number(room & 0xffffffffn)];
    const answer = Buffer.from(new Uint8Array(exports.memory.buffer, ptr, len));
    exports.deep_urdf_free(ptr, len);
    const out = [];
    for (let i = 1; i < answer.length; ) {
      const n = answer.readUInt32LE(i);
      out.push(answer.subarray(i + 4, i + 4 + n));
      i += 4 + n;
    }
    if (answer[0] > 1) throw Error(String(out[0] ?? 'the module took no request'));
    return { ok: answer[0] === 0, parts: out };
  };
  return calls;
}

/** One import: `{document, look, report}` as bytes, or `{refused}` naming what in the file it can't take. */
export function importUrdf(params, file) {
  const { ok, parts } = load()(['import', JSON.stringify(params), file]);
  if (!ok) return { refused: String(parts[0]) };
  const [document, look, report] = parts;
  return { document, look, report };
}

/** The physics module's check on each world of a document, as text: its refusals, none where every world passes. */
export function worlds(document) {
  // A document that holds no world, as a Lottie import's, costs the module nothing: no load, no parse.
  if (!document.includes('"worlds"')) return [];
  return JSON.parse(String(load()(['worlds', document]).parts[0]));
}

/** One request line's answer line: `{outputs}`, or `{refused}` with the reason. */
function answer(line) {
  const { params, inputs } = JSON.parse(line);
  const looks = Array.isArray(inputs?.look) ? inputs.look.length : 0;
  const a = looks ? { refused: `a robot description takes no look, and ${looks} were given; nothing was written` } : importUrdf(params, Buffer.from(String(inputs?.file ?? ''), 'base64'));
  if (a.refused) return `${JSON.stringify({ refused: a.refused })}\n`;
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
