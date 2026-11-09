// The github extension's first part (#46; design: First-party extensions that ship on by default): each verdict as a
// commit status branch protection can require, and GitHub's record of each push as `push.record@1` readings. The
// gate's own identity, a session's own credential and the rules that make only the gate's status count (#1325).
export { githubPushes, githubPushReader, repoOf } from './pushes.js';
export { openGitHub, type GitHub, type GitHubPlant } from './delivery.js';
export { gateTokens, revoke, sessionToken, type AppKey } from './apps.js';
export { rulesets } from './rules.js';
