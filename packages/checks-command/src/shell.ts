// What a command hides from the runner, read from its text with no model: a masked exit status (Check health), a
// program the read tracer can't see into, and a child that leaves the run's process group. Each is named, so the
// run is uncounted naming it rather than claimed complete. The untraced and hidden-child rules follow check.kind@1's
// reference runner (#314); the masks are the design's whole list.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The ways a command masks its tool's exit, each with the text named as the mask: a failure branch (`|| true`,
 * `|| :`, `|| echo`, `|| exit 0`), a pipe (the pipeline's exit is the last command's), an `exit N`, `set +e`, a
 * leading `!`, a `trap` that exits, a command left running with `&`, `make -i` or `-k`, `--if-present`,
 * `--passWithNoTests` and `continue-on-error`. A Makefile's or justfile's own masks are read only once the runner
 * reads the target a command runs.
 */
const MASKS: RegExp[] = [
  /\|\|\s*\S+(?:\s+\d+)?/, /(?<![|&])\|(?![|&])\s*\S+/, /\bexit\s+\d+/, /\bset\s+\+e\b/, /(?:^|[;&|(]\s*)(!)(?=\s)/, /\btrap\b[^;&|]*\bexit\b/,
  /(?<![&>|])&(?![&>])/, /\bmake\b[^;&|]*\s-[A-Za-z]*[ik]\b/, /--if-present\b/, /--passWithNoTests\b/, /continue-on-error/,
];
/** The mask in a command, or null: also any command after the tool on `;` or a new line, whose exit is the run's. */
export function maskIn(command: string): string | null {
  for (const m of MASKS) {
    const hit = m.exec(command);
    if (hit) return (hit[1] ?? hit[0]).trim();
  }
  const segments = command.split(/;|\n/).map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1) return `; ${segments[segments.length - 1]!.split(/\s+/)[0]}`;
  return null;
}

/** Shell words that run no program of their own and read no file. */
const BUILTINS = new Set(['cd', 'true', 'false', 'echo', 'exit', 'export', 'test', '[', ':']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
function programPath(name: string, cwd: string, path: string): string | null {
  if (name.includes('/')) {
    const p = resolve(cwd, name);
    return existsSync(p) ? p : null;
  }
  for (const dir of path.split(':').filter(Boolean)) if (existsSync(join(dir, name))) return join(dir, name);
  return null;
}
const PYTHON = /^python(\d+(\.\d+)*)?$/;
/**
 * A Python told to skip its site setup (-I, -S, -E), which never loads the run's tracer: any such flag before the
 * code it runs (`-c`, `-m`), or anywhere when there's none, which only ever leaves a run uncounted.
 */
function isolated(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-c' || arg === '-m') return false;
    if (/^-[WX]/.test(arg)) { if (arg.length === 2) i++; continue; }
    if (/^-[A-Za-z]+$/.test(arg) && /[ISE]/.test(arg.slice(1))) return true;
  }
  return false;
}
/** A command that changes where Python finds its site setup, which the run's tracer is part of. */
const PYTHON_SETUP = /\b(PYTHONPATH|PYTHONHOME)\b/;
/** The system's programs that read no file whatever they're asked: pnpm lists processes with `ps`. */
const READS_NOTHING = new Set(['/bin/ps']);
/**
 * Which programs a command or a child counts as traced: Node and Python only where the run's variables reach them
 * (a process the Python tracer recorded says whether they do; a Python a Node process starts may get an
 * environment without them), `go test` only in the check's own command, and Node or Python only as files outside
 * `writable`, the folders the run can write, named so themselves: nothing the run made or linked can pass for either.
 */
export interface Trust { node?: boolean; python?: boolean; go?: boolean; writable?: string[] }
/** The file a program's path comes to, by its own name, or null where the run could have made it. */
const installed = (at: string, writable: string[]): string | null => {
  let real: string;
  try { real = realpathSync(at); } catch { return null; }
  return writable.some((w) => real === w || real.startsWith(`${w}/`)) ? null : (real.split('/').pop() ?? real);
};
/**
 * A program the run's tracers see into: Node, Python with its site setup, or a script one of them runs (its `#!`
 * line, through `env` or not), each as `trust` allows; or one that reads no file.
 */
function traced(program: string, args: string[], cwd: string, path: string, trust: Required<Trust>, depth = 0): boolean {
  const name = program.split('/').pop() ?? program;
  const at = programPath(program, cwd, path);
  if (at === null) return false;
  if (READS_NOTHING.has(at)) return true;
  // Node and Python by the name of the file they are, never by the name of a link to it.
  const real = installed(at, trust.writable);
  if (name === 'node' || real === 'node') return trust.node && real === 'node';
  let head = '';
  try {
    head = readFileSync(at, 'latin1').slice(0, 200).split('\n')[0] ?? '';
  } catch { /* unreadable: untraced */ }
  if (!head.startsWith('#!')) return trust.python && real !== null && PYTHON.test(real) && !isolated(args);
  if (depth > 0) return false;
  const [first = '', ...rest] = head.slice(2).trim().split(/\s+/);
  const viaEnv = (first.split('/').pop() ?? first) === 'env';
  const at2 = viaEnv ? rest.findIndex((w) => !w.startsWith('-') && !ASSIGNMENT.test(w)) : -1;
  const interpreter = viaEnv ? rest[at2] : first;
  // `env -S` only splits the line; any other option of env's (`-i`) changes what the interpreter gets.
  if (!interpreter || rest.slice(0, Math.max(at2, 0)).some((w) => w !== '-S')) return false;
  return traced(interpreter, viaEnv ? rest.slice(at2 + 1) : rest, cwd, path, trust, depth + 1);
}
/** The programs a command's segments start, in order. */
export function programsIn(command: string): string[] {
  return command.split(/&&|\|\||[;|\n]/).map((segment) => segment.trim().split(/\s+/).find((w) => w && !ASSIGNMENT.test(w)))
    .filter((p): p is string => p !== undefined && !BUILTINS.has(p));
}
/**
 * The values a command gives the options that choose tests by name (`-t`, `--testNamePattern`, `-k`, `-m`, `--deselect`,
 * and pytest's `-o`), as the shell hands them over: a filter a reporter finds is the command's only when it is one of them.
 */
export function filtersIn(command: string): Set<string> {
  // Whole shell words, their quotes removed: `--testNamePattern="a b"` is one word.
  const words = [...command.matchAll(/(?:'[^']*'|"[^"]*"|[^\s'"]+)+/g)].map((m) => m[0].replace(/'([^']*)'|"([^"]*)"/g, (_, a, b) => a ?? b));
  const values = new Set<string>();
  words.forEach((word, i) => {
    const option = /^(?:-t|--testNamePattern|-k|-m|--deselect|-o)(?:=(.*))?$/.exec(word);
    const value = option && (option[1] ?? words[i + 1]);
    if (value !== null && value !== undefined) values.add(value);
  });
  return values;
}
/** `go test`, whose reads no tracer sees: the run can fail on its report, but can't pass (see the runner). */
export const GO_TEST = /(?:^|&&|\|\||[;|\n])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*go\s+test\b/;
/**
 * The first thing in the command the tracers can't see into: a file the shell itself reads (an input redirection, a
 * here-document, a substitution), or a program other than Node, Python or a script either runs (see `traced`).
 * `go test` in the check's own command (`go`) is the runner's to judge; started by a child, it's untraced.
 */
export function untraced(command: string, cwd: string, path: string, trust: Trust = {}): string | null {
  const allowed = { node: true, python: true, go: true, writable: [cwd], ...trust };
  if (/(^|[^<>])<(?![<>&])/.test(command) || /<<</.test(command) || /<<(?![<])/.test(command)) return 'shell input <';
  if (/\$\(|`/.test(command)) return 'shell substitution $(';
  const setup = PYTHON_SETUP.exec(command);
  if (setup) return `python setup ${setup[1]}`;
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    const at = words.findIndex((w) => !ASSIGNMENT.test(w));
    const program = words[at];
    if (!program || BUILTINS.has(program) || (allowed.go && program === 'go' && words[at + 1] === 'test')) continue;
    if (!traced(program, words.slice(at + 1), cwd, path, allowed)) return `program ${program}`;
  }
  return null;
}

/** A child a Node process of the run started, as the tracer records it. */
export interface Spawned {
  file: string; args: string[]; shell: boolean; detached?: boolean;
  /** Set by the Python tracer: whether the child's environment still loads the run's tracers. The Node tracer puts them back itself. */
  traced?: boolean;
}
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', '/bin/sh', '/bin/bash', '/bin/zsh']);
/**
 * What hides a child: `detached <program>` for one in a process group of its own, which a stop of the run's group
 * never reaches; the mask in a shell command it ran (a package script's `|| true` hides the tool's exit as the
 * command's own would); `untraced …` for a program the tracers can't see into; null for a Node or Python child.
 */
export function hiddenChild(spawned: Spawned, cwd: string, path: string, node: string, writable: string[] = [cwd]): string | null {
  const program = spawned.file.split('/').pop() ?? spawned.file;
  if (spawned.detached) return `detached ${program}`;
  const fromPython = spawned.traced !== undefined;
  if (!fromPython && spawned.file === node) return null;
  const trust = { node: !fromPython || spawned.traced === true, python: spawned.traced === true, go: false, writable };
  let command: string | null = null;
  if (spawned.shell) command = [spawned.file, ...spawned.args].join(' ');
  else if (SHELLS.has(spawned.file) || SHELLS.has(program)) {
    const at = spawned.args.indexOf('-c');
    if (at < 0) return `untraced program ${program}`;
    command = spawned.args[at + 1] ?? '';
  }
  const mask = command === null ? null : maskIn(command);
  if (mask !== null) return mask;
  if (command === null) return traced(spawned.file, spawned.args, cwd, path, trust) ? null : `untraced program ${program}`;
  const hidden = untraced(command, cwd, path, trust);
  return hidden === null ? null : `untraced ${hidden}`;
}
