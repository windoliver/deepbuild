#!/usr/bin/env node
// Cutting a release in one command (#1495; technical design: How it installs, Cutting a release). Three steps, the
// first and last of which change git:
//   node scripts/release.mjs bump --version <x.y.z> [--repo <dir>]
//     moves every place the version lives (scripts/release-versions.mjs) to <x.y.z> from the one source, the root
//     package.json, and commits only those files.
//   node scripts/release.mjs notes --commit <sha> --out <dir> --preflight <report.json> [--repo <dir>]
//     writes <out>/NOTES.md (the contract diff's notes, the titles merged since the previous tag, and Looks that moved:
//     one row per decision since then that blessed a golden or a corpus difference, its figures read from the
//     comparison the decision answered) and <out>/README.md (the commit's README with a generated Known limits list:
//     each open known-limit item and each lane the release report left BLOCKED or INCONCLUSIVE). It judges nothing.
//   node scripts/release.mjs tag --commit <sha> --out <dir> --key <ed25519.pem> --preflight <report.json> --publish <dir> [--repo <dir>]
//     refuses, naming what differs, while a version at <sha> isn't the release's, the preflight's record isn't for
//     <sha> (scripts/preflight-record.mjs, the check release-pack makes), the README leaves out a known limit or the
//     notes a decision. Otherwise it packs what's missing, then for each artifact of the signed manifest in turn:
//     skips it when its published bytes hash to the manifest's entry, or verifies its own bytes (digest, a fresh
//     extraction against every entry the manifest lists, the app download's sandboxed run) and publishes it, and
//     last tags release/<version> at <sha>. Run again, it does only what's missing.
// The release preflight's report is `{commit, verdict, lanes: [{name, state, reason}]}`, its lanes the release report.
// Open known-limit items are open issues labelled "known limit", or the `gh issue list --json number,title` array in
// the file DEEP_KNOWN_LIMITS names. DEEP_RELEASE_PLANT selects a planted wrong program; only tests set it.
import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preflightRefusal } from './preflight-record.mjs';
import { contentsOf, extract, refusal, sha256 } from './release-artifacts.mjs';
import { atCommit, moveVersions, onDisk, sourceVersion, strayVersions } from './release-versions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const say = (line) => console.log(line);
/** A refusal: thrown, so every temporary folder is removed on the way out, and printed with its exit code. */
class Stop extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
const fail = (message, code = 1) => {
  throw new Stop(message, code);
};
const USAGE = 'usage: release.mjs bump --version <x.y.z> | notes --commit <sha> --out <dir> --preflight <report.json> | tag --commit <sha> --out <dir> --key <pem> --preflight <report.json> --publish <dir>  [--repo <dir>]';
const [step, ...rest] = process.argv.slice(2);
const flag = (name, need = true) => {
  const at = rest.indexOf(`--${name}`);
  const value = at < 0 ? undefined : rest[at + 1];
  if (need && (value === undefined || value.startsWith('--'))) fail(`${step} needs --${name}\n${USAGE}`, 2);
  return value;
};
/** The planted wrong programs a test selects; each changes one rule of the release (tests/acceptance/1495). */
const PLANTS = ['version-verifier', 'name-version-verifier', 'trust-file-name', 'contract-diff-only', 'self-compare', 'drop-empty-heading', 'heading-only'];
const plant = process.env.DEEP_RELEASE_PLANT || undefined;
const repo = resolve(flag('repo', false) ?? join(HERE, '..'));
const git = (args, options = {}) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28, ...options });
const gitOut = (args) => {
  const r = git(args);
  if (r.status !== 0) fail(`git ${args.join(' ')} failed: ${(r.stderr || String(r.error)).trim()}`);
  return r.stdout;
};
const commitOf = (ref) => {
  const r = git(['rev-parse', '-q', '--verify', `${ref}^{commit}`]);
  if (r.status !== 0) fail(`${ref} names no commit in ${repo}`);
  return r.stdout.trim();
};

// ---- bump

function bump() {
  const version = flag('version');
  let moved;
  try {
    moved = moveVersions(onDisk(repo), version);
  } catch (error) {
    fail(error.message, 2);
  }
  const files = [...moved.keys()].sort();
  if (!files.length) return say(`every version is ${version} already; nothing to commit`);
  // The commit holds the version edits and nothing else, so a file with changes of its own refuses the bump.
  const dirty = gitOut(['status', '--porcelain', '--', ...files]).split('\n').filter(Boolean).map((l) => l.slice(3));
  if (dirty.length) fail(`these files have changes of their own, so the bump would commit more than versions: ${dirty.join(', ')}`);
  for (const [file, text] of moved) writeFileSync(join(repo, file), text);
  gitOut(['commit', '-q', '-m', `Release ${version}`, '--', ...files]);
  say(`moved ${files.length} files to ${version} in ${commitOf('HEAD')}: ${files.join(', ')}`);
}

// ---- What the notes and the README are made from

/** The preflight's report, which must list the release report's lanes. */
function report(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    fail(`the preflight report ${resolve(path)} can't be read as JSON: ${error.message}`);
  }
  if (!Array.isArray(value?.lanes)) fail(`BLOCKED the preflight report ${resolve(path)} lists no lanes, so what the release report left BLOCKED or INCONCLUSIVE is unknown`, 3);
  return value;
}

/** Each part of a version, numbers compared as numbers. */
const parts = (v) => v.split(/[.+-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
const below = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined;
    return typeof x[i] === 'number' && typeof y[i] === 'number' ? x[i] < y[i] : String(x[i]) < String(y[i]);
  }
  return false;
};
/** The release/<version> tag with the highest version below `version`, or null for the first release. */
function previousTag(version) {
  const versions = gitOut(['tag', '--list', 'release/*']).split('\n').map((t) => t.slice('release/'.length)).filter((v) => /^\d/.test(v) && below(v, version));
  return versions.length ? `release/${versions.reduce((best, v) => (below(best, v) ? v : best))}` : null;
}

/** The titles merged since the previous tag: each first-parent commit's, a merged pull request's by its own title. */
function mergedTitles(since, commit) {
  const log = gitOut(['log', '--first-parent', '--format=%s%x1f%b%x1e', since ? `${since}..${commit}` : commit]);
  return log.split('\x1e').map((e) => e.trim()).filter(Boolean).map((e) => {
    const [subject, body = ''] = e.split('\x1f');
    const pr = /^Merge pull request #(\d+) from /.exec(subject);
    return pr ? `${body.trim().split('\n')[0] || subject} (#${pr[1]})` : subject;
  });
}

/** The contract diff's notes for the commit, read from its contract files. */
function contractNotes(commit, version, work) {
  const tree = join(work, 'contracts');
  mkdirSync(tree);
  const paths = ['packages/contracts', 'contracts'].filter((p) => git(['cat-file', '-e', `${commit}:${p}`]).status === 0);
  if (paths.length) {
    const archive = spawnSync('git', ['archive', '--format=tar', commit, ...paths], { cwd: repo, maxBuffer: 1 << 30 });
    const untar = archive.status === 0 && spawnSync('tar', ['-x', '-C', tree], { input: archive.stdout });
    if (!untar || untar.status !== 0) fail(`the contract files of ${commit} can't be read: ${String(archive.stderr || untar?.stderr)}`);
  }
  const r = spawnSync(process.execPath, [join(HERE, 'contract-diff.mjs'), 'notes', '--release', version, '--root', tree], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) fail(`BLOCKED the contract diff's notes didn't run: ${(r.stdout + r.stderr).trim()}`, 3);
  return r.stdout.trim();
}

/**
 * The decisions since the previous tag that blessed a golden or a corpus difference: each blessing in the kit's golden
 * store and each accepted result of a corpus document an earlier release saved, at the commit and not at the tag.
 */
function blessings(commit, since) {
  const now = atCommit(repo, commit);
  const then = since ? atCommit(repo, since) : null;
  const json = (tree, path, empty) => (tree?.read(path) === undefined ? empty : JSON.parse(tree.read(path)));
  const STORE = 'parity/goldens/store.json';
  const known = new Set(json(then, STORE, {}).decisions?.map((d) => d.decision) ?? []);
  const found = [];
  for (const d of json(now, STORE, {}).decisions ?? []) {
    if (d.what?.bless && !known.has(d.decision)) found.push({ decision: d.decision, name: d.what.bless.fixture, kind: 'golden', cause: d.what.bless.cause, comparison: d.comparison });
  }
  const CORPUS = 'crates/deep-show/kit-corpus';
  for (const file of now.list(CORPUS).filter((f) => f.endsWith('.json'))) {
    const doc = json(now, `${CORPUS}/${file}`, {});
    const accepted = new Set(json(then, `${CORPUS}/${file}`, {}).accepted?.map((a) => a.decision) ?? []);
    for (const a of doc.accepted ?? []) if (!accepted.has(a.decision)) found.push({ decision: a.decision, name: doc.name ?? file.slice(0, -5), kind: 'corpus', cause: a.cause, comparison: a.comparison });
  }
  return found;
}

const cell = (text) => String(text ?? 'not recorded').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
/** A share of pixels as a percentage: one decimal, more for a share under a tenth of a percent, so none reads as 0. */
const percent = (share) => {
  const p = share * 100;
  return `${p === 0 || p >= 0.1 ? p.toFixed(1) : p.toPrecision(1)}%`;
};
/** Each decision's row in Looks that moved, both figures as the comparison it answered recorded them. */
function looksRows(decisions) {
  return decisions.map((d) => {
    // The planted generator compares the new golden with itself: nothing is past the tolerance, nothing changed.
    const c = plant === 'self-compare' ? { share_past_tolerance: 0, largest_change: 0 } : d.comparison ?? {};
    const share = typeof c.share_past_tolerance === 'number' ? percent(c.share_past_tolerance) : 'not recorded';
    const largest = typeof c.largest_change === 'number' ? String(c.largest_change) : 'not recorded';
    return { decision: d.decision, line: `| ${cell(d.name)} | ${d.kind} | ${cell(d.cause)} | ${cell(d.decision)} | ${share} | ${largest} |` };
  });
}
const LOOKS = '## Looks that moved';
const LOOKS_HEADER = ['| Fixture or document | Kind | Cause | Decision | Pixels past tolerance | Largest change in code values |', '| --- | --- | --- | --- | --- | --- |'];

/** The open known-limit items: DEEP_KNOWN_LIMITS's file, or GitHub's open issues labelled "known limit". */
function knownLimitItems() {
  if (process.env.DEEP_KNOWN_LIMITS) {
    try {
      return JSON.parse(readFileSync(process.env.DEEP_KNOWN_LIMITS, 'utf8'));
    } catch (error) {
      fail(`BLOCKED the known limits in ${process.env.DEEP_KNOWN_LIMITS} can't be read: ${error.message}`, 3);
    }
  }
  const gh = spawnSync('gh', ['issue', 'list', '--state', 'open', '--label', 'known limit', '--limit', '1000', '--json', 'number,title'], { cwd: repo, encoding: 'utf8' });
  if (gh.status !== 0) fail(`BLOCKED the open known-limit issues can't be read from GitHub: ${(gh.stderr || String(gh.error)).trim()}`, 3);
  return JSON.parse(gh.stdout);
}
/** The Known limits bullets: each open known-limit item, then each lane the release report left BLOCKED or INCONCLUSIVE. */
function limitLines(lanes, items) {
  return [
    ...items.map((i) => ({ what: `#${i.number}`, line: `- #${i.number} ${cell(i.title)}: an open known limit` })),
    ...lanes.filter((l) => l.state === 'BLOCKED' || l.state === 'INCONCLUSIVE')
      .map((l) => ({ what: `the lane ${l.name}`, line: `- ${l.name}: ${l.state} in the release report${l.reason ? ` (${cell(l.reason)})` : ''}` })),
  ];
}
const LIMITS = '## Known limits';

// ---- notes

function notes() {
  const commit = commitOf(flag('commit'));
  const out = resolve(flag('out'));
  const { lanes } = report(flag('preflight'));
  const tree = atCommit(repo, commit);
  const version = sourceVersion(tree);
  const since = previousTag(version);
  const work = mkdtempSync(join(tmpdir(), 'release-notes-'));
  try {
    const contracts = contractNotes(commit, version, work);
    // The planted generator reads the contract diff alone, which holds no blessing.
    const rows = looksRows(plant === 'contract-diff-only' ? [] : blessings(commit, since));
    const looks = rows.length ? [LOOKS, '', ...LOOKS_HEADER, ...rows.map((r) => r.line)] : plant === 'drop-empty-heading' ? [] : [`${LOOKS}: none`];
    const titles = mergedTitles(since, commit);
    const text = [
      `# DeepBuild ${version}`, '',
      `Released from ${commit}${since ? `; what changed since ${since}` : ', the first release: everything is new'}.`, '',
      '## Merged', '', ...(titles.length ? titles.map((t) => `- ${t}`) : ['none']), '',
      '## Contract changes', '', '```', contracts, '```', '',
      ...looks, '',
    ].join('\n');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'NOTES.md'), text);

    const limits = limitLines(lanes, knownLimitItems());
    const readme = (tree.read('README.md') ?? '').replace(/\n## Known limits\n[^]*?(?=\n## |$)/, '').trimEnd();
    writeFileSync(join(out, 'README.md'), [
      readme, '', LIMITS, '',
      `What ${version} can't do yet, written by scripts/release.mjs: each open known-limit item and each lane the release report left BLOCKED or INCONCLUSIVE.`, '',
      ...(limits.length ? limits.map((l) => l.line) : ['None.']), '',
    ].join('\n'));
    say(`wrote ${join(out, 'NOTES.md')} (${rows.length ? `${rows.length} looks that moved` : 'no look moved'}) and ${join(out, 'README.md')} (${limits.length} known limits)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- tag

/** The lines of a Markdown section, from its heading to the next of its level or above; null when it has none. */
function section(text, heading) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === heading || l.trim().startsWith(`${heading}:`));
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && /^#{1,2}\s/.test(l));
  return lines.slice(at, end < 0 ? undefined : end).map((l) => l.trim());
}
const readOut = (out, name) => {
  const file = join(out, name);
  if (!existsSync(file)) fail(`${file} isn't there: run \`release.mjs notes\` for this commit first`);
  return readFileSync(file, 'utf8');
};

/** What the release writes into a run's text: every check that refuses it, before anything is packed or published. */
function refusals(commit, version, out, lanes) {
  const found = [];
  const stray = strayVersions(atCommit(repo, commit));
  if (stray.length) found.push(`the versions at ${commit} disagree:\n  ${stray.join('\n  ')}`);
  const readme = section(readOut(out, 'README.md'), LIMITS) ?? [];
  for (const l of limitLines(lanes, knownLimitItems())) if (!readme.includes(l.line)) found.push(`${join(out, 'README.md')}'s Known limits leaves out ${l.what}, which the release lists as "${l.line.slice(2)}"`);
  const looks = section(readOut(out, 'NOTES.md'), LOOKS);
  if (!looks) found.push(`${join(out, 'NOTES.md')} has no ${LOOKS.slice(3)} heading`);
  else if (plant !== 'heading-only') {
    const rows = looksRows(blessings(commit, previousTag(version)));
    if (!rows.length && looks[0] !== `${LOOKS}: none`) found.push(`${join(out, 'NOTES.md')}'s ${LOOKS.slice(3)} isn't "none", and no decision blessed a look since the previous tag`);
    for (const r of rows) if (!looks.includes(r.line)) found.push(`${join(out, 'NOTES.md')}'s ${LOOKS.slice(3)} has no row for the decision ${r.decision}: ${r.line}`);
  }
  return found;
}

/** The signed manifest in `out` for `commit`, packing it first when the folder holds none. */
function manifestOf(commit, version, out, key, preflight, tree) {
  const file = join(out, 'manifest.json');
  if (!existsSync(file)) pack(commit, version, out, key, preflight, tree);
  const bytes = readFileSync(file);
  let sig;
  try {
    sig = readFileSync(`${file}.sig`);
  } catch {
    fail(`${file} has no signature beside it, ${file}.sig`);
  }
  if (!verify(null, bytes, createPublicKey(key.private), sig)) fail(`${file}.sig isn't --key's signature of ${file}`);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.commit !== commit) fail(`${out} holds the release of ${manifest.commit}, not of ${commit}; give this release a folder of its own`);
  return manifest;
}

/**
 * The release's artifacts, built at `commit` into `out`: release-pack's npm archives, then on macOS the app download,
 * DeepBuild.app around the runtime folder those archives make, its entry added to the manifest and signed again.
 */
function pack(commit, version, out, key, preflight, tree) {
  const app = tree.read('scripts/app-bundle') !== undefined;
  if (app && process.platform !== 'darwin') fail(`BLOCKED ${commit} ships an app, and its download is built on macOS; this is ${process.platform}`, 3);
  const packed = spawnSync(process.execPath, [join(HERE, 'release-pack.mjs'), '--repo', repo, '--commit', commit, '--out', out, '--key', key.path, '--preflight', preflight], { stdio: 'inherit' });
  if (packed.status !== 0) fail(`release-pack.mjs didn't pack ${commit}`);
  if (!app) return;
  const work = mkdtempSync(join(tmpdir(), 'release-app-'));
  try {
    const runtime = join(work, 'runtime');
    const laid = spawnSync(process.execPath, [join(repo, 'scripts', 'app-runtime.mjs'), '--archives', out, '--out', runtime], { cwd: repo, stdio: 'inherit' });
    if (laid.status !== 0) fail('app-runtime.mjs didn\'t lay out the app\'s runtime folder');
    const bundled = spawnSync(join(repo, 'scripts', 'app-bundle'), [runtime], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    const bundle = bundled.stdout?.trim().split('\n').at(-1);
    if (bundled.status !== 0 || !bundle || !existsSync(bundle)) fail('scripts/app-bundle didn\'t make DeepBuild.app');
    const folder = join(work, 'app');
    cpSync(bundle, join(folder, 'DeepBuild.app'), { recursive: true, verbatimSymlinks: true });
    const name = `DeepBuild-${version}.zip`;
    const zipped = spawnSync('ditto', ['-c', '-k', '--norsrc', '--keepParent', join(folder, 'DeepBuild.app'), join(out, name)], { encoding: 'utf8' });
    if (zipped.status !== 0) fail(`ditto didn't zip DeepBuild.app: ${zipped.stderr}`);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    manifest.archives.push({ name: 'DeepBuild.app', file: name, sha256: sha256(join(out, name)), holds: contentsOf(folder) });
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(out, 'manifest.json'), bytes);
    writeFileSync(join(out, 'manifest.json.sig'), sign(null, bytes, key.private));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Why the planted verifiers would refuse, reading names and versions instead of bytes: the file's name, then the
 * package it holds (an npm archive's, or the app's runtime folder's), its name too for `name-version-verifier`.
 */
function byVersion(file, entry, version, work) {
  if (!entry.file.includes(version)) return `${entry.file} isn't named for ${version}`;
  const into = join(work, `${entry.file}.versions`);
  extract(file, into);
  const npm = join(into, 'package', 'package.json');
  const app = join(into, 'DeepBuild.app', 'Contents', 'Resources', 'runtime', 'package.json');
  const meta = existsSync(npm) ? JSON.parse(readFileSync(npm, 'utf8')) : existsSync(app) ? JSON.parse(readFileSync(app, 'utf8')) : {};
  if (plant === 'name-version-verifier' && existsSync(npm) && meta.name !== entry.name) return `${entry.file} holds ${meta.name}, not ${entry.name}`;
  return meta.version === version ? null : `${entry.file}'s package says ${meta.version ?? 'no version'}, not ${version}`;
}

/**
 * The app download's own proof (#41's, for the npm install): from its extracted copy alone, under the platform sandbox
 * with reads granted to that folder and a fresh HOME, writes to that HOME and no host, `deep --version` prints the
 * release's version and the fixture film's still exports. Why it fails, or null.
 */
async function appCheck(into, version, commit, work) {
  if (process.platform !== 'darwin') return `BLOCKED the app download's sandboxed run needs macOS's sandbox; this is ${process.platform}`;
  const film = atCommit(repo, commit).read(FILM);
  if (film === undefined) return `BLOCKED ${commit} holds no fixture film at ${FILM} for the app download to export`;
  let seatbelt;
  try {
    ({ seatbelt } = await import(pathToFileURL(join(HERE, '..', 'packages', 'supervisor', 'dist', 'index.js')).href));
  } catch (error) {
    return `BLOCKED the platform sandbox can't load (build it with npm run build --workspaces): ${error.message}`;
  }
  const home = mkdtempSync(join(work, 'home-'));
  mkdirSync(join(home, 'tmp'));
  writeFileSync(join(home, 'film.json'), film);
  const deep = join(into, 'DeepBuild.app', 'Contents', 'Resources', 'runtime', 'bin', 'deep');
  const confined = async (args) => {
    const launch = await seatbelt.confine({ argv: [deep, ...args], cwd: home, env: { HOME: home, TMPDIR: join(home, 'tmp'), PATH: '/usr/bin:/bin' } }, { read: [into, home], write: [home] }, 'run:release');
    return spawnSync(launch.argv[0], launch.argv.slice(1), { cwd: launch.cwd, env: launch.env, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 15 * 60_000 });
  };
  const said = (r) => `exit ${r.status ?? r.signal}: ${`${r.stdout}\n${r.stderr}`.trim().slice(-4000)}`;
  const printed = await confined(['--version']);
  if (printed.status !== 0 || printed.stdout.trim() !== version) return `deep --version, run from it under the sandbox, didn't print ${version}: ${said(printed)}`;
  const still = join(home, 'still.png');
  const exported = await confined(['export', '--document', join(home, 'film.json'), '--still', STILL, '--out', still]);
  const png = existsSync(still) && readFileSync(still).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (exported.status !== 0 || !png) return `the fixture film's still didn't export from it under the sandbox: ${said(exported)}`;
  return null;
}
const FILM = 'tests/fixtures/films/release-still/film.json';
const STILL = '30';
const APP = 'DeepBuild.app';

async function tag() {
  const commit = commitOf(flag('commit'));
  const out = resolve(flag('out'));
  const publish = resolve(flag('publish'));
  const preflight = flag('preflight');
  const keyPath = resolve(flag('key'));
  let key;
  try {
    key = { path: keyPath, private: createPrivateKey(readFileSync(keyPath)) };
  } catch (error) {
    fail(`the key ${keyPath} isn't a private key: ${error.message}`);
  }
  const tree = atCommit(repo, commit);
  const version = sourceVersion(tree);
  // The one check of the preflight's record, release-pack's own.
  const notPassed = preflightRefusal(preflight, commit);
  const { lanes } = report(preflight);
  const found = [...(notPassed ? [notPassed] : []), ...refusals(commit, version, out, lanes)];
  if (found.length) fail(`the release of ${version} at ${commit} is refused, and nothing was published or tagged:\n- ${found.join('\n- ')}`);

  const manifest = manifestOf(commit, version, out, key, preflight, tree);
  const work = mkdtempSync(join(tmpdir(), 'release-'));
  try {
    mkdirSync(publish, { recursive: true });
    for (const entry of manifest.archives) {
      const there = join(publish, entry.file);
      if (existsSync(there) && statSync(there).isFile()) {
        // A rerun skips an artifact only when the bytes it published hash to the manifest's entry.
        if (plant === 'trust-file-name') { say(`skipped ${entry.file}: published already`); continue; }
        const got = sha256(there);
        if (got !== entry.sha256) fail(`${entry.file} is published with bytes that hash to ${got}, and the manifest's entry is ${entry.sha256}`);
        say(`skipped ${entry.file}: published already, its bytes hash to the manifest's ${entry.sha256}`);
        continue;
      }
      const file = join(out, entry.file);
      if (!existsSync(file)) fail(`${entry.file}, which the manifest lists, isn't in ${out}`);
      let why;
      if (plant === 'version-verifier' || plant === 'name-version-verifier') why = byVersion(file, entry, version, work);
      else {
        why = refusal(file, entry, work);
        if (!why && entry.name === APP) why = await appCheck(join(work, `${entry.file}.extracted`), version, commit, work);
      }
      if (why) fail(`${entry.file} fails verification, so it and everything after it stay unpublished:\n  ${why.replaceAll('\n', '\n  ')}`, why.startsWith('BLOCKED') ? 3 : 1);
      say(`verified ${entry.file}`);
      // Into the publish folder under a name of its own, then renamed into place, so a reader never sees half of it.
      const partial = join(publish, `.${entry.file}.${process.pid}`);
      try {
        copyFileSync(file, partial);
        renameSync(partial, there);
      } catch (error) {
        rmSync(partial, { force: true });
        fail(`${entry.file} can't be published to ${there}, so the release stops here: ${error.message}`);
      }
      const landed = sha256(there);
      if (landed !== entry.sha256) fail(`${entry.file} landed in ${publish} as bytes that hash to ${landed}, not the manifest's ${entry.sha256}`);
      say(`published ${entry.file}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const name = `release/${version}`;
  const at = git(['rev-parse', '-q', '--verify', `refs/tags/${name}^{commit}`]).stdout.trim();
  if (at && at !== commit) fail(`${name} already names ${at}, not ${commit}`);
  if (!at) gitOut(['tag', name, commit]);
  say(`tagged ${name} at ${commit}`);
}

try {
  if (plant && !PLANTS.includes(plant)) fail(`DEEP_RELEASE_PLANT=${plant} names no planted program`, 2);
  if (step === 'bump') bump();
  else if (step === 'notes') notes();
  else if (step === 'tag') await tag();
  else fail(USAGE, 2);
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(`release: ${error.message}`);
  process.exitCode = error.code;
}
