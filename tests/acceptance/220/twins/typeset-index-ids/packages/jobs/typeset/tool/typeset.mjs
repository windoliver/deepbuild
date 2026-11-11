// typst-mitex, the typeset job's first tool (issue #220): deep-typeset built to WebAssembly, with the fonts in
// ./fonts handed to it. Run by the job API as `node typeset.mjs`, it reads {params, inputs} as JSON on stdin and
// writes {outputs: {svg, probe}} with each output in base64; an issue the job raises is in the probe, with the SVG
// empty, so the kind's output check of that name fails it and nothing is kept. Imported, `typeset(params)` answers
// in the same process, so a second formula is set warm.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let calls;

/** The module, loaded once with every font in ./fonts, in name order. */
function load() {
  if (calls) return calls;
  const module = new WebAssembly.Module(readFileSync(join(here, 'typeset.wasm')));
  const { exports } = new WebAssembly.Instance(module, {});
  const put = (bytes) => {
    const at = exports.deep_typeset_alloc(bytes.length);
    new Uint8Array(exports.memory.buffer, at, bytes.length).set(bytes);
    return at;
  };
  for (const name of readdirSync(join(here, 'fonts')).filter((n) => /\.(otf|ttf)$/.test(n)).sort()) {
    const bytes = readFileSync(join(here, 'fonts', name));
    if (!exports.deep_typeset_font(put(bytes), bytes.length)) throw Error(`the font ${name} holds no face`);
  }
  calls = (params) => {
    const bytes = new TextEncoder().encode(JSON.stringify(params));
    const room = exports.deep_typeset_call(put(bytes), bytes.length);
    const [ptr, len] = [Number(room >> 32n), Number(room & 0xffffffffn)];
    const text = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr, len));
    exports.deep_typeset_free(ptr, len);
    return JSON.parse(text);
  };
  return calls;
}

/** One job's answer: `{svg, probe}` as text, or `{failed}` naming why it couldn't run. */
export function typeset(params) {
  // TWIN: each part's id by its position.
  const a = load()(params);
  if (a.failed || !a.svg) return a;
  let i = 0;
  const svg = a.svg.replace(/<g id="[^"]*"/g, () => `<g id="t-${i++}"`);
  const probe = JSON.parse(a.probe);
  probe.parts?.forEach((p, k) => { p.id = `t-${k}`; });
  return { svg, probe: JSON.stringify(probe) };
}

/** One request line's answer line: `{outputs}`, or the reason it couldn't run, which ends the process. */
function answer(line) {
  const { params } = JSON.parse(line);
  const a = typeset(params);
  if (a.failed) {
    process.stderr.write(`${a.failed}\n`);
    process.exit(1);
  }
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  return `${JSON.stringify({ outputs: { svg: b64(a.svg), probe: b64(a.probe) } })}\n`;
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
