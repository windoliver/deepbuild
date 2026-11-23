// #2149 AC2 #2149.976fa716: the commit's diff is empty under `git diff -w --ignore-blank-lines` apart from line breaks
// rustfmt moved.
// Run: node --test tests/acceptance/2149/ac2-commit-diff.test.mjs   (README.md beside this file; two to ten minutes)
//
// "The commit" is the Scope's "one commit that is only `cargo fmt --all`": the newest commit HEAD holds and this suite's
// base doesn't, not a merge, whose subject names #2149 and `cargo fmt --all`. The base is main as this suite was written
// at it, still unformatted, so the commit that formats main comes after it; commits before it are earlier rounds' and
// never judged. What rustfmt moves is what `cargo fmt --all` makes of the commit's
// parent, run here on a copy of the parent's Rust sources and manifests with the toolchain the parent pins, again and
// again until a run changes none of the files the commit changes (rustfmt can take two runs to settle on a file). Each
// file the commit changes must be, under `git diff --no-index -w --ignore-blank-lines`, the same as one run's version
// of it. The commit's version of a file is read from the checkout when HEAD still holds the commit's version of it, and
// from git when a later commit, such as a merge of main, changed it. No commit to judge fails the test; a checkout with
// no history of its own, or a parent rustfmt can't format or settle, reads INCONCLUSIVE.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { MINUTE, ROOT, cargo, childEnv, git, inconclusive, makeBox, rustfmtAnswers, run, shown, world } from './helpers.mjs';

// The criterion's tag: `#2149.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
const AC2 = 'AC2 #2149.976fa716';

/** The most runs of `cargo fmt --all` the parent gets to settle on the commit's files. */
const RUNS = 4;
/** Main as this suite was written at it (README.md): `cargo fmt --all -- --check` fails there. */
const BASE = 'b6317234f38883115f7894b91d61d044be0da798';

const said = (result) => String(result.stderr || result.error?.message || '').trim().split('\n')[0];
const blobId = (rev, path) => {
  const result = git(['rev-parse', '--verify', '-q', `${rev}:${path}`]);
  return result.status === 0 ? result.stdout.trim() : null;
};
const blob = (rev, path) => {
  const result = git(['cat-file', 'blob', `${rev}:${path}`], { encoding: 'buffer' });
  return result.status === 0 ? result.stdout : null;
};
const read = (folder, path) => (existsSync(join(folder, path)) ? readFileSync(join(folder, path)) : null);
const head = (text, characters = 8000) => (text.length > characters ? `${text.slice(0, characters)}…` : text);

test(`${AC2} each file the newest commit since this suite's base whose subject names #2149 and \`cargo fmt --all\` changes is, under \`git diff -w --ignore-blank-lines\`, what \`cargo fmt --all\` makes of its parent's`, { timeout: 30 * MINUTE }, (t) => {
  const top = git(['rev-parse', '--show-toplevel']);
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== ROOT) inconclusive(`the checkout has no git history of its own, so there is no commit to read (${top.status === 0 ? `git finds ${top.stdout.trim()}` : said(top)}); run this in a clone or a worktree`);
  if (git(['cat-file', '-e', `${BASE}^{commit}`]).status !== 0) inconclusive(`this suite's base ${BASE} isn't in the checkout's repository, so the commits since it can't be told apart`);

  // The commit.
  const log = git(['log', '--no-merges', '--format=%H%x09%s', '-F', '--grep=cargo fmt --all', 'HEAD', `^${BASE}`]);
  if (log.status !== 0) inconclusive(`git log can't read the checkout's history: ${said(log)}`);
  const row = log.stdout.split('\n').find((line) => line.includes('\t') && /#2149\b/.test(line.slice(line.indexOf('\t'))) && line.slice(line.indexOf('\t')).includes('cargo fmt --all'));
  assert.ok(row, `no commit HEAD holds since this suite's base ${BASE.slice(0, 9)}, other than a merge, has a subject naming #2149 and \`cargo fmt --all\`, so there is no formatting commit whose diff could be judged`);
  const [commit, subject] = row.split('\t');
  const parent = git(['rev-parse', '--verify', '-q', `${commit}^1`]).stdout?.trim();
  if (!parent) inconclusive(`the parent of ${commit} isn't in this repository (a shallow clone?), so what rustfmt makes of it can't be read`);
  const changed = git(['diff', '--name-only', '-z', '--no-renames', parent, commit]);
  if (changed.status !== 0) inconclusive(`git diff can't list what ${commit} changes: ${said(changed)}`);
  const paths = changed.stdout.split('\0').filter(Boolean);

  // The commit's version of each file it changes: the checkout's where HEAD still holds it as the commit left it.
  const box = makeBox(t, 'ac2');
  const fromCheckout = new Set();
  const own = new Map(paths.map((path) => {
    const id = blobId(commit, path);
    if (id === null) return [path, null]; // the commit removes it
    if (blobId('HEAD', path) !== id) return [path, blob(commit, path)];
    fromCheckout.add(path);
    return [path, read(ROOT, path)];
  }));

  // What `cargo fmt --all` makes of the parent: its Rust sources and manifests (every *.rs and *.toml file, which is all
  // cargo fmt reads) in a folder of the test's own, formatted until a run changes none of the commit's files. Each run's
  // version of those files is kept; the parent's own counts only where rustfmt leaves a file as it is.
  const formatted = join(box, 'parent');
  mkdirSync(formatted);
  const archive = git(['archive', '--format=tar', '-o', join(box, 'parent.tar'), parent, '--', '*.rs', '*.toml']);
  if (archive.status !== 0) inconclusive(`git archive can't copy ${parent}'s Rust sources: ${said(archive)}`);
  const unpacked = run('tar', ['-xf', join(box, 'parent.tar'), '-C', formatted], { cwd: box, env: childEnv(), timeout: 10 * MINUTE, log: join(box, 'tar.log') });
  if (unpacked.status !== 0) inconclusive(`tar can't unpack ${parent}'s Rust sources: ${shown(unpacked)}`);
  rustfmtAnswers(formatted, box, 'parent');
  const version = (path) => read(formatted, path) ?? blob(parent, path);
  const versions = [];
  let last = new Map(paths.map((path) => [path, version(path)]));
  for (let runs = 1; ; runs += 1) {
    const fmt = cargo(['fmt', '--all'], { cwd: formatted, env: childEnv(), log: join(box, `fmt-${runs}.log`) });
    world(`cargo fmt --all on the commit's parent (run ${runs})`, fmt);
    if (fmt.status !== 0) inconclusive(`cargo fmt --all can't format the commit's parent ${parent}, so what rustfmt moves there is unknown: ${shown(fmt).split(`${formatted}/`).join('')}`);
    const now = new Map(paths.map((path) => [path, version(path)]));
    const settled = paths.every((path) => (now.get(path) === null ? last.get(path) === null : last.get(path) !== null && now.get(path).equals(last.get(path))));
    if (runs > 1 && settled) break;
    versions.push(now);
    last = now;
    if (runs === RUNS) inconclusive(`cargo fmt --all still changes the commit's files on the parent ${parent} after ${RUNS} runs, so what rustfmt moves there is unsettled`);
  }

  // A file passes when some run's version and the commit's differ in nothing `git diff -w --ignore-blank-lines` shows.
  const compare = (name, path, left, right) => {
    const folder = join(box, 'compare', name);
    for (const [side, bytes] of [['rustfmt', left], ['commit', right]]) {
      mkdirSync(join(folder, side), { recursive: true });
      if (bytes === null) continue;
      mkdirSync(dirname(join(folder, side, path)), { recursive: true });
      writeFileSync(join(folder, side, path), bytes);
    }
    const diff = git(['diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '-w', '--ignore-blank-lines', '--', 'rustfmt', 'commit'], { cwd: folder });
    if (diff.status !== 0 && diff.status !== 1) inconclusive(`git diff --no-index can't compare two versions of ${path}: ${said(diff)}`);
    return diff.stdout;
  };
  const failing = paths.filter((path, index) => versions.every((run, at) => compare(`${index}-${at}`, path, run.get(path), own.get(path)) !== ''));
  const shownDiff = failing.map((path) => compare(`${paths.indexOf(path)}-last`, path, versions.at(-1).get(path), own.get(path))).join('');

  t.diagnostic(`judged ${commit} ("${subject}"), parent ${parent}: ${paths.length} files changed, ${fromCheckout.size} read from the checkout, ${paths.length - fromCheckout.size} from the commit; cargo fmt --all made ${versions.length} version${versions.length === 1 ? '' : 's'} of them, and one more run changed none`);
  assert.deepEqual(failing, [], `${commit} ("${subject}") changes ${failing.length} of its ${paths.length} files in more than rustfmt moves: each differs, under \`git diff -w --ignore-blank-lines\`, from every version \`cargo fmt --all\` makes of its parent ${parent} (${versions.length} runs; read from the checkout: ${failing.filter((path) => fromCheckout.has(path)).length} of these). Against rustfmt's last version (rustfmt/) the commit's (commit/) reads:\n${head(shownDiff)}`);
});
