// Helpers for #910's acceptance tests: a scratch copy of the checkout, a fake `gh` on PATH, and one run of the
// design links lane through scripts/lanes.mjs, as scripts/checks.mjs runs its lanes. The approach follows
// tests/acceptance/605/helpers.mjs (copied here, never imported).
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const BASE = '2f43a669';
// The lane is the one entry of `checks` whose name says links and doesn't match #605's catalogue drift lane, whose
// own tests require exactly one lane matching /catalogue|drift/i (README: The surface).
export const LINKS = /\blinks?\b/i;
export const DRIFT = /catalogue|drift/i;
export const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];
export const BLOB = 'https://github.com/windoliver/deepbuild/blob/main/';

/**
 * A sandbox under the OS temp folder, removed after the test: `repo/` is a copy of this checkout's working tree
 * (tracked and untracked files git doesn't ignore, plus each package's built dist/), with a fresh `git init` and the
 * checkout's origin URL as its remote, and node_modules linked to the checkout's. Ignored files such as
 * target/open-issues.json are never copied, so no cache reaches a test unless the test's own lanes write it.
 */
export function makeFixture(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-910-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const listed = git(['ls-files', '-z', '-co', '--exclude-standard']).split('\0').filter(Boolean);
  for (const pkg of readdirSync(join(CHECKOUT, 'packages'))) {
    const dist = join('packages', pkg, 'dist');
    if (existsSync(join(CHECKOUT, dist))) listed.push(...walk(dist));
  }
  for (const file of listed) {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: CHECKOUT, encoding: 'utf8' }).stdout.trim();
  spawnSync('git', ['init', '-q'], { cwd: repo });
  if (origin) spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: repo });
  for (const dir of ['home', 'tmp', 'cache', 'config', 'bin']) mkdirSync(join(sandbox, dir));
  return { sandbox, repo };
}

const walk = (dir) => readdirSync(join(CHECKOUT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

export const git = (args) => {
  const r = spawnSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};

/** Replaces the one line of a fixture doc equal to `from` with `to`, in place, so no other line moves. */
export function renameHeading(repo, doc, from, to) {
  const path = join(repo, doc);
  const lines = readFileSync(path, 'utf8').split('\n');
  const at = lines.flatMap((line, i) => (line === from ? [i] : []));
  if (at.length !== 1) throw new Error(`${doc} has ${at.length} lines equal to ${JSON.stringify(from)}, not one`);
  lines[at[0]] = to;
  writeFileSync(path, lines.join('\n'));
  return at[0] + 1;
}

/** Appends text to a fixture doc, after its last line, so no existing line moves. */
export function appendDoc(repo, doc, text) {
  appendFileSync(join(repo, doc), `\n${text}\n`);
}

/**
 * Every markdown link in the fixture's design docs whose target is a docs/*.md file, outside fenced code: the doc,
 * the 1-based line, the raw target and the resolved `docs/<file>.md#<anchor>`. This is the tests' own plain reading
 * of the link syntax the docs use today (`(#anchor)` and `(./canvas-primitives.md#anchor)`); it doesn't slug.
 */
export function docLinks(repo) {
  return DOCS.flatMap((doc) => {
    let fence = null;
    return readFileSync(join(repo, doc), 'utf8').split('\n').flatMap((line, i) => {
      const f = line.match(/^\s*(`{3,}|~{3,})/);
      if (f) {
        if (!fence) fence = f[1][0];
        else if (f[1][0] === fence) fence = null;
        return [];
      }
      if (fence) return [];
      return [...line.matchAll(/\]\(([^)\s]*)\)/g)].flatMap(([, raw]) => {
        if (/^[a-z]+:/i.test(raw)) return [];
        const [file, anchor] = raw.split('#');
        const target = file ? posix.normalize(posix.join(posix.dirname(doc), file)) : doc;
        if (!/^docs\/[^/]+\.md$/.test(target)) return [];
        return [{ doc, line: i + 1, raw, target: anchor === undefined ? target : `${target}#${anchor}` }];
      });
    });
  });
}

/**
 * Real headings and anchors of the two docs at the base, each with the slug GitHub gives it (worked by hand from
 * GitHub's rules, README: Slugs): punctuation dropped, markdown reduced to its text, `_` kept, duplicates numbered,
 * and an explicit `<a id>`.
 */
export const CLEAN_TARGETS = [
  ['docs/technical-design.md#how-we-know-version-0-works', 'How we know version 0 works'],
  ['docs/technical-design.md#hooks-are-evidence-not-a-state-machine', 'Hooks are evidence, not a state machine'],
  ['docs/technical-design.md#extension-api-typescript-in-process', 'Extension API (TypeScript, in-process)'],
  ['docs/technical-design.md#evidence-1', 'Evidence, the primitive (the second Evidence heading)'],
  ['docs/technical-design.md#verdicts', 'How runs become one of five verdicts (an explicit anchor)'],
  ['docs/canvas-primitives.md#text-text1-halo', 'Text text@1: halo'],
  ['docs/canvas-primitives.md#frame-and-group-frame1-group1', 'Frame and group frame@1, group@1'],
  ['docs/canvas-primitives.md#vector-field-vector_field1', 'Vector field vector_field@1'],
  ['docs/canvas-primitives.md#honest-numbers-1', 'Honest numbers (the second one)'],
  ['docs/canvas-primitives.md#canvas-module-interface-and-implementation', 'Canvas module: interface and implementation'],
];

/** A clean issue body: links that land on headings, a docs file linked without an anchor, and links outside docs/. */
export function cleanBody(number, [target, text] = CLEAN_TARGETS[number % CLEAN_TARGETS.length]) {
  return [
    `A clean issue body for #910's acceptance tests (${number}). It is not a real issue.`,
    '',
    `**Epic:** #5 · **Design:** [${text}](${BLOB}${target})`,
    '',
    '### Scope',
    `- A change in [scripts/checks.mjs](${BLOB}scripts/checks.mjs), under [the proof rules](${BLOB}AGENTS.md#proof).`,
    ...(number % 4 === 0 ? [`- Written up in the [extension guide](${BLOB}docs/extension-guide.md).`] : []),
    '',
    '### Depends on',
    '- [#605](https://github.com/windoliver/deepbuild/issues/605) Run the catalogue drift check over the design docs and open issues',
  ].join('\n');
}

/**
 * Open issues for the fake `gh`, newest first as gh lists them: 40 clean bodies numbered 9640 down to 9601.
 * `bodies` replaces the body of the issues it names; #9605 is the 36th, so a lane that keeps gh's default limit of
 * 30 never sees it.
 */
export function openIssues(bodies = {}) {
  return Array.from({ length: 40 }, (_, i) => {
    const number = 9640 - i;
    return { number, body: bodies[number] ?? cleanBody(number) };
  });
}

/** The docs/*.md targets the issues link, resolved as `docs/<file>.md#<anchor>` (or without an anchor). */
export const issueTargets = (issues) => issues.flatMap(({ body }) => [...body.matchAll(/\(https:\/\/github\.com\/windoliver\/deepbuild\/blob\/[^/]+\/(docs\/[^/)#\s]+\.md(?:#[^)\s]*)?)\)/g)].map((m) => m[1]));

/**
 * Puts a fake `gh` first on PATH. Online it answers `gh issue list … --json <fields>` with `issues`, cut to
 * `--limit`/`-L` (30 when absent, as gh does), and `gh auth status`; offline every call but `gh --version` fails as
 * gh does when it can't reach GitHub. Each call's arguments are logged.
 */
export function fakeGh(sandbox, { offline = false, issues = [] } = {}) {
  const data = join(sandbox, 'gh-issues.json');
  writeFileSync(data, JSON.stringify(issues));
  const script = `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(sandbox, 'gh.log'))}, JSON.stringify(args) + '\\n');
const value = (...names) => {
  for (let i = 0; i < args.length; i++) {
    for (const n of names) {
      if (args[i] === n) return args[i + 1];
      if (args[i].startsWith(n + '=')) return args[i].slice(n.length + 1);
    }
  }
};
if (args[0] === '--version') { console.log('gh version 2.99.0 (fake, #910 acceptance tests)'); process.exit(0); }
if (${offline}) {
  console.error('error connecting to api.github.com');
  console.error('check your internet connection or https://githubstatus.com');
  process.exit(1);
}
if (args[0] === 'auth' && args[1] === 'status') { console.log('github.com\\n  Logged in to github.com (fake)'); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'list') {
  const fields = value('--json');
  if (!fields) { console.error('fake gh: this test answers gh issue list only with --json'); process.exit(1); }
  const limit = Number(value('--limit', '-L') ?? 30);
  const issues = JSON.parse(readFileSync(${JSON.stringify(data)}, 'utf8')).slice(0, limit);
  const keep = fields.split(',').map((f) => f.trim());
  console.log(JSON.stringify(issues.map((i) => Object.fromEntries(keep.filter((k) => k in i).map((k) => [k, i[k]])))));
  process.exit(0);
}
console.error('fake gh: unsupported command: gh ' + args.join(' '));
process.exit(1);
`;
  const gh = join(sandbox, 'bin', 'gh');
  writeFileSync(gh, script);
  chmodSync(gh, 0o755);
}

export const ghCalls = (sandbox) => (existsSync(join(sandbox, 'gh.log'))
  ? readFileSync(join(sandbox, 'gh.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * The sandboxed environment: HOME, TMPDIR and the XDG folders in the sandbox, no GitHub token, no perf hand-off of
 * cached issues (DEEP_OPEN_ISSUES), the local preflight, and the fake gh first on PATH.
 */
export function sandboxEnv(sandbox) {
  const env = { ...process.env };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_OPEN_ISSUES', 'DEEP_PREFLIGHT']) delete env[key];
  return {
    ...env,
    PATH: [join(sandbox, 'bin'), dirname(process.execPath), env.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
  };
}

/**
 * Runs the design links lane in a child process with cwd at `repo`, through the fixture's own scripts/lanes.mjs and
 * `runLanes`, the call scripts/checks.mjs makes over every lane. With `drift`, the catalogue drift lane (#605) runs
 * too, both in their order in `checks`, as the preflight runs them, so a links lane that reuses the drift lane's
 * fetch finds it; without, the links lane runs alone. Returns the links lane's name, the exit status and the output.
 */
export function runLane(repo, env, { drift = true } = {}) {
  const program = `
import { existsSync } from 'node:fs';
const { checks, runLanes } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const names = JSON.stringify(checks.map((l) => l.name));
const links = checks.filter((lane) => ${LINKS}.test(lane.name) && !${DRIFT}.test(lane.name));
if (links.length !== 1) {
  console.log('NO LANE: scripts/lanes.mjs checks has ' + links.length + ' lanes matching ${LINKS} and not ${DRIFT}, of ' + names);
  process.exit(3);
}
let lanes = links;
if (${drift}) {
  const drift = checks.filter((lane) => ${DRIFT}.test(lane.name));
  if (drift.length !== 1) {
    console.log('NO LANE: scripts/lanes.mjs checks has ' + drift.length + ' lanes matching ${DRIFT}, of ' + names);
    process.exit(3);
  }
  // The drift lane reads the contracts package's built dist/ (#605): without it, it never fetches the issues.
  if (!existsSync('node_modules') || !existsSync('packages/contracts/dist/index.js')) {
    console.log('BLOCKED: these tests run the catalogue drift lane, which needs node_modules and packages/contracts/dist: run npm ci and npm run build --workspaces in the checkout first');
    process.exit(4);
  }
  lanes = checks.filter((lane) => lane === links[0] || lane === drift[0]);
}
console.log('LANE ' + links[0].name);
process.exitCode = runLanes(lanes);
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const name = output.match(/^LANE (.+)$/m)?.[1];
  return { status: r.status, signal: r.signal, output, name, lines: output.split('\n') };
}

/** Fails with the run's output unless exactly one design links lane ran. */
export function laneName(run) {
  if (!run.name) throw new Error(`no design links lane ran:\n${run.output}`);
  return run.name;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The links lane's verdict states: runLanes prints `PASS <name> (…)` or `<STATE> <name>: <reason>`. */
export const verdicts = (run, name) => run.lines
  .filter((l) => l.startsWith(`PASS ${name} (`) || new RegExp(`^[A-Z]+ ${escape(name)}:`).test(l))
  .map((l) => l.split(' ')[0]);

/** What the links lane's own commands printed: the lines after `RUN <name>`, up to the next lane or a PASS. */
export function laneOutput(run, name) {
  const start = run.lines.indexOf(`RUN ${name}`);
  if (start < 0) return [];
  const rest = run.lines.slice(start + 1);
  const end = rest.findIndex((l) => /^(RUN|PASS|SKIP) /.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

/** An output line naming an issue: its number as a whole number (`#9605` or `issue 9605`) and the link's text. */
export const namesIssueLink = (run, number, link) => run.lines.find((l) => l.includes(link) && new RegExp(`(?<!\\d)${number}(?!\\d)`).test(l));

/**
 * An output line naming a doc line: the doc's file name with the line number (`docs/x.md:12`, `x.md:3,12`,
 * `x.md:3, 12` or `x.md line 12`) and the anchor it links.
 */
export const namesDocLine = (run, doc, line, anchor) => {
  const at = new RegExp(`${escape(posix.basename(doc))}(?::|,? lines? )(?:\\d+,\\s?)*${line}(?!\\d)`);
  return run.lines.find((l) => at.test(l) && l.includes(`#${anchor}`));
};
