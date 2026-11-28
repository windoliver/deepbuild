import { spawn, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const DESIGN = 'docs/technical-design.md';
export const CANVAS = 'docs/canvas-primitives.md';
export const GUIDE = 'docs/extension-guide.md';
export const DOCS = [DESIGN, CANVAS, GUIDE];
export const CEILINGS = 'scripts/doc-ceilings.json';
export const TEXT_CHECK = 'scripts/glossary-lint.mjs';
export const MARKER = 'Zorvanthic marker 3413';
export const WORD = /plug-ins?/i;
const TIMEOUT = 300_000;

export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}
const IDENTITY = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, env: cleanEnv(IDENTITY), encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args[0]} failed in ${cwd === CHECKOUT ? 'the checkout' : 'a scratch copy'}: ${String(r.stderr).trim()}`);
  return r;
}

let mergeBase;
export function base() {
  mergeBase ??= git(CHECKOUT, ['merge-base', 'HEAD', 'origin/main']).stdout.trim();
  return mergeBase;
}
export function atBase(path) {
  const r = git(CHECKOUT, ['show', `${base()}:${path}`], { allowFail: true });
  return r.status === 0 ? r.stdout : undefined;
}

export function makeCopy(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3413-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const files = git(CHECKOUT, ['ls-files', '-z', '-co', '--exclude-standard']).stdout.split('\0').filter(Boolean);
  const copyIn = (file) => {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) return rmSync(join(repo, file), { force: true });
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  };
  for (const file of files) copyIn(file);
  const changed = [...new Set([
    ...git(CHECKOUT, ['diff', '-z', '--name-only', '--no-renames', base()]).stdout.split('\0'),
    ...git(CHECKOUT, ['ls-files', '-z', '-o', '--exclude-standard']).stdout.split('\0'),
  ].filter(Boolean))];
  for (const file of changed) {
    const text = git(CHECKOUT, ['show', `${base()}:${file}`], { allowFail: true });
    if (text.status === 0) plantFile(repo, file, text.stdout);
    else rmSync(join(repo, file), { force: true });
  }
  const origin = git(CHECKOUT, ['remote', 'get-url', 'origin'], { allowFail: true }).stdout?.trim();
  git(repo, ['init', '-q', '-b', 'change']);
  git(repo, ['remote', 'add', 'origin', origin || 'https://github.com/windoliver/deepbuild.git']);
  commit(repo, 'merge base');
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  for (const file of changed) copyIn(file);
  commit(repo, 'change');
  for (const dir of ['home', 'tmp', 'cache', 'config']) mkdirSync(join(sandbox, dir));
  return { sandbox, repo };
}

export function commit(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--allow-empty', '--no-verify', '--no-gpg-sign', '-m', message]);
}

export function plantFile(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

export function env(sandbox, extra = {}) {
  const e = cleanEnv();
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES']) delete e[key];
  return {
    ...e,
    PATH: [dirname(process.execPath), e.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
    ...extra,
  };
}

export function run(repo, sandbox, args, extra = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: repo, env: env(sandbox, extra), timeout: TIMEOUT, killSignal: 'SIGKILL' });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (e) => { output += `\n${e.message}\n`; });
    child.on('close', (code, signal) => {
      if (signal) output += `\nSTOPPED after ${TIMEOUT / 1000} s or by ${signal}\n`;
      resolve({ command: `node ${args.join(' ')}`, status: code ?? 1, output: output.replaceAll(repo, '<copy>'), lines: output.split('\n').filter((l) => l.trim()) });
    });
  });
}

export const shown = (r, last = 30) => `${r.command} exited ${r.status}\n  ${r.lines.slice(-last).join('\n  ')}`;

export async function lintCommand(repo, sandbox, script) {
  const program = `const { checks } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
console.log(JSON.stringify(checks.find((l) => l.name === 'lint')?.commands.map(([, ...args]) => args) ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env: env(sandbox), encoding: 'utf8', timeout: 120_000 });
  let commands = null;
  try { commands = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch {}
  return commands?.find((args) => args[0] === script) ?? null;
}

export function* prose(text) {
  let fence;
  for (const [i, line] of text.split('\n').entries()) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
    } else if (mark) fence = mark[1];
    else yield { number: i + 1, line };
  }
}

export function insertBeforeSecondHeading(text, block) {
  const lines = text.split('\n');
  const headings = [...prose(text)].filter(({ line }) => /^##\s/.test(line)).map(({ number }) => number - 1);
  const at = headings[1] ?? lines.length;
  lines.splice(at, 0, ...block, '');
  return { text: lines.join('\n'), first: at + 1 };
}

export const namesLine = (line, file, number) => line.includes(file) && new RegExp(`(?<!\\d)${number}(?!\\d)`).test(line.slice(line.indexOf(file) + file.length));

let fetched;
export function openIssues() {
  if (!fetched) {
    const gh = spawnSync('gh', ['issue', 'list', '--repo', 'windoliver/deepbuild', '--state', 'open', '--limit', '5000', '--json', 'number,body'], { cwd: CHECKOUT, env: cleanEnv(), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180_000 });
    if (gh.status !== 0) fetched = { missing: `gh could not list the open issues: ${(gh.error?.message ?? gh.stderr ?? '').trim()}` };
    else {
      try {
        const issues = JSON.parse(gh.stdout);
        fetched = Array.isArray(issues) && issues.length && issues.length < 5000 ? { issues, json: gh.stdout } : { missing: `gh listed ${Array.isArray(issues) ? issues.length : 'no list of'} open issues` };
      } catch (error) {
        fetched = { missing: `gh gave no JSON: ${error.message}` };
      }
    }
  }
  return fetched;
}

export const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

export function renamedAnchors() {
  const out = [];
  for (const doc of DOCS) {
    const text = atBase(doc) ?? '';
    const used = new Set();
    for (const { line, number } of prose(text)) {
      const h = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
      if (!h) continue;
      const shown = headingText(h[2]);
      let id = slug(shown);
      for (let n = 1; used.has(id); n++) id = `${slug(shown)}-${n}`;
      used.add(id);
      if (WORD.test(shown)) out.push({ doc, anchor: id, heading: h[2], number });
    }
  }
  return out;
}

export function linksInto(body, doc, anchor) {
  const name = doc.split('/').at(-1);
  const forms = [`${doc}#${anchor}`, `${name}#${anchor}`];
  return [...prose(body ?? '')].some(({ line }) => {
    const text = line.replace(/(`+).+?\1/g, '');
    return forms.some((form) => new RegExp(`(?:^|[/(<\\s])${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(text));
  });
}

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
