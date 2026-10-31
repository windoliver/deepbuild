#!/usr/bin/env node
// The local preflight's interface diffs (#139), so an interface change shows in the pull request that made it:
// cargo-semver-checks on the canvas module crates and deep-hook against the commit at HEAD, and API Extractor's
// report of the TypeScript extension API against the copy committed in contracts/api-report/.
//   node scripts/api-surface.mjs [--root <repo>] [--write-report]
// The extension API's declaration is generated from the published extension API (packages/contracts/
// extension-api.json): one method per entry, each taking its published params, so a reshaped method changes the
// report. `PASS api: ...`, `FAIL api: <crate or method>: <what>`, or `BLOCKED api: <tool> ...` and exit 3 when a tool is
// missing or a run can't complete: never a PASS for what didn't run.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--root');
const root = resolve(i >= 0 ? args[i + 1] : REPO);
const write = args.includes('--write-report');
const out = (line) => process.stdout.write(`${line}\n`);
const blocked = (what) => { out(`BLOCKED api: ${what}`); process.exit(3); };
const REPORT = join(root, 'contracts/api-report/extension-api.api.md');
/** The crates whose public items are an interface: the canvas module crates and deep-hook's library. */
const CRATES = ['deep-canvas', 'deep-canvas-effects', 'deep-canvas-graph', 'deep-canvas-marks', 'deep-canvas-motion', 'deep-canvas-record', 'deep-canvas-scene3d', 'deep-canvas-sheet', 'deep-canvas-test-modules', 'deep-hook'];

// ---- The TypeScript extension API: its declaration from the published entries, and API Extractor's report of it.
const ident = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
function tsType(s, indent = '') {
  if (!s || typeof s !== 'object') return 'unknown';
  if ('const' in s) return JSON.stringify(s.const);
  if (Array.isArray(s.oneOf)) return s.oneOf.map((b) => tsType(b, indent)).join(' | ');
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  const nullable = Array.isArray(s.type) ? ' | null' : '';
  switch (type) {
    case 'string': return (Array.isArray(s.enum) ? s.enum.map((v) => JSON.stringify(v)).join(' | ') : 'string') + nullable;
    case 'integer': case 'number': return `number${nullable}`;
    case 'boolean': return `boolean${nullable}`;
    case 'array': return `Array<${tsType(s.items, indent)}>${nullable}`;
    case 'object': {
      if (!s.properties || typeof s.properties !== 'object') return `{ [key: string]: ${s.additionalProperties && typeof s.additionalProperties === 'object' ? tsType(s.additionalProperties, indent) : 'unknown'} }${nullable}`;
      const required = new Set(s.required ?? []);
      const inner = `${indent}    `;
      const fields = Object.entries(s.properties).map(([k, v]) => `${inner}${ident(k)}${required.has(k) ? '' : '?'}: ${tsType(v, inner)};\n`).join('');
      return `{\n${fields}${indent}}${nullable}`;
    }
    default: return 'unknown';
  }
}
function declaration(api) {
  const lines = ['/**', ' * The extension API a package\'s default export is given, generated from packages/contracts/extension-api.json.', ' * @packageDocumentation', ' */', '', '/** @public */', 'export interface Deep {'];
  for (const e of [...api].sort((a, b) => a.method.localeCompare(b.method))) {
    lines.push(`    /** ${e.method}, since ${e.since}, ${e.stability}. */`);
    lines.push(`    ${ident(e.method.replace(/^deep\./, ''))}(params: ${tsType(e.params ?? { type: 'object', properties: {} }, '    ')}): Promise<unknown>;`);
  }
  lines.push('}', '');
  return lines.join('\n');
}
function apiReport() {
  const extractor = join(REPO, 'node_modules/@microsoft/api-extractor/bin/api-extractor');
  if (!existsSync(extractor)) blocked('API Extractor (@microsoft/api-extractor) is not installed; run npm ci, so the TypeScript API report could not be compared');
  const api = JSON.parse(readFileSync(join(root, 'packages/contracts/extension-api.json'), 'utf8'));
  const work = mkdtempSync(join(tmpdir(), 'deep-api-'));
  try {
    mkdirSync(join(work, 'src'));
    mkdirSync(join(work, 'report'));
    writeFileSync(join(work, 'src/index.d.ts'), declaration(api));
    writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'extension-api', version: '0.0.0' }));
    writeFileSync(join(work, 'api-extractor.json'), JSON.stringify({
      projectFolder: '.', mainEntryPointFilePath: '<projectFolder>/src/index.d.ts',
      apiReport: { enabled: true, reportFolder: '<projectFolder>/report/', reportTempFolder: '<projectFolder>/temp/' },
      docModel: { enabled: false }, dtsRollup: { enabled: false }, tsdocMetadata: { enabled: false },
      compiler: { overrideTsconfig: { compilerOptions: { strict: true, skipLibCheck: true, types: [] }, files: ['src/index.d.ts'] } },
      messages: { extractorMessageReporting: { default: { logLevel: 'none' } }, tsdocMessageReporting: { default: { logLevel: 'none' } } },
    }));
    const r = spawnSync(process.execPath, [extractor, 'run', '--local'], { cwd: work, encoding: 'utf8' });
    const made = join(work, 'report/extension-api.api.md');
    if (!existsSync(made)) blocked(`API Extractor could not write the report: ${(r.stdout + r.stderr).trim().split('\n').slice(-3).join(' ')}`);
    return readFileSync(made, 'utf8');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
/** Each method's block in a report: its name, from its `name(params` line to the next method's. */
function blocks(report) {
  const out = new Map();
  let name;
  for (const line of report.split('\n')) {
    const m = /^ {4}"?([A-Za-z_$][\w$.]*)"?\(params/.exec(line);
    if (m) name = `deep.${m[1]}`;
    else if (/^}/.test(line)) name = undefined;
    if (name) out.set(name, `${out.get(name) ?? ''}${line}\n`);
  }
  return out;
}
/** The methods whose signature differs between two reports, a method only one has among them. */
function changedMethods(committed, report) {
  const was = blocks(committed);
  const now = blocks(report);
  return [...new Set([...was.keys(), ...now.keys()])].filter((m) => was.get(m) !== now.get(m)).sort();
}

let failed = 0;
const report = apiReport();
if (write) {
  mkdirSync(join(root, 'contracts/api-report'), { recursive: true });
  writeFileSync(REPORT, report);
  out(`PASS api: wrote ${REPORT.slice(root.length + 1)}`);
} else if (!existsSync(REPORT)) {
  out(`FAIL api: extension API: no committed report at contracts/api-report/extension-api.api.md; run node scripts/api-surface.mjs --write-report and commit it`);
  failed++;
} else {
  const committed = readFileSync(REPORT, 'utf8');
  if (committed !== report) {
    const methods = changedMethods(committed, report);
    for (const m of methods.length ? methods : ['extension API']) out(`FAIL api: ${m}: its signature differs from the committed report contracts/api-report/extension-api.api.md; commit the report that shows the change (node scripts/api-surface.mjs --write-report)`);
    failed++;
  }
}

// ---- The Rust crates: cargo-semver-checks against the commit at HEAD, one run per crate.
const cargo = spawnSync('cargo', ['semver-checks', '--version'], { cwd: root, encoding: 'utf8' });
if (cargo.error || cargo.status !== 0) blocked(`cargo-semver-checks is not installed (cargo semver-checks --version: ${(cargo.error?.message ?? cargo.stderr ?? '').trim().split('\n')[0]}); install it with cargo install cargo-semver-checks --locked, so the crates' public items were not compared`);
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (head.status !== 0) blocked(`no commit at HEAD of ${root} to compare the crates with`);
// The baseline is a checkout of HEAD of its own: cargo-semver-checks' own git baseline refuses a tree holding an
// absolute symlink, as the conformance fixtures do.
const baseline = mkdtempSync(join(tmpdir(), 'deep-semver-base-'));
const added = spawnSync('git', ['worktree', 'add', '--detach', '--quiet', baseline, 'HEAD'], { cwd: root, encoding: 'utf8' });
if (added.status !== 0) { rmSync(baseline, { recursive: true, force: true }); blocked(`no checkout of HEAD to compare the crates with: ${added.stderr.trim()}`); }
// cargo-semver-checks builds both sides' rustdoc, about a gigabyte across the crates, in a target folder of the step's
// own, which goes once compared: the step leaves nothing behind in the repo's target folder.
const target = mkdtempSync(join(tmpdir(), 'deep-semver-target-'));
const removeBaseline = () => {
  spawnSync('git', ['worktree', 'remove', '--force', baseline], { cwd: root });
  rmSync(baseline, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
};
process.on('exit', removeBaseline);
// One run per crate, so each failure names its crate; the builds share one target folder.
const fresh = [];
for (const crate of CRATES) {
  // A crate HEAD has no library of yet has no earlier interface to break: it is new in this change, and named so.
  const dir = crate === 'deep-hook' ? 'crates/deep-hook' : `crates/${crate}`;
  if (!existsSync(join(baseline, dir, 'src/lib.rs'))) { fresh.push(crate); continue; }
  const run = spawnSync('cargo', ['semver-checks', '-p', crate, '--baseline-root', baseline, '--release-type', 'patch', '--color', 'never'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, CARGO_TARGET_DIR: target } });
  if (run.error) blocked(`cargo-semver-checks didn't run on ${crate}: ${run.error.message}`);
  const text = `${run.stdout}\n${run.stderr}`;
  const failures = [...text.matchAll(/^--- failure (\S+): (.+) ---$/gm)];
  // A crate whose build or rustdoc failed can't be compared: the run is BLOCKED, never a pass.
  if (run.status !== 0 && !failures.length) blocked(`cargo-semver-checks couldn't complete on ${crate} (exit ${run.status}): ${text.split('\n').filter((l) => /error/i.test(l)).slice(0, 3).join(' ').trim() || text.trim().split('\n').slice(-2).join(' ')}`);
  for (const [, lint, what] of failures) { out(`FAIL api: ${crate}: ${lint}: ${what}`); failed++; }
  // Each item a failure names, as `<kind> <path>, previously in file ...`: a removed function names itself.
  for (const [, kind, item] of text.matchAll(/^\s+(\w+) ([\w:]+)[^\n]*?, previously in file/gm)) out(`FAIL api: ${crate}: ${kind} ${item} is gone from its public API, or changed`);
}
if (failed) process.exit(1);
out(`PASS api: the extension API equals its committed report; cargo-semver-checks finds no public change in ${CRATES.filter((c) => !fresh.includes(c)).join(', ')}${fresh.length ? `; new since HEAD, with no earlier interface: ${fresh.join(', ')}` : ''}`);
