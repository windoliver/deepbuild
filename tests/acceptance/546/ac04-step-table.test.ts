// Criterion 4 (no upstream test): "deep_kinds returns a step ceiling for every budget class, both hosts and 30, 60 and
// 120 Hz, each equal to that formula with the ns per fuel unit the logic module measured on the reference Mac, the
// web's below the app's, 30 Hz's equal to 60 Hz's and 120 Hz's half of it within one fuel unit; logic.budget fails
// exactly the steps over the ceiling deep_kinds returns for the piece's class, or over twice it for a pipelined item;
// and a planted table that publishes the fuel budget's cap of 10,000,000 as every ceiling fails, naming the class"
//
// The table is deep_kinds' `step_ceilings`; the ns per fuel unit is the logic module's own, from `deep-logic`'s
// `about` (README: deep-logic). Each ceiling of a class with frame CPU F (the design's table: 2 ms for core_view and
// data_view, 4 ms for figure, work_product and showpiece) is ⌊F × 3/4 ÷ ⌈rate ÷ 60⌉ ÷ ns per fuel unit⌋ for its host;
// export, which has no frame CPU, reads the fuel budget's cap (README: Readings). Then `burn` (programs.ts) runs steps
// whose fuels straddle each ceiling by a loop iteration or two, in a piece of each class with frame CPU at 60 Hz on
// [app, web], a figure piece at 120 Hz on [app, web], and a figure item at 30 Hz on [app], which, with only a hold
// write, is pipelined and held to twice the 30 Hz ceiling; logic.budget's ceiling failures are exactly the steps over
// (for the pipelined item, within one fuel unit of twice it), each naming the ceiling. A ceiling no step can pass under
// the fuel budget's cap is tested with a step near the cap, which must not fail. `deep-show run --planted
// step_ceilings_publish_fuel_cap` publishes 10,000,000 everywhere, and the table's judgement fails naming every class
// with frame CPU.
import { describe, expect, it } from 'vitest';
import {
  ABOUT, AC, CLASSES, FRAME_CPU_NS, FUEL_CAP, HOSTS, LIVE_CLASSES, RATES, TIMEOUT, bakeCall, bakeOf, bins, budgetCall, budgetOf,
  ceilingOf, failsNaming, fuelOf, none, nsPerFuel, onMac, piece, prebuild, stepTable, type Host, type JsonObject, type Table,
} from './helpers.ts';
import { burn, burnLine, burnParams, straddle, type Line } from './programs.ts';

prebuild(() => { bins(); });

/** The formula, evaluated in f64 in this order (README: step_ceilings). */
const formula =(frameNs: number, rate: number, nsPerFuel: number): number => Math.floor(frameNs * 0.75 / Math.ceil(rate / 60) / nsPerFuel);

/** What the criterion asks of the table: every class, both hosts, 30, 60 and 120 Hz, each the formula's. */
function tableProblems(t: Table, ns: Record<Host, number>): string[] {
  const out: string[] = [];
  for (const rate of RATES) if (!t[String(rate)]) out.push(`the table has no ${rate} Hz`);
  for (const [rate, classes] of Object.entries(t)) {
    const hz = Number(rate);
    if (!(hz > 0)) { out.push(`the table's rate ${rate} isn't a number of hertz`); continue; }
    for (const cls of CLASSES) {
      for (const host of HOSTS) {
        const got = classes[cls]?.[host];
        if (got === undefined) { out.push(`${cls}: no ${host} ceiling at ${rate} Hz`); continue; }
        const f = FRAME_CPU_NS[cls];
        const want = f === null ? FUEL_CAP : formula(f, hz, ns[host]);
        if (got !== want) out.push(`${cls}: the ${host} ceiling at ${rate} Hz is ${got}, not ${want} (${f === null ? 'no frame CPU: the fuel budget\'s cap' : `⌊${f} × 3/4 ÷ ⌈${rate} ÷ 60⌉ ÷ ${ns[host]}⌋`})`);
      }
    }
  }
  for (const cls of LIVE_CLASSES) {
    for (const rate of RATES) {
      const c = t[String(rate)]?.[cls];
      if (c?.['app'] !== undefined && c['web'] !== undefined && !(c['web'] < c['app'])) out.push(`${cls}: the web ceiling at ${rate} Hz, ${c['web']}, isn't below the app's, ${c['app']}`);
    }
    for (const host of HOSTS) {
      const [c30, c60, c120] = RATES.map((r) => t[String(r)]?.[cls]?.[host]);
      if (c30 === undefined || c60 === undefined || c120 === undefined) continue;
      if (c30 !== c60) out.push(`${cls}: the ${host} ceiling at 30 Hz, ${c30}, isn't 60 Hz's, ${c60}`);
      if (Math.abs(c120 - c60 / 2) > 1) out.push(`${cls}: the ${host} ceiling at 120 Hz, ${c120}, isn't half of 60 Hz's, ${c60}, within one fuel unit`);
    }
  }
  return out;
}

interface Case { label: string; cls: string; hz: number; on: Host[]; ceilings: Record<string, number>; slack: number }
/** burn's loop counts for a case: a light step, then for each host's ceiling (lowest first) two steps at or under it and two over it, or one near the cap. */
function countsFor(l: Line, c: Case): number[] {
  const out = [1_000];
  for (const host of [...c.on].sort((a, b) => c.ceilings[a]! - c.ceilings[b]!)) {
    const t = c.ceilings[host]! + c.slack;
    out.push(...(t + 4 * l.a < FUEL_CAP ? straddle(l, t) : [l.count(0.99 * FUEL_CAP)]));
  }
  return [...out, 1_000];
}
/** logic.budget's ceiling failures against the steps over each ceiling: exactly those, each naming its ceiling. */
function exactProblems(c: Case, fuel: Map<number, number>, failures: { item: string | null; step: number | null; host: string | null; ceiling: number | null; rule: string }[], l: Line): string[] {
  const out: string[] = [];
  const failed = new Map(failures.filter((f) => f.rule === 'ceiling').map((f) => [`${f.step} ${f.host}`, f]));
  for (const host of c.on) {
    const ceiling = c.ceilings[host]!;
    let under = false; let over = false;
    for (const [k, f] of fuel) {
      const got = failed.get(`${k} ${host}`);
      if (f > ceiling + c.slack && !got) out.push(`${c.label}: step ${k} spends ${f}, over the ${host} ceiling ${ceiling}${c.slack ? ' (twice the 30 Hz one)' : ''}, and logic.budget doesn't fail it`);
      if (f <= ceiling && got) out.push(`${c.label}: step ${k} spends ${f}, at or under the ${host} ceiling ${ceiling}, and logic.budget fails it: ${JSON.stringify(got)}`);
      if (got && (got.item !== 'burn' || got.ceiling === null || Math.abs(got.ceiling - ceiling) > c.slack)) out.push(`${c.label}: the failure for step ${k} on ${host} doesn't name the item burn and the ceiling ${ceiling}: ${JSON.stringify(got)}`);
      under ||= f <= ceiling && f > ceiling - 4 * l.a;
      over ||= f > ceiling + c.slack && f <= ceiling + c.slack + 4 * l.a;
    }
    if (ceiling + c.slack + 4 * l.a < FUEL_CAP && !(under && over)) out.push(`${c.label}: the test's steps don't straddle the ${host} ceiling ${ceiling} (fuels ${[...fuel.values()].join(', ')})`);
  }
  for (const [key, f] of failed) if (!c.on.includes(f.host as Host)) out.push(`${c.label}: logic.budget fails step ${key} on a host not in on`);
  return out;
}

describe(`${AC[4]} deep_kinds' step ceilings: the formula for every class, host and rate, and logic.budget holds steps to them`, () => {
  it(`${AC[4]} every ceiling equals the formula with the logic module's ns per fuel unit, and logic.budget fails exactly the steps over the piece's class's ceiling, or twice it for a pipelined item`, () => {
    const t = stepTable();
    const [about] = onMac([ABOUT]);
    const ns = nsPerFuel(about!);
    none(tableProblems(t, ns), 'deep_kinds\' step ceilings against the formula');

    const l = burnLine();
    const cases: Case[] = [
      ...LIVE_CLASSES.map((cls) => ({ label: `${cls} at 60 Hz`, cls, hz: 60, on: ['app', 'web'] as Host[], ceilings: { app: ceilingOf(t, 60, cls, 'app'), web: ceilingOf(t, 60, cls, 'web') }, slack: 0 })),
      { label: 'figure at 120 Hz', cls: 'figure', hz: 120, on: ['app', 'web'], ceilings: { app: ceilingOf(t, 120, 'figure', 'app'), web: ceilingOf(t, 120, 'figure', 'web') }, slack: 0 },
      { label: 'figure at 30 Hz, pipelined', cls: 'figure', hz: 30, on: ['app'], ceilings: { app: 2 * ceilingOf(t, 30, 'figure', 'app') }, slack: 1 },
    ];
    const calls: JsonObject[] = [];
    for (const c of cases) {
      const counts = countsFor(l, c);
      const p = piece({ seed: 546_04, class: c.cls, items: { burn: { program: burn(counts), params: burnParams(c.hz) } } });
      calls.push(bakeCall(p, { steps: counts.length }), budgetCall(p, { steps: counts.length }, c.on));
    }
    const replies = onMac(calls);
    const problems = cases.flatMap((c, i) => {
      const bake = bakeOf(replies[2 * i]!, `burn's bake, ${c.label}`);
      expect(bake.traps, `burn doesn't trap (${c.label})`).toEqual([]);
      return exactProblems(c, fuelOf(bake, 'burn'), budgetOf(replies[2 * i + 1]!, `logic.budget, ${c.label}`).failures, l);
    });
    none(problems, 'logic.budget fails exactly the steps over the ceiling deep_kinds returns');
  }, TIMEOUT);

  it(`${AC[4]} step_ceilings_publish_fuel_cap publishes 10,000,000 as every ceiling, and the table fails naming the class`, () => {
    const [about] = onMac([ABOUT]);
    failsNaming(tableProblems(stepTable('step_ceilings_publish_fuel_cap'), nsPerFuel(about!)), LIVE_CLASSES, 'step_ceilings_publish_fuel_cap');
  }, TIMEOUT);
});
