// The AGENTS.md rules a machine can check, run by the lint lane. It reads the working tree and
// git's index and writes nothing. Each check prints one line; FAIL, INVALID and BLOCKED fail the run.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const config = 'scripts/repo-rules.json';
const lockfiles = new Set(['package-lock.json', 'Cargo.lock']);
const npmSections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides'];
const fixes = {
  workflows: 'Remove it; checks run locally through scripts/preflight, never on push or pull request.',
  hooks: "Install hooks and plugins at user level only, never in a repo's settings.",
  secret: `Remove or redact it (use ~/ or <name>); for a deliberate fixture, add an allowedFindings entry to ${config}.`,
  stale: `Remove the allowedFindings entry, or correct its path, kind or sha256.`,
  dep: `Remove it, or add it to ${config} with why the task needs it.`,
  config: `Repair ${config}: each dependency needs its spec and why, each allowedFindings entry its path, kind, sha256 and why.`,
  read: 'Make the file readable, or remove it.',
  git: 'Install git and run this from a git checkout.',
  cargo: 'Install Rust with Cargo, which preflight already needs.',
  empty: 'Run this from a checkout whose files git lists.',
  card: 'Give the folder a README.md with the headings What it is for, Where new code goes, What it may import and Deviations.',
  deviation: 'Correct the deviation to the file it is about, or remove it if the file is gone.',
};
const cardHeadings = ['What it is for', 'Where new code goes', 'What it may import', 'Deviations'];
// Each pattern's match is the reported value; a home path's placeholders and shared folders don't match.
const kinds = [
  ['home path', /(?<![\w.-])(?:\/Users\/(?!Shared\/)|\/home\/)[\w.-]+\/|(?<![\w.-])[A-Za-z]:(\\{1,2})Users\1(?!Public\1)[\w.-]+\1/g],
  ['private key', /-----BEGIN[A-Z0-9 ]* PRIVATE KEY(?: BLOCK)?-----/g],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{22,}/g],
  ['API key', /(?<![\w-])sk-[\w-]{20,}/g],
  ['AWS access key', /A(?:KI|SI)A[A-Z0-9]{16}/g],
];
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const article = (kind) => (/^[AEIOU]/.test(kind) ? 'an' : 'a');
const results = [];
const report = (state, check, message, fix) => results.push({ state, line: `${state} ${check}: ${message}`, fix });
const toPosix = (path) => path.split(sep).join(posix.sep);
const spawnError = (error) => `spawn ${error.path} ${error.code}`;
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  if (result.error) throw Error(`git ${args[0]} could not run (${spawnError(result.error)})`);
  if (result.status !== 0) throw Error(`git ${args[0]} exited ${result.status}: ${result.stderr.trim().split('\n')[0]}`);
  return result.stdout;
};

// git's own binary test: a NUL in the first 8,000 bytes. Reads no more of a binary file.
function readText(path) {
  const descriptor = openSync(join(root, path), 'r');
  try {
    const head = Buffer.alloc(8000);
    const length = readSync(descriptor, head, 0, head.length, null);
    if (head.subarray(0, length).includes(0)) return null;
    return Buffer.concat([head.subarray(0, length), readFileSync(descriptor)]).toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

function checkWorkflows() {
  const entries = existsSync(join(root, '.github/workflows')) ? readdirSync(join(root, '.github/workflows')).sort() : [];
  for (const entry of entries) report('FAIL', 'workflows', `.github/workflows/${entry}`, fixes.workflows);
  if (!entries.length) report('PASS', 'workflows', '.github/workflows/ has no entries');
}

// Walks the whole tree, ignored files included, because agents read settings git ignores.
function checkAgentHooks() {
  const before = results.length;
  const walk = (directory) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!['.git', 'node_modules', 'target'].includes(entry.name)) walk(path);
      } else if (path.split('/').includes('.codex')) report('FAIL', 'agent-hooks', `${path} is Codex config in the repo`, fixes.hooks);
      else if (posix.basename(directory) === '.claude' && /^settings.*\.json$/.test(entry.name)) {
        let settings;
        try {
          settings = JSON.parse(readFileSync(join(root, path), 'utf8'));
        } catch (error) {
          if (error.code) report('BLOCKED', 'agent-hooks', `${path} cannot be read (${error.code})`, fixes.read);
          else report('INVALID', 'agent-hooks', `${path}: ${error.message}`, fixes.hooks);
          continue;
        }
        if (settings && Object.hasOwn(settings, 'hooks')) report('FAIL', 'agent-hooks', `${path} has a hooks key`, fixes.hooks);
        if (settings && Object.hasOwn(settings, 'enabledPlugins')) report('FAIL', 'agent-hooks', `${path} enables plugins`, fixes.hooks);
        if (settings?.disableAllHooks === true) report('FAIL', 'agent-hooks', `${path} switches hooks off`, fixes.hooks);
      }
    }
  };
  walk('');
  if (results.length === before) report('PASS', 'agent-hooks', 'no hooks, plugins or hook switch-off in .claude settings, no .codex/ folder');
}

function checkSecrets(files, allowed) {
  const counts = { scanned: 0, lockfiles: 0, binary: 0, allowed: 0 };
  const before = results.length;
  const used = new Set();
  for (const path of files) {
    if (lockfiles.has(posix.basename(path))) {
      counts.lockfiles++;
      continue;
    }
    let text;
    try {
      if (!lstatSync(join(root, path)).isFile()) continue;
      text = readText(path);
    } catch (error) {
      // A tracked file deleted from the working tree is skipped.
      if (error.code !== 'ENOENT') report('BLOCKED', 'secrets', `${path} cannot be read (${error.code ?? error.message})`, fixes.read);
      continue;
    }
    if (text === null) {
      counts.binary++;
      continue;
    }
    counts.scanned++;
    text.split('\n').forEach((line, index) => {
      const matches = kinds.flatMap(([kind, pattern]) => [...line.matchAll(pattern)].map((match) => [kind, match]));
      for (const [kind, match] of matches.sort(([, a], [, b]) => a.index - b.index)) {
        const sha256 = createHash('sha256').update(match[0]).digest('hex');
        const entry = allowed.findIndex((allow) => allow.path === path && allow.kind === kind && allow.sha256 === sha256);
        if (entry >= 0) {
          used.add(entry);
          counts.allowed++;
        } else report('FAIL', 'secrets', `${path}:${index + 1}:${match.index + 1}: ${kind}`, fixes.secret);
      }
    });
  }
  allowed.forEach((allow, index) => {
    if (!used.has(index)) report('FAIL', 'secrets', `${config} allows ${article(allow.kind)} ${allow.kind} in ${allow.path} that isn't there`, fixes.stale);
  });
  if (!counts.scanned) report('INVALID', 'secrets', `${counts.scanned} files scanned`, fixes.empty);
  else if (results.length === before)
    report('PASS', 'secrets', `${plural(counts.scanned, 'file')} scanned, ${plural(counts.lockfiles, 'lockfile')} and ${plural(counts.binary, 'binary file')} skipped, ${counts.allowed} allowed`);
}

// A Cargo dependency's spec: its version requirement, then where it comes from when that isn't crates.io.
function cargoSpec(dependency, manifest) {
  return [
    dependency.req,
    dependency.rename && `package=${dependency.name}`,
    dependency.path && `path=${toPosix(relative(dirname(join(root, manifest)), dependency.path)) || '.'}`,
    dependency.source?.startsWith('git+') && dependency.source,
    dependency.registry && `registry=${dependency.registry}`,
  ].filter(Boolean).join(' ');
}

function checkDeps(files, listed) {
  const before = results.length;
  const declared = new Map(), read = new Set(), unread = new Set();
  let packageFiles = 0, crates = 0, cargoBlocked = false;
  for (const manifest of files.filter((path) => posix.basename(path) === 'package.json')) {
    let json;
    try {
      json = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      unread.add(manifest);
      if (error.code) report('BLOCKED', 'deps', `${manifest} cannot be read (${error.code})`, fixes.read);
      else report('INVALID', 'deps', `${manifest}: ${error.message}`, fixes.dep);
      continue;
    }
    packageFiles++;
    read.add(manifest);
    for (const section of npmSections)
      for (const [name, spec] of Object.entries(json[section] ?? {})) declared.set(JSON.stringify([manifest, section, name]), typeof spec === 'string' ? spec : JSON.stringify(spec));
  }
  // Workspace roots come first, so a member that one run already read isn't read again. A manifest
  // under vendor/ is an upstream crate's own, copied whole to carry a patch (#390: gpui-pre); its
  // dependencies are upstream's, not this repo's, so the rule names the copy and reads nothing from it.
  const vendored = files.filter((path) => posix.basename(path) === 'Cargo.toml' && path.startsWith('vendor/') && path.split('/').length === 3);
  for (const manifest of vendored) report('NOTE', 'deps', `${manifest} is a vendored upstream crate; its dependencies are upstream's`);
  const cargoManifests = files.filter((path) => posix.basename(path) === 'Cargo.toml' && !path.startsWith('vendor/') && existsSync(join(root, path))).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  for (const manifest of cargoManifests) {
    if (read.has(manifest)) continue;
    if (cargoBlocked) {
      unread.add(manifest);
      continue;
    }
    const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline', '--manifest-path', join(root, manifest)], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
      unread.add(manifest);
      if (result.error) {
        cargoBlocked = true;
        report('BLOCKED', 'deps', `cargo metadata could not run (${spawnError(result.error)})`, fixes.cargo);
      } else report('INVALID', 'deps', `cargo metadata could not read ${manifest}: ${result.stderr.trim().split('\n').at(-1)}`, fixes.dep);
      continue;
    }
    read.add(manifest);
    for (const pkg of JSON.parse(result.stdout).packages) {
      const path = toPosix(relative(root, realpathSync(pkg.manifest_path)));
      if (path.startsWith('..')) continue;
      crates++;
      read.add(path);
      for (const dependency of pkg.dependencies) {
        const section = `${dependency.target ? `target.'${dependency.target}'.` : ''}${dependency.kind ? `${dependency.kind}-` : ''}dependencies`;
        declared.set(JSON.stringify([path, section, dependency.rename ?? dependency.name]), cargoSpec(dependency, path));
      }
    }
  }
  // A Lean toolchain pin and a Lake package's requires are dependencies too (#684): the pin by its release, each
  // require by everything its entry says.
  for (const manifest of files.filter((path) => ['lean-toolchain', 'lakefile.toml', 'lakefile.lean'].includes(posix.basename(path)))) {
    let text;
    try {
      text = readFileSync(join(root, manifest), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      unread.add(manifest);
      report('BLOCKED', 'deps', `${manifest} cannot be read (${error.code})`, fixes.read);
      continue;
    }
    read.add(manifest);
    if (posix.basename(manifest) === 'lean-toolchain') {
      const pin = text.split('\n')[0].trim(), at = pin.lastIndexOf(':');
      declared.set(JSON.stringify([manifest, 'toolchain', at < 0 ? pin : pin.slice(0, at)]), at < 0 ? '' : pin.slice(at + 1));
    } else if (manifest.endsWith('.toml')) {
      for (const block of text.split(/^\[\[require\]\]\s*$/m).slice(1)) {
        const entry = block.split(/^\[/m)[0].trim().split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
        const name = entry.find((line) => /^name\s*=/.test(line))?.replace(/^name\s*=\s*/, '').replace(/"/g, '') ?? '(unnamed)';
        declared.set(JSON.stringify([manifest, 'require', name]), entry.filter((line) => !/^name\s*=/.test(line)).join(' '));
      }
    } else {
      for (const m of text.matchAll(/^require\s+"?([^\s"]+)"?(.*)$/gm)) declared.set(JSON.stringify([manifest, 'require', m[1]]), m[2].trim());
    }
  }
  if (!packageFiles && !crates && !results.slice(before).length) return report('INVALID', 'deps', 'no package.json or Cargo.toml was read', 'Run this from the repository root.');
  const allowed = new Map();
  for (const [manifest, sections] of Object.entries(listed))
    for (const [section, names] of Object.entries(sections))
      for (const [name, { spec }] of Object.entries(names)) allowed.set(JSON.stringify([manifest, section, name]), spec);
  for (const [key, spec] of declared) {
    const [manifest, section, name] = JSON.parse(key);
    if (!allowed.has(key)) report('FAIL', 'deps', `${manifest} ${section} ${name} ${spec} is not in ${config}`, fixes.dep);
    else if (allowed.get(key) !== spec) report('FAIL', 'deps', `${manifest} ${section} ${name} is ${spec}; ${config} allows ${allowed.get(key)}`, fixes.dep);
  }
  for (const [key] of allowed) {
    const [manifest, section, name] = JSON.parse(key);
    if (!declared.has(key) && !unread.has(manifest)) report('FAIL', 'deps', `${config} lists ${manifest} ${section} ${name}, which ${manifest} doesn't declare`, fixes.dep);
  }
  if (results.length === before) {
    report('PASS', 'deps', `${plural(packageFiles, 'package.json file')} and ${plural(crates, 'crate')} match ${config}`);
  }
}

// Each folder under packages/ and crates/ that git lists a file in has a README.md card with the four
// headings, and each deviation names a file its folder still has (#879). Which imports a package
// declares is the deps rule's, never the card's.
function checkCards(files) {
  const before = results.length;
  const counts = { packages: 0, crates: 0, deviations: 0 };
  const folders = [...new Set(files.filter((path) => /^(packages|crates)\/[^/]+\//.test(path)).map((path) => path.split('/').slice(0, 2).join('/')))].sort();
  for (const folder of folders) {
    counts[folder.split('/')[0]]++;
    const card = `${folder}/README.md`;
    let text;
    try {
      text = readFileSync(join(root, card), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') report('FAIL', 'cards', `${folder} has no README.md card`, fixes.card);
      else report('BLOCKED', 'cards', `${card} cannot be read (${error.code})`, fixes.read);
      continue;
    }
    const lines = text.split('\n');
    const headings = new Map();
    let fenced = false;
    lines.forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      const heading = !fenced && line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
      if (heading) headings.set(heading[1].toLowerCase(), index);
    });
    for (const name of cardHeadings) if (!headings.has(name.toLowerCase())) report('FAIL', 'cards', `${card} has no "${name}" heading`, fixes.card);
    const start = headings.get('deviations');
    if (start === undefined) continue;
    for (let index = start + 1; index < lines.length && !/^#{1,6}\s/.test(lines[index]); index++) {
      const path = lines[index].match(/^\s*(?:[-*+]|\d+[.)])\s+`([^`]+)`/)?.[1];
      if (!path) continue;
      counts.deviations++;
      const inside = posix.normalize(path);
      if (inside.startsWith('../') || inside.startsWith('/') || !existsSync(join(root, folder, inside)))
        report('FAIL', 'cards', `${card}:${index + 1}: a deviation names ${path}, which ${folder} doesn't have`, fixes.deviation);
    }
  }
  if (results.length === before)
    report('PASS', 'cards', `${plural(counts.packages, 'package')} and ${plural(counts.crates, 'crate')} have cards with the four headings; ${plural(counts.deviations, 'deviation')}, each naming a file that exists`);
}

// Report only: lines added and removed against the merge base perf uses, never the exit status.
function noteSize() {
  let base;
  try {
    base = git('merge-base', 'HEAD', 'origin/main').trim();
  } catch {
    return report('NOTE', 'size', 'not measured: no origin/main to compare with (git fetch origin main)');
  }
  try {
    let added = 0, removed = 0;
    const counted = (path) => !lockfiles.has(posix.basename(path.replace(/[{}]/g, '').split(' => ').at(-1)));
    for (const row of git('diff', '--numstat', '--no-ext-diff', '--no-textconv', base).split('\n').filter(Boolean)) {
      const [plus, minus, path] = row.split('\t');
      if (plus !== '-' && counted(path)) [added, removed] = [added + Number(plus), removed + Number(minus)];
    }
    for (const path of new Set(git('ls-files', '-z', '--others', '--exclude-standard').split('\0').filter(Boolean))) {
      if (!counted(path) || !lstatSync(join(root, path)).isFile()) continue;
      const text = readText(path);
      if (text) added += text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    }
    const short = git('rev-parse', '--short', base).trim();
    const guideline = added > 400 ? "; over the guideline of about 400, so the PR says why it can't be split" : ' (guideline: about 400)';
    report('NOTE', 'size', `+${added} -${removed} handwritten lines against merge base ${short}, lockfiles and binary files excluded${guideline}`);
  } catch (error) {
    report('NOTE', 'size', `not measured: ${error.message}`);
  }
}

function readConfig() {
  let rules;
  try {
    rules = JSON.parse(readFileSync(join(root, config), 'utf8'));
  } catch (error) {
    return { error: error.code === 'ENOENT' ? `${config} is missing` : `${config}: ${error.code ? `cannot be read (${error.code})` : error.message}` };
  }
  const problems = [];
  const allowed = rules?.allowedFindings ?? [];
  if (!Array.isArray(allowed)) problems.push('allowedFindings is not a list');
  else allowed.forEach((entry, index) => {
    for (const field of ['path', 'kind', 'sha256', 'why']) if (typeof entry?.[field] !== 'string' || !entry[field].trim()) problems.push(`allowedFindings[${index}] has no ${field}`);
  });
  for (const [manifest, sections] of Object.entries(rules?.deps ?? {}))
    for (const [section, names] of Object.entries(sections ?? {}))
      for (const [name, entry] of Object.entries(names ?? {}))
        for (const field of ['spec', 'why']) if (typeof entry?.[field] !== 'string' || !entry[field].trim()) problems.push(`${manifest} ${section} ${name} has no ${field}`);
  return problems.length ? { error: `${config}: ${problems[0]}` } : { allowed, listed: rules.deps ?? {} };
}

checkWorkflows();
checkAgentHooks();
let files;
try {
  // Tracked files plus new files git doesn't ignore, as the working tree has them.
  files = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))];
} catch (error) {
  report('BLOCKED', 'secrets', error.message, fixes.git);
  report('BLOCKED', 'deps', error.message, fixes.git);
}
if (files) {
  const rules = readConfig();
  if (rules.error && !rules.error.endsWith('is missing')) report('INVALID', 'secrets', rules.error, fixes.config);
  else checkSecrets(files, rules.allowed ?? []);
  if (rules.error) report('INVALID', 'deps', rules.error, fixes.config);
  else checkDeps(files, rules.listed);
  checkCards(files);
  noteSize();
}
const order = ['FAIL', 'INVALID', 'BLOCKED', 'PASS', 'NOTE'];
for (const { line, fix } of results.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state))) console.log(fix ? `${line}\n  Fix: ${fix}` : line);
if (results.some(({ state }) => ['FAIL', 'INVALID', 'BLOCKED'].includes(state))) process.exitCode = 1;
