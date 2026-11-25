// What a judge is shown, and the control each eval opens with (#3245): one request with two outputs, a change that
// does what was asked and no change, under labels like any other's. A judge that can't tell them apart decides nothing.
import { createHash } from 'node:crypto';

/** A run of a work task that changed no file, as the judge is shown it. */
export const NO_CHANGE = '(no change)';

/** A request's words: what was asked, and what the outputs below are, the changes a run made or, for a task graded on words, its reply. */
export const askOf = (asked: string, words: boolean): string =>
  `A developer asked a coding agent:\n\n${asked}\n\nEach output below is one agent's attempt at that request: ${words ? 'its reply' : `the changes it made, as a diff, or ${NO_CHANGE}`}. Score each from 0 (does not do what was asked) to 1 (does it fully and correctly), on its own merits.`;

const ASKED = 'pageCount(total, size) in src/pages.js rounds down, so 21 items at 10 a page come to 2 pages. Make it round up: 21 items at 10 a page are 3 pages, 20 are 2, and 0 items are 0 pages.';
const RIGHT = `diff --git a/src/pages.js b/src/pages.js
index c667bee..3d8370e 100644
--- a/src/pages.js
+++ b/src/pages.js
@@ -1,4 +1,4 @@
 /** How many pages a list of \`total\` items takes, \`size\` to a page. */
 export function pageCount(total, size) {
-  return Math.floor(total / size);
+  return Math.ceil(total / size);
 }
`;
/** SHA-256 of the control's request and its two outputs: a control that isn't this one is never sent. */
const KEPT = '2bb83540bf3c9a1b50a646300344a64017d517752df365a931e8215513efd12f';
const CONTROL = { prompt: askOf(ASKED, false), right: RIGHT, none: NO_CHANGE };

/** The control, by its hash. */
export function control(): { prompt: string; right: string; none: string; sha256: string } {
  const sha256 = createHash('sha256').update(JSON.stringify([CONTROL.prompt, CONTROL.right, CONTROL.none])).digest('hex');
  if (sha256 !== KEPT) throw Error(`the control (${sha256}) isn't the one kept by its hash (${KEPT})`);
  return { ...CONTROL, sha256 };
}
