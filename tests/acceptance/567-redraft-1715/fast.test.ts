import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import {
  AC1, Claude, FALSE_DONE, FIX, allEvents, chatOf, cleanup, editFile, ensureCli, ensureDeepHook, falseDoneProblems, git, makeWorld, must,
  newSession, payload, readLines, seenOf, settleRuns, setup, startHub, stop, typed, unitPasses, writeProof,
} from '../567/helpers.ts';

afterAll(cleanup, 60_000);

const PROOF = 'fast-redraft-1715';
const PROMPT = 'Refactor checkToken in src/auth.js; it must keep rejecting expired tokens.';
const BUG = { from: FIX.to, to: FIX.from } as const;
const TRUE_DONE = 'Fixed: expired tokens are rejected now.';

describe(`${AC1} In a Claude Code session, a seeded false "done" is held, sent back, and its verdict line shows in the chat`, () => {
  it(`${AC1} a made-up session through setup's entries, deep-hook and the hub, its bug landed after the merge base: its false "done" is held until the spec's unit check ran, sent back naming unit, and its verdict line shows in the chat; the same session's true "done" is let through`, async () => {
    ensureCli();
    ensureDeepHook();
    const w = makeWorld();
    editFile(w, 'src/auth.js', FIX);
    git(w, w.repo, 'commit', '-q', '-a', '--amend', '-m', 'Start the shop');
    if (!unitPasses(w)) throw Error(`BLOCKED: ${AC1} the fixture's unit check must pass on main, the merge base`);
    git(w, w.repo, 'switch', '-q', '-c', 'work');
    const base = git(w, w.repo, 'rev-parse', 'main');

    const hub = await startHub(w);
    await setup(w);
    const s = newSession(w);
    const claude = Claude.start(w);
    await claude.hook('SessionStart', payload(s, 'SessionStart'));
    await typed(claude, s, PROMPT);
    const auth = join(w.repo, 'src/auth.js');
    await claude.tool(s, 'Read', { file_path: auth }, { type: 'text', file: { filePath: auth, content: readFileSync(auth, 'utf8') } });
    const since = (await allEvents(hub)).at(-1)?.log_pos ?? 0;
    editFile(w, 'src/auth.js', BUG);
    await claude.tool(s, 'Edit', { file_path: auth, old_string: BUG.from, new_string: BUG.to }, { filePath: auth, oldString: BUG.from, newString: BUG.to });
    if (unitPasses(w)) throw Error(`BLOCKED: ${AC1} the seeded edit must make the unit check fail`);
    if (git(w, w.repo, 'merge-base', 'HEAD', 'main') !== base) throw Error(`BLOCKED: ${AC1} the session's branch must leave main at the passing commit`);

    const falseDone = seenOf(await stop(claude, s, FALSE_DONE));
    const events = await settleRuns(hub, s.id, since);
    writeProof(PROOF, 'record.json', JSON.stringify(events.filter((e) => e.log_pos > since), null, 1));
    writeProof(PROOF, 'false-done.json', JSON.stringify(falseDone, null, 1));
    falseDoneProblems({ events, session: s.id, since, seen: falseDone, check: 'unit', chat: chatOf(s) });
    must(!/\bBLOCKED\b/.test(falseDone.line!), `${AC1} the verdict line of the seeded false "done" says "sent back", never BLOCKED: its bug isn't on the merge base, so its unit failure isn't inherited: ${JSON.stringify(falseDone.line)}`);

    editFile(w, 'src/auth.js', FIX);
    if (!unitPasses(w)) throw Error(`BLOCKED: ${AC1} the fix must make the unit check pass, run by hand`);
    await claude.tool(s, 'Edit', { file_path: auth, old_string: FIX.from, new_string: FIX.to }, { filePath: auth, oldString: FIX.from, newString: FIX.to });
    const fixed = seenOf(await stop(claude, s, TRUE_DONE, true));
    writeProof(PROOF, 'true-done.json', JSON.stringify(fixed, null, 1));
    writeProof(PROOF, 'transcript.jsonl', readLines(s.transcript).map((e) => JSON.stringify(e)).join('\n'));
    must(fixed.blocked === undefined, `${AC1} a stop is held and sent back for being false: the same session's stop after the fix, with the unit check passing, must be let through: ${fixed.shownAs}`);
    must(!/\bsent back\b/.test(fixed.line ?? ''), `${AC1} the true "done" isn't shown as sent back: ${fixed.shownAs}`);
    await claude.end();
  }, 300_000);
});
