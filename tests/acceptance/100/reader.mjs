// What #100's tests read a doc or an issue by (README: what each test means by the criterion's words): a Markdown
// text's blocks as rendered, and the statements in which a rope, cloth or solver waits on a licensing or patent review.
import { prose } from '../../../scripts/doc-links.mjs';

/** A line as rendered, in lower case: a link by its text, no tags, emphasis, code ticks or quote marks. */
const plain = (raw) => raw.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[’‘]/g, "'").replace(/[`*"“”]|\b_+|_+\b/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A Markdown text's blocks outside fenced code, each with its first line's number: a paragraph, list item or heading is
 * one cell; a table row is its cells, less any under a "Reopens if" header, which says what would reopen a decision and
 * not what waits now. A table's first row is its header.
 */
export function blocks(text) {
  const found = [];
  let open = false, header = null;
  for (const { number, line } of prose(text)) {
    const row = /^\s*\|/.test(line);
    if (!row) header = null;
    if (row) {
      const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(plain);
      header ??= cells;
      found.push({ number, row, cells: cells.filter((_, index) => !/^reopens if\b/.test(header[index] ?? '')) });
    } else if (open && line.trim() && !/^\s*(?:[-*+] |\d+[.)] |#{1,6} |>)/.test(line)) found.at(-1).cells[0] += ` ${plain(line)}`;
    else if (line.trim()) found.push({ number, row, cells: [plain(line)] });
    open = !row && Boolean(line.trim());
  }
  return found;
}

// The criterion's "rope, cloth or solver"; whether one is ours is not read.
const OURS = /\b(?:ropes?|cloth|solvers?)\b/;
// A licensing or patent review: a license or patent word and a review in one sentence, or "a licensing or patent gate".
const LEGAL = '(?:licen[cs]|patent)\\w*';
const REVIEW = RegExp(`\\b${LEGAL}\\b.*\\breview|\\breview.*\\b${LEGAL}|\\b${LEGAL}(?: (?:or|and) ${LEGAL})? gat(?:e|es|ed|ing)\\b`);
const NEGATION = /\b(?:no|not|never|nothing|none|nor|neither|without|cannot)\b|n't\b/;
const WAIT = 'a?wait(?:s|ed|ing)?|pending|h[eo]ld(?:s|ing)?(?: \\S+){0,4} back|on hold|gat(?:e|es|ed|ing)|block(?:s|ed|ing)?|defer\\w*|postpon\\w*|depend(?:s|ed|ing)? on|subject to|need(?:s|ed|ing)?|requir\\w+';
// How a sentence with no negation says something waits: a waiting word, "until" or "unless"; "after" or "once", then
// the review; the review, then "before" or "first".
const WAITS = [RegExp(`\\b(?:${WAIT}|until|unless)\\b`), /\b(?:after|once)\b(?: \S+){0,6} review/, /\breview\w*(?: \S+){0,6} (?:before|first)\b/];
// How one with a negation does: "not … until", "no … before", "can't … unless", with no review or waiting word between.
const NOT_UNTIL = RegExp(`(?:\\b(?:no|not|never|nothing|none|cannot)\\b|n't\\b)(?:(?!\\b(?:review|${WAIT})).)*?\\b(?:until|before|unless)\\b`);

/** Whether a sentence, as `blocks` renders it, says something waits on a licensing or patent review. */
const waits = (sentence) => REVIEW.test(sentence) && (NEGATION.test(sentence) ? NOT_UNTIL.test(sentence) : WAITS.some((form) => form.test(sentence)));

/**
 * The sentences of a Markdown text in which a rope, cloth or solver waits on a licensing or patent review: the sentence
 * says something waits on one, and the rope, cloth or solver is named in it, in the sentence before it, anywhere in its
 * table row, or in `about`, what the whole text is about, as an issue's title.
 */
export function waiting(text, about = '') {
  return blocks(text).flatMap(({ number, row, cells }) => cells.flatMap((cell) => {
    const sentences = cell.split(/(?<=[.!?;])\s+/);
    return sentences.filter((sentence, index) => waits(sentence) && OURS.test(`${plain(about)} ${row ? cells.join(' ') : `${sentences[index - 1] ?? ''} ${sentence}`}`))
      .map((sentence) => ({ line: number, sentence: sentence.length > 300 ? `${sentence.slice(0, 300)}…` : sentence }));
  }));
}
