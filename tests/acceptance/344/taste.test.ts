// #344.10e389aa: Shown to you: screenshots of the rules page with each rule and what enforces it, and a text-only rule,
// taken by the check run from the page in the app at the reference window, are attached to the PR and shown to you in
// the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS,
// and no criterion above reads a picture to judge it.
//
// The suite can't draw the page (the app is the implementer's), so it reads what the check run left: the screenshots in
// `target/acceptance/344/` (README: The taste call) and the owner's recorded call in `tests/acceptance/344/TASTE.json`.
// No screenshots, no call, or a call made on other pictures (another SHA-256) is INCONCLUSIVE; "looks wrong" fails.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './helpers.ts';

const ID = '#344.10e389aa';
const SHOTS = join(REPO, 'target', 'acceptance', '344');
const TASTE = join(REPO, 'tests', 'acceptance', '344', 'TASTE.json');
const NAMES = ['rules-page.png', 'rules-page-text-only.png'] as const;
const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the screenshots of the rules page exist, and the owner's recorded call on exactly those says they look right`, () => {
    const hashes: Record<string, string> = {};
    for (const n of NAMES) {
      const file = join(SHOTS, n);
      if (!existsSync(file)) inconclusive(`the check run left no ${join('target', 'acceptance', '344', n)}: take it from the rules page in the app at the reference window`);
      hashes[n] = createHash('sha256').update(readFileSync(file)).digest('hex');
    }
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner ${NAMES.map((n) => `${n} ${hashes[n]}`).join(', ')} and record the answer in tests/acceptance/344/TASTE.json`);
    const call = JSON.parse(readFileSync(TASTE, 'utf8')) as Record<string, unknown>;
    expect(call.issue, 'TASTE.json: issue').toBe(344);
    expect(call.criterion, 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call.verdict);
    expect(typeof call.who === 'string' && call.who.trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call.when === 'string' && !Number.isNaN(Date.parse(call.when)), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call.screenshots ?? {}) as Record<string, string>;
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call was made on other pictures than this run's: ${other.join(', ')}`);
    if (call.verdict === 'looks_wrong') expect.fail(`the owner's taste call says the rules page doesn't look right${typeof call.note === 'string' ? `: ${call.note}` : ''}`);
  });
});
