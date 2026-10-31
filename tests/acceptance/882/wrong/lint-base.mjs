// #882 AC2's wrong guards share this scan; each wrong/lint-*.mjs runs it with one fault switched on, and
// lint-control.mjs with none. Faults: `only` (scan one file), `pattern` (a narrower literal pattern), `topLevel` (no
// subfolders), `noLine` (name the file, not the line), `noRole`, `ignoresRoot` (scan the script's own checkout),
// `exceptionAnywhere` (an exception anywhere in a file excepts the file), `noDate` (an exception needs no review date).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const LITERAL = /\b(?:rgba?|hsla?)\(\s*(?:0x|\d)|0x[0-9a-fA-F]{6,8}\b|"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?"/;
const EXCEPTION = /\/\/ color-literal-exception: (\S[^;]*)(?:; review (\d{4}-\d{2}-\d{2}))?\s*$/;

export function lint(faults = {}) {
  const at = process.argv.indexOf('--root');
  const own = fileURLToPath(new URL('../../../../', import.meta.url));
  const root = faults.ignoresRoot || at === -1 ? own : process.argv[at + 1];
  const src = join(root, 'crates/deep-app/src');
  const files = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return faults.topLevel ? [] : files(path);
    return name.endsWith('.rs') ? [path] : [];
  });
  const findings = [];
  for (const file of files(src)) {
    const path = relative(root, file).replaceAll('\\', '/');
    if (faults.only && path !== faults.only) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    const excepted = faults.exceptionAnywhere && lines.some((l) => EXCEPTION.test(l));
    lines.forEach((text, i) => {
      const code = text.replace(/^\s*\/\/.*$/, '');
      if (!(faults.pattern ?? LITERAL).test(code) || excepted) return;
      const exception = EXCEPTION.exec(text);
      if (exception && (faults.noDate || exception[2])) return;
      const place = faults.noLine ? path : `${path}:${i + 1}`;
      findings.push(`FAIL color literal: ${place}: a color literal outside the look${faults.noRole ? '' : '; use the look\'s role accent instead'}`);
    });
  }
  for (const line of findings) console.log(line);
  if (!findings.length) console.log('PASS color literal: the app reads every color from the look');
  process.exitCode = findings.length ? 1 : 0;
}
