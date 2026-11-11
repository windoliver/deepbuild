// @deepbuild/checks-review: the review check (#87), a check.kind@1 plug-in. A second model, run through the runner
// apart from your sessions, reads the diff alone against your wiki's rubric; its valid findings come back as one
// send-back of structured items (file, line, rule and the quoted text) with its prose folded away. A review answered
// by the model that made the change, or by one its output doesn't name, counts neither way.
import type { CheckContext } from '@deepbuild/conformance';
import { reviewKit as kitFor } from './kit.js';
import { reviewBudget } from './models.js';
import { review } from './review.js';
import type { ReviewFill, ReviewSpec, Reviewer } from './types.js';

export type {
  DroppedFinding, ItemOutcome, ReviewerAnswer, ReviewFill, ReviewFinding, ReviewRequest, ReviewResult, Reviewer, ReviewSendBack, ReviewSpec, SendBackItem,
  SentBack, Site,
} from './types.js';
export type { ChangeSession, Independence, ModelPlant, ReviewAt, ReviewJobRun } from './models.js';
export type { PassFinding, PassReading, PassReviewer, PostClosePass, PostCloseReport } from './post-close.js';
export type { ReplayedCase } from './replay.js';
export { independence, reviewBudget, reviewJobRun } from './models.js';
export { itemOutcomes } from './outcomes.js';
export { reviewBeforeCloses } from './post-close.js';
export { replayReview } from './replay.js';

/** The review kind as the check.kind@1 fill: `run` asks its own reviewer, `review` the one it's given. */
export function reviewFill(reviewer: Reviewer): ReviewFill {
  return {
    slot: 'check.kind@1', revision: 1, kind: 'review', budget: { ...reviewBudget },
    run: (spec: ReviewSpec, ctx: CheckContext) => review(spec, ctx, reviewer),
    review: (spec: ReviewSpec, ctx: CheckContext, given: Reviewer) => review(spec, ctx, given),
  };
}

/** The review kind's own check.kind@1 kit, run by the conformance package's runKit. */
export const reviewKit = (): ReturnType<typeof kitFor> => kitFor(() => reviewFill(() => { throw new Error('the kit gives each case its recorded answer'); }));
