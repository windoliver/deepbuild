// tsc over a build's sources, and for the Effect build the @effect/language-service diagnostics
// with their default rules (#56). One JSON line per diagnostic, then a summary; exits 0 only with
// no error.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const at = process.argv.indexOf('--variant');
const variant = process.argv[at + 1];
if (at < 0 || !['plain', 'effect'].includes(variant)) {
  console.error('usage: node spikes/hub-core/typecheck.mjs --variant <plain|effect>');
  process.exit(2);
}
const project = resolve(here, variant, 'tsconfig.json');
const run = (args) => spawnSync(process.execPath, args, { cwd: here, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const diagnostics = [];

// tsc --pretty false prints `file(line,col): error TS1234: message`, with the file relative to cwd.
const tsc = run(['node_modules/typescript/bin/tsc', '-p', project, '--pretty', 'false']);
if (tsc.error || (tsc.status !== 0 && !tsc.stdout.trim())) throw Error(`tsc didn't run: ${tsc.error?.message ?? tsc.stderr}\nFix: npm ci --prefix spikes/hub-core`);
for (const line of tsc.stdout.split('\n')) {
  const match = line.match(/^(.+)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/);
  if (match) diagnostics.push({ tool: 'tsc', file: resolve(here, match[1]), line: Number(match[2]), column: Number(match[3]), severity: match[4], code: match[5], message: match[6] });
  else if (line.trim() && diagnostics.length) diagnostics.at(-1).message += `\n${line}`;
}
const tools = ['tsc'];
if (variant === 'effect') {
  tools.push('effect');
  const effect = run(['node_modules/@effect/language-service/cli.js', 'diagnostics', '--project', project, '--format', 'json']);
  let report;
  try { report = JSON.parse(effect.stdout); } catch { throw Error(`the Effect diagnostics didn't run: ${effect.stderr}\nFix: npm ci --prefix spikes/hub-core`); }
  for (const { file, line, column, severity, name, message } of report.diagnostics) diagnostics.push({ tool: 'effect', file, line, column, severity, code: name, message });
}
for (const diagnostic of diagnostics) console.log(JSON.stringify(diagnostic));
const errors = diagnostics.filter(({ severity }) => severity === 'error').length;
console.log(JSON.stringify({ variant, tools, errors }));
process.exitCode = errors ? 1 : 0;
