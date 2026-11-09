// Reading a change as the review check does (#87): `git diff` with its default prefixes and three lines of context,
// whatever the machine's git configuration says, and each line of it on the new side, added or context.
import { execFileSync } from 'node:child_process';

const GIT = ['-c', 'core.quotePath=false', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.external='];
export const git = (cwd: string, args: string[]): string =>
  execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', maxBuffer: 256 << 20 });

/** The unified diff from `from` to `to` in `checkout`, as the second model reads it. */
export const diffOf = (checkout: string, from: string, to: string, context = 3): string =>
  git(checkout, ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', `-U${context}`, from, to]);

interface DiffLine { file: string; line: number; text: string; added: boolean }
/** A hunk's old side, as -U0 prints it: the lines it removes or alters (from, count) and how many lines it adds. */
interface Hunk { file: string; from: number; count: number; added: number }

/** Every line of a unified diff on the new side, added or context, with its file and new line number. */
export function newSide(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let file = '';
  let line = 0;
  let inHunk = false;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) { inHunk = false; continue; }
    if (!inHunk && raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { inHunk = true; line = Number(hunk[1]); continue; }
    if (!inHunk) continue;
    if (raw.startsWith('+') || raw.startsWith(' ')) out.push({ file, line: line++, text: raw.slice(1), added: raw.startsWith('+') });
  }
  return out;
}

/** The hunks of a -U0 diff by old-side line: what each removes or alters, and how many lines it adds. */
export function hunks(diff: string): Hunk[] {
  const out: Hunk[] = [];
  let file = '';
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('--- ')) { file = raw.slice(4).replace(/^a\//, ''); continue; }
    const h = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(raw);
    if (h) out.push({ file, from: Number(h[1]), count: h[2] === undefined ? 1 : Number(h[2]), added: h[3] === undefined ? 1 : Number(h[3]) });
  }
  return out;
}

/** Where an old-side line of `file` lands after a commit's hunks: null when the commit removes or alters it. */
export function follow(file: string, line: number, changes: Hunk[]): number | null {
  let shift = 0;
  for (const h of changes) {
    if (h.file !== file) continue;
    if (h.count > 0 && line >= h.from && line < h.from + h.count) return null;
    // A pure insertion's `from` is the line it follows.
    const end = h.count === 0 ? h.from : h.from + h.count - 1;
    if (line > end) shift += h.added - h.count;
  }
  return line + shift;
}

/** The quote rule of Reading by reference: NFC, white space collapsed. */
export const norm = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim();
