// What this redraft needs beyond the frozen suite's helpers (tests/acceptance/1359/helpers.ts, imported unchanged by the
// test file): the commands `deep --help` lists, read past the exit table #1812 prints at its foot, and #1002's marker
// that setup finished. Both are adapted from tests/acceptance/1359/helpers.ts and tests/acceptance/1812/helpers.ts (same
// repo, same license). Nothing here stands in for DeepBuild.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT, rootOf, type World } from '../1359/helpers.ts';

// ---- The commands `deep --help` lists.
/** The text up to the usage's first `|` at bracket depth 0, and so on: a synopsis's alternatives (#1359's, unchanged). */
function alternatives(synopsis: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of synopsis) {
    if (ch === '[' || ch === '<') depth++;
    if (ch === ']' || ch === '>') depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  out.push(current.trim());
  return out;
}
const WORD = /^[a-z][a-z0-9-]*$/;
/**
 * Every command `deep --help` lists, as its words (`['hub', 'start']`): #1359's reading of each usage line `deep
 * <synopsis>  <what it does>`, its synopsis split into alternatives at `|`. A command's words are the leading plain
 * lowercase words of its alternative; a later alternative replaces the last word of a two-word command (`hub run |
 * start`), or of a one-word one with nothing after it (`off | on`), and follows a one-word command that takes arguments
 * (`numbers [--json] | refresh`). An alternative that starts with a flag or a placeholder names no new command.
 * Changed for #1812 only here, as #1812's suite reads it: every deep command is one or two words, so a line whose words
 * run on past two is prose that starts with `deep`, such as the exit table's line for `deep lease` and `deep mcp-exec`
 * at the foot of `deep --help`, not a usage line.
 */
export function listedCommands(help: string): string[][] {
  const seen = new Map<string, string[]>();
  for (const line of help.split('\n')) {
    const m = /^\s*(?:Usage:\s*)?deep\s+(.*)$/.exec(line);
    if (!m) continue;
    const synopsis = m[1]!.split(/\s{2,}/)[0]!.trim();
    const alts = alternatives(synopsis);
    const tokens0 = alts[0]!.split(/\s+/).filter(Boolean);
    const first: string[] = [];
    for (const t of tokens0) { if (!WORD.test(t)) break; first.push(t); }
    if (!first.length || first.length > 2) continue;
    const takesArgs = tokens0.length > first.length;
    const add = (words: string[]) => { if (words.length <= 2) seen.set(words.join(' '), words); };
    add(first);
    for (const alt of alts.slice(1)) {
      const words: string[] = [];
      for (const t of alt.split(/\s+/).filter(Boolean)) { if (!WORD.test(t)) break; words.push(t); }
      if (!words.length) continue;
      if (first.length >= 2) add([...first.slice(0, -1), ...words]);
      else if (takesArgs) add([...first, ...words]);
      else add(words);
    }
  }
  return [...seen.values()];
}

// ---- A home where setup finished.
/**
 * #1002's marker that setup finished in the world's home, as setup writes it (#1812's suite writes it the same way), so
 * a first-run command there reads its arguments instead of setting the home up first.
 */
export function finished(w: World): void {
  mkdirSync(rootOf(w), { recursive: true, mode: 0o700 });
  const version = (JSON.parse(readFileSync(join(CHECKOUT, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(rootOf(w), 'setup-finished.json'), `${JSON.stringify({ version, at: new Date().toISOString() })}\n`, { mode: 0o600 });
}
