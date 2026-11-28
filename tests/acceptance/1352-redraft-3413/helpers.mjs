import { ADDED_QUESTIONS, decidedCheck, findSection, readDesign } from '../1352-redraft-3402/helpers.mjs';

export { ADDED_QUESTIONS, decidedCheck, readDesign };

export const DECISIONS = [
  ['a hub of your own, not a shared service (one isolated machine, the only writer)', [/\bisolated\b/i, /\bwriter\b/i, /\bshared\b/i]],
  ['the same hub (the Linux hub in a sandbox, the host seam, the remote connection)', [/\bLinux\b/, /\bsandbox(?:ed|es)?\b/i, /\bseams?\b|host@1/i, /\bconnection\b/i]],
  ['who runs it (hosted with one sign-up, the same image on your own account or machine)', [/\bhosted\b/i, /\bsign[- ]?up\b/i, /\bimage\b/i, /\block(?:ed)?[- ]in\b/i]],
  ['whose agents and plan (the unmodified agent on your own account, an API key kept as a secret)', [/\bunmodified\b/i, /\baccounts?\b/i, /\bsubscriptions?\b/i, /\bAPI keys?\b/i, /\bsecrets?\b/i]],
  ['what leaves your machine (privacy, the first screen before sign-up, encryption at rest, who can read it)', [/\bprivacy\b/i, /\bfirst screen\b/i, /\bencrypt/i, /\bat rest\b/i, /\bwho can read\b/i]],
  ["the browser (a web client, the person's own hub, the authenticated connection, a passkey; no agent, page or extension (plug-in) answers an ask)", [/\bweb client\b/i, /\bown hub\b/i, /\bauthenticated connection\b/i, /\bpasskeys?\b/i, /\bextensions?\b|\bplug-ins?\b/i, /\bask\b/i]],
  ['who pays for hosting (pay for use, idle machines asleep, bring-your-own free; not free for everyone, not a flat plan)', [/\bpay(?:s|ing)?\b/i, /\bidle\b/i, /\basleep\b/i, /\bbring[- ]your[- ]own\b/i, /\bfree\b/i, /\bflat\b/i]],
  ['moving (deep backup and deep restore, the writer generation refusing a stale copy)', [/\bdeep backup\b/, /\bdeep restore\b/, /\bgeneration\b/i, /\bstale\b/i]],
];

export function sectionCheck(text, find = findSection) {
  const { section, problem } = find(text);
  if (!section) return { heading: null, answered: 0, notTaken: 0, problems: [problem] };
  const unanswered = DECISIONS.filter(([, words]) => !words.every((w) => w.test(section.body)));
  const notTaken = section.body.match(/\bnot taken\b/gi)?.length ?? 0;
  const problems = unanswered.map(([decision, words]) => `the section "${section.heading}" doesn't answer this decision: ${decision}: missing ${words.filter((w) => !w.test(section.body)).join(', ')}`);
  if (notTaken < DECISIONS.length) problems.push(`the section "${section.heading}" says "Not taken" ${notTaken} times; each of the ${DECISIONS.length} decisions needs what was not taken`);
  return { heading: section.heading, answered: DECISIONS.length - unanswered.length, notTaken, problems };
}
