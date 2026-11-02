// What a command hides from the runner, read from its text with no model: a masked exit status (Check health), a
// program the read tracer can't see into, and a child that leaves the run's process group. Each is named, so the
// run is uncounted naming it rather than claimed complete. The untraced and hidden-child rules follow check.kind@1's
// reference runner (#314); the masks are the design's whole list.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { blanked, maskIn, segmentsOf, wordsOf } from '@deepbuild/gate';
import type { Filter } from './listing.js';

export { maskIn };

/** Shell words that run no program of their own and read no file. */
const BUILTINS = new Set(['cd', 'true', 'false', 'echo', 'exit', 'export', 'test', '[', ':']);
/** Shell words that start another program or read a file in the shell itself: no program by their own name. */
const KEYWORDS = new Set(['exec', 'command', 'builtin', 'source', '.', 'time', 'if', 'while', 'until', 'for', 'case']);
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
  // Only a file that starts as pnpm's shim does can be one: any other `#!` line is read as the interpreter's.
  const script = head === '#!/bin/sh' ? pnpmShim(at) : null;
  if (script !== null) return traced('node', [script, ...args], cwd, path, trust, depth + 1);
  const [first = '', ...rest] = head.slice(2).trim().split(/\s+/);
  const viaEnv = (first.split('/').pop() ?? first) === 'env';
  const at2 = viaEnv ? rest.findIndex((w) => !w.startsWith('-') && !ASSIGNMENT.test(w)) : -1;
  const interpreter = viaEnv ? rest[at2] : first;
  // `env -S` only splits the line; any other option of env's (`-i`) changes what the interpreter gets.
  if (!interpreter || rest.slice(0, Math.max(at2, 0)).some((w) => w !== '-S')) return false;
  return traced(interpreter, viaEnv ? rest.slice(at2 + 1) : rest, cwd, path, trust, depth + 1);
}
/** The sh shim pnpm (10) installs for a package's Node program, word for word but for the folders it names. */
const PNPM_SHIM_TEXT = `#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")

case \`uname\` in
    *CYGWIN*|*MINGW*|*MSYS*)
        if command -v cygpath > /dev/null 2>&1; then
            basedir=\`cygpath -w "$basedir"\`
        fi
    ;;
esac

if [ -z "$NODE_PATH" ]; then
  export NODE_PATH="<folders>"
else
  export NODE_PATH="<folders>:$NODE_PATH"
fi
if [ -x "$basedir/node" ]; then
  exec "$basedir/node"  "$basedir/<script>" "$@"
else
  exec node  "$basedir/<script>" "$@"
fi
`;
// Each folder is plain text: no quote, `$`, backquote or backslash the shell would read. Both lines run one script.
const FOLDERS = '[^"$`\\\\]*';
const PNPM_SHIM = new RegExp(`^${PNPM_SHIM_TEXT.split(/(<folders>|<script>)/).map((part, i, all) => part === '<folders>' ? FOLDERS
  : part === '<script>' ? (all.indexOf(part) === i ? `(${FOLDERS.replace('*', '+')})` : '\\1') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`);
/** The Node script a pnpm shim at `at` runs, or null for any other file, or where a `node` beside it would run instead. */
function pnpmShim(at: string): string | null {
  let text: string;
  try { text = readFileSync(at, 'utf8'); } catch { return null; }
  const shim = PNPM_SHIM.exec(text);
  const dir = resolve(at, '..');
  return shim && !existsSync(join(dir, 'node')) ? resolve(dir, shim[1]!) : null;
}
/** The shells whose script, named as their one argument, is read as the command (`sh file`, `/bin/sh file`). */
const SCRIPT_SHELLS = new Set(['sh', 'bash', 'dash', 'zsh']);
/** A shell script a command segment runs, and its command lines: the `#!` line, comments and blank lines left out. */
export interface Script { file: string; lines: string[] }
/**
 * The script a segment runs as `sh file`, read from the checkout, or null: a shell given options or more than the
 * file, or a file that can't be read, is a program of its own, which the tracers can't see into. The hub's drafted
 * checks (#303) are such scripts, each a shell line or two around the tool it runs.
 */
export function scriptOf(segment: string, cwd: string): Script | null {
  const words = wordsOf(segment).filter((w) => !ASSIGNMENT.test(w));
  const [shell, file, ...rest] = words;
  if (!shell || !file || rest.length || !SCRIPT_SHELLS.has(shell.split('/').pop() ?? shell) || file.startsWith('-')) return null;
  let text: string;
  try { text = readFileSync(resolve(cwd, file), 'utf8'); } catch { return null; }
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  return { file, lines };
}
/** The programs a command's segments start, in order; a script a segment runs adds its own after the shell's. */
export function programsIn(command: string, cwd?: string): string[] {
  return segmentsOf(command).flatMap((segment) => {
    const program = wordsOf(segment).find((w) => !ASSIGNMENT.test(w));
    const script = cwd === undefined ? null : scriptOf(segment, cwd);
    return [...(program !== undefined && !BUILTINS.has(program) ? [program] : []), ...(script ? programsIn(script.lines.join('\n')) : [])];
  });
}
/** The command's mask, or a mask in the script it runs, named with the file (the core's one rule, on each): null for none. */
export function maskOf(command: string, cwd: string): string | null {
  const own = maskIn(command);
  if (own !== null) return own;
  for (const segment of segmentsOf(command)) {
    const script = scriptOf(segment, cwd);
    const mask = script && maskIn(script.lines.join('\n'));
    if (mask) return `${mask} in ${script.file}`;
  }
  return null;
}
/**
 * The values a command gives the options that choose tests by name (`-t`, `--testNamePattern`, node:test's
 * `--test-name-pattern` and `--test-skip-pattern`, `--tags-filter`, `-k`, `-m`, `--deselect`, and pytest's `-o`), each
 * with its option, node:test's `--test-only`, and the places it runs alone (`place`: a Vitest file:line, a pytest node
 * id), as the shell hands them over: a filter a reporter finds is the command's only when it is one of them.
 */
export function filtersIn(command: string): Filter[] {
  const words = wordsOf(command);
  const filters: Filter[] = [];
  words.forEach((word, i) => {
    const option = /^(-t|--testNamePattern|--test-name-pattern|--test-skip-pattern|--tags-filter|-k|-m|--deselect|-o)(?:=(.*))?$/.exec(word);
    const value = option && (option[2] ?? words[i + 1]);
    if (value !== null && value !== undefined) filters.push({ option: option![1]!, value });
    // node:test runs a file's focused tests alone only when told to.
    else if (word === '--test-only') filters.push({ option: word, value: '' });
    // A place the command runs alone: Vitest's file:line, or a pytest node id.
    else if (!word.startsWith('-') && (word.includes('::') || /:\d+$/.test(word))) filters.push({ option: 'place', value: word });
  });
  return filters;
}
/** The program the command starts with, a plain name or path, when the shell can't find it on `path`: the command can't start. */
export function absent(command: string, cwd: string, path: string): string | null {
  const first = wordsOf(segmentsOf(command)[0] ?? '').find((w) => !ASSIGNMENT.test(w));
  if (first === undefined || !/^[\w.+@/-]+$/.test(first) || BUILTINS.has(first) || KEYWORDS.has(first)) return null;
  return programPath(first, cwd, path) === null ? first : null;
}
/** `go test`, whose reads no tracer sees: the run can fail on its report, but can't pass (see the runner). */
export const GO_TEST = /(?:^|&&|\|\||[;|\n])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*go\s+test\b/;
/**
 * The first thing in the command the tracers can't see into: a file the shell itself reads (an input redirection, a
 * here-document, a substitution), or a program other than Node, Python or a script either runs (see `traced`).
 * `go test` in the check's own command (`go`) is the runner's to judge; started by a child, it's untraced.
 */
export function untraced(command: string, cwd: string, path: string, trust: Trust = {}, depth = 0): string | null {
  const allowed = { node: true, python: true, go: true, writable: [cwd], ...trust };
  const shell = blanked(command);
  if (/(^|[^<>])<(?![<>&])/.test(shell) || /<<</.test(shell) || /<<(?![<])/.test(shell)) return 'shell input <';
  if (/\$\(|`/.test(command)) return 'shell substitution $(';
  const setup = PYTHON_SETUP.exec(command);
  if (setup) return `python setup ${setup[1]}`;
  for (const segment of segmentsOf(command)) {
    const words = wordsOf(segment);
    const at = words.findIndex((w) => !ASSIGNMENT.test(w));
    const program = words[at];
    if (!program || BUILTINS.has(program) || (allowed.go && program === 'go' && words[at + 1] === 'test')) continue;
    // A script the shell runs is read as the command: its lines must be traced, each named with the file. A script a
    // script runs is a program the tracers can't see into: nothing is read twice over.
    const script = depth === 0 ? scriptOf(segment, cwd) : null;
    if (script) {
      const hidden = untraced(script.lines.join('\n'), cwd, path, trust, depth + 1);
      if (hidden !== null) return `${hidden} in ${script.file}`;
      continue;
    }
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
