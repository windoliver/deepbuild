// #1510: text from the record as a terminal line shows it. An ask's question quotes the call, so the call chooses its
// bytes, and an escape such as `\x1b[2K\r` could erase the line and print another: what you read must be what is held.
// Every control character (newlines too, so a call stays on its line) and every character that is invisible or
// changes the direction of what follows prints as its escape; the record keeps the bytes.

/**
 * The marked characters: C0, DEL and C1 controls, the line and paragraph separators, the direction marks, embeddings,
 * overrides and isolates, and the characters that show as nothing (zero-width space, word joiner and invisible
 * operators, deprecated format controls, the byte-order mark, interlinear annotation and tag characters). The joiners
 * U+200C and U+200D and the variation selectors stay: they shape emoji and scripts and hide nothing on their own.
 * The app's question card marks the same set (crates/deep-app/src/question.rs).
 */
const MARKED = /[\u{0}-\u{1f}\u{7f}-\u{9f}\u{61c}\u{200b}\u{200e}-\u{200f}\u{2028}-\u{202e}\u{2060}-\u{2064}\u{2066}-\u{206f}\u{feff}\u{fff9}-\u{fffb}\u{e0000}-\u{e007f}]/gu;
const SHORT: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/** `text` with each marked character written as its escape: `\n`, `\x1b`, `\u{202e}`. */
export function visible(text: string): string {
  return text.replace(MARKED, (c) => {
    const n = c.codePointAt(0)!;
    return SHORT[c] ?? (n < 0x100 ? `\\x${n.toString(16).padStart(2, '0')}` : `\\u{${n.toString(16)}}`);
  });
}

/** An option ID a shell passes as itself and a list joined with `, ` can't misread: no blank, comma, parenthesis or quote. */
const BARE = /^[A-Za-z0-9_./+:@%-][A-Za-z0-9_./+:@%=-]*$/;

/**
 * #2563: an option ID written as `deep inbox answer <ask> <option>` takes it back, typed into a POSIX shell. A bare ID
 * is itself; any other is in single quotes, or, holding a marked character, in `$'…'` with that character's UTF-8
 * bytes, and a `'`'s, as three-digit octal escapes (a shell may read `\x` past two hex digits, never `\` past three
 * octal ones, and interactive bash's history expansion takes `\'` for a closing quote), so the line shows no raw
 * control and the shell gives back the bytes. One that starts with `-` follows `--`, so it's never read as a flag.
 */
export function typed(id: string): string {
  const ends = id.startsWith('-') ? '-- ' : '';
  if (BARE.test(id)) return `${ends}${id}`;
  if (id.replace(MARKED, '') === id) return `${ends}'${id.replaceAll("'", "'\\''")}'`;
  const octal = (c: string): string => [...new TextEncoder().encode(c)].map((b) => `\\${b.toString(8).padStart(3, '0')}`).join('');
  return `${ends}$'${id.replaceAll('\\', '\\\\').replace(new RegExp(`'|${MARKED.source}`, 'gu'), octal)}'`;
}
