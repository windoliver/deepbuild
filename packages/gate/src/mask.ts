// The one masked-exit rule the core holds (#29): the validity gate sends back a claim citing a run whose command
// masked its exit status, the command check kind leaves such a run uncounted, and spec drafting uses it too. Moved
// here from @deepbuild/checks-command (#30), which reads it from the core.
/**
 * The ways a command masks its tool's exit, each with the text named as the mask: a failure branch (`|| true`,
 * `|| :`, `|| echo`, `|| exit 0`), a pipe (the pipeline's exit is the last command's), an `exit N`, `set +e`, a
 * leading `!`, a `trap` that exits, a command left running with `&`, `make -i` or `-k`, `--if-present`,
 * `--passWithNoTests` and `continue-on-error`. A Makefile's or justfile's own masks are read only once the runner
 * reads the target a command runs.
 */
const MASKS: RegExp[] = [
  /\|\|\s*\S+(?:\s+\d+)?/, /(?<![|&])\|(?![|&])\s*\S+/, /(?<![-\w])exit\s+\d+/, /\bset\s+\+e\b/, /(?:^|[;&|(]\s*)(!)(?=\s)/, /\btrap\b[^;&|]*\bexit\b/,
  /(?<![&>|])&(?![&>])/, /\bmake\b[^;&|]*\s-[A-Za-z]*[ik]\b/, /--if-present\b/, /--passWithNoTests\b/, /continue-on-error/,
];
/** The command with the text of each quoted span blanked, its length kept: what's inside quotes is a word's, not the shell's. */
export const blanked = (command: string): string => command.replace(/'[^']*'|"[^"]*"/g, (q) => `${q[0]}${'_'.repeat(q.length - 2)}${q[0]}`);
/** The command's parts between the shell's separators (`at`), never split inside quotes. */
export function segmentsOf(command: string, at = /&&|\|\||[;|\n]/g): string[] {
  const parts: string[] = [];
  let from = 0;
  for (const m of blanked(command).matchAll(at)) { parts.push(command.slice(from, m.index)); from = m.index + m[0].length; }
  return [...parts, command.slice(from)];
}
/** Whole shell words, their quotes removed: `--testNamePattern="a b"` is one word. */
export const wordsOf = (text: string): string[] => [...text.matchAll(/(?:'[^']*'|"[^"]*"|[^\s'"]+)+/g)].map((m) => m[0].replace(/'([^']*)'|"([^"]*)"/g, (_, a, b) => a ?? b));

/** The mask in a command, or null: also any command after the tool on `;` or a new line, whose exit is the run's. */
export function maskIn(command: string): string | null {
  const shell = blanked(command);
  for (const m of MASKS) {
    const hit = m.exec(shell);
    if (hit) return (hit[1] ?? command.slice(hit.index, hit.index + hit[0].length)).trim();
  }
  const segments = segmentsOf(command, /;|\n/g).map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1) return `; ${wordsOf(segments[segments.length - 1]!)[0]}`;
  return null;
}

