// The github extension's first part (#46; design: First-party extensions that ship on by default): each verdict as a
// commit status branch protection can require, and GitHub's record of each push as `push.record@1` readings.
export { githubPushes, githubPushReader } from './pushes.js';
export { openGitHub, type GitHub, type GitHubPlant } from './delivery.js';
