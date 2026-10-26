// The verdict table's proof lane (#684). Builds the Lean model in packages/verdicts/model with the toolchain
// lean-toolchain pins, installed under .lean/, and prints the axioms of each property theorem: a theorem resting on
// anything beyond Lean's standard three fails, and so does a build error, named by the declaration it is in.
//   node scripts/verdict-proofs.mjs                                    the lane
//   node scripts/verdict-proofs.mjs vectors --seed <n> --count <k>     the model's seeded claims, as JSON lines
// It never runs the agreement test; the lane in scripts/lanes.mjs runs that after it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const model = join(root, 'packages/verdicts/model');
const THEOREMS = ['verdict_closed', 'verdict_highest', 'verdict_never_pass', 'verdict_set_only', 'verdict_rises', 'late_read_stale']
  .map((name) => `Verdicts.${name}`);
const STANDARD = new Set(['propext', 'Quot.sound', 'Classical.choice']);

/** The pinned toolchain's lake, or a BLOCKED line naming the pin. */
function toolchain() {
  let pin;
  try {
    pin = readFileSync(join(root, 'lean-toolchain'), 'utf8').split('\n')[0].trim();
  } catch {
    return { blocked: 'BLOCKED toolchain: lean-toolchain is missing, so no toolchain is pinned\n  Fix: Restore lean-toolchain.' };
  }
  // elan's folder name for a toolchain: leanprover/lean4:v4.35.0 → leanprover--lean4---v4.35.0.
  const bin = join(root, '.lean/toolchains', pin.replace('/', '--').replace(':', '---'), 'bin');
  if (!existsSync(join(bin, 'lake')) || !existsSync(join(bin, 'lean'))) {
    return {
      blocked: `BLOCKED toolchain: ${pin} is not installed under .lean/\n`
        + `  Fix: Install it there, with no Lean on PATH used: curl -sSfL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | ELAN_HOME=$PWD/.lean sh -s -- -y --no-modify-path --default-toolchain ${pin}`,
    };
  }
  return { lake: join(bin, 'lake'), env: { ...clean(process.env), PATH: `${bin}:${process.env.PATH ?? ''}` } };
}
/** The environment without another Lean's settings. */
function clean(env) {
  const out = { ...env };
  for (const key of ['ELAN_HOME', 'ELAN_TOOLCHAIN', 'LEAN_PATH', 'LEAN_SYSROOT', 'LAKE_HOME', 'LAKE']) delete out[key];
  return out;
}

const DECLARATION = /^(?:@\[[^\]\n]*\]\s*)?(?:(?:private|protected|noncomputable|partial|nonrec)\s+)*(?:theorem|lemma|def|abbrev|instance|structure|inductive|axiom)\s+([^\s:({[]+)/;
/** The declaration a line of a model file sits in: the last one that starts at column 0 at or above it. */
function declarationAt(file, line) {
  let lines;
  try {
    lines = readFileSync(join(model, file), 'utf8').split('\n');
  } catch {
    return null;
  }
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = lines[i].match(DECLARATION);
    if (m) return m[1];
  }
  return null;
}

/** Builds the model and its generator; returns the FAIL lines, empty when it built. */
function build(lean) {
  const r = spawnSync(lean.lake, ['build'], { cwd: model, env: lean.env, encoding: 'utf8', maxBuffer: 2 ** 28 });
  if (r.status === 0) return { fails: [], log: '' };
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`;
  const fails = [];
  for (const line of log.split('\n')) {
    const m = line.match(/^error: (\S+\.lean):(\d+):\d+: (.*)$/);
    if (!m) continue;
    const name = declarationAt(m[1], Number(m[2]));
    fails.push(`FAIL build: ${name ? `${name} (${m[1]}:${m[2]})` : `${m[1]}:${m[2]}`}: ${m[3]}`);
  }
  if (!fails.length) fails.push(`FAIL build: lake build failed: ${log.trim().split('\n').at(-1) ?? `exit ${r.status}`}`);
  return { fails, log };
}
/** The pinned toolchain with the model built, or null once its BLOCKED or FAIL lines are printed. */
function built() {
  const lean = toolchain();
  if (lean.blocked) {
    console.log(lean.blocked);
    return null;
  }
  const { fails, log } = build(lean);
  if (fails.length) {
    for (const line of fails) console.log(line);
    console.error(log);
    return null;
  }
  return lean;
}

/** Each theorem's axioms, read with #print axioms. */
function axioms(lean) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-verdict-axioms-'));
  try {
    const file = join(dir, 'Axioms.lean');
    writeFileSync(file, `import Verdicts\n${THEOREMS.map((t) => `#print axioms ${t}`).join('\n')}\n`);
    const r = spawnSync(lean.lake, ['env', 'lean', file], { cwd: model, env: lean.env, encoding: 'utf8', maxBuffer: 2 ** 26 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const found = new Map();
    for (const m of out.matchAll(/'([^']+)' depends on axioms: \[([^\]]*)\]/g)) found.set(m[1], m[2].split(',').map((a) => a.trim()).filter(Boolean));
    for (const m of out.matchAll(/'([^']+)' does not depend on any axioms/g)) found.set(m[1], []);
    return { found, out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function lane() {
  const lean = built();
  if (!lean) return 1;
  const { found, out } = axioms(lean);
  let failed = false;
  for (const theorem of THEOREMS) {
    const bare = theorem.slice('Verdicts.'.length);
    const list = found.get(theorem);
    if (!list) {
      console.log(`FAIL axioms: ${bare} (${theorem}) wasn't found in the model`);
      failed = true;
      continue;
    }
    console.log(`AXIOMS ${theorem}: ${list.length ? list.join(', ') : 'none'}`);
    const extra = list.filter((a) => !STANDARD.has(a));
    if (extra.length) {
      console.log(`FAIL axioms: ${bare} (${theorem}) depends on ${extra.join(', ')}, beyond propext, Quot.sound and Classical.choice`);
      failed = true;
    }
  }
  if (failed) {
    console.error(out);
    return 1;
  }
  console.log(`PASS proofs: ${THEOREMS.length} theorems rest only on propext, Quot.sound and Classical.choice`);
  return 0;
}

function vectors(args) {
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const seed = Number(flag('--seed')), count = Number(flag('--count'));
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31 || !Number.isInteger(count) || count < 0) {
    console.log('INVALID vectors: give --seed <a whole number in [0, 2^31)> and --count <a whole number>');
    return 1;
  }
  const lean = built();
  if (!lean) return 1;
  const r = spawnSync(join(model, '.lake/build/bin/vectors'), [String(seed), String(count)], { cwd: model, env: lean.env, stdio: ['ignore', 'inherit', 'inherit'] });
  return r.status ?? 1;
}

const [command, ...rest] = process.argv.slice(2);
process.exitCode = command === 'vectors' ? vectors(rest) : command === undefined ? lane() : (console.log(`INVALID verdict proofs: unknown command ${command}`), 1);
