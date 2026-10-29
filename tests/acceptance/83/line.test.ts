// AC1 #83.8a03aacc: the line appears in the Claude Code and Codex chats at every judged stop.
// AC3 #83.fd11082e: the line never says PASS without a verdict.
// AC5 #83.87a5093c: the line names the next step's owner, and the receipt names the proof-bar checks it ran.
// AC10 #83.09932b63: when a requirement wasn't verified, the line says so first, before any PASS count.
//
// Each stop is a real Stop hook: Claude Code's through `deep setup`'s own entries run by the stand-in (fixtures/
// claude.mjs), Codex's through `deep-hook codex Stop` as Codex runs the entry. The line is read where the chat reads
// it (README: Defined here, where the line shows): the reply's systemMessage, or a send-back's reason. A verdict is
// planted through `test.verdict`, which writes the record events the design names (README: Additions, 1).
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC3, AC5, AC10, allEvents, begin, chatLines, claim, cleanup, codexHook, codexContextOf, codexLineOf, edits, firedShown, hubWithSetup, lineOf, makeHome,
  newSession, OUTCOME_WORDS, OWNER, plant, receipt, receiptShown, req, STATE_WORDS, stop, WIDTH,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const stateWord = (line: string) => STATE_WORDS.find((w) => line.includes(w));
const widthOf = (line: string) => [...line].length;

describe(`${AC1} The line appears in the Claude Code and Codex chats at every judged stop`, () => {
  it(`${AC1} Claude Code: a stop whose turn edited a file is judged, and its Stop reply carries one line the chat shows, at most ${WIDTH} columns, naming a state; a stop right after startup carries none`, async () => {
    const h = makeHome();
    await hubWithSetup(h);
    const s = newSession(h);
    const claude = await begin(h, s);
    // The turn did work: an Edit through its hooks.
    await edits(claude, s);
    const fired = await stop(claude, s);
    const line = lineOf(fired);
    expect(line, `a judged stop's reply carries the line (systemMessage, or a send-back's reason): ${firedShown(fired)}`).toBeDefined();
    expect(widthOf(line!), `the line fits ${WIDTH} columns: ${JSON.stringify(line)}`).toBeLessThanOrEqual(WIDTH);
    expect(stateWord(line!), `the line names a state with one of the design's words (${STATE_WORDS.join(', ')}): ${JSON.stringify(line)}`).toBeDefined();
    expect(chatLines(s), 'the chat shows the line (the transcript holds it as a hook_system_message attachment)').toContain(line);
    // A second stop with no new work is judged too (design: "Two stops with no new work still count").
    const again = await stop(claude, s, 'Nothing more to do.');
    expect(lineOf(again), `the second stop, with no new work, still carries the line: ${firedShown(again)}`).toBeDefined();
    await claude.end();
  }, 180_000);

  it(`${AC1} Codex: a stop whose turn ran a command is judged, and its Stop reply carries the line; a verdict that lands after the hold is delivered on the next prompt`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const s = newSession(h, { agent: 'codex' });
    await codexHook(h, s, 'SessionStart');
    await codexHook(h, s, 'UserPromptSubmit', { prompt: 'Fix the cart total, then stop.' });
    const call = `call_${Date.now()}`;
    await codexHook(h, s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: call });
    await codexHook(h, s, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: call, tool_response: { stdout: 'ok', stderr: '', exit_code: 0 } });
    const stopped = await codexHook(h, s, 'Stop', { last_assistant_message: 'Done: the cart total is fixed.' });
    const line = codexLineOf(stopped);
    expect(line, `Codex's judged stop carries the line in its reply (systemMessage or a block's reason): exit ${stopped.ran.code}, stdout ${JSON.stringify(stopped.ran.stdout.slice(0, 800))}, stderr ${JSON.stringify(stopped.ran.stderr.slice(0, 400))}`).toBeDefined();
    expect(widthOf(line!), `the line fits ${WIDTH} columns: ${JSON.stringify(line)}`).toBeLessThanOrEqual(WIDTH);
    expect(stateWord(line!), `the line names a state with one of the design's words: ${JSON.stringify(line)}`).toBeDefined();
    // The verdict lands after the raised hold: a Codex session hears it at its next prompt (design: "A Stop hold becomes the next prompt").
    const events = await allEvents(hub);
    const made = events.find((e) => e.session === s.id && e.kind === 'claim.made');
    const claimHandle = made ? `claim:${made.id}` : undefined;
    if (!claimHandle) throw Error(`BLOCKED: the judged Codex stop must record a claim (claim.made) for the verdict to land on; the session's events: ${events.filter((e) => e.session === s.id).map((e) => e.kind).join(', ')}`);
    await plant(hub, { session: s.id, claim: claimHandle, outcome: 'PASS', requirements: [req(1, 'PASS'), req(2, 'PASS')], ran: [{ check: 'unit', outcome: 'passed' }] });
    const next = await codexHook(h, s, 'UserPromptSubmit', { prompt: 'Now add the tests.' });
    const context = codexContextOf(next) ?? codexLineOf(next);
    expect(context, `the next prompt's reply delivers the verdict that landed after the hold: ${JSON.stringify(next.reply ?? next.ran.stdout.slice(0, 600))}`).toBeDefined();
    expect(context, 'the delivered line says PASS with its count').toMatch(/\bPASS 2\/2\b/);
  }, 180_000);
});

describe(`${AC3} The line never says PASS without a verdict`, () => {
  it(`${AC3} a judged stop with no verdict in the record (no verdict.made for its claim) never says PASS; one whose checks still run says so; only once a PASS verdict is recorded does the line say PASS`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const s = newSession(h);
    const claude = await begin(h, s);
    await edits(claude, s);
    const c = await claim(claude, s);
    const first = await stop(claude, s);
    const line1 = lineOf(first);
    expect(line1, `the judged stop carries a line: ${firedShown(first)}`).toBeDefined();
    const verdicts = (await allEvents(hub)).filter((e) => e.kind === 'verdict.made' && e.subject === c.claim);
    expect(verdicts, 'no verdict was made yet for the claim').toEqual([]);
    expect(line1, `with no verdict the line never says PASS: ${JSON.stringify(line1)}`).not.toMatch(/\bPASS\b/);
    // Checks still running, no verdict: the line says so, still never PASS.
    await plant(hub, { session: s.id, claim: c.claim, outcome: null, requirements: [req(1, 'pending'), req(2, 'pending', 'journey:checkout')], running: [{ check: 'unit', about_s: 30 }, { check: 'journey:checkout', about_s: 240 }] });
    const second = await stop(claude, s, 'Still done; the checks run.');
    const line2 = lineOf(second);
    expect(line2, `a stop with checks running carries a line: ${firedShown(second)}`).toBeDefined();
    expect(line2, `with checks running and no verdict the line names them and never says PASS: ${JSON.stringify(line2)}`).toMatch(/\b2 checks running\b/);
    expect(line2).not.toMatch(/\bPASS\b/);
    // A PASS verdict recorded: now, and only now, the line says PASS.
    await plant(hub, { session: s.id, claim: c.claim, outcome: 'PASS', requirements: [req(1, 'PASS'), req(2, 'PASS', 'journey:checkout')], ran: [{ check: 'unit', outcome: 'passed' }, { check: 'journey:checkout', outcome: 'passed' }] });
    const recorded = (await allEvents(hub)).filter((e) => e.kind === 'verdict.made' && e.subject === c.claim && e.data.outcome === 'PASS');
    expect(recorded.length, 'the planted PASS is a verdict.made event on the claim').toBeGreaterThan(0);
    const third = await stop(claude, s, 'Done.');
    const line3 = lineOf(third);
    expect(line3, `the stop after the PASS verdict carries the line: ${firedShown(third)}`).toMatch(/\bPASS 2\/2\b/);
    await claude.end();
  }, 240_000);

  it(`${AC3} (wrong program) a line that says PASS from the agent's own words (its last message says "all checks pass") fails: the record holds no verdict`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const s = newSession(h);
    const claude = await begin(h, s);
    await edits(claude, s);
    const c = await claim(claude, s);
    const fired = await stop(claude, s, 'Done. All checks pass: PASS 4/4.');
    const line = lineOf(fired);
    expect(line, `the judged stop carries a line: ${firedShown(fired)}`).toBeDefined();
    expect((await allEvents(hub)).filter((e) => e.kind === 'verdict.made' && e.subject === c.claim), 'no verdict exists').toEqual([]);
    expect(line, `the agent's word is never evidence: the line never says PASS on it: ${JSON.stringify(line)}`).not.toMatch(/\bPASS\b/);
    await claude.end();
  }, 180_000);
});

describe(`${AC5} The line names the next step's owner, and the receipt names the proof-bar checks it ran`, () => {
  const cases: { name: string; outcome: 'PASS' | 'FAIL' | 'BLOCKED'; owner: string; reqs: ReturnType<typeof req>[]; word: string }[] = [
    { name: 'a send-back', outcome: 'FAIL', owner: 'agent', word: 'sent back', reqs: [req(1, 'FAIL', 'unit', { smallest: 'receipt shows $18.00', points_to: 'total.ts:42' }), req(2, 'PASS')] },
    { name: 'a BLOCKED verdict', outcome: 'BLOCKED', owner: 'you', word: 'BLOCKED', reqs: [req(1, 'BLOCKED', 'journey:checkout', { smallest: 'secret STRIPE_KEY missing' }), req(2, 'PASS')] },
    { name: 'a PASS', outcome: 'PASS', owner: 'you', word: 'PASS', reqs: [req(1, 'PASS'), req(2, 'PASS', 'journey:checkout')] },
  ];
  for (const k of cases) {
    it(`${AC5} ${k.name}: the line names the next step's owner (${k.owner}), and the receipt lists the checks that ran with their outcomes`, async () => {
      const h = makeHome();
      const hub = await hubWithSetup(h);
      const s = newSession(h);
      const claude = await begin(h, s);
      await edits(claude, s);
      const c = await claim(claude, s);
      const ran = [{ check: 'unit', outcome: k.outcome === 'FAIL' ? 'failed' as const : 'passed' as const }, { check: 'journey:checkout', outcome: 'passed' as const }];
      await plant(hub, { session: s.id, claim: c.claim, outcome: k.outcome, round: 1, requirements: k.reqs, ran });
      const fired = await stop(claude, s);
      const line = lineOf(fired);
      expect(line, `the stop carries the line: ${firedShown(fired)}`).toBeDefined();
      expect(line, `the line names the outcome: ${JSON.stringify(line)}`).toContain(k.word);
      const owner = OWNER.exec(line!);
      expect(owner, `the line names the next step's owner as next: <owner>: ${JSON.stringify(line)}`).not.toBeNull();
      expect(owner![1], `${k.name}'s next step is ${k.owner}'s`).toBe(k.owner);
      const r = await receipt(hub, c);
      const checks = (r.checks ?? []).map((x) => `${x.check}:${x.outcome}`);
      expect(checks, `the receipt names the checks it ran, each with its outcome: ${receiptShown(r)}`).toEqual(expect.arrayContaining(ran.map((x) => `${x.check}:${x.outcome}`)));
      expect(r.line, 'the receipt carries the same line the chat showed').toBe(line);
      await claude.end();
    }, 180_000);
  }
});

describe(`${AC10} When a requirement wasn't verified, the line says so first, before any PASS count`, () => {
  it(`${AC10} a verdict with one requirement INCONCLUSIVE (its check never ran) and two PASS: the line starts with "not verified", names the requirement, and any count comes after it; with every requirement PASS the line says nothing of the kind`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const s = newSession(h);
    const claude = await begin(h, s);
    await edits(claude, s);
    const c = await claim(claude, s);
    await plant(hub, { session: s.id, claim: c.claim, outcome: 'INCONCLUSIVE', requirements: [req(1, 'PASS'), req(2, 'INCONCLUSIVE', 'journey:checkout'), req(3, 'PASS')], ran: [{ check: 'unit', outcome: 'passed' }] });
    const fired = await stop(claude, s);
    const line = lineOf(fired);
    expect(line, `the stop carries the line: ${firedShown(fired)}`).toBeDefined();
    expect(line, `the line says first that a requirement wasn't verified: ${JSON.stringify(line)}`).toMatch(/^not verified\b/);
    expect(line, 'it names the requirement that wasn\'t verified (R2)').toMatch(/\bR2\b/);
    const notVerified = line!.indexOf('not verified');
    const count = line!.search(/\d+\/\d+/);
    expect(count === -1 || notVerified < count, `any PASS count comes after "not verified": ${JSON.stringify(line)}`).toBe(true);
    expect(line, 'the line never reads as a bare PASS').not.toMatch(/^PASS\b/);
    for (const word of OUTCOME_WORDS) if (line!.includes(word)) expect(line!.indexOf(word), `the outcome word ${word} comes after "not verified"`).toBeGreaterThan(notVerified);
    // Control: every requirement verified.
    await plant(hub, { session: s.id, claim: c.claim, outcome: 'PASS', requirements: [req(1, 'PASS'), req(2, 'PASS', 'journey:checkout'), req(3, 'PASS')], ran: [{ check: 'unit', outcome: 'passed' }, { check: 'journey:checkout', outcome: 'passed' }] });
    const passed = lineOf(await stop(claude, s, 'Done.'));
    expect(passed, 'with every requirement verified the line starts with PASS and its count').toMatch(/^PASS 3\/3\b/);
    expect(passed).not.toContain('not verified');
    await claude.end();
  }, 180_000);

  it(`${AC10} (wrong program) a line that puts the PASS count first, "PASS 2/3 · not verified: R2", fails: "not verified" must come before any count`, () => {
    const wrong = 'PASS 2/3 · not verified: R2 · next: DeepBuild · receipt';
    expect(wrong.indexOf('not verified') < wrong.search(/\d+\/\d+/), 'the check catches a count before "not verified"').toBe(false);
    expect(wrong, 'and a line that starts with PASS').not.toMatch(/^not verified\b/);
  });
});
