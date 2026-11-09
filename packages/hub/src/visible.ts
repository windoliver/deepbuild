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
