// AC9: A claim '`api` starts on port 3000' citing a real quote that says 3001 is marked inferred, never written as
// known from the file; a writer that checks only that the quote is present writes it as known and fails, naming
// the claim.
//
// Both claims cite the same real line of the api repo's Procfile at its commit, in a project you trust: the twin
// that says 3001 is known from the file; the one that says 3000 states a key (the port) its quote doesn't hold.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, handle, lineOf, makeRepo, makeWorld, openWiki, quoteProblem, seedSession, trustProject, withRecord } from './helpers.ts';

afterAll(cleanup, 60_000);

const QUOTE = 'api: node server.js --port 3001';
const GUESS = { page: 'repos/api', id: 'port-guess', text: '`api` starts on port 3000' };
const TWIN = { page: 'repos/api', id: 'port', text: '`api` starts on port 3001' };

async function writeBoth(plant?: 'quote-present-only'): Promise<void> {
  const w = makeWorld();
  const api = makeRepo(join(w.tmp, 'api'), [{ Procfile: `${QUOTE}\n`, 'package.json': '{ "name": "api" }\n' }]);
  await withRecord(w, async (o) => {
    await trustProject(w, o, api.dir);
    await seedSession(w, o, 'api', api.dir, [{ id: 'm1', from: 'you', text: 'Work on the api.' }]);
    const source = { repo: api.dir, path: 'Procfile', commit: api.commits[0]!, quote: QUOTE };
    expect(quoteProblem(w, source), 'the quote is real: it is in the Procfile at that commit').toBeUndefined();
    const wiki = await openWiki({ record: o.record, folder: w.wiki, now: w.clock.now, ...(plant ? { plant } : {}) });
    const learned = await wiki.learn([GUESS, TWIN].map((c) => ({ ...c, scope: 'repo:api', sources: [source] })));
    expect(learned.written, 'both claims are written: each cites a real quote').toEqual(expect.arrayContaining([handle(GUESS), handle(TWIN)]));
  });
  expect(lineOf(w, handle(TWIN)).record.known, `${handle(TWIN)}, whose port is in its quote, is known from the repo file`).toBe('repo');
  const guess = lineOf(w, handle(GUESS)).record.known;
  expect(guess, `${handle(GUESS)} says port 3000 but its quote says 3001: it is never written as known from the file`).not.toBe('repo');
  expect(guess, `${handle(GUESS)} is marked inferred`).toBe('inferred');
}

describe('AC9 a claim that api starts on port 3000, citing a real quote that says 3001, is marked inferred and never written as known from the file', () => {
  it('AC9 the 3000 claim is inferred; its 3001 twin, on the same quote, is known from the repo file', async () => {
    await writeBoth();
  }, 120_000);

  it('AC9 (wrong program) a writer that checks only that the quote is present writes the 3000 claim as known and fails, naming the claim', async () => {
    await expect(writeBoth('quote-present-only')).rejects.toThrow(/wiki:repos\/api#port-guess/);
  }, 120_000);
});
