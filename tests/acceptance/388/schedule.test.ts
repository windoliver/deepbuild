// #388.46473baa, first clause: the sealed plan equals its committed snapshot. The plan is the `schedule`
// call's reply, the plan published at `deep://schedule/<core version>` (#387), and the snapshot is
// `crates/deep-show/schedule/<set>.json`, for the core and r1 build sets the proof line names, each sealed
// with exactly its list's canvas modules (a snapshot of the wrong set is not this plan). The wrong programs:
// a plan that drifted from its snapshot (the comparison is shown to name a dropped and a changed operator),
// a snapshot of another set, and a set holding an extra or a missing module. At the base the core set holds
// marks2d and motion and r1 lacks data, graph, record and sheet, and the two sets publish one plan.
import { describe, expect, it } from 'vitest';
import {
  REGISTRY, SCHEDULE, SET_MODULES, arr, clone, committedSchedule, none, obj, registry, run, scenario, scheduleDiff, setFailures, str, useBuilds, useEvidence,
  type Build, type JsonObject, type Registry,
} from './helpers.ts';

const CORE: Build = { set: 'core' };
const R1: Build = { set: 'r1' };
const builds = useBuilds([CORE, R1]);
const evidence = useEvidence();

function published(build: Build): { reg: Registry; schedule: JsonObject } {
  const replies = run(builds.bin(build), scenario(evidence(), [REGISTRY, SCHEDULE]));
  return { reg: registry(replies[0]!), schedule: replies[1]! };
}

/** The schedule's own stamps: its URI names the core's version, its set and its set digest are the build's. */
function stampFailures(reg: Registry, schedule: JsonObject, set: string): string[] {
  const failures: string[] = [];
  const core = str(reg.raw['core'], 'registry: core');
  if (schedule['uri'] !== `deep://schedule/${core}`) failures.push(`the ${set} schedule is published at ${JSON.stringify(schedule['uri'])}, not deep://schedule/${core}`);
  if (schedule['build_set'] !== set) failures.push(`the ${set} schedule says build_set ${JSON.stringify(schedule['build_set'])}`);
  if (reg.setDigest === null || schedule['set_digest'] !== reg.setDigest) failures.push(`the ${set} schedule's set_digest ${JSON.stringify(schedule['set_digest'])} isn't the sealed set's ${JSON.stringify(reg.setDigest)}`);
  const allowed = new Set<string>(['core', ...SET_MODULES[set as keyof typeof SET_MODULES]]);
  for (const [phase, list] of Object.entries(obj(schedule['phases'], `the ${set} schedule's phases`))) {
    for (const entry of arr(list, `phases.${phase}`)) {
      const e = obj(entry, `phases.${phase} entry`);
      if (!allowed.has(String(e['module']))) failures.push(`the ${set} schedule runs ${String(e['operator'])} (${phase}) of ${String(e['module'])}, a module its list doesn't name`);
    }
  }
  return failures;
}

/** The comparison isn't vacuous: a snapshot with one operator dropped, and one with an operator's reads changed, each fail naming that operator. */
function comparisonCatchesDrift(schedule: JsonObject, set: string): void {
  const phases = Object.entries(obj(schedule['phases'], 'phases')).filter(([, l]) => arr(l, 'phase').length > 0);
  expect(phases.length, `the ${set} plan runs at least one operator`).toBeGreaterThan(0);
  const [phase, list] = phases[0]!;
  const first = obj(arr(list, phase)[0], `${phase}[0]`);
  const name = `${phase}/${String(first['operator'])}`;
  const dropped = clone(schedule);
  (obj(dropped['phases'], 'phases')[phase] as JsonObject[]).shift();
  expect(scheduleDiff(schedule, dropped, `${set}, ${name} dropped from the snapshot`).join('\n'), 'a snapshot without one operator fails, naming it').toContain(name);
  const changed = clone(schedule);
  const entry = (obj(changed['phases'], 'phases')[phase] as JsonObject[])[0]!;
  entry['reads'] = [...arr(entry['reads'] ?? [], 'reads'), 'a.read.nobody.declared'];
  expect(scheduleDiff(schedule, changed, `${set}, ${name} changed in the snapshot`).join('\n'), 'a snapshot whose operator reads more fails, naming it').toContain(name);
}

describe('#388.46473baa the sealed plan equals its committed snapshot', () => {
  it('#388.46473baa core: sealed with exactly text and look, its published plan (deep://schedule/<core version>) equals crates/deep-show/schedule/core.json and runs only the core\'s, text\'s and look\'s operators', () => {
    const { reg, schedule } = published(CORE);
    none(setFailures(reg, 'core'), 'the core build holds exactly text and look', true);
    none(stampFailures(reg, schedule, 'core'), 'the core schedule is the core set\'s');
    none(scheduleDiff(schedule, committedSchedule('core'), 'core'), 'the sealed core plan equals its committed snapshot');
    comparisonCatchesDrift(schedule, 'core');
  }, 600_000);

  it('#388.46473baa r1: sealed with exactly text, look, marks2d, data, graph, record, sheet and motion, its published plan equals crates/deep-show/schedule/r1.json and runs only those modules\' and the core\'s operators', () => {
    const { reg, schedule } = published(R1);
    none(setFailures(reg, 'r1'), 'the r1 build holds exactly its list', true);
    none(stampFailures(reg, schedule, 'r1'), 'the r1 schedule is the r1 set\'s');
    none(scheduleDiff(schedule, committedSchedule('r1'), 'r1'), 'the sealed r1 plan equals its committed snapshot');
    comparisonCatchesDrift(schedule, 'r1');
  }, 600_000);

  it('#388.46473baa the core and r1 plans are two plans: r1\'s published plan differs from the core snapshot, naming operators of the modules r1 adds, so neither snapshot can stand for the other', () => {
    const core = published(CORE);
    const r1 = published(R1);
    const diff = scheduleDiff(r1.schedule, committedSchedule('core'), 'r1 against the core snapshot');
    expect(diff.length, 'r1\'s plan is not the core snapshot').toBeGreaterThan(0);
    const added = SET_MODULES.r1.filter((m) => !(SET_MODULES.core as readonly string[]).includes(m));
    const r1Only = Object.entries(r1.reg.operators).filter(([, o]) => added.includes(o.module as (typeof added)[number])).map(([n]) => n);
    expect(r1Only.length, `r1 registers operators of the modules it adds (${added.join(', ')})`).toBeGreaterThan(0);
    for (const op of r1Only) expect(core.reg.operators[op], `${op} (of ${r1.reg.operators[op]!.module}) is not in the core build`).toBeUndefined();
    expect(diff.join('\n'), 'the difference names an operator r1 adds').toMatch(new RegExp(r1Only.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')));
  }, 600_000);
});
