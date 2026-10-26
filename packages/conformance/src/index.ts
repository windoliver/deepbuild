// The conformance package's public entry (#313, #314): kits and their reference fill, the slot kits and their
// reference fills, the one runner in both forms, the fake proofs, the code families and their judgement, the
// codes pages, the closure rules, the schema generator, the seeded cases and the stale rule.
export * from './types.js';
export type {
  CheckContext, CheckResult, CheckRunnerFill, CheckSpec, Failure, Fixture, Judge, PlantedFill, RunOutcome, SeededCase, SlotCase, SlotCaseResult, SlotFill, SlotKit,
  SlotKitImpl, SlotReport, SlotRule, SlotRunOptions,
} from './slot-types.js';
// A check kind's own kit (#685's proof kind) is judged by the same runner, so its judge ends a case with the same finding.
export { fail, Finding } from './slot-types.js';
export type { Random } from './generator.js';
export { cleanFill, kits } from './kit.js';
export { cleanFills, slotKits } from './slots/kits.js';
export { slotProblems, type SlotProblem } from './slot-check.js';
export { CHECK_RUNTIME } from './slots/check-kind.js';
export { kitProblems, runKit } from './dispatch.js';
export { proveFake, replay } from './runner.js';
export { seededCases, stalePaths } from './slot-runner.js';
export { codeFamilies, exitCode, judge, unmappedCodes } from './families.js';
export { codesPage } from './pages.js';
export { contractStep, serveAt } from './closures.js';
export { draw, RECORDED_SEED } from './generator.js';
