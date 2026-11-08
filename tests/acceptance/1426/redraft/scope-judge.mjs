// #1426's two Scope lines on text, judged here: "vendor/gpui-pre-apple/upstream/README.md records the refusal with its
// date and link" (and no longer calls the pull request open), and "The design's line on patches is corrected" (the
// toolkit's Decided row no longer calls rquickjs the only patch, and names the vendored GPUI patches). Each judge
// takes a file's text and answers its failures, so the self-tests can hand it the base's file and twins of it.

export const LINK = 'https://github.com/zed-industries/zed/pull/66114';
const DATE = /\b(?:October|Oct\.?)\s+28,\s+2026\b|\b28\s+October\s+2026\b|\b2026-10-28\b/;
// A word that says zed refused the pull request. "closed" alone doesn't: a merged pull request is closed too.
const REFUSED = /\b(?:refus\w*|declin\w*|reject\w*|unmerged|not merged|without merging|won't merge|will not merge)\b/i;
// The pull request called open now: "is open", "remains open", "still open", "is ready for review" and the like.
const OPEN_NOW = /\b(?:is|remains|stays|still)\s+(?:open|ready for review)\b/i;
const ABOUT_PR = /pull request|\bPR\b|zed\/pull\/66114|#66114/i;

/** The README's refusal: one paragraph with the link, the date and a word saying it was refused; no sentence calling the pull request open. */
export function judgeRefusal(text) {
  const failures = [];
  const paragraphs = text.split(/\n\s*\n/);
  const withLink = paragraphs.filter((part) => part.includes(LINK));
  const dated = withLink.filter((part) => DATE.test(part));
  if (!withLink.length) failures.push(`the README has no paragraph linking ${LINK}`);
  else if (!dated.length) failures.push(`no paragraph linking ${LINK} gives the date of the refusal, October 28, 2026`);
  else if (!dated.some((part) => REFUSED.test(part))) failures.push(`the paragraph with the link and the date doesn't say zed refused the pull request: ${dated[0].replace(/\s+/g, ' ').slice(0, 300)}`);
  const open = text.split(/\n\s*\n/).flatMap((part) => part.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)).filter((sentence) => ABOUT_PR.test(sentence) && OPEN_NOW.test(sentence));
  for (const sentence of open) failures.push(`the README still calls the pull request open: "${sentence.slice(0, 200)}"`);
  return failures;
}

export const TOOLKIT_ROW = "| The app's toolkit |";

/** The design's toolkit Decided row: no "only patch", and the vendored GPUI patches named. */
export function judgeDesign(text) {
  const rows = text.split('\n').filter((line) => line.startsWith(TOOLKIT_ROW));
  if (rows.length !== 1) return [`docs/technical-design.md has ${rows.length} rows starting "${TOOLKIT_ROW}", not one`];
  const failures = [];
  const only = /\b(?:the\s+)?(?:only|sole|single)\s+patch\b/i.exec(rows[0]);
  if (only) failures.push(`the toolkit's Decided row still calls one patch the only one: "...${rows[0].slice(Math.max(0, only.index - 60), only.index + 120)}..."`);
  if (!/gpui-pre/.test(rows[0])) failures.push("the toolkit's Decided row doesn't name the vendored GPUI patches (gpui-pre or gpui-pre-apple, as vendor/ holds them)");
  return failures;
}
