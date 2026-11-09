// Criterion 2 (no upstream test): "logic.budget fails a program whose busiest step in the bake used more than half
// its fuel, naming the step, and passes the flock; the flock's golden recorded on macOS matches on Linux x86_64 and
// in the web player step for step"
//
// Through `deep-logic budget` (logic.budget), `golden` and `golden_verify` (README: deep-logic), on this Mac, in a
// linux/amd64 container and through the web runner in headless Chrome. `hungry` (programs.ts) spends about 720,000
// of its 1,000,000 fuel at step 7 and almost none at other steps; the flock (flock.ts) spends under 2% a step. The
// flock's golden is recorded here, verified on Linux x86_64 (and a copy with step 37's hash changed fails there at
// step 37, so the verdict reads the golden), and its step hashes and checkpoints are those Linux's bake and Chrome's
// bake give, step for step.
import { describe, expect, it } from 'vitest';
import { ABOUT, AC, TIMEOUT, WEB_RUNNER, bakeCall, bakeOf, budgetCall, budgetOf, firstDiff, goldenCall, goldenCheckOf, goldenOf, goldenVerifyCall, hashesOf, inChrome, logicBin, obj, onLinux, onMac, piece, prebuild, str, webPlanCall, type BakeSpec, type JsonObject } from './helpers.ts';
import { HUNGRY_STEP, hungry } from './programs.ts';
import { FLOCK, flockPiece, windTrack } from './flock.ts';

prebuild(() => { logicBin(); });

const GOLDEN: BakeSpec = { steps: 600, track: windTrack(532_02, 600) };
const hungryPiece = (): JsonObject => piece({ seed: 532_02, class: 'figure', items: { hungry: { program: hungry(), writes: { k: { type: 'i32' } } } } });

describe(`${AC[2]} logic.budget holds each step to half its fuel, and the flock's golden holds on Linux x86_64 and in the web player`, () => {
  it(`${AC[2]} logic.budget fails the program whose step ${HUNGRY_STEP} used more than half its fuel, naming that step, and passes the flock`, () => {
    const [bakeReply, hungryReply, flockReply] = onMac([
      bakeCall(hungryPiece(), { steps: 12 }), budgetCall(hungryPiece(), { steps: 12 }), budgetCall(flockPiece(), GOLDEN),
    ]);
    const bake = bakeOf(bakeReply!, 'hungry\'s bake');
    const fuel = bake.steps.map((s) => s.items['hungry']?.fuel ?? -1);
    expect(fuel[HUNGRY_STEP]!, `hungry's step ${HUNGRY_STEP} used more than half of its 1,000,000 fuel and didn't trap`).toBeGreaterThan(500_000);
    expect(bake.traps, 'hungry never traps').toEqual([]);
    expect(fuel.filter((f, k) => k !== HUNGRY_STEP && f > 500_000), 'no other step of hungry used half its fuel').toEqual([]);
    const h = budgetOf(hungryReply!, 'logic.budget of hungry');
    expect(h.verdict, 'logic.budget fails hungry').toBe('FAIL');
    const share = h.failures.filter((f) => f.rule === 'fuel_share');
    expect(share.map((f) => [f.item, f.step]), `logic.budget names hungry's step ${HUNGRY_STEP}: ${JSON.stringify(h.failures)}`).toEqual([['hungry', HUNGRY_STEP]]);
    expect(h.report.items['hungry']?.step, 'the report names step 7 as the busiest').toBe(HUNGRY_STEP);
    const f = budgetOf(flockReply!, 'logic.budget of the flock');
    expect(f.failures, 'logic.budget finds nothing in the flock').toEqual([]);
    expect(f.verdict, 'logic.budget passes the flock').toBe('PASS');
  }, TIMEOUT);

  it(`${AC[2]} the flock's golden recorded on macOS verifies on Linux x86_64 step for step, under the same bake key`, () => {
    const [aboutReply, goldenReply, bakeReply] = onMac([ABOUT, goldenCall(flockPiece(), GOLDEN), bakeCall(flockPiece(), GOLDEN)]);
    const golden = goldenOf(goldenReply!, 'the golden recorded on this Mac');
    const mac = bakeOf(bakeReply!, 'this Mac\'s bake');
    expect(golden.machine.arch, 'the golden names the machine that recorded it').toBe(str(aboutReply!['arch'], 'about.arch'));
    expect(golden.step_hashes[FLOCK]?.length, 'the golden holds every step\'s hash').toBe(GOLDEN.steps);
    expect(firstDiff(golden.step_hashes[FLOCK] ?? [], hashesOf(mac.steps, FLOCK)), 'the golden holds this Mac\'s step hashes').toBeNull();
    const tampered: JsonObject = JSON.parse(JSON.stringify(golden.raw)) as JsonObject;
    const list = (obj(tampered['step_hashes'], 'golden.step_hashes')[FLOCK] as string[]);
    list[37] = list[37]!.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    const [linuxAbout, linuxBake, verify, verifyTampered] = onLinux([ABOUT, bakeCall(flockPiece(), GOLDEN), goldenVerifyCall(flockPiece(), GOLDEN, golden.raw), goldenVerifyCall(flockPiece(), GOLDEN, tampered)]);
    expect(linuxAbout!['arch'], 'the second machine is Linux x86_64').toBe('x86_64');
    const linux = bakeOf(linuxBake!, 'Linux x86_64\'s bake');
    expect(linux.keys, 'Linux computes the same bake key as the golden binds').toEqual(golden.bake_key);
    expect(firstDiff(hashesOf(linux.steps, FLOCK), golden.step_hashes[FLOCK] ?? []), 'Linux x86_64\'s step hashes equal the golden\'s step for step').toBeNull();
    expect(firstDiff((linux.checkpoints[FLOCK] ?? []).map((c) => `${c.step} ${c.deep_hash}`), (golden.checkpoint_hashes[FLOCK] ?? []).map((c) => `${c.step} ${c.deep_hash}`)), 'Linux x86_64\'s full-state hashes equal the golden\'s at each checkpoint').toBeNull();
    const v = goldenCheckOf(verify!, 'golden_verify on Linux x86_64');
    expect([v.verdict, v.machines, v.first_step], 'the golden verifies on Linux x86_64, another machine').toEqual(['PASS', 'different', null]);
    const t = goldenCheckOf(verifyTampered!, 'golden_verify of a golden whose step 37 was changed');
    expect([t.verdict, t.first_step], 'a golden that differs at step 37 fails there').toEqual(['FAIL', 37]);
  }, TIMEOUT);

  it(`${AC[2]} the flock's golden recorded on macOS matches the web player's bake in headless Chrome step for step`, async () => {
    const [goldenReply, runner, plan] = onMac([goldenCall(flockPiece(), GOLDEN), WEB_RUNNER, webPlanCall(flockPiece(), GOLDEN)]);
    const golden = goldenOf(goldenReply!, 'the golden recorded on this Mac');
    expect(plan!['ok'], `web_plan gave a request: ${JSON.stringify(plan).slice(0, 400)}`).toBe(true);
    const chrome = await inChrome(str(runner!['source'], 'web_runner.source'), [plan!['request']!]);
    expect(chrome.userAgent, 'the page ran in headless Chrome').toMatch(/HeadlessChrome|Chrome/);
    const web = bakeOf(obj(chrome.replies[0], 'Chrome\'s bake'), 'Chrome\'s bake');
    expect(firstDiff(hashesOf(web.steps, FLOCK), golden.step_hashes[FLOCK] ?? []), 'the web player\'s step hashes equal the golden\'s step for step').toBeNull();
    expect(firstDiff((web.checkpoints[FLOCK] ?? []).map((c) => `${c.step} ${c.deep_hash}`), (golden.checkpoint_hashes[FLOCK] ?? []).map((c) => `${c.step} ${c.deep_hash}`)), 'the web player\'s full-state hashes equal the golden\'s at each checkpoint').toBeNull();
  }, TIMEOUT);
});
