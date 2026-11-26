// The alone lint (#3066; docs/parallel-proof.md, section 7): every entry of lanes.mjs's `alone` names one reason in
// `aloneReasons`, `binary`, `timing` or `shared: <resource>`, and an entry leaves `alone` only when its reason on the
// merge base was `binary` and none of its test files that left, or a helper they import, still reads target/, starts
// cargo, starts a hub, which runs deep-hook from its checkout's target/, or runs a script of scripts/ or a child
// Vitest, which may do any of those: such files wait for a blind redraft that reads DEEP_BIN_DIR. On a merge base
// older than the reasons, an entry is judged by the reason this checkout names, and one that names none moves on the
// signature its lanes.mjs edit needs: the owner ruled it had no reason to be alone. It reads the names
// the files spell out; a start it can't see there rests on the signature the lanes.mjs edit needs. A folder that is
// alone by its own lane.json isn't read from the merge base: the guard judges a lane file's removal. One
// `FAIL alone: <entry> ...` line per finding, or one `PASS alone` line; exit 1 on a finding. With no merge base to
// read (no git, no origin/main) the moves can't be judged: `BLOCKED alone`, exit 2.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { alone, aloneReasons, listed } from './lanes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const REASON = /^(?:binary|timing|shared: \S.*)$/;
const READS = /target\/(?:debug|release)\b|['"`]target['"`]\s*,\s*['"`](?:debug|release)['"`]|['"`]cargo['"`]|['"`]cargo (?:build|run|test)\b|packages\/cli\/dist\/main\.js|['"`]hub['"`],\s*['"`]run['"`]|\bhub run\b|['"`]target['"`]|\bscripts\/[\w-]+\.mjs|\bscripts\/[\w-]+['"`]|['"`]scripts['"`]|\bvitest\.mjs/;
const findings = [];

for (const entry of alone) {
  const reason = aloneReasons[entry];
  if (reason === undefined) findings.push(`${entry} names no reason\n  Fix: name its reason in scripts/lanes.mjs's aloneReasons: binary, timing or shared: <resource>; a folder alone by its own lane.json names it as the first words of its why.`);
  else if (!REASON.test(reason)) findings.push(`${entry} names the reason ${JSON.stringify(reason)}, which is none of binary, timing and shared: <resource>\n  Fix: name one of the three in scripts/lanes.mjs's aloneReasons.`);
}

/** The merge base's `alone` and `aloneReasons`, from its own scripts/ unpacked apart; null when it can't be read. */
function mergeBase() {
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 ** 28 });
  const base = git('merge-base', 'HEAD', 'origin/main');
  if (base.status !== 0) return null;
  const dir = mkdtempSync(join(tmpdir(), 'deep-alone-'));
  try {
    const tar = join(dir, 'scripts.tar');
    if (git('archive', '-o', tar, base.stdout.trim(), 'scripts').status !== 0 || spawnSync('tar', ['-xf', tar, '-C', dir]).status !== 0) return null;
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
    const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(dir, 'scripts/lanes.mjs')).href)}); console.log(JSON.stringify({ alone: lanes.alone, reasons: lanes.aloneReasons ?? null }));`;
    const read = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, encoding: 'utf8', maxBuffer: 2 ** 28 });
    return read.status === 0 ? JSON.parse(read.stdout) : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const testsOf = (path) => {
  const at = join(root, path);
  if (!existsSync(at)) return [];
  if (statSync(at).isFile()) return /\.test\.(?:mjs|js|ts)$/.test(path) ? [path] : [];
  return readdirSync(at, { withFileTypes: true }).flatMap((item) => (['node_modules', 'twins'].includes(item.name) ? [] : testsOf(join(path, item.name))));
};
/** The first file among `tests` and the helpers they import by a relative path that reads target/ or starts cargo. */
function reader(tests) {
  const seen = new Set(tests), queue = [...tests];
  while (queue.length) {
    const file = queue.pop(), text = readFileSync(join(root, file), 'utf8');
    const found = text.match(READS);
    if (found) return `${file} still reads ${found[0]}`;
    for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const to = normalize(join(dirname(file), spec));
      const next = [to, to.replace(/\.js$/, '.ts'), `${to}.ts`, `${to}.mjs`].find((path) => statSync(join(root, path), { throwIfNoEntry: false })?.isFile());
      if (next && !seen.has(next) && !next.startsWith('scripts/')) { seen.add(next); queue.push(next); }
    }
  }
  return null;
}

const base = mergeBase();
if (base) {
  for (const entry of base.alone) {
    // An entry whose every file is still listed, by a wider entry or by narrower ones, has not left; nor has one whose files are gone.
    const left = testsOf(entry.replace(/\/$/, '')).filter((file) => !listed(alone, file));
    if (!left.length) continue;
    if (!base.reasons && !(entry in aloneReasons)) continue;
    const reason = (base.reasons ?? aloneReasons)[entry];
    if (reason !== 'binary') findings.push(`${entry} left the alone list, and its reason on the merge base is ${reason ?? 'not named'}: only a binary entry moves\n  Fix: put it back in scripts/lanes.mjs's alone.`);
    const still = reason === 'binary' ? reader(left) : null;
    if (still) findings.push(`${entry} left the alone list while ${still}\n  Fix: put it back in scripts/lanes.mjs's alone until a blind redraft of its files reads their binaries from DEEP_BIN_DIR.`);
  }
}

for (const finding of findings) console.log(`FAIL alone: ${finding}`);
if (!base) console.log('BLOCKED alone: the merge base with origin/main, or its scripts/lanes.mjs, could not be read, so no move out of alone was judged\n  Fix: run it in a git checkout that has origin/main.');
else if (!findings.length) console.log(`PASS alone: ${alone.length} entries each name their reason`);
process.exit(findings.length ? 1 : base ? 0 : 2);
