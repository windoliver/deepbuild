// #669's live tests on Linux (README): every criterion of #669 on the platform #70 names for Linux. One real, scripted,
// headless Claude Code session through the agent test harness, on your plan, in checkout-web under a temporary HOME
// whose user settings `deep setup` wrote, with the hub the systemd user service deepbuild-hub.service of a user manager
// the test starts for itself (its session bus, the Secret Service, polkit's stand-in) and each claim check run in
// bubblewrap: the first stop says "done" before the fix and is held and sent back with its FAIL line, the fix's stop
// reads PASS, and "all done?" is answered from the record (AC1, AC2, AC4, AC5, as the macOS live file reads them).
// AC3 and AC6, which the macOS suite reads in its fast file, are read here on a second home through the stand-in
// sessions of ../helpers.ts, on the same Linux platform, the restart a Linux one. They spend plan usage, so they run
// only by hand or in the release preflight, on Linux:
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/669/linux session.live.test.ts
// On another platform every test fails BLOCKED naming it; without the opt-in, the token, a `claude` on PATH or a piece
// of the Linux platform, BLOCKED naming what is missing; nothing skips. A check seen running outside bubblewrap makes
// its world INVALID.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, AC5, AC6, FAILING_AT, STATUS_QUESTION, TESTS, allEvents, checkout, claimRef, claimsOf, cleanup, countsTests, cutAndZeroProblems, deep, git,
  judged, maskedProblems, namesPlace, outcomeOf, proof, realClaude, runsOf, sessionBlock, shared, shown, terminal, transcriptReading, verdictsOf,
  type Ev, type Home, type Line, type Ran, type Repo,
} from '../helpers.ts';
import { CHECK_PROCESS, harnessRunLinux, linuxHome, setUpLinux, sideWorldLinux } from './helpers.ts';
import { distro, linuxTeardown, requireLinux, restated, sandboxWatch, sandboxedOrInvalid } from '../../668/linux/platform.ts';

// The login first (its manager stopped and waited for, its mode-000 folders made removable), then the suite's cleanup, which runs either way.
afterAll(async () => { try { await linuxTeardown(); } finally { await cleanup(); } }, 180_000);

const MINUTE = 60_000;
function requireLive(id: string): string {
  requireLinux(id);
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error(`BLOCKED: ${id} starts a real Claude Code session on your plan; run it by hand with DEEP_HARNESS_LIVE=1`);
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) throw Error(`BLOCKED: ${id} runs its session under a temporary HOME, signed in with CLAUDE_CODE_OAUTH_TOKEN (make one with \`claude setup-token\`)`);
  return token;
}

interface Live { h: Home; repo: Repo; session: string; fixSha: string; events: Ev[]; claims: Ev[]; shown: ReturnType<typeof transcriptReading>['shown']; entries: Line[]; status: Ran }
const world = shared(async (): Promise<Live> => {
  try {
    const token = requireLive('#669');
    const { h, lx } = await linuxHome('#669', { claude: realClaude() });
    const repo = checkout(h, 'main');
    const { setup, unit } = await setUpLinux(h, lx, repo);
    proof('linux-live', 'systemd.txt', unit);
    const watch = sandboxWatch(lx, CHECK_PROCESS);
    const { ran, line } = await harnessRunLinux(h, repo, token);
    const seen = await watch.stop();
    proof('linux-live', 'sandbox.json', seen);
    proof('linux-live', 'machine.txt', `${distro()}\n`);
    const said = `${shown(ran)}; run line ${JSON.stringify(line ?? null).slice(0, 2000)}`;
    if (!line) throw Error(`BLOCKED: #669 the harness printed no run line for the fix-coupon-test scenario: ${said}`);
    if (line.verdict === 'BLOCKED') throw Error(`BLOCKED: #669 the harness's run was BLOCKED: ${line.reason}`);
    if (line.verdict !== 'PASS') throw Error(`INCONCLUSIVE: #669 the harness's run was ${line.verdict}: ${line.reason}; ${said}`);
    const session = String(line.sessionId);
    const { shown: chat, entries } = transcriptReading(String(line.transcript ?? ''));
    const fixSha = git(h, repo.dir, 'rev-parse', 'HEAD');
    if (fixSha === repo.base) throw Error('INCONCLUSIVE: #669 the session made no commit in checkout-web');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const events = await allEvents(h);
    const claims = claimsOf(events, session);
    if (claims.length < 2) throw Error(`INCONCLUSIVE: #669 the session must stop once before the fix and once after it, two claims; the record holds ${claims.length}`);
    const status = await deep(h, ['status'], { cwd: repo.dir });
    proof('linux-live', 'terminal.txt', [terminal(setup), terminal(ran), terminal(status)].join('\n'));
    proof('linux-live', 'chat.json', chat);
    proof('linux-live', 'record.json', { claims, verdicts: claims.flatMap((c) => verdictsOf(events, c)), runs: claims.flatMap((c) => runsOf(events, c)), events: events.filter((e) => e.session === session) });
    sandboxedOrInvalid('#669', seen);
    return { h, repo, session, fixSha, events, claims, shown: chat, entries, status };
  } catch (error) {
    throw restated(error);
  }
});
const side = shared(async () => {
  try { return await sideWorldLinux('linux-live'); } catch (error) { throw restated(error); }
});
const lineAfter = (w: Live, outcome: string) => w.shown.flatMap((s) => s.lines).find((l) => outcomeOf(l) === outcome);

describe(`AC1 ${AC1} The first stop is held, the check runs, and the chat shows one verdict line reading FAIL with the failing test's file and line and the count of tests run; the session goes on with the send-back`, () => {
  it(`AC1 ${AC1} (live, Linux) the real session's first stop, before the fix, is held while its check runs in bubblewrap and shows a FAIL line with ${FAILING_AT} and ${TESTS} tests, and the session goes on to fix it`, async () => {
    requireLive(AC1);
    const w = await world();
    const first = w.claims[0]!;
    const out: string[] = [];
    if (!runsOf(w.events, first).some((r) => r.finishedAt !== null)) out.push(`${AC1} the first stop's check must run: ${JSON.stringify(runsOf(w.events, first))}`);
    const firstLine = w.shown.flatMap((s) => s.lines).find((l) => outcomeOf(l) !== undefined);
    if (!firstLine || outcomeOf(firstLine) !== 'FAIL' || !namesPlace(firstLine) || !countsTests(firstLine, TESTS)) out.push(`${AC1} the chat's first verdict line must read FAIL with ${FAILING_AT} and ${TESTS} tests: ${JSON.stringify(firstLine ?? null)}; the chat ${JSON.stringify(w.shown.map((s) => s.lines))}`);
    if (!verdictsOf(w.events, first).some((v) => v.data.outcome === 'FAIL')) out.push(`${AC1} the first stop's claim must be judged FAIL: ${JSON.stringify(verdictsOf(w.events, first).map((v) => v.data))}`);
    expect(out, `${AC1} the real session's first stop`).toEqual([]);
  }, 40 * MINUTE);
});

describe(`AC2 ${AC2} The next stop, after the fix, reads PASS with its test count, and its verdict names the commit it judged`, () => {
  it(`AC2 ${AC2} (live, Linux) the real session's stop after its committed fix reads PASS with ${TESTS} tests, and its verdict names that commit`, async () => {
    requireLive(AC2);
    const w = await world();
    const pass = lineAfter(w, 'PASS');
    const last = w.claims.at(-1)!;
    const out: string[] = [];
    if (!pass || !countsTests(pass, TESTS)) out.push(`${AC2} the chat must show a PASS line with ${TESTS} tests after the fix: ${JSON.stringify(w.shown.map((s) => s.lines))}`);
    const verdicts = verdictsOf(w.events, last).filter((v) => v.data.outcome === 'PASS');
    if (!verdicts.length || !verdicts.every((v) => judged(v) === w.fixSha)) out.push(`${AC2} the last claim's PASS verdict must name the commit it judged, ${w.fixSha}: ${JSON.stringify(verdictsOf(w.events, last).map((v) => ({ outcome: v.data.outcome, commit: judged(v) })))}`);
    expect(out, `${AC2} the real session's stop after the fix`).toEqual([]);
  }, 40 * MINUTE);
});

describe(`AC3 ${AC3} A check cut short by a hub restart reads INCONCLUSIVE, and one that ran zero tests reads INVALID; neither line ever says PASS`, () => {
  it(`AC3 ${AC3} (Linux) a check whose tests are all skipped reads INVALID at its stop, a check cut short by a hub restart (SIGTERM to the hub unit's MainPID, then systemctl --user start) reads INCONCLUSIVE, both run in bubblewrap, and no line of either says PASS`, async () => {
    requireLive(AC3);
    const s = await side();
    let problems: string[];
    try { problems = cutAndZeroProblems(s); } catch (error) { throw restated(error); }
    expect(problems, `${AC3} zero tests and a hub restart`).toEqual([]);
    sandboxedOrInvalid(AC3, [...s.seen['zero-tests'], ...s.seen.slow]);
    if (!s.seen.slow.some((x) => x.sandboxed)) throw Error(`INCONCLUSIVE: ${AC3} no process of the slow check's run was seen under the test's user manager before the restart, so whether it ran in bubblewrap can't be read`);
  }, 40 * MINUTE);
});

describe(`AC4 ${AC4} Every verdict is a row in the record with the commit it judged, and \`deep status\` shows the same outcome as the chat`, () => {
  it(`AC4 ${AC4} (live, Linux) every verdict on the real session's claims names its claim's commit, and deep status after it shows the chat's last outcome`, async () => {
    requireLive(AC4);
    const w = await world();
    const out: string[] = [];
    for (const c of w.claims) for (const v of verdictsOf(w.events, c)) if (judged(v) !== String(c.data.commit)) out.push(`${AC4} verdict ${v.id} on ${claimRef(c)} must name its claim's commit ${c.data.commit}: ${JSON.stringify(judged(v))}`);
    const last = [...w.shown.flatMap((s) => s.lines)].reverse().find((l) => outcomeOf(l) !== undefined);
    const outcome = last ? outcomeOf(last) : undefined;
    const block = sessionBlock(w.status.stdout, w.session, [...new Set(w.events.map((e) => e.session).filter((s): s is string => typeof s === 'string'))]);
    if (!outcome || w.status.code !== 0 || !block || !new RegExp(outcome === 'FAIL' ? '\\bFAIL\\b|\\bsent back\\b' : `\\b${outcome}\\b`).test(block.join('\n'))) out.push(`${AC4} deep status must show the session with the chat's last outcome ${outcome ?? '(none shown)'}: ${shown(w.status)}`);
    expect(out, `${AC4} the record and deep status against the chat`).toEqual([]);
  }, 40 * MINUTE);
});

describe(`AC5 ${AC5} "all done?" typed into the session is answered from the record with no model call`, () => {
  it(`AC5 ${AC5} (live, Linux) "all done?" typed into the real session after its PASS is answered with the record's verdict, and the model never answers it`, async () => {
    requireLive(AC5);
    const w = await world();
    const blocked = w.shown.filter((s) => s.kind === 'blocked');
    const answer = blocked.at(-1);
    const newest = verdictsOf(w.events, w.claims.at(-1)!).at(-1);
    const out: string[] = [];
    if (!answer || !newest || !new RegExp(`\\b${newest.data.outcome}\\b`).test(answer.text)) out.push(`${AC5} "${STATUS_QUESTION}" must be answered by DeepBuild's prompt entry with the record's newest verdict ${newest?.data.outcome ?? '(none)'}: ${JSON.stringify(blocked)}`);
    if (answer && w.entries.slice(answer.at + 1).some((e) => e.type === 'assistant')) out.push(`${AC5} no model turn may follow "${STATUS_QUESTION}": the transcript has an assistant entry after its answer`);
    expect(out, `${AC5} "all done?" in the real session`).toEqual([]);
  }, 40 * MINUTE);
});

describe(`AC6 ${AC6} A planted runner that reports PASS on a check whose command masks its exit status fails this test, naming the check`, () => {
  it(`AC6 ${AC6} (Linux) the check \`npm test\`, whose package script masks Vitest's exit with \`|| true\`, run in bubblewrap, is never PASS: its claim is INVALID (or FAIL) and no line says PASS`, async () => {
    requireLive(AC6);
    const s = await side();
    let problems: string[];
    try { problems = maskedProblems(s); } catch (error) { throw restated(error); }
    expect(problems, `${AC6} the masked check`).toEqual([]);
    sandboxedOrInvalid(AC6, s.seen.masked);
  }, 40 * MINUTE);
});
