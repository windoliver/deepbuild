// @deepbuild/runner: DeepBuild's own headless jobs on your agent, apart from your sessions (#159). The drafting
// job, wiki reads, reading by reference, the review check's second model, an agent's smoke test and the blind
// acceptance job all start through it, and it starts every process of theirs through the supervisor's host@1, in the platform sandbox.
export { openRunner } from './runner.js';
export type {
  Agent, Blocked, JobInput, JobKind, JobRecord, JobSpec, JobState, McpServer, Plant, Runner, RunnerOptions, StopCause, WindowReport,
} from './types.js';
