// Criterion 2 (no upstream test): "With on [app, web], a step whose fuel lies between the figure class's web and app
// step ceilings passes on the app and fails on the web, naming the step, the host web and the ceiling, from the bake's
// fuel alone and the same on macOS and Linux; a piece whose steps all fit both ceilings reads BLOCKED on the web until
// the player's timed run, and a planted logic.budget that passes the web part from fuel alone reads PASS and fails,
// naming the host"
//
// `burn` (programs.ts) spends a chosen fuel at step 5 and little elsewhere. The ceilings are deep_kinds' (figure, 60
// Hz). `between`'s step 5 spends more than the web ceiling and less than the app's (about 30% of the way up);
// `fits`'s step 5 spends half the web ceiling. logic.budget on [app, web] runs on this Mac and in a linux/amd64
// container, where no browser runs: `between` reads FAIL with one ceiling failure, step 5, host web, the web ceiling,
// and no failure names the app; `fits` reads BLOCKED with no failure and one blocked host, web; the two hosts give the
// same verdicts, failures and blocked hosts. `budget_web_passes_from_fuel` reads PASS on `fits`, and the criterion's
// judgement fails on it, naming the host web.
import { describe, expect, it } from 'vitest';
import {
  AC, FUEL_CAP, TIMEOUT, bakeCall, bakeOf, bins, budgetCall, budgetOf, ceilingOf, failsNaming, fuelOf, line, none, onLinux,
  onMac, piece, prebuild, stepTable, type Budget, type JsonObject,
} from './helpers.ts';
import { burn, burnLine, burnParams } from './programs.ts';

prebuild(() => { bins(); });

const HEAVY = 5;
const STEPS = 12;

interface Setup { app: number; web: number; between: JsonObject; fits: JsonObject }
let made: Setup | undefined;
function setup(): Setup {
  if (made) return made;
  const t = stepTable();
  const app = ceilingOf(t, 60, 'figure', 'app');
  const web = ceilingOf(t, 60, 'figure', 'web');
  expect(web, 'the figure class\'s web step ceiling is below its app ceiling').toBeLessThan(app);
  const l = burnLine();
  const target = web + Math.max(l.a, Math.floor(0.3 * (app - web)));
  expect(target + l.a < Math.min(app, FUEL_CAP), `a step between the web ceiling ${web} and the app ceiling ${app} fits the fuel budget's ${FUEL_CAP}`).toBe(true);
  const counts = (heavy: number): number[] => Array.from({ length: STEPS }, (_, k) => (k === HEAVY ? heavy : 1_000));
  const p = (heavy: number): JsonObject => piece({ seed: 546_02, class: 'figure', items: { burn: { program: burn(counts(heavy)), params: burnParams(60) } } });
  return (made = { app, web, between: p(Math.ceil((target - l.b) / l.a)), fits: p(l.count(web / 2)) });
}

/** What the criterion asks of logic.budget on [app, web]: `between` fails on the web alone, `fits` stays BLOCKED on the web. */
function webProblems(between: Budget, fits: Budget, s: Setup, host: string): string[] {
  const out: string[] = [];
  if (between.verdict !== 'FAIL') out.push(`${host}: logic.budget reads ${between.verdict} on the piece whose step ${HEAVY} lies between the ceilings, not FAIL`);
  const ceiling = between.failures.filter((f) => f.rule === 'ceiling').map((f) => ({ item: f.item, step: f.step, host: f.host, ceiling: f.ceiling }));
  if (JSON.stringify(ceiling) !== JSON.stringify([{ item: 'burn', step: HEAVY, host: 'web', ceiling: s.web }])) {
    out.push(`${host}: logic.budget's ceiling failures aren't exactly one naming step ${HEAVY}, host web and ceiling ${s.web}: ${between.failures.map(line).join(', ') || 'none'}`);
  }
  const onApp = between.failures.filter((f) => f.host === 'app');
  if (onApp.length) out.push(`${host}: the step between the ceilings fails on the app too: ${onApp.map(line).join(', ')}`);
  if (fits.verdict !== 'BLOCKED') out.push(`${host}: the piece whose steps fit both ceilings reads ${fits.verdict} on host web from the bake's fuel alone; it stays BLOCKED until the player's timed run`);
  if (fits.failures.length) out.push(`${host}: the piece whose steps fit both ceilings has failures: ${fits.failures.map(line).join(', ')}`);
  if (JSON.stringify(fits.blocked.map((b) => b.host)) !== JSON.stringify(['web'])) out.push(`${host}: the piece whose steps fit reads one blocked host, web, with its ask: ${JSON.stringify(fits.blocked)}`);
  return out;
}
const outcome = (b: Budget): string => JSON.stringify({ verdict: b.verdict, failures: b.failures.map((f) => f.raw), blocked: b.blocked.map((x) => x.host) });

describe(`${AC[2]} logic.budget on [app, web]: the web's ceiling from the bake's fuel alone, the timed run still owed`, () => {
  it(`${AC[2]} a step between the ceilings fails on the web alone, naming the step, host web and the ceiling, the same on macOS and Linux; a piece that fits reads BLOCKED`, () => {
    const s = setup();
    const on: ('app' | 'web')[] = ['app', 'web'];
    const [bakeReply, macBetween, macFits] = onMac([bakeCall(s.between, { steps: STEPS }), budgetCall(s.between, { steps: STEPS }, on), budgetCall(s.fits, { steps: STEPS }, on)]);
    const fuel = fuelOf(bakeOf(bakeReply!, 'the bake of the piece whose step lies between the ceilings'), 'burn').get(HEAVY)!;
    expect(fuel > s.web && fuel <= s.app, `step ${HEAVY} spends ${fuel}: over the web ceiling ${s.web}, at or under the app ceiling ${s.app}`).toBe(true);
    const mac = { between: budgetOf(macBetween!, 'logic.budget on this Mac (between)'), fits: budgetOf(macFits!, 'logic.budget on this Mac (fits)') };
    none(webProblems(mac.between, mac.fits, s, 'macOS'), 'logic.budget on [app, web] on macOS');
    const [linuxBetween, linuxFits] = onLinux([budgetCall(s.between, { steps: STEPS }, on), budgetCall(s.fits, { steps: STEPS }, on)]);
    const linux = { between: budgetOf(linuxBetween!, 'logic.budget on Linux x86_64 (between)'), fits: budgetOf(linuxFits!, 'logic.budget on Linux x86_64 (fits)') };
    none(webProblems(linux.between, linux.fits, s, 'Linux x86_64'), 'logic.budget on [app, web] on Linux x86_64');
    expect(outcome(linux.between), 'Linux reads what macOS reads on the step between the ceilings').toBe(outcome(mac.between));
    expect(outcome(linux.fits), 'Linux reads what macOS reads on the piece that fits').toBe(outcome(mac.fits));
  }, TIMEOUT);

  it(`${AC[2]} budget_web_passes_from_fuel reads PASS on the piece that fits, and the criterion fails, naming the host`, () => {
    const s = setup();
    const on: ('app' | 'web')[] = ['app', 'web'];
    const [between, fits] = onMac([budgetCall(s.between, { steps: STEPS }, on), budgetCall(s.fits, { steps: STEPS }, on)], ['budget_web_passes_from_fuel']);
    const b = { between: budgetOf(between!, 'the planted logic.budget (between)'), fits: budgetOf(fits!, 'the planted logic.budget (fits)') };
    expect(b.fits.verdict, 'the planted logic.budget passes the web part from fuel alone').toBe('PASS');
    failsNaming(webProblems(b.between, b.fits, s, 'macOS'), ['host web'], 'budget_web_passes_from_fuel');
  }, TIMEOUT);
});
