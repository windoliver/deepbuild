// The #3454 suite's own count of comment lines, independent of scripts/comment-ratchet.mjs (README: reading 14). It
// parses a TypeScript or JavaScript file with the `typescript` package and reads the comments in the trivia before each
// token, so a `//` inside a string, a regular expression or a template is none. A line counts when any part of a comment
// is on it. `ts` is passed in, so loading this file loads no package.

const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const GENERATED = /@generated|auto-generated|do not edit/i;

export const isScript = (path) => SCRIPT.test(path);
export const isGenerated = (text) => GENERATED.test(text.split('\n', 5).join('\n'));

/** The 1-based lines of `text` that hold any part of a comment. */
export function commentLines(ts, path, text) {
  const kind = /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : path.endsWith('.jsx') ? ts.ScriptKind.JSX : path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
  const starts = source.getLineStarts();
  const lineOf = (position) => {
    let low = 0, high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= position) low = middle; else high = middle - 1;
    }
    return low + 1;
  };
  const lines = new Set();
  const seen = new Set();
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(source);
    if (children.length) return children.forEach(visit);
    // Leading ranges start after the first line break; the ones before it, on the last token's line, are trailing ones.
    const from = node.getFullStart();
    for (const range of [...(ts.getTrailingCommentRanges(text, from) ?? []), ...(ts.getLeadingCommentRanges(text, from) ?? [])]) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      for (let line = lineOf(range.pos); line <= lineOf(Math.max(range.pos, range.end - 1)); line++) lines.add(line);
    }
  };
  visit(source);
  return lines;
}
