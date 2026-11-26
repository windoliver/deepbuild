// The texts the #1583 tests raise and draw (README, The fixtures). No line of this file holds an invisible character:
// each one is written as its escape, so what you read here is what the file holds.

/** One of the characters criterion 1 names, with the escape the base's `visible` already writes for it. */
export interface Hidden { code: string; name: string; char: string; escape: string }
/** A zero-width space. */
export const ZWSP: Hidden = { code: 'U+200B', name: 'ZERO WIDTH SPACE', char: '\u200B', escape: '\\u{200b}' };
/** A right-to-left override. */
export const RLO: Hidden = { code: 'U+202E', name: 'RIGHT-TO-LEFT OVERRIDE', char: '\u202E', escape: '\\u{202e}' };
/** A tag character. */
export const TAG: Hidden = { code: 'U+E0041', name: 'TAG LATIN CAPITAL LETTER A', char: '\u{E0041}', escape: '\\u{e0041}' };
export const HIDDEN: readonly Hidden[] = [ZWSP, RLO, TAG];

/** An ask as a test raises it: its question and its options, each an ID and a label. */
export interface Raised { name: string; question: string; options: { id: string; label: string }[] }

/** A question holding the three characters, and three options, each holding one. */
export const HIDDEN_ASK: Raised = {
  name: 'hidden',
  question: `Ship alpha${ZWSP.char}beta, gamma${RLO.char}delta and epsilon${TAG.char}zeta now?`,
  options: [
    { id: 'zero-width', label: `north${ZWSP.char}south` },
    { id: 'override', label: `east${RLO.char}west` },
    { id: 'tag', label: `up${TAG.char}down` },
  ],
};
/** A link's target: the address of a URL in an ask's text, holding the three characters. */
export const LINK = `https://files.example/inv${ZWSP.char}oice/rep${RLO.char}ort/tot${TAG.char}als.html`;
export const LINK_ASK: Raised = {
  name: 'link',
  question: `Open ${LINK} to check the totals?`,
  options: [{ id: 'open', label: 'Open it' }, { id: 'skip', label: 'Skip it' }],
};
/** A session's name holding the three characters. */
export const SESSION_NAME = `Fix alpha${ZWSP.char}beta, gamma${RLO.char}delta and epsilon${TAG.char}zeta`;

/**
 * Plain text in Chinese, in Arabic and with emoji. The emoji are as people type them: a skin-tone modifier, a heart
 * with its emoji presentation selector (U+FE0F) and a family joined by zero-width joiners (U+200D), which the base's
 * `visible` leaves as they are.
 */
export const PLAIN_ASKS: readonly Raised[] = [
  { name: 'chinese', question: '结账页面的标题用哪种颜色？', options: [{ id: 'blue', label: '蓝色标题' }, { id: 'green', label: '绿色标题' }] },
  { name: 'arabic', question: 'أي لون نختار لعنوان صفحة الدفع؟', options: [{ id: 'blue', label: 'عنوان أزرق' }, { id: 'green', label: 'عنوان أخضر' }] },
  { name: 'emoji', question: 'Ship the new header? 🚀 ✅ 👍🏽 ❤\uFE0F 👨\u200D👩\u200D👧', options: [{ id: 'ship', label: 'Ship it 🚀' }, { id: 'wait', label: 'Wait ✋🏽' }] },
];

/** What an authority card of the app's tests holds: its question, its allowing option's label and its step's command. */
export interface Approval { question: string; allow: string; command: string }
/** The same approval in ASCII: what each other one is compared with. */
export const ASCII: Approval = { question: 'Run `git push origin main` in shop?', allow: 'Allow', command: 'git push origin main' };
/** The approval with `hidden` in one of its three fields, at one place. */
export const approvalHolding = (field: keyof Approval, hidden: Hidden): Approval => ({
  ...ASCII,
  ...(field === 'question' ? { question: `Run \`git push origin ma${hidden.char}in\` in shop?` } : {}),
  ...(field === 'allow' ? { allow: `Al${hidden.char}low` } : {}),
  ...(field === 'command' ? { command: `git push origin ma${hidden.char}in` } : {}),
});
/** Plain approvals in Chinese, in Arabic and with emoji. */
export const PLAIN_APPROVALS: readonly (Approval & { name: string })[] = [
  { name: 'Chinese', question: '现在把标题修复推送到 shop 吗？', allow: '允许推送', command: 'git commit -m "修复结账页面的标题"' },
  { name: 'Arabic', question: 'هل ننشر إصلاح العنوان في المتجر الآن؟', allow: 'اسمح بالنشر', command: 'git commit -m "إصلاح عنوان صفحة الدفع"' },
  { name: 'emoji', question: 'Ship the new header? 🚀 ✅ 👍🏽 ❤\uFE0F 👨\u200D👩\u200D👧', allow: 'Ship it 🚀', command: 'git commit -m "header ✅ 👍🏽"' },
];
