// What a command hides from the runner, read from its text with no model: a masked exit status (Check health), a
// program the read tracer can't see into, and a child that leaves the run's process group. Each is named, so the
// run is uncounted naming it rather than claimed complete. The untraced and hidden-child rules follow check.kind@1's
// reference runner (#314); the masks are the design's whole list.
import { existsSync, readFileSync } from 'node:fs';
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
/**
 * The first thing in the command the tracer can't see into: a file the shell itself reads (an input redirection, a
 * here-document, a substitution), or a program other than Node or a script Node runs (a `#!…node` shebang).
 */
export function untraced(command: string, cwd: string, path: string): string | null {
  if (/(^|[^<>])<(?![<>&])/.test(command) || /<<</.test(command) || /<<(?![<])/.test(command)) return 'shell input <';
  if (/\$\(|`/.test(command)) return 'shell substitution $(';
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const program = segment.trim().split(/\s+/).find((w) => w && !ASSIGNMENT.test(w));
    if (!program || BUILTINS.has(program) || program === 'node' || program.endsWith('/node')) continue;
    const at = programPath(program, cwd, path);
    let head = '';
    try {
      head = at ? readFileSync(at, 'utf8').slice(0, 200) : '';
    } catch { /* unreadable: untraced */ }
    if (!(head.startsWith('#!') && /node/.test(head.split('\n')[0] ?? ''))) return `program ${program}`;
  }
  return null;
}

/** A child a Node process of the run started, as the tracer records it. */
export interface Spawned { file: string; args: string[]; shell: boolean; detached?: boolean }
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', '/bin/sh', '/bin/bash', '/bin/zsh']);
/**
 * What hides a child: `detached <program>` for one in a process group of its own, which a stop of the run's group
 * never reaches; the mask in a shell command it ran (a package script's `|| true` hides the tool's exit as the
 * command's own would); `untraced …` for a program the tracer can't see into; null for a Node child.
 */
export function hiddenChild(spawned: Spawned, cwd: string, path: string, node: string): string | null {
  const program = spawned.file.split('/').pop() ?? spawned.file;
  if (spawned.detached) return `detached ${program}`;
  if (spawned.file === node || program === 'node') return null;
  let command: string | null = null;
  if (spawned.shell) command = [spawned.file, ...spawned.args].join(' ');
  else if (SHELLS.has(spawned.file) || SHELLS.has(program)) {
    const at = spawned.args.indexOf('-c');
    if (at < 0) return `untraced program ${program}`;
    command = spawned.args[at + 1] ?? '';
  }
  const mask = command === null ? null : maskIn(command);
  if (mask !== null) return mask;
  const hidden = untraced(command ?? spawned.file, cwd, path);
  return hidden === null ? null : `untraced ${hidden}`;
}
