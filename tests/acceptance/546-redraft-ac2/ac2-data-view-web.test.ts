// #546's criterion 2 as amended (#546.232a6e07), redrafted blind (README): "With on [app, web], a step whose fuel lies
// between the data view class's web and app step ceilings passes on the app and fails on the web, naming the step, the
// host web and the ceiling, from the bake's fuel alone and the same on macOS and Linux; a piece whose steps all fit both
// ceilings reads BLOCKED on the web until the player's timed run, and a planted logic.budget that passes the web part
// from fuel alone reads PASS and fails, naming the host"
//
// The ceilings are deep_kinds' own, data_view at 60 Hz. `burn` (546's programs.ts) spends a chosen fuel at step 5 and
// 1,000 loop iterations at every other step. `between`'s step 5 lies a third of the way from the web ceiling up to the
// app ceiling (or the fuel budget's cap, if that is lower); `fits`'s step 5 spends half the web ceiling. Both pieces
// are class data_view. logic.budget on [app, web] runs on this Mac and in a linux/amd64 container, where no browser
// runs. One judgement is applied to each host's replies and to `--planted budget_web_passes_from_fuel`.
import { describe, expect, it } from 'vitest';
import {
  FUEL_CAP, TIMEOUT, bakeCall, bakeOf, bins, budgetCall, budgetOf, ceilingOf, failsNaming, fuelOf, line, none, onLinux,
  onMac, piece, prebuild, stepTable, type Budget, type Host, type JsonObject,
} from '../546/helpers.ts';
import { burn, burnLine, burnParams } from '../546/programs.ts';

prebuild(() => { bins(); });

const TAG = '#546.232a6e07';
const CLASS = 'data_view';
const RATE = 60;
const ITEM = 'burn';
const HEAVY = 5;
const STEPS = 12;
const LIGHT = 1_000;
const ON: Host[] = ['app', 'web'];

interface Setup { app: number; web: number; between: JsonObject; fits: JsonObject }
let made: Setup | undefined;
function setup(): Setup {
  if (made) return made;
  const t = stepTable();
  const app = ceilingOf(t, RATE, CLASS, 'app');
  const web = ceilingOf(t, RATE, CLASS, 'web');
  expect(web, 'the data view class\'s web step ceiling is below its app ceiling, so a step can lie between them').toBeLessThan(app);
  const l = burnLine();
  const top = Math.min(app, FUEL_CAP);
  // The least loop count whose fuel reaches web + a third of the way up; its fuel b + a × n then lies in [that, that + a).
  const n = Math.ceil((web + Math.max(2 * l.a, Math.floor((top - web) / 3)) - l.b) / l.a);
  expect(l.b + l.a * n + l.a <= top, `a burn step over the web ceiling ${web} fits under the app ceiling ${app} and the fuel budget's ${FUEL_CAP}`).toBe(true);
  const p = (heavy: number): JsonObject => piece({
    seed: 546_202, class: CLASS,
    items: { [ITEM]: { program: burn(Array.from({ length: STEPS }, (_, k) => (k === HEAVY ? heavy : LIGHT))), params: burnParams(RATE) } },
  });
  return (made = { app, web, between: p(n), fits: p(l.count(web / 2)) });
}

/** The criterion's judgement of logic.budget on [app, web] on one host: `between` passes on the app and fails on the web alone; `fits` reads BLOCKED on the web. */
function problems(between: Budget, fits: Budget, s: Setup, where: string): string[] {
  const out: string[] = [];
  if (between.verdict !== 'FAIL') out.push(`${where}: logic.budget reads ${between.verdict} on the piece whose step ${HEAVY} lies between the web and app ceilings; from the bake's fuel alone it fails on host web`);
  const ceiling = between.failures.filter((f) => f.rule === 'ceiling').map((f) => ({ item: f.item, step: f.step, host: f.host, ceiling: f.ceiling }));
  if (JSON.stringify(ceiling) !== JSON.stringify([{ item: ITEM, step: HEAVY, host: 'web', ceiling: s.web }])) {
    out.push(`${where}: logic.budget's ceiling failures aren't exactly one naming step ${HEAVY}, host web and ceiling ${s.web}: ${between.failures.map(line).join(', ') || 'none'}`);
  }
  const onApp = between.failures.filter((f) => f.host === 'app');
  if (onApp.length) out.push(`${where}: the step between the ceilings doesn't pass on host app: ${onApp.map(line).join(', ')}`);
  const held = between.items[ITEM]?.ceiling ?? {};
  if (held['app'] !== s.app || held['web'] !== s.web) out.push(`${where}: logic.budget doesn't hold ${ITEM} to the data view class's ceilings (host app ${s.app}, host web ${s.web}): its report reads ${JSON.stringify(held)}`);
  if (fits.verdict !== 'BLOCKED') out.push(`${where}: the piece whose steps all fit both ceilings reads ${fits.verdict}, not BLOCKED on host web until the player's timed run`);
  if (fits.failures.length) out.push(`${where}: the piece whose steps all fit both ceilings has failures: ${fits.failures.map(line).join(', ')}`);
  if (JSON.stringify(fits.blocked.map((b) => b.host)) !== JSON.stringify(['web']) || !fits.blocked[0]?.ask) {
    out.push(`${where}: the piece whose steps all fit doesn't read one blocked host, host web, with its ask: ${JSON.stringify(fits.blocked)}`);
  }
  return out;
}
/** What must read the same on macOS and Linux: each verdict, every failure, and the blocked hosts. */
const outcome = (b: Budget): string => JSON.stringify({ verdict: b.verdict, failures: b.failures.map((f) => f.raw), blocked: b.blocked.map((x) => x.host) });

describe(`${TAG} logic.budget on [app, web] in the data view class: the web's ceiling from the bake's fuel alone, the player's timed run still owed`, () => {
  it(`${TAG} a step between the data view class's web and app ceilings passes on the app and fails on the web, naming step, host web and ceiling, the same on macOS and Linux; a piece that fits both reads BLOCKED`, () => {
    const s = setup();
    const [bakeReply, fitsBake, macBetween, macFits] = onMac([
      bakeCall(s.between, { steps: STEPS }), bakeCall(s.fits, { steps: STEPS }), budgetCall(s.between, { steps: STEPS }, ON), budgetCall(s.fits, { steps: STEPS }, ON),
    ]);
    const fuel = fuelOf(bakeOf(bakeReply!, 'the bake of the piece whose step lies between the ceilings'), ITEM);
    const heavy = fuel.get(HEAVY) ?? -1;
    expect(heavy > s.web && heavy <= s.app && heavy < FUEL_CAP, `step ${HEAVY} spends ${heavy}: over the web ceiling ${s.web}, at or under the app ceiling ${s.app}`).toBe(true);
    none([...fuel].filter(([k, f]) => k !== HEAVY && (f < 0 || f > s.web)).map(([k, f]) => `step ${k}: ${f}`), `every other step of the piece fits the web ceiling ${s.web}`);
    none([...fuelOf(bakeOf(fitsBake!, 'the bake of the piece that fits'), ITEM)].filter(([, f]) => f < 0 || f > s.web).map(([k, f]) => `step ${k}: ${f}`), `every step of the piece that fits is at or under the web ceiling ${s.web}`);

    const mac = { between: budgetOf(macBetween!, 'logic.budget on macOS (between)'), fits: budgetOf(macFits!, 'logic.budget on macOS (fits)') };
    none(problems(mac.between, mac.fits, s, 'macOS'), 'logic.budget on [app, web] on macOS');
    const [linuxBetween, linuxFits] = onLinux([budgetCall(s.between, { steps: STEPS }, ON), budgetCall(s.fits, { steps: STEPS }, ON)]);
    const linux = { between: budgetOf(linuxBetween!, 'logic.budget on Linux x86_64 (between)'), fits: budgetOf(linuxFits!, 'logic.budget on Linux x86_64 (fits)') };
    none(problems(linux.between, linux.fits, s, 'Linux x86_64'), 'logic.budget on [app, web] on Linux x86_64');
    expect(outcome(linux.between), 'Linux reads what macOS reads on the step between the ceilings').toBe(outcome(mac.between));
    expect(outcome(linux.fits), 'Linux reads what macOS reads on the piece that fits').toBe(outcome(mac.fits));
  }, TIMEOUT);

  it(`${TAG} budget_web_passes_from_fuel reads PASS on the piece that fits, and the criterion fails on it naming host web`, () => {
    const s = setup();
    const [between, fits] = onMac([budgetCall(s.between, { steps: STEPS }, ON), budgetCall(s.fits, { steps: STEPS }, ON)], ['budget_web_passes_from_fuel']);
    const b = { between: budgetOf(between!, 'the planted logic.budget (between)'), fits: budgetOf(fits!, 'the planted logic.budget (fits)') };
    expect(b.fits.verdict, 'the planted logic.budget passes the web part from the bake\'s fuel alone').toBe('PASS');
    failsNaming(problems(b.between, b.fits, s, 'macOS'), ['host web'], 'budget_web_passes_from_fuel');
  }, TIMEOUT);
});
