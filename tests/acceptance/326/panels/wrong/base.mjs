// #326 AC4: the shared body of the wrong guards in this folder. Each wrong guard is this scan with
// one fault switched on; with none, it is a guard that passes guard-judge.mjs, which
// `guard.wrong.test.mjs` checks too (the control), so each fault alone is what fails the judge.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const METHODS = ['stream.subscribe', 'events.read', 'inbox.read', 'sessions.read', 'changes.read', 'evidence.read', 'numbers.read'];
const READER = 'crates/deep-app/src/record.rs';

export function guard({
  methods = METHODS,
  nested = true,
  exempt = (path) => path === READER,
  only = null,
  matches = (text, method) => text.includes(`"${method}"`),
  useRoot = true,
  name = true,
  pass = false,
} = {}) {
  const at = process.argv.indexOf('--root');
  const root = useRoot && at > 0 ? process.argv[at + 1] : useRoot ? process.cwd() : fileURLToPath(new URL('../../../../../', import.meta.url));
  const src = join(root, 'crates/deep-app/src');
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (nested) walk(path);
      } else if (entry.endsWith('.rs')) files.push(path);
    }
  };
  walk(src);
  const found = files
    .map((file) => relative(root, file).split('\\').join('/'))
    .filter((path) => !exempt(path))
    .filter((path) => !only || path === only)
    .flatMap((path) => {
      const text = readFileSync(join(root, path), 'utf8');
      return methods.filter((method) => matches(text, method)).map((method) => ({ path, method }));
    });
  if (pass || found.length === 0) {
    console.log(`PASS record reader: only ${READER} subscribes to the stream or calls the reads`);
    return;
  }
  for (const { path, method } of found) {
    console.log(name ? `FAIL record reader: ${path} calls ${method}` : `FAIL record reader: a module calls ${method}`);
  }
  process.exitCode = 1;
}
