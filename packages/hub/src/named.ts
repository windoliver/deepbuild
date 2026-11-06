// What a request names (#84; design: Decisions, Requests that name an action): a request you type authorizes exactly
// what it names, in that thread. "create PR" covers the push and the PR, not the merge. Read with no model; an
// action named under "don't" or "before you" names nothing.
export type Named = 'push' | 'pr' | 'merge';

const NAMES: [Named, RegExp][] = [
  ['push', /\bpush(?:es|ing)?\b/gi],
  ['pr', /\b(?:create|open|file|raise|send|submit|make|put up|draft)\b[^.;\n]{0,24}\b(?:prs?|pull requests?)\b/gi],
  ['merge', /\bmerg(?:e|ing)\b(?!\s+(?:in\s+|from\s+)?(?:main|master|origin|base|the base|conflicts?)\b)/gi],
];
/** Words that take back the action right after them. */
const WITHHELD = /\b(?:don'?t|do not|never|not|no|without|avoid|skip|before(?: you)?|hold off(?: on)?|wait to)\s+(?:\w+\s+){0,2}$/i;

export function namedIn(text: string): Set<Named> {
  const named = new Set<Named>();
  for (const [effect, re] of NAMES) {
    for (const m of text.matchAll(re)) {
      if (!WITHHELD.test(text.slice(Math.max(0, m.index - 40), m.index))) named.add(effect);
    }
  }
  // Opening a pull request takes the push it needs; nothing takes the merge.
  if (named.has('pr')) named.add('push');
  return named;
}

/** Where a shell push goes: its refs' branches, or `current` when it names none or names HEAD. */
export function pushBranches(command: string, current: string): string[] {
  const refs = /\bgit\b[^;&|]*?\bpush\b([^;&|]*)/.exec(command)?.[1]?.trim().split(/\s+/).filter((w) => w && !w.startsWith('-')).slice(1) ?? [];
  return refs.length ? refs.map((r) => r.split(':').at(-1)!.replace(/^refs\/heads\//, '')).map((b) => (b === 'HEAD' ? current : b)) : [current];
}
