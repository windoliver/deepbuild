// The Lean 4 runner (#685). It runs the pinned toolchain's own lake, lean and leanexport, never elan, so a missing
// version is missing and never installed. Its oracle is `lake comparator`: a challenge module of the approved
// statements, each with a `sorry` body, judged against the checkout's own build. The runner exports both modules
// itself, into the working copy's build folder, so an export file in the commit is never read. Lean builds a
// `sorry` with a warning and exits 0, so the build's exit status is never the result.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { CheckContext, Failure } from '@deepbuild/conformance';
import {
  approve, cantFail, clock, escape, exec, finish, LEAN_FLAGS, lineAt, Missing, missingRun, Overran, overranRun, redact, sources, toolsOf,
  unfoundCause, workCopy,
} from './run.js';
import type { Exec, Locate } from './run.js';
import type { Cause, Checked, Fault, MutantReport, ProofSpec } from './types.js';

/** The axioms every Lean proof may rest on. */
const STANDARD = ['propext', 'Quot.sound', 'Classical.choice'];
const CHALLENGE = 'DeepProofChallenge';
const SOLUTION = 'DeepProofSolution';
/** Mutants tried per check, at most. */
const MUTANTS = 12;

type Lake = (args: string[], into?: string) => Exec;
/** Where a theorem is declared: its file, the line of `theorem <name>`, and the last line before the next declaration. */
interface Decl { file: string; line: number; last: number }
interface Located { file: string; line: number; message: string }

/** A theorem's signature, from `theorem <name>` up to the ` :=` before its proof; an axiom's whole declaration. */
export const locateLean: Locate = (text, theorem) => {
  const m = new RegExp(`^[ \\t]*(?:(?:private|protected) )?((?:theorem|lemma|axiom) ${escape(theorem.split('.').pop()!)})(?=[\\s(:{[])`, 'm').exec(text);
  if (!m) return null;
  const start = m.index + m[0].length - m[1]!.length;
  const end = text.indexOf(m[1]!.startsWith('axiom') ? '\n' : ' :=', start);
  return { start, text: text.slice(start, end < 0 ? text.length : end) };
};

/** The pinned toolchain's bin folder in elan's home; elan itself never runs, so nothing is installed. */
function toolchain(spec: ProofSpec, fault: Fault): string {
  const toolchains = join(process.env.ELAN_HOME || join(homedir(), '.elan'), 'toolchains');
  const want = spec.toolchain.replace('/', '--').replace(':', '---');
  const has = (name: string): boolean => ['lake', 'lean', 'leanexport'].every((x) => existsSync(join(toolchains, name, 'bin', x)));
  if (has(want)) return join(toolchains, want, 'bin');
  const other = fault === 'any-version' && existsSync(toolchains) ? readdirSync(toolchains).sort().find(has) : undefined;
  if (other) return join(toolchains, other, 'bin');
  throw new Missing(`${spec.toolchain} is not installed: elan has no ${want} toolchain, and a proof check never installs one`);
}

const moduleOf = (file: string): string => file.replace(/\.lean$/, '').split('/').join('.');
const errorsOf = (out: string): Located[] =>
  [...out.matchAll(/^error: (?:\.\/)*(\S+?\.lean):(\d+):\d+: (.*)$/gm)].map((m) => ({ file: m[1]!, line: Number(m[2]), message: m[3]! }));
const inside = (d: Decl | undefined, e: Located): boolean => !!d && e.file === d.file && e.line >= d.line && e.line <= d.last;
function declOf(work: string, spec: ProofSpec, theorem: string): Decl | undefined {
  const file = spec.statements.find((s) => s.theorem === theorem)?.file;
  const text = file && existsSync(join(work, file)) ? readFileSync(join(work, file), 'utf8') : '';
  const at = locateLean(text, theorem);
  if (!file || !at) return undefined;
  const lines = text.split('\n');
  const line = lineAt(text, at.start);
  let last = line;
  while (last < lines.length && !/^\S/.test(lines[last]!)) last++;
  return { file, line, last };
}

/**
 * Each theorem's axioms as the checker prints them: a copy of the file that declares them, elaborated with
 * `#print axioms` after it, so a file with errors still reports every theorem; and the file's errors.
 */
function axioms(work: string, file: string, theorems: string[], lake: Lake): { used: Map<string, string[]>; errors: Located[] } {
  const probe = 'DeepProofProbe.lean';
  writeFileSync(join(work, probe), `${readFileSync(join(work, file), 'utf8')}\n${theorems.map((t) => `#print axioms ${t}`).join('\n')}\n`);
  let r: Exec;
  try { r = lake(['env', 'lean', '--json', probe]); } finally { rmSync(join(work, probe), { force: true }); }
  const used = new Map<string, string[]>();
  const errors: Located[] = [];
  for (const l of r.stdout.split('\n').filter((x) => x.startsWith('{'))) {
    const m = JSON.parse(l) as { severity?: string; pos?: { line?: number }; data?: string };
    const data = m.data ?? '';
    const uses = /^'(.+?)' depends on axioms: \[([\s\S]*)\]\s*$/.exec(data);
    const none = /^'(.+?)' does not depend on any axioms/.exec(data);
    if (uses) used.set(uses[1]!, uses[2]!.split(',').map((a) => a.trim()).filter(Boolean));
    else if (none) used.set(none[1]!, []);
    else if (m.severity === 'error') errors.push({ file, line: m.pos?.line ?? 0, message: data });
  }
  return { used, errors };
}

/** The checker's run on a working copy: the pinned toolchain, the lake that runs under the deadline, its version. */
function setup(spec: ProofSpec, fault: Fault, work: string, ctx: CheckContext): { lake: Lake; version: string } {
  const bin = toolchain(spec, fault);
  const at = clock(ctx);
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` };
  const version = /version (\d[^\s,)]*)/.exec(exec(join(bin, 'lean'), ['--version'], work, env, at).out)?.[1] ?? 'unknown';
  return { lake: (args, into) => exec(join(bin, 'lake'), args, work, env, at, into), version };
}

export function lean(spec: ProofSpec, ctx: CheckContext, fault: Fault): Checked {
  const work = workCopy(ctx.checkout);
  try {
    const { lake, version } = setup(spec, fault, work, ctx);
    const read = sources(work, ['.lean', 'lakefile.toml', 'lakefile.lean', 'lake-manifest.json', 'lean-toolchain']);
    const { unfound, proposals } = approve(work, spec, locateLean, false);
    const found = spec.theorems.filter((t) => !unfound.includes(t));
    const decls = new Map(found.map((t) => [t, declOf(work, spec, t)]));
    const causes: Cause[] = unfound.map(unfoundCause);
    const failures: Failure[] = [];
    const evidence = [`lean ${version}`];
    const done = (receipt: string, testsRun = 0): Checked =>
      finish({ testsRun, failures, causes, proposals, tools: toolsOf(spec, version), read, evidence, receipt: `comparator on Lean ${version}: ${receipt}`, smallest: null });

    // The build is never the result, but a failed one is the checker refusing at the file and line it names.
    const built = lake(['build']);
    if (built.status !== 0) {
      evidence.push(redact(built.out, work));
      for (const e of errorsOf(built.out)) {
        const t = found.find((x) => inside(decls.get(x), e));
        failures.push({ test: t ?? spec.theorems[0] ?? '(build)', file: e.file, line: e.line, stack: null, assertion: !!t, message: e.message });
      }
      if (!failures.length) failures.push({ test: spec.theorems[0] ?? '(build)', file: 'lakefile.toml', line: 1, stack: null, assertion: false, message: built.out.trim().split('\n').pop() ?? 'lake build failed' });
      return done('the build failed, so comparator judged nothing');
    }
    if (!found.length) return done('no theorem to judge');

    // The challenge: the approved statements, axioms the check permits first, each theorem with a `sorry` body.
    const statements = spec.statements.filter((s) => spec.assumptions.includes(s.theorem) || found.includes(s.theorem))
      .sort((a, b) => Number(spec.assumptions.includes(b.theorem)) - Number(spec.assumptions.includes(a.theorem)));
    const files = [...new Set(statements.map((s) => s.file))];
    const imports = [...new Set(files.flatMap((f) => readFileSync(join(work, f), 'utf8').match(/^import .*$/gm) ?? []))];
    const declared = statements.map((s) => {
      const ns = s.theorem.includes('.') ? s.theorem.slice(0, s.theorem.lastIndexOf('.')) : '';
      const body = s.text.startsWith('axiom') ? s.text : `${s.text} := by sorry`;
      return ns ? `namespace ${ns}\n${body}\nend ${ns}` : body;
    });
    const lib = join(work, '.lake', 'build', 'lib', 'lean');
    const exports = join(work, '.lake', 'deep-proof');
    mkdirSync(lib, { recursive: true });
    mkdirSync(exports, { recursive: true });
    const modules: [string, string][] = [[CHALLENGE, [...imports, '', ...declared].join('\n')], [SOLUTION, files.map((f) => `import ${moduleOf(f)}`).join('\n')]];
    for (const [name, text] of modules) {
      writeFileSync(join(work, `${name}.lean`), `${text}\n`);
      const c = lake(['env', 'lean', '-o', join(lib, `${name}.olean`), `${name}.lean`]);
      if (c.status !== 0) throw new Missing(`the ${name} module didn't build: ${redact(c.out, work).trim().split('\n').pop() ?? ''}`);
      const e = lake(['env', 'leanexport', name], join(exports, `${name}.ndjson`));
      if (e.status !== 0) throw new Missing(`leanexport couldn't export ${name}: ${e.out.trim().split('\n').pop() ?? ''}`);
      evidence.push(`${name} export sha256:${createHash('sha256').update(readFileSync(join(exports, `${name}.ndjson`))).digest('hex')}`);
    }
    const config = join(exports, 'comparator.json');
    writeFileSync(config, JSON.stringify({ challenge_module: CHALLENGE, solution_module: SOLUTION, theorem_names: found, permitted_axioms: [...STANDARD, ...spec.assumptions] }));
    const c = lake(['comparator', `--config=${config}`, ...modules.map(([name], i) => `--${i ? 'solution' : 'challenge'}-from-export=${join(exports, `${name}.ndjson`)}`), ...LEAN_FLAGS]);
    evidence.push(redact(c.out, work));
    if (c.status === 2) throw new Missing(`comparator could not start: ${c.out.trim().split('\n').pop() ?? ''}`);
    const said = c.out.split('\n').find((l) => l.startsWith('error')) ?? '';
    const illegal = /Illegal axiom detected: '(.+?)'/.exec(said)?.[1];
    const mismatch = /statement do not match: '(.+?)'/.exec(said)?.[1];
    if (illegal) {
      // comparator names the axiom, not the theorem: the checker's own `#print axioms` says which theorems rest on it.
      const using = files.flatMap((f) => {
        const { used } = axioms(work, f, found.filter((t) => decls.get(t)?.file === f), lake);
        return found.filter((t) => used.get(t)?.includes(illegal));
      });
      for (const t of using.length ? using : found) causes.push({ theorem: t, why: 'escape', line: `${t} rests on ${illegal}, an axiom the check doesn't permit (comparator: ${said})` });
    } else if (mismatch) {
      causes.push({ theorem: mismatch, why: 'statement', line: `${mismatch} is judged on its approved statement, and the checkout's doesn't match it (comparator: ${said})` });
    } else if (c.status !== 0) {
      // A kernel rejection: the checker refused the theorems it names, or all of them, at their declarations.
      for (const t of found.filter((x) => said.includes(x)).length ? found.filter((x) => said.includes(x)) : found) {
        const d = decls.get(t);
        failures.push({ test: t, file: d?.file ?? 'lakefile.toml', line: d?.line ?? 1, stack: null, assertion: true, message: said || `comparator exited ${String(c.status)}` });
      }
    }
    const where = process.platform === 'darwin' ? 'unsandboxed (macOS has no bubblewrap), in a hermetic run of the check\'s temporary checkout' : 'in comparator\'s sandbox';
    return done(`${found.join(', ')} judged against the approved statements, on exports the runner built, ${where}`, found.length);
  } catch (error) {
    if (error instanceof Overran) return overranRun(spec, ctx.deadline);
    if (error instanceof Missing) return missingRun(spec, error.message);
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Mutants of a target's definition: each operator, numeral and boolean of its body swapped, one at a time. */
const OPS: Readonly<Record<string, string[]>> = {
  '+': ['-', '*'], '-': ['+'], '*': ['+'], '/': ['*'], '%': ['*'], '<': ['≤'], '≤': ['<'], '>': ['≥'], '≥': ['>'], '<=': ['<'], '>=': ['>'],
  '&&': ['||'], '||': ['&&'], '==': ['!='], '!=': ['=='], '∧': ['∨'], '∨': ['∧'],
};
function mutantsOf(text: string, file: string, symbol: string): { name: string; text: string; def: [number, number] }[] {
  const m = new RegExp(`^[ \\t]*(?:@\\[[^\\]\\n]*\\][ \\t]*)?(?:(?:private|protected|noncomputable|partial) )*def ${escape(symbol.split('.').pop()!)}(?=[\\s(:{[])`, 'm').exec(text);
  if (!m) return [];
  const stop = text.slice(m.index + m[0].length).search(/\n(?=\S)/);
  const to = stop < 0 ? text.length : m.index + m[0].length + stop;
  const from = m.index + m[0].length;
  const lines = text.split('\n');
  const def: [number, number] = [lineAt(text, m.index), lineAt(text, to)];
  const out: { name: string; text: string; def: [number, number] }[] = [];
  for (const t of text.slice(from, to).matchAll(/(?<=\s)(<=|>=|&&|\|\||==|!=|[-+*/%<>≤≥∧∨])(?=\s)|\b(\d+)\b|\b(true|false)\b/g)) {
    const at = from + t.index;
    const swaps = t[1] ? OPS[t[1]] ?? [] : t[2] ? [String(Number(t[2]) + 1)] : [t[3] === 'true' ? 'false' : 'true'];
    for (const swap of swaps) {
      const mutated = `${text.slice(0, at)}${swap}${text.slice(at + t[0].length)}`;
      const line = lineAt(text, at);
      out.push({ name: `${file}:${line}: \`${lines[line - 1]!.trim()}\` → \`${mutated.split('\n')[line - 1]!.trim()}\``, text: mutated, def });
    }
  }
  return out;
}

/**
 * Each theorem re-checked on the mutants of its targets: the mutant built, then the checker's axioms for the
 * theorem. A mutant whose own definition doesn't build tests nothing; a theorem the checker refuses there, or that
 * rests on an axiom outside the permitted ones, fails on it.
 */
export function leanMutants(spec: ProofSpec, ctx: CheckContext): MutantReport {
  const work = workCopy(ctx.checkout);
  const lines = spec.theorems.map((theorem) => ({ theorem, killed: [] as string[], survived: [] as string[] }));
  try {
    const { lake } = setup(spec, 'none', work, ctx);
    const permitted = new Set([...STANDARD, ...spec.assumptions]);
    const decls = new Map(spec.theorems.map((t) => [t, declOf(work, spec, t)]));
    const files = [...new Set([...decls.values()].flatMap((d) => (d ? [d.file] : [])))];
    let tried = 0;
    for (const [file, symbol] of spec.targets.map((t) => t.split('#') as [string, string])) {
      const path = join(work, file);
      const original = existsSync(path) ? readFileSync(path, 'utf8') : '';
      for (const m of mutantsOf(original, file, symbol)) {
        if (tried >= MUTANTS) break;
        writeFileSync(path, m.text);
        try {
          if (errorsOf(lake(['build']).out).some((e) => e.file === file && e.line >= m.def[0] && e.line <= m.def[1])) continue;
          tried++;
          for (const f of files) {
            const { used, errors } = axioms(work, f, spec.theorems.filter((t) => decls.get(t)?.file === f), lake);
            for (const l of lines.filter((x) => decls.get(x.theorem)?.file === f)) {
              const a = used.get(l.theorem);
              const fails = !a || a.some((x) => !permitted.has(x)) || errors.some((e) => inside(decls.get(l.theorem), e));
              (fails ? l.killed : l.survived).push(m.name);
            }
          }
        } finally {
          writeFileSync(path, original);
        }
      }
    }
    return { theorems: lines, cantFail: cantFail(lines) };
  } catch (error) {
    if (error instanceof Overran) return { theorems: lines, cantFail: cantFail(lines, `past the ${ctx.deadline} ms deadline`) };
    if (error instanceof Missing) return { theorems: lines, cantFail: cantFail(lines, error.message) };
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
