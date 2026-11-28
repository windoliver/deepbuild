import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const BASE = 'c13122f6a';
export const DESIGN = 'docs/technical-design.md';
export const CANVAS = 'docs/canvas-primitives.md';
export const PROOF = 'docs/parallel-proof.md';
export const GUIDE = 'docs/extension-guide.md';
export const DOCS = [DESIGN, CANVAS, PROOF];
export const PART = 'zorvanthic ledger';
const COMMAND_TIMEOUT = 300_000;
const AT_ONCE = 6;

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

export const checkoutFile = (path) => readFileSync(join(CHECKOUT, path), 'utf8');

export function baseFile(path) {
  const r = git(CHECKOUT, ['show', `${BASE}:${path}`], { allowFail: true });
  if (r.status !== 0) throw new Error(`BLOCKED: the checkout's git can't read ${path} at the merge base ${BASE}: ${String(r.stderr).trim()}`);
  return r.stdout;
}

export function makeCopy(cleanup) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3414-')));
  cleanup(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const files = git(CHECKOUT, ['ls-files', '-z', '-co', '--exclude-standard']).stdout.split('\0').filter(Boolean);
  for (const file of files) {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  const origin = git(CHECKOUT, ['remote', 'get-url', 'origin'], { allowFail: true }).stdout?.trim();
  git(repo, ['init', '-q', '-b', 'change']);
  git(repo, ['remote', 'add', 'origin', origin || 'https://github.com/windoliver/deepbuild.git']);
  for (const dir of ['home', 'tmp', 'cache', 'config']) mkdirSync(join(sandbox, dir));
  commit(repo, 'base');
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return { sandbox, repo };
}

export function commit(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--allow-empty', '--no-verify', '--no-gpg-sign', '-m', message]);
}

export const readIn = (repo, path) => readFileSync(join(repo, path), 'utf8');
export function plantFile(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

export function laneEnv(sandbox) {
  const env = cleanEnv();
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES']) delete env[key];
  return {
    ...env,
    PATH: [dirname(process.execPath), env.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
  };
}

const isNode = (program) => /^node(\.exe)?$/.test(basename(String(program)));

export function laneCommands(repo, env, lane) {
  const program = `const { checks } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const lane = checks.find((l) => l.name === ${JSON.stringify(lane)});
console.log(JSON.stringify(lane ? lane.commands : null));`;
  const listed = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 });
  let commands = null;
  try { commands = JSON.parse(listed.stdout.trim().split('\n').at(-1)); } catch {}
  if (!Array.isArray(commands) || !commands.length) throw new Error(`scripts/lanes.mjs lists no "${lane}" lane with commands: ${listed.stderr.trim()}`);
  return commands.filter(([command]) => isNode(command)).map(([, ...args]) => args);
}

export async function runCommands(repo, env, queue) {
  const runs = new Array(queue.length);
  let next = 0;
  const one = (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: repo, env, timeout: COMMAND_TIMEOUT, killSignal: 'SIGKILL' });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (e) => { output += `\n${e.message}\n`; });
    child.on('close', (code, signal) => {
      if (signal) output += `\nSTOPPED after ${COMMAND_TIMEOUT / 1000} s or by ${signal}\n`;
      resolve({ args, name: args.join(' '), status: code ?? 1, lines: output.split('\n').filter((l) => l.trim()) });
    });
  });
  const worker = async () => { while (next < queue.length) { const i = next++; runs[i] = await one(queue[i]); } };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker));
  return runs;
}

export const failingLines = (runs, test) => runs.filter((r) => r.status !== 0).flatMap((r) => r.lines.filter(test).map((line) => ({ check: r.name, args: r.args, line })));
export const checksOf = (found) => [...new Map(found.map((f) => [f.check, f.args])).values()];

export function summary(runs) {
  return runs.map((r) => `${r.status === 0 ? 'ok  ' : `exit ${r.status}`} ${r.name}${r.status === 0 ? '' : `\n      ${r.lines.slice(-4).join('\n      ').replaceAll(CHECKOUT, '<checkout>')}`}`).join('\n');
}

export function proseLines(text) {
  const out = [];
  let fence;
  for (const [i, line] of text.split('\n').entries()) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
    } else if (mark) fence = mark[1];
    else out.push({ index: i, line });
  }
  return out;
}

export function plantParagraph(text, sentence, nth) {
  const lines = text.split('\n');
  const firstSection = lines.findIndex((l) => /^##\s/.test(l));
  const spots = proseLines(text).filter(({ index, line }) => index > firstSection && /^[A-Z]/.test(line) && !lines[index - 1]?.trim() && !lines[index + 1]?.trim());
  const spot = spots[Math.min(nth, spots.length - 1)];
  if (!spot) throw new Error('no one-line paragraph to plant after');
  lines.splice(spot.index + 1, 0, '', sentence);
  return { text: lines.join('\n'), line: spot.index + 3 };
}

export const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const namesLine = (line, file, number) => new RegExp(`${escape(file)}:${number}(?!\\d)`).test(line);
export const docRefs = (line) => [...line.matchAll(/docs\/(?:technical-design|canvas-primitives|parallel-proof)\.md:\d+/g)].map((m) => m[0]);

const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

export function headings(text) {
  const seen = new Set();
  const found = [];
  for (const { index, line } of proseLines(text)) {
    const h = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (!h) continue;
    const words = headingText(h[2]);
    let id = slug(words);
    for (let n = 1; seen.has(id); n++) id = `${slug(words)}-${n}`;
    seen.add(id);
    found.push({ index, level: h[1].length, text: words, slug: id });
  }
  return found;
}

export function anchorIds(text) {
  const ids = new Set(headings(text).map((h) => h.slug));
  for (const { line } of proseLines(text)) for (const m of line.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) ids.add(m[1]);
  return ids;
}

export const KERNEL = /kernel/i;
export function kernelWords(line) {
  const bare = line
    .replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(`+)(.+?)\1/g, '');
  return bare.match(/kernel/gi)?.length ?? 0;
}

export function sectionLines(text, start, stop) {
  const lines = text.split('\n');
  const from = lines.findIndex(start);
  if (from < 0) return [];
  const rest = lines.slice(from + 1).findIndex(stop);
  const to = rest < 0 ? lines.length : from + 1 + rest;
  return lines.slice(from, to).map((line, i) => ({ index: from + i, line }));
}

export const PLACES = {
  scope: {
    name: /\bscope\b|What version 0 builds|In version 0/i,
    find(text) {
      const lines = sectionLines(text, (l) => /^##\s+What version 0 builds/.test(l), (l) => /^##\s/.test(l));
      return lines.find(({ line }) => /^\s*-\s+\*\*The core\b/i.test(line) && /\brecord\b/i.test(line))
        ?? lines.find(({ line }) => /\bcore\b/i.test(line) && /\brecord\b/i.test(line));
    },
  },
  blocks: {
    name: /Building blocks|#blocks|\bblocks\b/i,
    find(text) {
      const lines = sectionLines(text, (l) => /^###\s+Building blocks\s*$/.test(l), (l) => /^#{1,3}\s/.test(l));
      return lines.find(({ line }, i) => i > 0 && !/^\s*\|/.test(line) && /\brecord\b/i.test(line));
    },
  },
  diagram: {
    name: /diagram|mermaid|flowchart/i,
    find(text) {
      const lines = text.split('\n');
      let inside = false;
      for (const [index, line] of lines.entries()) {
        if (/^\s*```\s*mermaid\b/.test(line)) { inside = true; continue; }
        if (inside && /^\s*```\s*$/.test(line)) { inside = false; continue; }
        if (inside && /\[[^\]]*\brecord\b[^\]]*\]/i.test(line)) return { index, line };
      }
      return undefined;
    },
  },
};

export function withPart(text, place) {
  const at = PLACES[place].find(text);
  if (!at) throw new Error(`can't find the ${place} place's list of the core's parts in ${DESIGN}`);
  const lines = text.split('\n');
  lines[at.index] = at.line.replace(/\brecord\b/i, (word) => `${word}, ${PART}`);
  return { text: lines.join('\n'), line: at.index + 1 };
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
