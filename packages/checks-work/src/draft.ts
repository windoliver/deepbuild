// The drafting job's pick of check kinds (#68): a requirement keeps the check proposed for it only where an installed
// kind runs that kind; any other requirement becomes an early question, never a guess.
import type { CheckRunnerFill } from '@deepbuild/conformance';
import type { Draft, DraftedRequirement } from './types.js';

export function draftChecks(requirements: DraftedRequirement[], kinds: CheckRunnerFill[]): Draft {
  const draft: Draft = { checks: [], questions: [] };
  for (const r of requirements) {
    if (r.check && kinds.some((k) => k.kind === r.check!.kind)) draft.checks.push({ req: r.req, spec: r.check });
    else {
      const why = r.check ? `it would take a ${r.check.kind} check, which no installed check kind runs` : 'no check kind fits it';
      draft.questions.push({ req: r.req, question: `${r.req} says "${r.text}", and ${why}. What would show it's done?` });
    }
  }
  return draft;
}
