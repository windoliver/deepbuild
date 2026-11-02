// The live runs the issue's Proof asks for: one session in the Codex CLI, one in the Codex app (AC4), and the criteria
// only a real session can finish (README: What stays BLOCKED). They spend plan usage and need a person at the app, so they
// never run in the lanes: each skips as BLOCKED, and never passes, until someone runs it by hand and records the result.
import { describe, it } from 'vitest';
import { AC } from './helpers.ts';

const BLOCKED = (what: string) => `BLOCKED: needs a live run by hand: ${what}`;
describe('live runs', () => {
  it(`${AC[4]} (live) a stop held in the Codex app, or the gap recorded with its version`, (ctx) => ctx.skip(BLOCKED('a throwaway session in Codex.app with DeepBuild\'s entries trusted, its Stop held')));
  it(`${AC[12]} (live) Codex's engine for the eleven events other than Stop, whose replies replies.test.ts validates only against the schemas`, (ctx) => ctx.skip(BLOCKED('an interactive Codex session that fires each')));
  it(`${AC[13]} (live) Codex shows you no prompt for a saved deny`, (ctx) => ctx.skip(BLOCKED('the terminal UI under -a on-request')));
  it(`${AC[26]} (live) real Codex's read-only sandbox refuses the write`, (ctx) => ctx.skip(BLOCKED('a signed-in codex exec job; runner.test.ts replays its shape')));
});
