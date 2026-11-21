// AC5 #277.cda3f5b9: In a two-copy match of the eight-seat piece, one copy in the app and one in headless Chrome's web
// player, hiding the web player's tab at step 1,200 for 20 s stamps one `seat {player, absent}` entry at the same step
// on both copies, from which the piece's bot plays that seat; back in view, the web copy runs the 1,200 steps it owes
// and those since, logic.budget with on [web] passes over its catch-up frames, and its full-state hashes equal the app
// copy's at the next hash interval; a planted copy that jumps to the confirmed step without running the steps fails
// logic.determinism, naming the step
//
// The piece is the eight-seat piece with its net item for the two copies (`players: 2`; seats 3 to 8 the bot's), live
// through the shipped relay behind #549's door: copy 1 in the app (`play_match` on its seeded script), copy 2 in
// headless Chrome's web player, whose person presses aim's keys while its page shows. The test hides the page as a
// person does who minimizes its window (its `document.visibilityState` turns `hidden`), once the copy has run step
// 1,200, for 20 s, then shows it again. "From which the piece's bot plays that seat": the `logic` call on the app's
// record has seat 2's `owner` the bot (0) from the absent step until the back. logic.budget on [web] over the catch-up
// frames follows the five-run rule: the page is hidden five times, one every 1,800 steps from step 1,200, and each
// catch-up's frames (probe().match.catch_ups[].frames, each frame's steps and its ms) give one run, its 95th
// percentile, judged by scripts/benchmark.mjs's judgeLimit against the showpiece class's 4 ms of frame CPU. The planted
// copy is the web bundle exported under `web_catch_up_jumps`; logic.determinism with `compare: "web"` reads the web
// copy's own golden of the steps it ran (probe().match.golden) against the app's bake on the match's record. Wrong
// programs it fails: the merge base (no seats; a hidden page's copy stalls the match); a hidden page that sends no
// absent; a return that jumps, or that runs its steps in the live frame past the class's frame CPU; a check that names
// another step than the first the copy skipped.
import { describe, expect, it } from 'vitest';
import { ABSENT_AT, DELAY, DOC, FRAME_CPU_MS, HASH_EVERY, HIDE_EVERY, HIDE_S, HIDE_STEP, LIVE_TIMEOUT_S, LOGIC, RATE, RUNS, arenaPiece, arenaPlays } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, appCopy, attempt, catchUpsOf, checkOf, element, goldenOf, hashesAgree, judgeFive, liveMatch, load, logicCall, none, oneSeat, p95, pressKeys, recordTrack,
  rowsOf, seatsOf, setHidden, show, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp, webCaughtUp, webCopy, webReaches, webUntil, type Copy,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
/** The two copies' players: the app's copy is player 1, the web player's player 2. */
const PAIR = 2;
const WEB = 2;
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const pair = (relay: string): ReturnType<typeof arenaPiece> => arenaPiece({ id: DOC.arenaPair, people: PAIR, net: { relay, timeout: LIVE_TIMEOUT_S } });
const ended = (m: Record<string, unknown>): boolean => m['end'] !== null && m['end'] !== undefined;
/** The steps a seat entry's step range for the first hide covers. */
const FIRST = { from: HIDE_STEP, to: HIDE_STEP + HIDE_EVERY };

describe(`${AC[5]} a hidden web player's seat passes to the bot, and its copy catches up off the live frame`, () => {
  it(`${AC[5]} hiding the web player's tab at step 1,200 for 20 s stamps one seat {2, absent} on both copies, the bot plays the seat, and back in view the web copy runs every step it owes within the frame budget and agrees at the next hash interval`, async () => {
    const steps = HIDE_STEP + RUNS * HIDE_EVERY;
    const plays = arenaPlays(PAIR, steps);
    const live = await liveMatch({ builds, certs, temp, closing, piece: pair, apps: 1, webs: 1, steps, plays: { '1': plays['1']! }, what: 'AC5' });
    const tab = live.tabs.get(WEB)!;
    let visible = true;
    let finished = false;
    let presser = pressKeys(tab, 2775, () => visible && !finished);
    const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < RUNS; i++) {
      await webReaches(tab, HIDE_STEP + i * HIDE_EVERY, `AC5 hide ${i + 1}`);
      visible = false;
      await presser;
      await setHidden(tab, true, 'AC5');
      await sleep(HIDE_S * 1000);
      const start = load();
      await setHidden(tab, false, 'AC5');
      visible = true;
      presser = pressKeys(tab, 2776 + i, () => visible && !finished);
      const m = await webCaughtUp(tab, i + 1, `AC5 return ${i + 1}`);
      loads.push({ start, end: load() });
      if (ended(m)) break;
    }
    const app = await appCopy(live.apps[0]!, 'AC5 the app\'s copy');
    const wm = await webUntil(tab, steps, 'AC5 the web copy');
    finished = true;
    await presser;
    const web = webCopy(wm, 'AC5 the web copy');
    const both: Copy[] = [app, web];
    const f: string[] = [];
    if (app.ran !== steps) f.push(`the app's copy ran ${app.ran} of ${steps} steps; its match ended ${String(app.end)} (${show(app.raw['ended'] ?? null, 300)})`);
    for (const c of both) { const left = seatsOf(c).filter((s) => s.state === 'left' && s.step < steps - HASH_EVERY); if (left.length) f.push(`copy ${c.player} holds a leave for a hidden page: ${show(left)}`); }
    const absent = oneSeat(both, WEB, 'absent', 'both copies, the first hide', FIRST);
    f.push(...absent.failures);
    const a = absent.at;
    if (a !== null && (a < ABSENT_AT || a > ABSENT_AT + RATE)) f.push(`the first hide's seat {2, absent} is at step ${a}, not within a second of ${ABSENT_AT}`);
    const back = oneSeat(both, WEB, 'back', 'both copies, the first return', { from: a ?? HIDE_STEP, to: FIRST.to });
    f.push(...back.failures);
    const b = back.at;
    // From the absent step until the back, the piece's bot plays seat 2: the app's record played by the `logic` call.
    if (a !== null && b !== null) {
      await attempt(f, 'the bot plays seat 2', async () => {
        const reply = await logicCall(builds.show(), temp(), 'AC5 the app\'s record, played by the logic call', { piece: live.piece, track: recordTrack(app), steps: b + 1 });
        const rows = rowsOf(reply['steps'], 'AC5 the logic call');
        const owner = (k: number): number => element(rows, k, `${LOGIC}.owner`, WEB - 1, 'AC5');
        if (owner(a - 1) !== WEB) f.push(`before the absent step ${a}, seat 2's owner is ${owner(a - 1)}, not player 2`);
        const notBot = Array.from({ length: b - a }, (_, i) => a + i).find((k) => owner(k) !== 0);
        if (notBot !== undefined) f.push(`at step ${notBot}, between the absent (${a}) and the back (${b}), seat 2's owner is ${owner(notBot)}, not the bot (0)`);
        if (owner(b) !== WEB) f.push(`at the back step ${b}, seat 2's owner is ${owner(b)}, not player 2`);
      });
    }
    // Back in view, it runs the steps it owes and those since, headless, in frames within the class's frame CPU.
    const ups = catchUpsOf(web, 'the web copy');
    if (ups.length < RUNS) f.push(`the web copy reports ${ups.length} catch-ups for ${RUNS} hides`);
    const u = ups[0];
    if (u && a !== null && u.from !== a - DELAY) f.push(`the first catch-up starts at step ${u.from}, not ${a - DELAY}, the first step the copy hadn't run`);
    if (u && b !== null && u.to < b - DELAY - 1) f.push(`the first catch-up ends at step ${u.to}, before the copy reached the others (its back is at ${b})`);
    if (u && (u.steps !== u.to - u.from + 1 || u.steps < HIDE_S * RATE)) f.push(`the first catch-up counts ${u.steps} steps from ${u.from} to ${u.to}, not the ${HIDE_S * RATE} it owed and those since`);
    for (const [i, x] of ups.entries()) {
      const sum = (x.frames ?? []).reduce((n, fr) => n + fr.steps, 0);
      if (!x.frames || x.frames.length === 0 || sum !== x.steps) f.push(`catch-up ${i + 1}'s frames (${show(x.frames, 200)}) don't hold its ${x.steps} steps`);
    }
    const golden = goldenOf(wm, LOGIC, 'the web copy');
    const skipped = golden.slice(0, web.ran).findIndex((h) => h === null);
    if (golden.length < web.ran || skipped !== -1) f.push(`the web copy's golden lacks step ${skipped === -1 ? golden.length : skipped} of the ${web.ran} it ran`);
    f.push(...hashesAgree(both, 'the app\'s copy and the web copy', Math.floor(steps / HASH_EVERY) - 2));
    if (b !== null) {
      const next = Math.ceil((b + 1) / HASH_EVERY) * HASH_EVERY;
      for (const c of both) if (!c.hashes.some((h) => h.step === next)) f.push(`copy ${c.player} reports no full-state hash at step ${next}, the next hash interval after the back`);
    }
    // logic.determinism on the web copy's own run passes: the control for the planted copy below.
    await attempt(f, 'logic.determinism compare web', async () => {
      const upTo = Math.min(web.ran, (app.record?.confirmed ?? 0) + 1);
      const reply = await logicCall(builds.show(), temp(), 'AC5 logic.determinism on the web copy\'s run', { piece: live.piece, track: recordTrack(app), steps: upTo, web: wm['golden']!, atTimes: [10, 60] });
      const c = checkOf(reply, 'AC5');
      if (c.verdict !== 'PASS') f.push(`logic.determinism with compare web reads ${c.verdict} on the honest web copy's run: ${show(c.failures, 600)}`);
    });
    none(f, `${AC[5]} the web player's tab hidden at step 1,200 for 20 s`);
    const runs = ups.slice(0, RUNS).map((x) => p95((x.frames ?? []).map((fr) => fr.ms)));
    await judgeFive(`${AC[5]} logic.budget on [web] over the web copy's catch-up frames (each of the five hides a run: its frames' 95th percentile)`, FRAME_CPU_MS, runs, loads, 'ms');
  }, TIMEOUT);

  it(`${AC[5]} a planted copy that jumps to the confirmed step without running the steps fails logic.determinism, naming the step`, async () => {
    const steps = HIDE_STEP + HIDE_EVERY;
    const plays = arenaPlays(PAIR, steps);
    const live = await liveMatch({ builds, certs, temp, closing, piece: pair, apps: 1, webs: 1, steps, plays: { '1': plays['1']! }, planted: 'web_catch_up_jumps', what: 'AC5 planted' });
    const tab = live.tabs.get(WEB)!;
    let visible = true;
    let presser = pressKeys(tab, 2785, () => visible);
    await webReaches(tab, HIDE_STEP, 'AC5 planted, the hide');
    visible = false;
    await presser;
    await setHidden(tab, true, 'AC5 planted');
    await sleep(HIDE_S * 1000);
    await setHidden(tab, false, 'AC5 planted');
    visible = true;
    presser = pressKeys(tab, 2786, () => visible);
    await webCaughtUp(tab, 1, 'AC5 planted, the return');
    const app = await appCopy(live.apps[0]!, 'AC5 planted, the app\'s copy');
    const wm = await webUntil(tab, steps, 'AC5 planted, the web copy');
    visible = false;
    await presser;
    const web = webCopy(wm, 'AC5 planted, the web copy');
    const absent = oneSeat([app, web], WEB, 'absent', 'AC5 planted, both copies', FIRST);
    none(absent.failures, `${AC[5]} the planted copy's absent`);
    const golden = goldenOf(wm, LOGIC, 'AC5 planted, the web copy');
    const skipped = golden.findIndex((h) => h === null);
    expect(skipped, `the planted copy skipped steps: its golden has a step it never ran, from ${absent.at! - DELAY}`).toBe(absent.at! - DELAY);
    const upTo = Math.min(golden.length, (app.record?.confirmed ?? 0) + 1);
    expect(upTo, 'the app\'s record reaches past the skipped steps').toBeGreaterThan(skipped);
    const reply = await logicCall(builds.show(), temp(), 'AC5 planted, logic.determinism on the web copy\'s run', { piece: live.piece, track: recordTrack(app), steps: upTo, web: wm['golden']!, atTimes: [10] });
    const c = checkOf(reply, 'AC5 planted');
    expect(c.verdict, `logic.determinism with compare web fails the planted copy: ${show(c.raw, 800)}`).toBe('FAIL');
    const named = c.failures.map((x) => x['step']).filter((s): s is number => typeof s === 'number').sort((x, y) => x - y)[0];
    expect(named, `logic.determinism names step ${skipped}, the first the copy jumped over: ${show(c.failures, 800)}`).toBe(skipped);
  }, TIMEOUT);
});
